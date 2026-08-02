// ============================================================================
// Spectator-safe projectors. THIS FILE IS THE SECURITY BOUNDARY.
//
// The TV receiver and every non-owning player socket only ever see what
// toPublicRoom() explicitly constructs here. Build every object field by
// field — a single `{...gridCard}` spread hands the TV the answer key
// (GridCard.ownerPlayerId is the entire secret of the game).
//
// Invariants enforced here and asserted in __tests__/harness.ts:
//   1. PublicGridCard never carries an owner mapping while IN_GRID.
//   2. PublicRound.revealedPlate is non-null only for the current Active
//      Player, and only during GUESSING.
//   3. PublicPlayer carries pile *counts*, never pile contents.
//   4. No reconnectToken appears anywhere in PublicRoom.
//   5. toPrivateState(engine, null) — the receiver's private state — is
//      all-nulls/zeros.
// ============================================================================
import {
  TOTAL_ROUNDS,
  type GameRoom,
  type GridCard,
  type PrivateState,
  type PublicGridCard,
  type PublicPlayer,
  type PublicRoom,
  type PublicRound,
  type PublicTurnResolution,
  type TurnResolution,
} from '@vntypl8s/shared';
import type { GameEngine } from './engine.js';

function projectResolution(r: TurnResolution): PublicTurnResolution {
  return {
    activePlayerId: r.activePlayerId,
    outcome: r.outcome,
    winnerPlayerId: r.winnerPlayerId,
    // Titles/chars are safe here: a resolution exists only once that
    // player's turn has been played out and the reveal has happened.
    ownerCardTitle: r.revealedOwnerCard.title,
    requirementsChars: r.revealedRequirementsCard.chars,
    requirementsMet: r.requirementsMet,
    requirementsScored: r.requirementsScored,
  };
}

function projectGridCard(g: GridCard, resolutions: readonly TurnResolution[]): PublicGridCard {
  // While the card is face-up in the grid, WHOSE it is must not leave the
  // server. Only once it has been scored or discarded do we say who took it.
  let claimedByPlayerId: string | null = null;
  if (g.status === 'SCORED') {
    const res = resolutions.find((r) => r.revealedOwnerCard.id === g.card.id);
    claimedByPlayerId = res?.winnerPlayerId ?? null;
  }
  return {
    cardId: g.card.id,
    title: g.card.title,
    status: g.status,
    claimedByPlayerId,
  };
}

export function toPublicRoom(room: GameRoom, now: number): PublicRoom {
  const activePlayerId =
    room.phase === 'GUESSING' &&
    room.round &&
    room.round.turnIndex >= 0 &&
    room.round.turnIndex < room.round.turnOrder.length
      ? (room.round.turnOrder[room.round.turnIndex] ?? null)
      : null;

  let round: PublicRound | null = null;
  if (room.round) {
    const r = room.round;
    // The ONLY plate that ever becomes public, and only on its owner's turn.
    const revealedPlate =
      activePlayerId !== null
        ? (r.playerStates.find((s) => s.playerId === activePlayerId)?.plate ?? null)
        : null;

    round = {
      roundNumber: r.roundNumber,
      turnOrder: [...r.turnOrder],
      turnIndex: r.turnIndex,
      activePlayerId,
      revealedPlate,
      grid: r.grid.map((g) => projectGridCard(g, r.resolutions)),
      currentResolution: r.currentResolution ? projectResolution(r.currentResolution) : null,
      resolutions: r.resolutions.map(projectResolution),
    };
  }

  const players: PublicPlayer[] = room.players.map((p) => {
    const st = room.round?.playerStates.find((s) => s.playerId === p.id);
    return {
      id: p.id,
      displayName: p.displayName,
      connected: p.connected,
      isHost: p.isHost,
      canCast: p.canCast,
      pendingJoin: p.pendingJoin,
      joinOrder: p.joinOrder,
      // Counts only — never the pile contents.
      ownerScore: p.ownerPile.length,
      requirementsScore: p.requirementsPile.length,
      totalScore: p.ownerPile.length + p.requirementsPile.length,
      submitted: st?.submitted ?? false,
      // Length only — never the draft text.
      plateLength: st?.plate.length ?? 0,
    };
  });

  return {
    code: room.code,
    phase: room.phase,
    players,
    round,
    timer: { enabled: room.timer.enabled, phaseDeadline: room.timer.phaseDeadline },
    pause: {
      active: room.pause.active,
      reason: room.pause.reason,
      waitingForPlayerId: room.pause.waitingForPlayerId,
    },
    castConnected: room.castConnected,
    winnerPlayerIds: [...room.winnerPlayerIds],
    totalRounds: TOTAL_ROUNDS,
    serverNow: now,
  };
}

const EMPTY_PRIVATE: PrivateState = {
  playerId: null,
  reconnectToken: null,
  isHost: false,
  pendingJoin: false,
  ownerCard: null,
  requirementsCard: null,
  plate: '',
  submitted: false,
  requirementsMet: false,
  isActivePlayer: false,
  ownerPile: [],
  requirementsPile: [],
};

/** Sent only to the owning socket. `playerId: null` is the TV receiver. */
export function toPrivateState(engine: GameEngine, playerId: string | null): PrivateState {
  if (!playerId) return { ...EMPTY_PRIVATE, ownerPile: [], requirementsPile: [] };
  const room = engine.room;
  const p = room.players.find((pl) => pl.id === playerId);
  if (!p) return { ...EMPTY_PRIVATE, ownerPile: [], requirementsPile: [] };
  const st = room.round?.playerStates.find((s) => s.playerId === playerId);

  return {
    playerId: p.id,
    reconnectToken: p.reconnectToken,
    isHost: p.isHost,
    pendingJoin: p.pendingJoin,
    ownerCard: st ? { ...st.ownerCard } : null,
    requirementsCard: st ? { ...st.requirementsCard } : null,
    plate: st?.plate ?? '',
    submitted: st?.submitted ?? false,
    requirementsMet: st?.requirementsMet ?? false,
    isActivePlayer: engine.activePlayerId() === playerId,
    ownerPile: p.ownerPile.map((c) => ({ ...c })),
    requirementsPile: p.requirementsPile.map((c) => ({ ...c })),
  };
}
