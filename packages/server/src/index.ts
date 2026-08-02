// Server bootstrap: Express (static client + config/cast endpoints) +
// Socket.IO, wired to the game engine. The AI card generator is deliberately
// NOT imported here — it is an offline CLI (src/scripts/generate-cards.ts)
// and must never sit on a request path.
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import express from 'express';
import { Server } from 'socket.io';
import { SOCKET_PATH } from '@vntypl8s/shared';
import { StaticDeckSource } from './engine/deck.js';
import { RoomManager } from './net/rooms.js';
import { attachSocketServer } from './net/server.js';
import { mintCastToken } from './cast/tokens.js';
import { loadRootEnv, readAppVersion } from './env.js';

loadRootEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_VERSION = readAppVersion();

const PORT = Number(process.env.PORT ?? 3001);
const CAST_RECEIVER_APP_ID = process.env.CAST_RECEIVER_APP_ID ?? '';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173';

const rooms = new RoomManager(new StaticDeckSource());

// --- HTTP + static client ---
const app = express();
app.use(express.json());

app.get('/api/config', (_req, res) => {
  res.json({
    castReceiverAppId: CAST_RECEIVER_APP_ID,
    publicBaseUrl: PUBLIC_BASE_URL,
    appVersion: APP_VERSION,
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: APP_VERSION, rooms: rooms.all().length });
});

/**
 * Mint a short-lived cast token scoped to a room code. The sender fetches
 * this before syncing and passes it through the Cast channel; the receiver
 * hands it back on `receiver:subscribe`. Guide §5: cast endpoints validate a
 * scoped access token even for "public" data.
 */
app.post('/api/cast/token', (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  if (!rooms.has(code)) {
    res.status(404).json({ error: 'Room not found.' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json(mintCastToken(code));
});

/**
 * HTTP fallback for room-code delivery (guide §5's "secondary HTTP fallback",
 * belt to the Cast channel's braces). Returns a code + a fresh scoped token
 * within the pending window, or `{ code: null }`.
 */
app.get('/api/cast/pending', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const code = rooms.getPendingCastCode();
  if (!code) {
    res.json({ code: null });
    return;
  }
  res.json({ code, ...mintCastToken(code) });
});

// Serve the built client if present (player at /, receiver at /receiver.html).
const clientDist = join(__dirname, '../../client/dist');
const DEPLOY_VERSION = Date.now().toString(36);
if (existsSync(clientDist)) {
  // Redirect /receiver.html to a versioned URL so the Chromecast never serves
  // a cached copy — the version changes on every deploy (guide §6).
  app.get('/receiver.html', (req, res) => {
    if (req.query.v === DEPLOY_VERSION) {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(join(clientDist, 'receiver.html'));
    } else {
      const rest = Object.entries(req.query)
        .filter(([k]) => k !== 'v')
        .map(([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('');
      res.redirect(302, `/receiver.html?v=${DEPLOY_VERSION}${rest}`);
    }
  });
  app.use(express.static(clientDist));
  // SPA fallback for the player deep-link routes (/, /join?code=…).
  app.get(/^\/(join)?$/, (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  path: SOCKET_PATH,
  cors: { origin: true, credentials: true },
  // Mobile browsers throttle JS timers in backgrounded tabs, which starves
  // the Socket.IO heartbeat well before the player actually left. Give it
  // real slack. (See net/server.ts DEFAULT_DISCONNECT_GRACE_MS for the
  // second layer.)
  pingInterval: 25_000,
  pingTimeout: 60_000,
});

attachSocketServer(io, rooms);

httpServer.listen(PORT, () => {
  console.log(`[startup] VNTYPL8S v${APP_VERSION} on :${PORT} (socket ${SOCKET_PATH})`);
  if (!CAST_RECEIVER_APP_ID) {
    console.log('[startup] CAST_RECEIVER_APP_ID unset — Cast sender disabled (app runs normally).');
  }
});
