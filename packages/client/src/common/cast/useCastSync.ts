// The sync protocol (Chromecast guide §4.6). All five mechanisms, together —
// this is explicitly NOT either/or. Ack-only was tried in production and found
// insufficiently reliable on real hardware:
//
//   1. an idempotency key `${roomCode}:${token}` tracked in confirmedKeyRef
//   2. a send on every relevant transition (connected / TOKEN_REJECTED / a
//      room code arriving while already connected)
//   3. an unconditional 3s retry interval until confirmed
//   4. an in-flight guard against overlapping syncs
//   5. only a SYNCED whose roomCode matches the current one confirms
//
// Plus a 120s PING: ALL our real traffic is on Socket.io, so the Cast
// session's own liveness clock sees zero traffic and kills the session at
// ~5 minutes even though the game is fine (guide §3.2). A round can easily
// run past 5 minutes. The PING is not decorative.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CastConnectionState, CastSessionController } from './types.js';
import { getCastController, loadSenderSdk } from './controller.js';

const RETRY_MS = 3000;
const PING_MS = 120_000;
const SS_KEY = 'vp:cast:sync';

export interface CastSync {
  state: CastConnectionState;
  /** True once the receiver has acked a SYNCED for the current room. */
  synced: boolean;
  requestSession(): void;
  endSession(): void;
  toggleDebug(): void;
  /**
   * Dev-only. A ready-to-open URL that boots the receiver in `?dev` stub mode
   * (guide §6) already carrying the current room code and a fresh scoped
   * token, so the TV view can be previewed in a plain browser tab with no
   * Chromecast in the room. `null` until a room exists (or in a prod build).
   */
  receiverDevUrl: string | null;
}

interface Persisted {
  roomCode: string;
  token: string;
}

function readPersisted(): Persisted | null {
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}
function writePersisted(p: Persisted): void {
  try {
    sessionStorage.setItem(SS_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

export interface UseCastSyncArgs {
  appId: string;
  roomCode: string | null;
  /** From /api/config. In dev this MUST be a LAN address — a Chromecast
   *  cannot resolve your machine's `localhost` (guide §6). */
  apiBaseUrl: string;
  /** Report session state up to the server for the lobby UI. */
  onStateChange?: (connected: boolean) => void;
}

export function useCastSync({
  appId,
  roomCode,
  apiBaseUrl,
  onStateChange,
}: UseCastSyncArgs): CastSync {
  const [controller, setController] = useState<CastSessionController>(() =>
    getCastController(appId),
  );
  const [state, setState] = useState<CastConnectionState>(() => controller.currentState());
  const [synced, setSynced] = useState(false);

  const confirmedKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const tokenRef = useRef<string | null>(null);

  // Dev-only browser preview of the receiver (guide §6). Mint one standalone
  // token per room — independent of any live Cast session — so the link works
  // whether or not a Chromecast is around.
  const [devToken, setDevToken] = useState<string | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV || !roomCode) {
      setDevToken(null);
      return;
    }
    let cancelled = false;
    void fetch('/api/cast/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: roomCode }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ token: string }>) : null))
      .then((d) => {
        if (!cancelled && d?.token) setDevToken(d.token);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  const receiverDevUrl =
    import.meta.env.DEV && roomCode && devToken
      ? `/receiver.html?dev&code=${roomCode}&token=${encodeURIComponent(devToken)}`
      : null;

  // Load the SDK lazily and upgrade from the no-op controller once it lands.
  useEffect(() => {
    if (!appId) return;
    let cancelled = false;
    void loadSenderSdk().then((available) => {
      if (cancelled || !available) return;
      const next = getCastController(appId);
      setController((cur) => (cur === next ? cur : next));
    });
    return () => {
      cancelled = true;
    };
  }, [appId]);

  const key = roomCode ? `${roomCode}:${tokenRef.current ?? ''}` : null;

  const trySync = useCallback(
    async (force = false) => {
      if (!roomCode) return;
      if (inFlightRef.current) return; // (4) in-flight guard
      if (!force && confirmedKeyRef.current?.startsWith(`${roomCode}:`)) return; // (1)
      if (controller.currentState() !== 'connected') return;
      inFlightRef.current = true;
      try {
        // Reuse a persisted token across a sender reload (guide §4.7).
        let token = tokenRef.current;
        if (!token) {
          const persisted = readPersisted();
          if (persisted?.roomCode === roomCode) token = persisted.token;
        }
        if (!token) {
          const res = await fetch('/api/cast/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: roomCode }),
          });
          if (!res.ok) return;
          token = ((await res.json()) as { token: string }).token;
        }
        tokenRef.current = token;
        writePersisted({ roomCode, token });
        controller.sendMessage({ type: 'SYNC_ROOM', roomCode, token, apiBaseUrl });
      } catch (e) {
        console.warn('[cast] sync failed', e);
      } finally {
        inFlightRef.current = false;
      }
    },
    [roomCode, apiBaseUrl, controller],
  );

  useEffect(() => {
    const unsubState = controller.onSessionChanged((s) => {
      setState(s);
      onStateChange?.(s === 'connected');
      if (s === 'connected') {
        void trySync(true); // (2) send on transition to connected
      } else {
        // A new session must re-sync from a blank slate.
        confirmedKeyRef.current = null;
        setSynced(false);
      }
    });

    const unsubMsg = controller.onMessage((msg) => {
      // (5) only a SYNCED matching the CURRENT room confirms.
      if (msg.type === 'SYNCED' && msg.roomCode === roomCode) {
        confirmedKeyRef.current = `${roomCode}:${tokenRef.current ?? ''}`;
        setSynced(true);
        return;
      }
      if (msg.type === 'ERROR') {
        console.warn('[cast] receiver error', msg.code, msg.message);
        if (msg.code === 'TOKEN_REJECTED') {
          tokenRef.current = null; // stale token — mint a fresh one
          confirmedKeyRef.current = null;
          setSynced(false);
          void trySync(true); // (2)
        }
      }
    });

    // (3) unconditional retry until confirmed — belt to the ack's braces.
    const retry = setInterval(() => void trySync(), RETRY_MS);
    // Keep the Cast session's own liveness clock alive (guide §3.2).
    const ping = setInterval(() => {
      if (controller.currentState() === 'connected') {
        controller.sendMessage({ type: 'PING', t: Date.now() });
      }
    }, PING_MS);

    return () => {
      unsubState();
      unsubMsg();
      clearInterval(retry);
      clearInterval(ping);
    };
    // `key` is in deps so a room code arriving later re-runs the effect.
  }, [controller, roomCode, key, trySync, onStateChange]);

  const requestSession = useCallback(() => void controller.requestSession(), [controller]);
  const endSession = useCallback(() => controller.endSession(), [controller]);
  const toggleDebug = useCallback(
    () => controller.sendMessage({ type: 'TOGGLE_DEBUG' }),
    [controller],
  );

  return { state, synced, requestSession, endSession, toggleDebug, receiverDevUrl };
}
