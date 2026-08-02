// Google Cast Web Sender integration (Chromecast guide §4).
//
// Every `window.cast` / `window.chrome.cast` reference in the codebase lives
// in THIS FILE. UI code calls the CastSessionController interface and never
// branches on platform support — the factory hands back a no-op controller
// when Cast isn't available or CAST_RECEIVER_APP_ID is unset.
import { CAST_NAMESPACE, type ReceiverToSenderMessage, type SenderToReceiverMessage } from '@vntypl8s/shared';
import type { CastConnectionState, CastSessionController } from './types.js';

const SENDER_SDK = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';

declare global {
  interface Window {
    __onGCastApiAvailable?: (available: boolean) => void;
    cast?: any;
    chrome?: any;
  }
}

// ---------------------------------------------------------------- SDK loading
let sdkLoading: Promise<boolean> | null = null;

/**
 * `window.__onGCastApiAvailable` is Google's own bootstrap contract. Two real
 * races to guard (guide §4.1): the callback can fire *before* we subscribe
 * (so also check `window.cast?.framework` eagerly), and dev HMR can
 * double-inject the script tag (so reuse an existing tag and chain onto any
 * previous handler rather than overwriting it).
 */
export function loadSenderSdk(): Promise<boolean> {
  if (sdkLoading) return sdkLoading;
  sdkLoading = new Promise<boolean>((resolve) => {
    if (typeof window === 'undefined') return resolve(false);
    if (window.cast?.framework) return resolve(true); // eager check

    const prev = window.__onGCastApiAvailable;
    window.__onGCastApiAvailable = (available: boolean) => {
      try {
        prev?.(available);
      } catch {
        /* a previous handler throwing must not break ours */
      }
      resolve(available);
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[src^="${SENDER_SDK}"]`);
    if (!existing) {
      const script = document.createElement('script');
      script.src = SENDER_SDK;
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    }
    // Don't hang forever on a blocked/slow CDN.
    setTimeout(() => resolve(!!window.cast?.framework), 8000);
  });
  return sdkLoading;
}

// ------------------------------------------------------------------- no-op
/**
 * Deliberately NOT memoized: returning a fresh instance every call lets the
 * factory naturally "upgrade" to a real controller on a later call once the
 * SDK appears, with no stale singleton to invalidate (guide §4.2).
 */
export class NoopCastSessionController implements CastSessionController {
  requestSession(): void {}
  endSession(): void {}
  sendMessage(_msg: SenderToReceiverMessage): void {}
  onMessage(_cb: (msg: ReceiverToSenderMessage) => void): () => void {
    return () => {};
  }
  onSessionChanged(cb: (s: CastConnectionState) => void): () => void {
    // Report once so consumers settle on 'unavailable' and hide the button.
    queueMicrotask(() => cb('unavailable'));
    return () => {};
  }
  currentState(): CastConnectionState {
    return 'unavailable';
  }
}

// -------------------------------------------------------------------- real
class WebCastSessionController implements CastSessionController {
  private state: CastConnectionState = 'disconnected';
  private stateSubs = new Set<(s: CastConnectionState) => void>();
  private msgSubs = new Set<(m: ReceiverToSenderMessage) => void>();
  /** The session we currently have a message listener attached to. */
  private attachedSession: any = null;
  private readonly boundListener = (_ns: string, payload: unknown) => this.handleInbound(payload);

  constructor(private readonly appId: string) {
    const cast = window.cast;
    const chrome = window.chrome;
    const context = cast.framework.CastContext.getInstance();
    context.setOptions({
      receiverApplicationId: this.appId,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    });

    context.addEventListener(
      cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
      (event: any) => this.onRawSessionState(event.sessionState),
    );

    // Auto-join can mean a session already exists before our listeners
    // attached (guide §4.3) — check for one right now.
    if (context.getCurrentSession()) {
      this.setState('connected');
      this.attachMessageListener();
    }
  }

  private get context(): any {
    return window.cast.framework.CastContext.getInstance();
  }

  /** Map Google's raw states onto our narrow union (guide §4.4). */
  private onRawSessionState(raw: string): void {
    const S = window.cast.framework.SessionState;
    switch (raw) {
      case S.SESSION_STARTED:
      case S.SESSION_RESUMED:
        this.setState('connected');
        this.attachMessageListener();
        break;
      case S.SESSION_STARTING:
      case S.SESSION_RESUMING:
      case S.SESSION_ENDING:
        this.setState('connecting');
        break;
      case S.SESSION_START_FAILED:
      case S.SESSION_RESUME_FAILED:
        this.setState('failed');
        this.detachMessageListener();
        break;
      case S.SESSION_ENDED:
      case S.NO_SESSION:
      default:
        this.setState('disconnected');
        this.detachMessageListener();
        break;
    }
  }

  private setState(s: CastConnectionState): void {
    if (this.state === s) return;
    this.state = s;
    for (const cb of this.stateSubs) cb(s);
  }

  /**
   * Idempotent, detach-before-attach. Without this, every reconnect adds
   * another listener and each message gets processed N times (guide §4.4).
   */
  private attachMessageListener(): void {
    const session = this.context.getCurrentSession();
    if (!session || session === this.attachedSession) return;
    this.detachMessageListener();
    try {
      session.addMessageListener(CAST_NAMESPACE, this.boundListener);
      this.attachedSession = session;
    } catch (e) {
      console.warn('[cast] addMessageListener failed', e);
    }
  }

  private detachMessageListener(): void {
    if (!this.attachedSession) return;
    try {
      this.attachedSession.removeMessageListener(CAST_NAMESPACE, this.boundListener);
    } catch {
      /* session already gone */
    }
    this.attachedSession = null;
  }

  private handleInbound(payload: unknown): void {
    // The receiver passes plain objects to sendCustomMessage, but the sender
    // SDK hands them to us as JSON strings. Accept either (guide §3.4).
    let msg: ReceiverToSenderMessage | null = null;
    try {
      msg =
        typeof payload === 'string'
          ? (JSON.parse(payload) as ReceiverToSenderMessage)
          : (payload as ReceiverToSenderMessage);
    } catch {
      console.warn('[cast] unparseable inbound message', payload);
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') {
      return;
    }
    for (const cb of this.msgSubs) cb(msg);
  }

  async requestSession(): Promise<void> {
    try {
      await this.context.requestSession();
      this.attachMessageListener();
    } catch (e) {
      // The user just closed the device picker — not worth logging.
      const cancel = window.chrome?.cast?.ErrorCode?.CANCEL;
      const code = (e as { code?: string })?.code ?? e;
      if (code === cancel || e === cancel) return;
      console.warn('[cast] requestSession failed', e);
    }
  }

  endSession(): void {
    try {
      this.context.endCurrentSession(true);
    } catch {
      /* noop */
    }
    this.detachMessageListener();
  }

  sendMessage(msg: SenderToReceiverMessage): void {
    const session = this.context.getCurrentSession();
    if (!session) return;
    try {
      // Asymmetry called out in guide §3.4: the Web Sender SDK's
      // session.sendMessage wants a string, while the receiver's
      // sendCustomMessage auto-serializes. Stringify HERE and only here.
      session.sendMessage(CAST_NAMESPACE, JSON.stringify(msg));
    } catch (e) {
      console.warn('[cast] sendMessage failed', e);
    }
  }

  onMessage(cb: (m: ReceiverToSenderMessage) => void): () => void {
    this.msgSubs.add(cb);
    return () => this.msgSubs.delete(cb);
  }

  onSessionChanged(cb: (s: CastConnectionState) => void): () => void {
    this.stateSubs.add(cb);
    queueMicrotask(() => cb(this.state));
    return () => this.stateSubs.delete(cb);
  }

  currentState(): CastConnectionState {
    return this.state;
  }
}

// ----------------------------------------------------------------- factory
let realController: WebCastSessionController | null = null;

/**
 * Returns the real controller only when we have an App ID, a window, and a
 * loaded Cast SDK. Otherwise a fresh no-op. Only the real controller is
 * memoized (it wraps live SDK listeners that must survive remounts).
 */
export function getCastController(appId: string): CastSessionController {
  if (!appId) return new NoopCastSessionController();
  if (typeof window === 'undefined') return new NoopCastSessionController();
  if (!window.cast?.framework || !window.chrome?.cast) return new NoopCastSessionController();
  if (!realController) realController = new WebCastSessionController(appId);
  return realController;
}

/** Test hook. */
export function __resetCastController(): void {
  realController = null;
  sdkLoading = null;
}
