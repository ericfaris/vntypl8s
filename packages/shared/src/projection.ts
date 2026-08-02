// ============================================================================
// The public/cast allowlist. THIS IS THE SECURITY BOUNDARY (Chromecast guide
// §0/§7). The receiver gets `PublicRoom` and nothing else.
//
// Build these field-by-field in server/src/engine/project.ts — never
// `{...room}` with deletions, never JSON.parse(JSON.stringify(room)).
//
// Explicitly stripped and never present in PublicRoom:
//   Player.reconnectToken; PlayerRoundState.ownerCard / requirementsCard
//   (until the owning player's turn resolves); PlayerRoundState.plate for
//   anyone whose turn hasn't come up; GridCard.ownerPlayerId while IN_GRID;
//   GameRoom.ownerDeck / requirementsDeck; phaseBeforePause; anything
//   socket-related.
// ============================================================================
import type { OwnerCard, PauseState, RequirementsCard, RoomPhase, TimerState } from './types.js';

export interface PublicPlayer {
  id: string;
  displayName: string;
  connected: boolean;
  isHost: boolean;
  canCast: boolean;
  pendingJoin: boolean;
  joinOrder: number;
  ownerScore: number; // ownerPile.length  (counts, never contents)
  requirementsScore: number; // requirementsPile.length
  totalScore: number;
  /** WRITE_PLATES only: has this player locked in? Never their plate text. */
  submitted: boolean;
  /** WRITE_PLATES only: character count so the TV can show progress dots. */
  plateLength: number;
}

/** A face-up grid card. Title only — the owner mapping is the whole game. */
export interface PublicGridCard {
  cardId: string;
  title: string;
  status: 'IN_GRID' | 'SCORED' | 'DISCARDED';
  /** Only set once status !== 'IN_GRID'; who ended up with it (or null if discarded). */
  claimedByPlayerId: string | null;
}

export interface PublicTurnResolution {
  activePlayerId: string;
  outcome: 'GUESSED' | 'MISSED';
  winnerPlayerId: string | null;
  ownerCardTitle: string;
  requirementsChars: string;
  requirementsMet: boolean;
  requirementsScored: boolean;
}

export interface PublicRound {
  roundNumber: number;
  turnOrder: string[];
  turnIndex: number;
  activePlayerId: string | null;
  /** The Active Player's plate — the ONLY plate ever public, and only on their turn. */
  revealedPlate: string | null;
  grid: PublicGridCard[];
  currentResolution: PublicTurnResolution | null;
  resolutions: PublicTurnResolution[];
}

export interface PublicRoom {
  code: string;
  phase: RoomPhase;
  players: PublicPlayer[];
  round: PublicRound | null;
  timer: TimerState;
  pause: PauseState;
  castConnected: boolean;
  winnerPlayerIds: string[];
  totalRounds: number;
  serverNow: number; // clients reconcile timer deadlines against this
}

/** Sent only to the owning socket. */
export interface PrivateState {
  playerId: string | null;
  reconnectToken: string | null;
  isHost: boolean;
  pendingJoin: boolean;
  /** Your secret cards this round. */
  ownerCard: OwnerCard | null;
  requirementsCard: RequirementsCard | null;
  /** Your own plate draft (others never see it until your turn). */
  plate: string;
  submitted: boolean;
  /** Live indicator while composing — do your 3 chars appear in order yet? */
  requirementsMet: boolean;
  isActivePlayer: boolean;
  /** Your pile contents, for a personal score screen. */
  ownerPile: OwnerCard[];
  requirementsPile: RequirementsCard[];
}
