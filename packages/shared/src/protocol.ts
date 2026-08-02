// ============================================================================
// Wire protocol: socket event map + the Cast custom-message channel.
// The Cast namespace literal lives here and is duplicated (by necessity) in
// client/receiver.html, which cannot import from the bundle at CAF boot time.
// Grep both before shipping — namespace drift is a silent killer (guide §2.5).
// ============================================================================
import type { PrivateState, PublicRoom } from './projection.js';

export const SOCKET_PATH = '/socket';
export const CAST_NAMESPACE = 'urn:x-cast:com.mooseflip.vntypl8s.v1';

export type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ClientToServer {
  'host:create': (p: { canCast: boolean }, ack: (r: Ack<{ code: string }>) => void) => void;
  'host:castStatus': (p: { connected: boolean }) => void;

  'room:join': (
    p: { code: string; displayName: string; reconnectToken?: string; canCast?: boolean },
    ack: (r: Ack<{ playerId: string; reconnectToken: string }>) => void,
  ) => void;

  /** TV receiver joins read-only. Token is required and validated server-side. */
  'receiver:subscribe': (p: { code: string; token: string }, ack: (r: Ack<{}>) => void) => void;
  /** TV receiver has no code yet; park it until a host casts. */
  'receiver:standby': (p: {}) => void;

  'lobby:start': (p: {}, ack: (r: Ack<{}>) => void) => void;

  /** Tile-picker writes the whole current draft each tap. Server re-validates. */
  'plate:set': (p: { plate: string }, ack: (r: Ack<{}>) => void) => void;
  'plate:submit': (p: {}, ack: (r: Ack<{}>) => void) => void;

  /** Active Player taps the winner, or null for "nobody got it". */
  'guess:award': (p: { winnerPlayerId: string | null }, ack: (r: Ack<{}>) => void) => void;
  /** Active Player moves to the next plate after seeing the resolution. */
  'guess:advance': (p: {}, ack: (r: Ack<{}>) => void) => void;

  'round:next': (p: {}, ack: (r: Ack<{}>) => void) => void;
  'host:forceEnd': (p: {}) => void;
  'host:rematch': (p: {}, ack: (r: Ack<{}>) => void) => void;
}

export interface ServerToClient {
  'host:created': (p: { code: string }) => void;
  'room:state': (p: PublicRoom) => void;
  'you:state': (p: PrivateState) => void;
  'room:closed': (p: { reason: string }) => void;
  error: (p: { message: string }) => void;
  /** Server pushes a code to a standby receiver when a host casts. */
  'cast:roomCode': (p: { code: string; token: string }) => void;
}

// ---------------------------------------------------------------- Cast channel
export type SenderToReceiverMessage =
  | { type: 'SYNC_ROOM'; roomCode: string; token: string; apiBaseUrl: string }
  | { type: 'PING'; t: number }
  | { type: 'TOGGLE_DEBUG' };

export type ReceiverToSenderMessage =
  | { type: 'SYNCED'; roomCode: string }
  | {
      type: 'ERROR';
      code:
        | 'INVALID_PAYLOAD'
        | 'TOKEN_REJECTED'
        | 'ROOM_NOT_FOUND'
        | 'BACKEND_UNREACHABLE'
        | 'INTERNAL';
      message?: string;
    };
