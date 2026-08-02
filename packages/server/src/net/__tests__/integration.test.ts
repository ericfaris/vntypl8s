// Net-layer integration: boot the real Socket.IO server in-process and play
// over actual WebSockets, validating the wire protocol, the receiver token
// gate, and — most importantly — that the receiver's broadcast never carries
// a secret.
import { createServer, type Server as HttpServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Server } from 'socket.io';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import {
  SOCKET_PATH,
  satisfiesRequirements,
  type Ack,
  type PrivateState,
  type PublicRoom,
} from '@vntypl8s/shared';
import { SyntheticDeckSource } from '../../engine/deck.js';
import { RoomManager } from '../rooms.js';
import { attachSocketServer } from '../server.js';
import { __resetCastTokens, mintCastToken } from '../../cast/tokens.js';

let httpServer: HttpServer;
let io: Server;
let rooms: RoomManager;
let port: number;

/** Real (short) grace period so tests exercise it without burning 60s each. */
const TEST_DISCONNECT_GRACE_MS = 60;

beforeEach(async () => {
  __resetCastTokens();
  httpServer = createServer();
  io = new Server(httpServer, { path: SOCKET_PATH });
  rooms = new RoomManager(new SyntheticDeckSource());
  attachSocketServer(io as never, rooms, { disconnectGraceMs: TEST_DISCONNECT_GRACE_MS });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  port = (httpServer.address() as { port: number }).port;
});

afterEach(async () => {
  io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

class Client {
  socket: ClientSocket;
  pub: PublicRoom | null = null;
  priv: PrivateState | null = null;
  /** Every public projection this socket ever saw — scanned for leaks. */
  pubHistory: PublicRoom[] = [];
  playerId = '';
  token = '';

  constructor() {
    this.socket = ioc(`http://localhost:${port}`, { path: SOCKET_PATH, forceNew: true });
    this.socket.on('room:state', (s: PublicRoom) => {
      this.pub = s;
      this.pubHistory.push(s);
    });
    this.socket.on('you:state', (s: PrivateState) => (this.priv = s));
  }
  emit<T>(event: string, payload: unknown): Promise<Ack<T>> {
    return new Promise((resolve) => this.socket.emit(event, payload, resolve));
  }
  connected(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket.connected) resolve();
      else this.socket.on('connect', () => resolve());
    });
  }
  close() {
    this.socket.disconnect();
  }
}

const tick = () => new Promise((r) => setTimeout(r, 30));
const pastGraceWindow = () => new Promise((r) => setTimeout(r, TEST_DISCONNECT_GRACE_MS + 60));

async function setupRoom(playerCount = 3): Promise<{ code: string; clients: Client[] }> {
  const host = new Client();
  await host.connected();
  const created = await host.emit<{ code: string }>('host:create', { canCast: true });
  expect(created.ok).toBe(true);
  const code = created.ok ? created.data.code : '';
  const clients: Client[] = [host];
  const hj = await host.emit<{ playerId: string; reconnectToken: string }>('room:join', {
    code,
    displayName: 'Host',
    canCast: true,
  });
  if (hj.ok) {
    host.playerId = hj.data.playerId;
    host.token = hj.data.reconnectToken;
  }
  for (let i = 1; i < playerCount; i++) {
    const c = new Client();
    await c.connected();
    const r = await c.emit<{ playerId: string; reconnectToken: string }>('room:join', {
      code,
      displayName: `P${i}`,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      c.playerId = r.data.playerId;
      c.token = r.data.reconnectToken;
    }
    clients.push(c);
  }
  await tick();
  return { code, clients };
}

describe('receiver token gate', () => {
  it('rejects receiver:subscribe with a bogus, missing, or wrong-room token', async () => {
    const { code } = await setupRoom(3);
    const tv = new Client();
    await tv.connected();

    expect(await tv.emit('receiver:subscribe', { code, token: 'bogus' })).toEqual({
      ok: false,
      error: 'TOKEN_REJECTED',
    });
    expect(await tv.emit('receiver:subscribe', { code, token: '' })).toEqual({
      ok: false,
      error: 'TOKEN_REJECTED',
    });
    expect(await tv.emit('receiver:subscribe', { code })).toEqual({
      ok: false,
      error: 'TOKEN_REJECTED',
    });
    // A valid token minted for a *different* room must not work here.
    const other = mintCastToken('0000').token;
    expect(await tv.emit('receiver:subscribe', { code, token: other })).toEqual({
      ok: false,
      error: 'TOKEN_REJECTED',
    });
    // ...and no public state ever reached this socket.
    expect(tv.pub).toBeNull();

    const good = mintCastToken(code).token;
    const res = await tv.emit('receiver:subscribe', { code, token: good });
    expect(res.ok).toBe(true);
    await tick();
    expect(tv.pub?.code).toBe(code);
    tv.close();
  }, 20000);

  it('rejects a valid token against a room that does not exist', async () => {
    const tv = new Client();
    await tv.connected();
    const token = mintCastToken('4242').token;
    expect(await tv.emit('receiver:subscribe', { code: '4242', token })).toEqual({
      ok: false,
      error: 'ROOM_NOT_FOUND',
    });
    tv.close();
  }, 20000);
});

describe('full round over WebSockets', () => {
  it('plays a 3-player round and never leaks a secret to the receiver', async () => {
    const { code, clients } = await setupRoom(3);
    const [host] = clients as [Client, Client, Client];

    // TV joins read-only with a properly scoped token.
    const tv = new Client();
    await tv.connected();
    const token = mintCastToken(code).token;
    expect((await tv.emit('receiver:subscribe', { code, token })).ok).toBe(true);
    await tick();

    expect(host.pub?.players).toHaveLength(3);
    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();
    expect(host.pub?.phase).toBe('WRITE_PLATES');

    // Each socket got ONLY its own secret cards.
    const secrets = new Map<string, { owner: string; req: string; plate: string }>();
    for (const c of clients) {
      expect(c.priv?.ownerCard).not.toBeNull();
      expect(c.priv?.requirementsCard).not.toBeNull();
      expect(c.priv?.playerId).toBe(c.playerId);
      secrets.set(c.playerId, {
        owner: c.priv!.ownerCard!.title,
        req: c.priv!.requirementsCard!.chars,
        plate: '',
      });
    }
    // No two players hold the same Owner card.
    expect(new Set([...secrets.values()].map((s) => s.owner)).size).toBe(3);
    // The TV's private state is empty.
    expect(tv.priv?.playerId).toBeNull();
    expect(tv.priv?.ownerCard).toBeNull();
    expect(tv.priv?.reconnectToken).toBeNull();

    // --- write plates, in reverse join order to prove turn order follows it ---
    for (const c of [...clients].reverse()) {
      const req = c.priv!.requirementsCard!.chars;
      const plate = (req + 'BB').slice(0, 8);
      expect(satisfiesRequirements(plate, req)).toBe(true);
      secrets.get(c.playerId)!.plate = plate;
      expect((await c.emit('plate:set', { plate })).ok).toBe(true);
      await tick();
      expect(c.priv?.requirementsMet).toBe(true);
      // Nobody else's socket sees this plate text.
      for (const other of clients) {
        if (other === c) continue;
        expect(other.priv?.plate).not.toBe(plate);
      }
      expect((await c.emit('plate:submit', {})).ok).toBe(true);
      await tick();
    }

    expect(host.pub?.phase).toBe('GUESSING');
    expect(host.pub?.round?.grid).toHaveLength(3 + 6);
    // Grid arrives with no owner mapping at all.
    for (const g of tv.pub!.round!.grid) {
      expect(g).not.toHaveProperty('ownerPlayerId');
      expect(g.claimedByPlayerId).toBeNull();
    }

    // --- play out the round ---
    let guard = 0;
    while (host.pub?.phase === 'GUESSING' && guard++ < 10) {
      const activeId = host.pub!.round!.activePlayerId!;
      const active = clients.find((c) => c.playerId === activeId)!;
      // Only the active player's plate is on the TV.
      expect(tv.pub?.round?.revealedPlate).toBe(secrets.get(activeId)!.plate);
      for (const [pid, s] of secrets) {
        if (pid !== activeId && s.plate !== secrets.get(activeId)!.plate) {
          expect(JSON.stringify(tv.pub)).not.toContain(`"${s.plate}"`);
        }
      }
      // The active player cannot award themselves.
      expect((await active.emit('guess:award', { winnerPlayerId: activeId })).ok).toBe(false);
      // A non-active player cannot award at all.
      const other = clients.find((c) => c.playerId !== activeId)!;
      expect((await other.emit('guess:award', { winnerPlayerId: activeId })).ok).toBe(false);

      expect((await active.emit('guess:award', { winnerPlayerId: other.playerId })).ok).toBe(true);
      await tick();
      expect(tv.pub?.round?.currentResolution?.winnerPlayerId).toBe(other.playerId);
      expect((await active.emit('guess:advance', {})).ok).toBe(true);
      await tick();
    }
    expect(host.pub?.phase).toBe('ROUND_END');

    // ---- the load-bearing assertion: scan EVERY public projection the TV
    // ever received for anything it must never have seen. ----
    for (const pub of tv.pubHistory) {
      const json = JSON.stringify(pub);
      expect(json).not.toContain('reconnectToken');
      expect(json).not.toContain('ownerPlayerId');
      expect(json).not.toContain('ownerDeck');
      expect(json).not.toContain('requirementsDeck');
      expect(json).not.toContain('phaseBeforePause');
      expect(json).not.toContain('ownerPile');
      for (const c of clients) expect(json).not.toContain(c.token);
      for (const g of pub.round?.grid ?? []) {
        if (g.status === 'IN_GRID') expect(g.claimedByPlayerId).toBeNull();
      }
    }

    for (const c of [...clients, tv]) c.close();
  }, 30000);
});

describe('reconnect & disconnect grace', () => {
  it('pauses only after the grace window, and a token rejoin resumes', async () => {
    const { code, clients } = await setupRoom(3);
    const [host] = clients as [Client, Client, Client];
    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();
    expect(host.pub?.phase).toBe('WRITE_PLATES');

    const victim = clients[1]!;
    const token = victim.token;
    victim.close();
    await tick(); // well inside the grace window
    expect(host.pub?.phase).toBe('WRITE_PLATES');
    await pastGraceWindow();
    expect(host.pub?.phase).toBe('PAUSED');

    const rejoin = new Client();
    await rejoin.connected();
    const rr = await rejoin.emit('room:join', { code, displayName: 'P1', reconnectToken: token });
    expect(rr.ok).toBe(true);
    await tick();
    expect(host.pub?.phase).toBe('WRITE_PLATES');

    for (const c of [...clients, rejoin]) c.close();
  }, 20000);

  it('does not pause at all if the player returns inside the grace window', async () => {
    const { code, clients } = await setupRoom(3);
    const [host] = clients as [Client, Client, Client];
    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();

    const victim = clients[1]!;
    const token = victim.token;
    victim.close();
    const rejoin = new Client();
    await rejoin.connected();
    expect((await rejoin.emit('room:join', { code, displayName: 'P1', reconnectToken: token })).ok)
      .toBe(true);
    await pastGraceWindow();
    expect(host.pub?.phase).toBe('WRITE_PLATES');

    for (const c of [...clients, rejoin]) c.close();
  }, 20000);
});

describe('cast pairing does not gate gameplay', () => {
  it('a room with no receiver and no cast session starts and plays normally', async () => {
    const { clients } = await setupRoom(3);
    const [host] = clients as [Client, Client, Client];
    expect(host.pub?.castConnected).toBe(false);
    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();
    expect(host.pub?.phase).toBe('WRITE_PLATES');
    for (const c of clients) c.close();
  }, 20000);

  it('a standby receiver is handed a code + scoped token when a host casts', async () => {
    const tv = new Client();
    await tv.connected();
    const pushed = new Promise<{ code: string; token: string }>((resolve) =>
      tv.socket.on('cast:roomCode', resolve),
    );
    tv.socket.emit('receiver:standby', {});
    await tick();

    const host = new Client();
    await host.connected();
    const created = await host.emit<{ code: string }>('host:create', { canCast: true });
    const code = created.ok ? created.data.code : '';

    const msg = await pushed;
    expect(msg.code).toBe(code);
    expect(msg.token.length).toBeGreaterThanOrEqual(16);
    // That pushed token actually works.
    expect((await tv.emit('receiver:subscribe', { code, token: msg.token })).ok).toBe(true);

    tv.close();
    host.close();
  }, 20000);
});
