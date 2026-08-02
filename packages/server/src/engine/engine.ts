// ============================================================================
// VNTYPL8S game engine — pure, server-authoritative state machine.
// One GameEngine instance owns exactly one GameRoom. Net/timer side effects
// live outside; this file is deterministic given { rng, deckSource, now }.
// ============================================================================
import {
  FILLER_CARDS_PER_ROUND,
  MAX_PLAYERS,
  MIN_PLAYERS,
  TOTAL_ROUNDS,
  WRITE_SECONDS,
  satisfiesRequirements,
  validatePlate,
  type GameRoom,
  type GridCard,
  type OwnerCard,
  type Player,
  type PlayerRoundState,
  type RequirementsCard,
  type RoomPhase,
  type RoundState,
  type TurnResolution,
} from '@vntypl8s/shared';
import type { DeckSource } from './deck.js';
import { makeRng, type Rng } from './rng.js';

export type EngineResult = { ok: true } | { ok: false; error: string };
const ok: EngineResult = { ok: true };
const err = (error: string): EngineResult => ({ ok: false, error });

const IN_PROGRESS_PHASES: RoomPhase[] = ['WRITE_PLATES', 'GUESSING', 'ROUND_END'];

export interface EngineDeps {
  rng?: Rng;
  deckSource: DeckSource;
  now?: () => number;
}

export interface JoinInput {
  displayName: string;
  reconnectToken?: string;
  canCast?: boolean;
}
export type JoinResult =
  | { ok: true; player: Player; reconnected: boolean }
  | { ok: false; error: string };

let tokenSeq = 0;
function makeToken(): string {
  tokenSeq += 1;
  return `tok_${tokenSeq}_${Math.random().toString(36).slice(2, 10)}`;
}
let playerSeq = 0;
function makePlayerId(): string {
  playerSeq += 1;
  return `p_${playerSeq}_${Math.random().toString(36).slice(2, 8)}`;
}

export class GameEngine {
  readonly room: GameRoom;
  private readonly rng: Rng;
  private readonly deckSource: DeckSource;
  private readonly now: () => number;

  private pausedRemainingMs: number | null = null;
  private joinCounter = 0;

  constructor(code: string, deps: EngineDeps) {
    this.rng = deps.rng ?? makeRng();
    this.deckSource = deps.deckSource;
    this.now = deps.now ?? (() => Date.now());
    this.room = {
      code,
      phase: 'LOBBY',
      players: [],
      round: null,
      ownerDeck: [],
      requirementsDeck: [],
      timer: { enabled: true, phaseDeadline: null },
      pause: { active: false, reason: null, waitingForPlayerId: null },
      castConnected: false,
      winnerPlayerIds: [],
      createdAt: this.now(),
      phaseBeforePause: null,
    };
  }

  static create(code: string, deps: EngineDeps): GameEngine {
    return new GameEngine(code, deps);
  }

  // ---------------------------------------------------------------- helpers
  private player(id: string): Player | undefined {
    return this.room.players.find((p) => p.id === id);
  }
  private host(): Player | undefined {
    return this.room.players.find((p) => p.isHost);
  }
  private isHost(id: string): boolean {
    return this.host()?.id === id;
  }
  /** Players that actively participate this round (not queued mid-join). */
  activePlayers(): Player[] {
    return this.room.players.filter((p) => !p.pendingJoin);
  }
  private roundState(playerId: string): PlayerRoundState | undefined {
    return this.room.round?.playerStates.find((s) => s.playerId === playerId);
  }
  /** The player whose plate is currently on the TV, or null. */
  activePlayerId(): string | null {
    const r = this.room.round;
    if (!r || this.room.phase !== 'GUESSING') return null;
    if (r.turnIndex < 0 || r.turnIndex >= r.turnOrder.length) return null;
    return r.turnOrder[r.turnIndex] ?? null;
  }

  // ------------------------------------------------------------------- join
  join(input: JoinInput): JoinResult {
    const { displayName, reconnectToken, canCast } = input;

    // Reconnect path: a known token reclaims the same seat.
    if (reconnectToken) {
      const existing = this.room.players.find((p) => p.reconnectToken === reconnectToken);
      if (existing) {
        existing.connected = true;
        if (canCast !== undefined) existing.canCast = canCast;
        this.maybeResume();
        return { ok: true, player: existing, reconnected: true };
      }
    }

    const name = displayName.trim();
    if (!name) return { ok: false, error: 'Display name required.' };
    const dupe = this.room.players.some((p) => p.displayName.toLowerCase() === name.toLowerCase());
    if (dupe) return { ok: false, error: 'That name is taken in this room.' };
    if (this.room.players.length >= MAX_PLAYERS) {
      return { ok: false, error: `Room is full (${MAX_PLAYERS} players max).` };
    }

    const inProgress =
      IN_PROGRESS_PHASES.includes(this.room.phase) || this.room.phase === 'PAUSED';

    const player: Player = {
      id: makePlayerId(),
      reconnectToken: makeToken(),
      displayName: name,
      connected: true,
      isHost: !this.host(),
      canCast: canCast ?? false,
      // Mid-game joiners sit out until the next round boundary.
      pendingJoin: inProgress,
      joinOrder: this.joinCounter++,
      ownerPile: [],
      requirementsPile: [],
    };
    this.room.players.push(player);
    return { ok: true, player, reconnected: false };
  }

  // ------------------------------------------------------------------ start
  start(hostId: string): EngineResult {
    if (!this.isHost(hostId)) return err('Only the host can start the game.');
    if (this.room.phase !== 'LOBBY') return err('Game already started.');

    const present = this.room.players.filter((p) => p.connected && !p.pendingJoin);
    if (present.length < MIN_PLAYERS) return err(`Need at least ${MIN_PLAYERS} players.`);
    if (present.length > MAX_PLAYERS) return err(`At most ${MAX_PLAYERS} players.`);

    for (const p of this.room.players) {
      p.ownerPile = [];
      p.requirementsPile = [];
      p.pendingJoin = false;
    }
    this.room.winnerPlayerIds = [];
    this.room.ownerDeck = this.deckSource.ownerDeck(this.rng);
    this.room.requirementsDeck = this.deckSource.requirementsDeck(this.rng);

    this.beginRound(1);
    return ok;
  }

  // ------------------------------------------------------------- round flow
  private drawOwner(): OwnerCard {
    const c = this.room.ownerDeck.shift();
    if (!c) throw new Error('Owner deck exhausted.');
    return c;
  }
  private drawRequirements(): RequirementsCard {
    const c = this.room.requirementsDeck.shift();
    if (!c) throw new Error('Requirements deck exhausted.');
    return c;
  }

  private beginRound(roundNumber: number): void {
    // Promote anyone who joined mid-game; they play from this round on.
    for (const p of this.room.players) p.pendingJoin = false;

    const playerStates: PlayerRoundState[] = this.activePlayers().map((p) => ({
      playerId: p.id,
      ownerCard: this.drawOwner(),
      requirementsCard: this.drawRequirements(),
      plate: '',
      submitted: false,
      submittedAt: null,
      requirementsMet: false,
    }));

    const round: RoundState = {
      roundNumber,
      playerStates,
      grid: [],
      turnOrder: [],
      turnIndex: -1,
      currentResolution: null,
      resolutions: [],
    };
    this.room.round = round;
    this.room.phase = 'WRITE_PLATES';
    this.startTimer(WRITE_SECONDS);
  }

  // ------------------------------------------------------- writing plates
  setPlate(playerId: string, plate: string): EngineResult {
    if (this.room.phase !== 'WRITE_PLATES') return err('Not in the writing phase.');
    const st = this.roundState(playerId);
    if (!st) return err('You are not playing this round.');
    if (st.submitted) return err('Plate already submitted.');
    // An empty draft is a legal intermediate state (the player cleared it),
    // but anything non-empty must pass the mechanical rules.
    if (plate.length > 0) {
      const v = validatePlate(plate);
      if (!v.ok) return err(`Illegal plate (${v.error}).`);
    }
    st.plate = plate;
    st.requirementsMet = satisfiesRequirements(plate, st.requirementsCard.chars);
    return ok;
  }

  submitPlate(playerId: string): EngineResult {
    if (this.room.phase !== 'WRITE_PLATES') return err('Not in the writing phase.');
    const st = this.roundState(playerId);
    if (!st) return err('You are not playing this round.');
    if (st.submitted) return err('Plate already submitted.');
    const v = validatePlate(st.plate);
    if (!v.ok) return err(`Illegal plate (${v.error}).`);
    st.submitted = true;
    st.submittedAt = this.now();
    st.requirementsMet = satisfiesRequirements(st.plate, st.requirementsCard.chars);
    this.maybeAssembleGrid();
    return ok;
  }

  /**
   * Write timer expired: auto-submit everyone with whatever draft they have.
   * An empty draft is allowed (matches the physical game's "time's up") — the
   * player simply can't realistically be guessed and scores no bonus.
   */
  writeTimerExpired(): EngineResult {
    if (this.room.phase !== 'WRITE_PLATES' || !this.room.round) {
      return err('No active write timer.');
    }
    for (const st of this.room.round.playerStates) {
      if (st.submitted) continue;
      if (!validatePlate(st.plate).ok && st.plate.length > 0) st.plate = '';
      st.submitted = true;
      st.submittedAt = this.now();
      st.requirementsMet =
        st.plate.length > 0 && satisfiesRequirements(st.plate, st.requirementsCard.chars);
    }
    this.maybeAssembleGrid();
    return ok;
  }

  private maybeAssembleGrid(): void {
    const round = this.room.round;
    if (!round) return;
    if (!round.playerStates.every((s) => s.submitted)) return;

    // Turn order = submit order, ties broken by joinOrder.
    round.turnOrder = round.playerStates
      .slice()
      .sort((a, b) => {
        const ta = a.submittedAt ?? Infinity;
        const tb = b.submittedAt ?? Infinity;
        if (ta !== tb) return ta - tb;
        const ja = this.player(a.playerId)?.joinOrder ?? 0;
        const jb = this.player(b.playerId)?.joinOrder ?? 0;
        return ja - jb;
      })
      .map((s) => s.playerId);

    const grid: GridCard[] = round.playerStates.map((s) => ({
      card: s.ownerCard,
      ownerPlayerId: s.playerId,
      status: 'IN_GRID' as const,
    }));
    for (let i = 0; i < FILLER_CARDS_PER_ROUND; i++) {
      grid.push({ card: this.drawOwner(), ownerPlayerId: null, status: 'IN_GRID' });
    }
    round.grid = this.rng.shuffle(grid);

    round.turnIndex = 0;
    this.room.phase = 'GUESSING';
    this.stopTimer();
  }

  // ------------------------------------------------------------- guessing
  award(activePlayerId: string, winnerPlayerId: string | null): EngineResult {
    if (this.room.phase !== 'GUESSING') return err('Not in the guessing phase.');
    const round = this.room.round;
    if (!round) return err('No active round.');
    if (this.activePlayerId() !== activePlayerId) {
      return err('Only the Active Player can award the point.');
    }
    if (round.currentResolution) return err('This plate is already resolved.');

    if (winnerPlayerId !== null) {
      if (winnerPlayerId === activePlayerId) return err('You cannot award yourself.');
      const winner = this.player(winnerPlayerId);
      if (!winner || winner.pendingJoin) return err('No such player in this round.');
      if (!round.playerStates.some((s) => s.playerId === winnerPlayerId)) {
        return err('No such player in this round.');
      }
    }

    const st = round.playerStates.find((s) => s.playerId === activePlayerId)!;
    const outcome = winnerPlayerId === null ? 'MISSED' : 'GUESSED';

    // Mark the grid card FIRST, then compute the requirements bonus.
    const gridCard = round.grid.find(
      (g) => g.ownerPlayerId === activePlayerId && g.status === 'IN_GRID',
    );
    if (gridCard) {
      gridCard.status = outcome === 'GUESSED' ? 'SCORED' : 'DISCARDED';
      if (outcome === 'GUESSED' && winnerPlayerId) {
        this.player(winnerPlayerId)?.ownerPile.push(gridCard.card);
      }
    }

    const requirementsScored = st.requirementsMet && outcome === 'GUESSED';
    if (requirementsScored) {
      // The Requirements bonus goes to the ACTIVE player, not the guesser.
      this.player(activePlayerId)?.requirementsPile.push(st.requirementsCard);
    }

    const resolution: TurnResolution = {
      activePlayerId,
      outcome,
      winnerPlayerId,
      revealedOwnerCard: st.ownerCard,
      revealedRequirementsCard: st.requirementsCard,
      requirementsMet: st.requirementsMet,
      requirementsScored,
    };
    round.currentResolution = resolution;
    round.resolutions.push(resolution);
    return ok;
  }

  advanceTurn(activePlayerId: string): EngineResult {
    if (this.room.phase !== 'GUESSING') return err('Not in the guessing phase.');
    const round = this.room.round;
    if (!round) return err('No active round.');
    if (this.activePlayerId() !== activePlayerId) {
      return err('Only the Active Player can advance.');
    }
    if (!round.currentResolution) return err('Award the point first.');

    round.currentResolution = null;
    round.turnIndex += 1;

    if (round.turnIndex >= round.turnOrder.length) {
      // End of round: everything left face-up in the grid is discarded.
      for (const g of round.grid) {
        if (g.status === 'IN_GRID') g.status = 'DISCARDED';
      }
      if (round.roundNumber >= TOTAL_ROUNDS) {
        this.endGame();
      } else {
        this.room.phase = 'ROUND_END';
        this.stopTimer();
      }
    }
    return ok;
  }

  // ------------------------------------------------------------ round end
  nextRound(hostId: string): EngineResult {
    if (!this.isHost(hostId)) return err('Only the host can advance the round.');
    if (this.room.phase !== 'ROUND_END') return err('Round is not over.');
    this.beginRound((this.room.round?.roundNumber ?? 0) + 1);
    return ok;
  }

  private endGame(): void {
    const scored = this.room.players.filter((p) => !p.pendingJoin);
    const total = (p: Player) => p.ownerPile.length + p.requirementsPile.length;
    if (scored.length > 0) {
      const maxTotal = Math.max(...scored.map(total));
      let winners = scored.filter((p) => total(p) === maxTotal);
      if (winners.length > 1) {
        // Tiebreak: most Requirements cards among the leaders.
        const maxReq = Math.max(...winners.map((p) => p.requirementsPile.length));
        winners = winners.filter((p) => p.requirementsPile.length === maxReq);
      }
      // Still tied → shared victory: everyone remaining stays a winner.
      this.room.winnerPlayerIds = winners.map((p) => p.id);
    } else {
      this.room.winnerPlayerIds = [];
    }
    this.room.phase = 'GAME_OVER';
    this.stopTimer();
    this.room.pause = { active: false, reason: null, waitingForPlayerId: null };
    this.room.phaseBeforePause = null;
  }

  // ---------------------------------------------------------- host powers
  forceEnd(hostId: string): EngineResult {
    if (!this.isHost(hostId)) return err('Only the host can end the game.');
    this.endGame();
    return ok;
  }

  rematch(hostId: string): EngineResult {
    if (!this.isHost(hostId)) return err('Only the host can start a rematch.');
    this.room.phase = 'LOBBY';
    this.room.round = null;
    this.room.winnerPlayerIds = [];
    this.room.ownerDeck = [];
    this.room.requirementsDeck = [];
    this.room.pause = { active: false, reason: null, waitingForPlayerId: null };
    this.room.phaseBeforePause = null;
    this.stopTimer();
    for (const p of this.room.players) {
      p.ownerPile = [];
      p.requirementsPile = [];
      p.pendingJoin = false;
    }
    return ok;
  }

  /** UI flag only — Cast is optional here and never gates a phase transition. */
  setCastConnected(connected: boolean): EngineResult {
    this.room.castConnected = connected;
    return ok;
  }

  // ----------------------------------------------------- disconnect/pause
  disconnect(playerId: string): EngineResult {
    const p = this.player(playerId);
    if (!p) return err('No such player.');
    p.connected = false;
    if (p.isHost) this.transferHost(p);
    if (IN_PROGRESS_PHASES.includes(this.room.phase)) {
      this.pause('PLAYER_DISCONNECT', playerId);
    }
    return ok;
  }

  /** Permanently remove a player (lobby leave / host kick). */
  removePlayer(playerId: string): EngineResult {
    const p = this.player(playerId);
    if (!p) return err('No such player.');
    if (p.isHost) this.transferHost(p);
    this.room.players = this.room.players.filter((x) => x.id !== playerId);
    if (this.room.phase === 'PAUSED') this.maybeResume();
    return ok;
  }

  private transferHost(old: Player): void {
    old.isHost = false;
    const candidates = this.room.players.filter((p) => p.id !== old.id && p.connected);
    if (candidates.length === 0) {
      old.isHost = true; // nobody to take over; keep (game stays paused)
      return;
    }
    const caster = candidates.find((p) => p.canCast);
    (caster ?? candidates[0]!).isHost = true;
  }

  private pause(reason: 'PLAYER_DISCONNECT', waitingForPlayerId: string | null): void {
    if (this.room.phase === 'PAUSED') {
      if (!this.room.pause.waitingForPlayerId && waitingForPlayerId) {
        this.room.pause.waitingForPlayerId = waitingForPlayerId;
      }
      return;
    }
    this.pausedRemainingMs = this.room.timer.phaseDeadline
      ? Math.max(0, this.room.timer.phaseDeadline - this.now())
      : null;
    this.room.phaseBeforePause = this.room.phase;
    this.room.phase = 'PAUSED';
    this.room.timer.phaseDeadline = null;
    this.room.pause = { active: true, reason, waitingForPlayerId };
  }

  private maybeResume(): void {
    if (this.room.phase !== 'PAUSED') return;
    const anyDisconnectedActive = this.room.players.some((p) => !p.connected && !p.pendingJoin);
    if (anyDisconnectedActive) return;

    this.room.phase = this.room.phaseBeforePause ?? 'LOBBY';
    this.room.phaseBeforePause = null;
    this.room.pause = { active: false, reason: null, waitingForPlayerId: null };
    if (this.room.timer.enabled && this.pausedRemainingMs !== null) {
      this.room.timer.phaseDeadline = this.now() + this.pausedRemainingMs;
    }
    this.pausedRemainingMs = null;
  }

  // ----------------------------------------------------------------- timer
  private startTimer(seconds: number): void {
    this.room.timer.phaseDeadline = this.room.timer.enabled ? this.now() + seconds * 1000 : null;
  }
  private stopTimer(): void {
    this.room.timer.phaseDeadline = null;
  }
}
