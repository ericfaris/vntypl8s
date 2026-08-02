// ============================================================================
// Canonical server-side model. Anything in here may contain secrets; only the
// shapes in projection.ts are ever sent to a client or the TV receiver.
// ============================================================================

// ---------- Cards ----------
export interface OwnerCard {
  id: string; // 'own_001'
  title: string; // 'Park Ranger'
}
export interface RequirementsCard {
  id: string; // 'req_01'
  chars: string; // exactly 3, all in PLATE_ALPHABET, e.g. 'RF5'
}

// ---------- Phases ----------
export type RoomPhase =
  | 'LOBBY'
  | 'WRITE_PLATES' // simultaneous composition
  | 'GUESSING' // turn-based reveal/guess/award
  | 'ROUND_END' // interstitial
  | 'GAME_OVER'
  | 'PAUSED';

// ---------- Players ----------
export interface Player {
  id: string;
  reconnectToken: string; // secret
  displayName: string;
  connected: boolean;
  isHost: boolean;
  canCast: boolean; // device reported Cast Sender support
  pendingJoin: boolean; // joined mid-game; active next round
  joinOrder: number;
  /** Scoring piles — persist across rounds, cleared only on rematch. */
  ownerPile: OwnerCard[];
  requirementsPile: RequirementsCard[];
}

// ---------- Per-player round state ----------
export interface PlayerRoundState {
  playerId: string;
  ownerCard: OwnerCard; // SERVER-ONLY until revealed/awarded
  requirementsCard: RequirementsCard; // SERVER-ONLY until this player's turn resolves
  plate: string; // draft while writing, final once submitted
  submitted: boolean;
  submittedAt: number | null; // drives finish order == guessing turn order
  /** Computed at submit time; server-authoritative. */
  requirementsMet: boolean;
}

// ---------- Grid ----------
export interface GridCard {
  card: OwnerCard;
  /** playerId whose card this is, or null for one of the 6 filler cards.
   *  NEVER projected publicly while face-up in the grid. */
  ownerPlayerId: string | null;
  status: 'IN_GRID' | 'SCORED' | 'DISCARDED';
}

// ---------- Turn resolution ----------
export type TurnOutcome = 'GUESSED' | 'MISSED';
export interface TurnResolution {
  activePlayerId: string;
  outcome: TurnOutcome;
  /** who guessed it (null when MISSED) */
  winnerPlayerId: string | null;
  /** the Active Player's Owner card — revealed once the turn resolves */
  revealedOwnerCard: OwnerCard;
  /** the Active Player's Requirements card — revealed once the turn resolves */
  revealedRequirementsCard: RequirementsCard;
  requirementsMet: boolean;
  /** true iff requirementsMet && outcome === 'GUESSED' */
  requirementsScored: boolean;
}

// ---------- Round ----------
export interface RoundState {
  roundNumber: number; // 1..3
  playerStates: PlayerRoundState[];
  /** Assembled at the end of WRITE_PLATES: every player's card + 6 filler, shuffled. */
  grid: GridCard[];
  /** playerIds in submit order; the guessing turn order. */
  turnOrder: string[];
  turnIndex: number; // index into turnOrder; -1 while writing
  /** Set once the current Active Player's turn resolves; cleared on advance. */
  currentResolution: TurnResolution | null;
  /** Every resolution this round, in order — drives the TV recap. */
  resolutions: TurnResolution[];
}

// ---------- Room ----------
export interface GameRoom {
  code: string;
  phase: RoomPhase;
  players: Player[];
  round: RoundState | null;
  /** Undealt remainder of the shuffled decks for this game. */
  ownerDeck: OwnerCard[];
  requirementsDeck: RequirementsCard[];
  timer: TimerState;
  pause: PauseState;
  castConnected: boolean;
  winnerPlayerIds: string[]; // supports shared victory
  createdAt: number;
  phaseBeforePause: RoomPhase | null;
}

export interface TimerState {
  enabled: boolean;
  phaseDeadline: number | null;
}
export interface PauseState {
  active: boolean;
  reason: 'PLAYER_DISCONNECT' | null;
  waitingForPlayerId: string | null;
}

// ---------- Constants ----------
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const TOTAL_ROUNDS = 3;
export const FILLER_CARDS_PER_ROUND = 6;
export const WRITE_SECONDS = 120; // generous; the timer is advisory
