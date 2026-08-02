import type { ReceiverToSenderMessage, SenderToReceiverMessage } from '@vntypl8s/shared';

export type CastConnectionState =
  | 'unavailable'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'failed';

/**
 * Program against this interface everywhere. There is a real implementation
 * and a total no-op one; UI code never branches on Cast support (guide §4.2).
 */
export interface CastSessionController {
  requestSession(): Promise<void> | void;
  endSession(): void;
  sendMessage(msg: SenderToReceiverMessage): void;
  onMessage(cb: (msg: ReceiverToSenderMessage) => void): () => void;
  onSessionChanged(cb: (s: CastConnectionState) => void): () => void;
  /** Current state, for a consumer that mounts after the session exists. */
  currentState(): CastConnectionState;
}
