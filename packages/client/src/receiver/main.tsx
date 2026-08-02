import './debug.js'; // MUST be first — captures boot-time errors
import { createRoot } from 'react-dom/client';
import '../common/styles.css';
import './receiver.css';
import App from './App.js';
import { store } from '../common/store.js';

type SyncCb = (ok: boolean, code?: string) => void;
interface CastWindow {
  __castPending?: { roomCode: string; token: string } | null;
  __castOnSync?: (roomCode: string, token: string, cb?: SyncCb) => void;
  __castDevMode?: boolean;
  __vpSetState?: unknown;
}
const w = window as unknown as CastWindow;

// Park on the server as a receiver awaiting a room code. The server pushes
// cast:roomCode (with a scoped token) the moment a host casts — no Cast
// messaging required for that path at all.
store.receiverStandby();

// Every code-delivery path converges here: Cast custom message, the
// receiver.html HTTP poll, and the ?dev query string.
w.__castOnSync = (roomCode: string, token: string, cb?: SyncCb) => {
  void store.receiverSubscribe(roomCode, token).then((ok) => cb?.(ok, ok ? undefined : 'ROOM_NOT_FOUND'));
};

// A SYNC_ROOM that landed before React mounted (the common case on real
// hardware — the CAF block runs first by design).
const pending = w.__castPending;
if (pending) w.__castOnSync(pending.roomCode, pending.token);

// --- ?dev stub mode (guide §6, acceptance criterion 4) -------------------
// Skips window.cast entirely so the receiver can be developed in a normal
// desktop browser tab. Takes ?code= and ?token= from the query string, or
// falls back to /api/cast/pending.
if (w.__castDevMode) {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const token = params.get('token');
  if (code && token) {
    w.__castOnSync(code, token);
  } else {
    void fetch('/api/cast/pending', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { code: string | null; token?: string }) => {
        if (d?.code && d.token) w.__castOnSync?.(d.code, d.token);
      })
      .catch(() => undefined);
  }
}

createRoot(document.getElementById('root')!).render(<App />);
