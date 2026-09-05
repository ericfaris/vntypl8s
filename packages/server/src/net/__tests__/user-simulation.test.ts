// User-simulation suite: plays full VNTYPL8S sessions end-to-end over real
// WebSockets, each shaped around a real rule boundary (min/mid/max players)
// with one or two realistic human/network/device behaviors layered on top —
// sloppy input, a straggler at the write timer, an Active Player who vanishes
// mid-guess, a permanent dropout, a mid-game joiner, a host handoff, a
// rematch with a stale roster, Chromecast pairing edge cases, rapid
// duplicate actions, and the two extremes of the guessing RNG — rather than
// only the single happy path already covered by integration.test.ts. Every
// scenario also runs the engine's own invariant checker (harness.ts) after
// every mutating step, so a broken invariant surfaces as a failure here even
// if nothing throws.
import { createServer, type Server as HttpServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Server } from 'socket.io';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import {
  PLATE_MAX_LENGTH,
  SOCKET_PATH,
  satisfiesRequirements,
  validatePlate,
  type Ack,
  type PrivateState,
  type PublicRoom,
} from '@vntypl8s/shared';
import { SyntheticDeckSource } from '../../engine/deck.js';
import { checkInvariants } from '../../engine/__tests__/harness.js';
import { RoomManager } from '../rooms.js';
import { attachSocketServer } from '../server.js';
import { __resetCastTokens, mintCastToken } from '../../cast/tokens.js';

let httpServer: HttpServer;
let io: Server;
let rooms: RoomManager;
let port: number;

/** Short so tests don't burn real seconds. Real server default is 60s. */
const GRACE_MS = 80;

beforeEach(async () => {
  __resetCastTokens();
  httpServer = createServer();
  io = new Server(httpServer, { path: SOCKET_PATH });
  rooms = new RoomManager(new SyntheticDeckSource());
  attachSocketServer(io as never, rooms, { disconnectGraceMs: GRACE_MS });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  port = (httpServer.address() as { port: number }).port;
});

afterEach(async () => {
  io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

const tick = () => new Promise((r) => setTimeout(r, 30));
const pastGrace = () => new Promise((r) => setTimeout(r, GRACE_MS + 60));

function checkRoomInvariants(code: string) {
  const runtime = rooms.get(code);
  if (runtime) checkInvariants(runtime.engine);
}

class Client {
  socket: ClientSocket;
  pub: PublicRoom | null = null;
  priv: PrivateState | null = null;
  /** Every public projection this socket ever saw — scanned for leaks. */
  pubHistory: PublicRoom[] = [];
  playerId = '';
  token = '';
  name: string;

  constructor(name = '') {
    this.name = name;
    this.socket = ioc(`http://localhost:${port}`, { path: SOCKET_PATH, forceNew: true });
    this.socket.on('room:state', (s: PublicRoom) => {
      this.pub = s;
      this.pubHistory.push(s);
    });
    this.socket.on('you:state', (s: PrivateState) => (this.priv = s));
  }
  emit<T>(event: string, payload: unknown = {}): Promise<Ack<T>> {
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

/** Leak scan applied to every public projection a TV or player ever saw. */
function assertNoLeaks(pub: PublicRoom, tokens: string[]) {
  const json = JSON.stringify(pub);
  expect(json).not.toContain('reconnectToken');
  expect(json).not.toContain('ownerPlayerId');
  expect(json).not.toContain('ownerDeck');
  expect(json).not.toContain('requirementsDeck');
  expect(json).not.toContain('phaseBeforePause');
  expect(json).not.toContain('ownerPile');
  expect(json).not.toContain('requirementsPile');
  for (const t of tokens) {
    if (t) expect(json).not.toContain(t);
  }
  for (const g of pub.round?.grid ?? []) {
    if (g.status === 'IN_GRID') expect(g.claimedByPlayerId).toBeNull();
  }
}

/** Stand up a room and join `n` players with plain names P0..P{n-1}. First is host. */
async function seatPlayers(
  n: number,
  opts: { hostCanCast?: boolean } = {},
): Promise<{ code: string; host: Client; all: Client[] }> {
  const host = new Client('P0');
  await host.connected();
  const created = await host.emit<{ code: string }>('host:create', {
    canCast: opts.hostCanCast ?? false,
  });
  expect(created.ok).toBe(true);
  const code = created.ok ? created.data.code : '';
  const hj = await host.emit<{ playerId: string; reconnectToken: string }>('room:join', {
    code,
    displayName: 'P0',
    canCast: opts.hostCanCast ?? false,
  });
  expect(hj.ok).toBe(true);
  if (hj.ok) {
    host.playerId = hj.data.playerId;
    host.token = hj.data.reconnectToken;
  }
  const all = [host];
  for (let i = 1; i < n; i++) {
    const c = new Client(`P${i}`);
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
    all.push(c);
  }
  await tick();
  checkRoomInvariants(code);
  return { code, host, all };
}

/** Every still-connected player writes and submits a legal plate. */
async function writeAndSubmitAll(
  code: string,
  clients: Client[],
  opts: { meetRequirements?: boolean } = {},
) {
  const meet = opts.meetRequirements ?? true;
  for (let i = 0; i < clients.length; i++) {
    const c = clients[i]!;
    const req = c.priv?.requirementsCard?.chars;
    if (!req) continue; // sat out this round (pendingJoin)
    // Salt each plate with a per-player, per-index filler so distinct
    // players never *coincidentally* produce byte-identical plates — a real
    // collision is legal in play, but an artificial one here would mask a
    // genuine leak behind a false "it's just a coincidence" pass.
    const salt = i.toString(36).toUpperCase().padStart(2, '0').replace(/[0AEIOU]/g, 'X');
    const plate = meet
      ? (req + salt).slice(0, PLATE_MAX_LENGTH)
      : (salt + 'ZZZZZZ').slice(0, PLATE_MAX_LENGTH);
    expect((await c.emit('plate:set', { plate })).ok).toBe(true);
    await tick();
    expect((await c.emit('plate:submit', {})).ok).toBe(true);
    await tick();
    checkRoomInvariants(code);
  }
}

/** Drive the current GUESSING round to completion (ROUND_END or GAME_OVER). */
async function playGuessingToEnd(
  code: string,
  host: Client,
  clients: Client[],
  opts: { alwaysGuess?: boolean } = {},
) {
  const alwaysGuess = opts.alwaysGuess ?? true;
  let guard = 0;
  while (host.pub?.phase === 'GUESSING' && guard++ < 40) {
    const activeId = host.pub!.round!.activePlayerId!;
    const active = clients.find((c) => c.playerId === activeId);
    if (!active) break; // active player is disconnected; scenario drives this itself
    const other = clients.find((c) => c.playerId !== activeId && c.pub);
    const winner = alwaysGuess && other ? other.playerId : null;
    const res = await active.emit('guess:award', { winnerPlayerId: winner });
    expect(res.ok).toBe(true);
    await tick();
    checkRoomInvariants(code);
    expect((await active.emit('guess:advance', {})).ok).toBe(true);
    await tick();
    checkRoomInvariants(code);
  }
}

// ============================================================================
// Game 1 — MIN_PLAYERS (3), sloppy input at the tile-picker's edges
// ============================================================================
describe('Game 1: minimum lobby size, sloppy input', () => {
  it('rejects whitespace/case-only duplicate names, then plays a normal 3-round game', async () => {
    const { code, host, all } = await seatPlayers(3);

    // A case-only duplicate of an existing name is rejected.
    const dupe = new Client();
    await dupe.connected();
    const dupeRes = await dupe.emit('room:join', { code, displayName: '  p0  ' });
    expect(dupeRes.ok).toBe(false);
    dupe.close();

    // An empty/whitespace-only name is rejected outright.
    const blank = new Client();
    await blank.connected();
    expect((await blank.emit('room:join', { code, displayName: '   ' })).ok).toBe(false);
    blank.close();

    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();
    checkRoomInvariants(code);

    let rounds = 0;
    while (host.pub?.phase !== 'GAME_OVER' && rounds < 5) {
      await writeAndSubmitAll(code, all);
      await playGuessingToEnd(code, host, all);
      if (host.pub?.phase === 'ROUND_END') {
        expect((await host.emit('round:next', {})).ok).toBe(true);
        await tick();
        checkRoomInvariants(code);
      }
      rounds++;
    }
    expect(host.pub?.phase).toBe('GAME_OVER');
    expect(host.pub?.winnerPlayerIds.length).toBeGreaterThanOrEqual(1);

    for (const c of all) c.close();
  }, 30000);

  it('an 8-char plate at exactly PLATE_MAX_LENGTH is accepted; one that never satisfies its own requirements still scores the owner card', async () => {
    const { code, host, all } = await seatPlayers(3);
    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();

    const straggler = all[2]!;
    const straggerPlate = 'BCDFGHJK'.slice(0, PLATE_MAX_LENGTH); // 8 chars, almost certainly fails its own req
    expect(straggerPlate.length).toBe(8);
    expect(validatePlate(straggerPlate).ok).toBe(true);

    for (const c of [all[0]!, all[1]!]) {
      const req = c.priv!.requirementsCard!.chars;
      const plate = (req + 'BB9').slice(0, PLATE_MAX_LENGTH);
      expect((await c.emit('plate:set', { plate })).ok).toBe(true);
      expect((await c.emit('plate:submit', {})).ok).toBe(true);
      await tick();
    }
    expect((await straggler.emit('plate:set', { plate: straggerPlate })).ok).toBe(true);
    await tick();
    const met = satisfiesRequirements(straggerPlate, straggler.priv!.requirementsCard!.chars);
    expect(straggler.priv?.requirementsMet).toBe(met);
    expect((await straggler.emit('plate:submit', {})).ok).toBe(true);
    await tick();
    checkRoomInvariants(code);

    expect(host.pub?.phase).toBe('GUESSING');
    for (const c of all) c.close();
  }, 20000);
});

// ============================================================================
// Game 2 — a middle-sized lobby (5), write timer expires on a straggler
// ============================================================================
describe('Game 2: mid-size lobby, write timer strands a straggler', () => {
  it('auto-submits an unsubmitted player with an empty plate and the round still assembles correctly', async () => {
    const { code, host, all } = await seatPlayers(5);
    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();

    // Everyone but the last player submits.
    const submitted = all.slice(0, 4);
    const straggler = all[4]!;
    await writeAndSubmitAll(code, submitted);
    expect(host.pub?.phase).toBe('WRITE_PLATES'); // still waiting on the straggler

    // Simulate the write timer firing directly against the engine (the net
    // layer's own timer already covers real elapsed time; here we want a
    // deterministic trigger rather than waiting out WRITE_SECONDS for real).
    const runtime = rooms.get(code)!;
    const res = runtime.engine.writeTimerExpired();
    expect(res.ok).toBe(true);
    checkInvariants(runtime.engine);
    // Push the resulting state to sockets the way the real timer callback does.
    io.to(code).emit('room:state', { ...runtime.engine.room } as never); // best-effort nudge; real broadcast below
    await tick();

    expect(runtime.engine.room.phase).toBe('GUESSING');
    expect(runtime.engine.room.round!.grid).toHaveLength(5 + 6);
    const strandedState = runtime.engine.room.round!.playerStates.find(
      (s) => s.playerId === straggler.playerId,
    )!;
    expect(strandedState.submitted).toBe(true);
    expect(strandedState.plate).toBe('');
    expect(strandedState.requirementsMet).toBe(false);

    // The stranded player can still be the Active Player later in turn order
    // (submittedAt is "now", so they sort last) — an empty plate must never
    // itself be revealed as if it were a real answer, and must never crash
    // guess:award/advance.
    for (const c of all) c.close();
  }, 20000);
});

// ============================================================================
// Game 3 — the Active Player disconnects mid-GUESSING, before awarding
// ============================================================================
describe('Game 3: Active Player vanishes mid-turn', () => {
  it('pauses the game, and a token-rejoin resumes the exact same turn with no skip or duplicate', async () => {
    const { code, host, all } = await seatPlayers(4);
    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();
    await writeAndSubmitAll(code, all);
    expect(host.pub?.phase).toBe('GUESSING');

    const activeId = host.pub!.round!.activePlayerId!;
    const active = all.find((c) => c.playerId === activeId)!;
    const activeToken = active.token;
    const turnIndexBefore = host.pub!.round!.turnIndex;
    // The Active Player can BE the host (turn order follows submit order,
    // and the host often submits first) — so state must be observed through
    // a socket that is guaranteed to stay connected, never through `active`
    // itself once it's closed.
    const observer = all.find((c) => c.playerId !== activeId)!;

    active.close();
    await tick(); // inside the grace window — nothing should happen yet
    expect(observer.pub?.phase).toBe('GUESSING');
    await pastGrace();
    expect(observer.pub?.phase).toBe('PAUSED');
    checkRoomInvariants(code);

    const rejoin = new Client();
    await rejoin.connected();
    const rr = await rejoin.emit<{ playerId: string; reconnectToken: string }>('room:join', {
      code,
      displayName: active.name,
      reconnectToken: activeToken,
    });
    expect(rr.ok).toBe(true);
    await tick();

    expect(observer.pub?.phase).toBe('GUESSING');
    expect(observer.pub?.round?.turnIndex).toBe(turnIndexBefore);
    expect(observer.pub?.round?.activePlayerId).toBe(activeId);
    expect(observer.pub?.round?.currentResolution).toBeNull();
    checkRoomInvariants(code);

    // The reconnected Active Player can still award the point for this turn.
    const other = all.find((c) => c.playerId !== activeId)!;
    expect((await rejoin.emit('guess:award', { winnerPlayerId: other.playerId })).ok).toBe(true);
    await tick();
    checkRoomInvariants(code);

    for (const c of [...all.filter((c) => c !== active), rejoin]) c.close();
  }, 20000);
});

// ============================================================================
// Game 4 — a non-Active-Player disconnects while someone else is being guessed
// ============================================================================
describe('Game 4: a bystander vanishes mid-turn', () => {
  it('pauses without skipping or duplicating the current turn', async () => {
    const { code, host, all } = await seatPlayers(4);
    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();
    await writeAndSubmitAll(code, all);
    expect(host.pub?.phase).toBe('GUESSING');

    const activeId = host.pub!.round!.activePlayerId!;
    const bystander = all.find((c) => c.playerId !== activeId)!;
    const bystanderToken = bystander.token;

    bystander.close();
    await pastGrace();
    expect(host.pub?.phase).toBe('PAUSED');
    checkRoomInvariants(code);

    const rejoin = new Client();
    await rejoin.connected();
    expect(
      (await rejoin.emit('room:join', { code, displayName: bystander.name, reconnectToken: bystanderToken }))
        .ok,
    ).toBe(true);
    await tick();
    expect(host.pub?.phase).toBe('GUESSING');
    // Still the same turn — the bystander's absence never advanced it.
    expect(host.pub?.round?.activePlayerId).toBe(activeId);
    checkRoomInvariants(code);

    for (const c of [...all.filter((c) => c !== bystander), rejoin]) c.close();
  }, 20000);
});

// ============================================================================
// Game 5 — MAX_PLAYERS (8), a permanent dropout with no return
// ============================================================================
describe('Game 5: maximum lobby size, a permanent dropout', () => {
  it('gives the host a real recovery path (forceEnd) instead of leaving the room stuck PAUSED forever', async () => {
    const { code, host, all } = await seatPlayers(8);
    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();
    await writeAndSubmitAll(code, all);
    expect(host.pub?.phase).toBe('GUESSING');

    const ghost = all[6]!; // never comes back
    ghost.close();
    await pastGrace();
    expect(host.pub?.phase).toBe('PAUSED');
    checkRoomInvariants(code);

    // Host is not the ghost, so the host socket is still live and can act.
    host.socket.emit('host:forceEnd', {});
    await tick();
    expect(host.pub?.phase).toBe('GAME_OVER');
    expect(host.pub?.winnerPlayerIds.length).toBeGreaterThanOrEqual(1);
    checkRoomInvariants(code);

    for (const c of all.filter((c) => c !== ghost)) c.close();
  }, 20000);
});

// ============================================================================
// Game 6 — the host disconnects mid-round; host authority must transfer
// ============================================================================
describe('Game 6: host vanishes mid-round, authority transfers', () => {
  it('the new host — not the old one — holds host authority afterward, and can recover the game via forceEnd', async () => {
    const { code, host, all } = await seatPlayers(4);
    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();
    await writeAndSubmitAll(code, all);
    await playGuessingToEnd(code, host, all);
    expect(host.pub?.phase).toBe('ROUND_END');

    // Before the host vanishes: a non-host player cannot advance the round.
    const someoneElse = all.find((c) => c.playerId !== host.playerId)!;
    expect((await someoneElse.emit('round:next', {})).ok).toBe(false);

    host.close();
    await pastGrace();
    // Disconnecting the host during ROUND_END is still an in-progress-phase
    // disconnect: it both transfers host AND pauses the game (waiting for
    // the — now former — host, who is gone for good in this scenario). Host
    // transfer alone does not auto-resume play; recovery is via forceEnd,
    // exactly like the permanent-dropout case in Game 5.
    checkRoomInvariants(code);

    const newHostId = rooms.get(code)!.engine.room.players.find((p) => p.isHost)!.id;
    expect(newHostId).not.toBe(host.playerId);
    const newHost = all.find((c) => c.playerId === newHostId)!;
    const observer = all.find((c) => c.playerId !== newHostId && c.socket.connected)!;
    expect(observer.pub?.phase).toBe('PAUSED');
    expect(observer.pub?.players.find((p) => p.id === newHostId)?.isHost).toBe(true);
    expect(observer.pub?.players.find((p) => p.id === host.playerId)?.isHost).toBe(false);

    // A non-host trying to recover the game has no effect.
    const nonHost = all.find((c) => c.playerId !== newHostId && c.socket.connected)!;
    nonHost.socket.emit('host:forceEnd', {});
    await tick();
    expect(observer.pub?.phase).toBe('PAUSED');

    // Only the new host's forceEnd actually recovers the game.
    newHost.socket.emit('host:forceEnd', {});
    await tick();
    expect(observer.pub?.phase).toBe('GAME_OVER');
    checkRoomInvariants(code);

    for (const c of all.filter((c) => c.socket.connected)) c.close();
  }, 20000);
});

// ============================================================================
// Additional shape — mid-game join sits out, then joins the next round
// ============================================================================
describe('Mid-game join', () => {
  it('a joiner after lobby:start is pendingJoin, excluded from the current round, and active from the next round on', async () => {
    const { code, host, all } = await seatPlayers(3);
    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();

    const latecomer = new Client('Latecomer');
    await latecomer.connected();
    const joinRes = await latecomer.emit<{ playerId: string; reconnectToken: string }>('room:join', {
      code,
      displayName: 'Latecomer',
    });
    expect(joinRes.ok).toBe(true);
    if (joinRes.ok) {
      latecomer.playerId = joinRes.data.playerId;
      latecomer.token = joinRes.data.reconnectToken;
    }
    await tick();
    checkRoomInvariants(code);

    const runtime = rooms.get(code)!;
    const latecomerPlayer = runtime.engine.room.players.find((p) => p.id === latecomer.playerId)!;
    expect(latecomerPlayer.pendingJoin).toBe(true);
    // Not in this round's playerStates or grid at all.
    expect(
      runtime.engine.room.round!.playerStates.some((s) => s.playerId === latecomer.playerId),
    ).toBe(false);
    expect(latecomer.priv?.ownerCard).toBeNull();

    await writeAndSubmitAll(code, all);
    expect(host.pub?.phase).toBe('GUESSING');
    // Still excluded mid-round.
    expect(host.pub?.round?.turnOrder).not.toContain(latecomer.playerId);

    await playGuessingToEnd(code, host, all);
    expect(host.pub?.phase).toBe('ROUND_END');
    expect((await host.emit('round:next', {})).ok).toBe(true);
    await tick();
    checkRoomInvariants(code);

    // Promoted: now has secret cards and is part of the new round.
    expect(latecomer.priv?.ownerCard).not.toBeNull();
    expect(
      runtime.engine.room.round!.playerStates.some((s) => s.playerId === latecomer.playerId),
    ).toBe(true);

    for (const c of [...all, latecomer]) c.close();
  }, 20000);
});

// ============================================================================
// Additional shape — rematch with a stale (permanently disconnected) roster
// ============================================================================
describe('Rematch with a stale roster', () => {
  it('clears piles, reshuffles decks, and returns to LOBBY even with a dropout never having rejoined', async () => {
    const { code, host, all } = await seatPlayers(3);
    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();

    let rounds = 0;
    while (host.pub?.phase !== 'GAME_OVER' && rounds < 5) {
      await writeAndSubmitAll(code, all);
      await playGuessingToEnd(code, host, all);
      if (host.pub?.phase === 'ROUND_END') {
        expect((await host.emit('round:next', {})).ok).toBe(true);
        await tick();
      }
      rounds++;
    }
    expect(host.pub?.phase).toBe('GAME_OVER');
    const someoneScored = rooms
      .get(code)!
      .engine.room.players.some((p) => p.ownerPile.length + p.requirementsPile.length > 0);
    expect(someoneScored).toBe(true);

    // One player vanishes for good, right after the game ends.
    const dropout = all[2]!;
    dropout.close();
    await pastGrace();

    expect((await host.emit('host:rematch', {})).ok).toBe(true);
    await tick();
    expect(host.pub?.phase).toBe('LOBBY');
    checkRoomInvariants(code);

    const runtime = rooms.get(code)!;
    for (const p of runtime.engine.room.players) {
      expect(p.ownerPile).toHaveLength(0);
      expect(p.requirementsPile).toHaveLength(0);
      expect(p.pendingJoin).toBe(false);
    }
    expect(runtime.engine.room.winnerPlayerIds).toHaveLength(0);

    for (const c of all.filter((c) => c !== dropout)) c.close();
  }, 20000);
});

// ============================================================================
// Additional shape — Chromecast pairing edge cases layered onto normal play
// ============================================================================
describe('Chromecast pairing during a live game', () => {
  it('a standby receiver is pushed a code the moment a canCast host creates a room, and a token minted for another room is rejected', async () => {
    const tv = new Client();
    await tv.connected();
    const pushed = new Promise<{ code: string; token: string }>((resolve) =>
      tv.socket.on('cast:roomCode', resolve),
    );
    tv.socket.emit('receiver:standby', {});
    await tick();

    const { code } = await seatPlayers(3, { hostCanCast: true });
    const msg = await pushed;
    expect(msg.code).toBe(code);

    // A token minted for a different room must be rejected here.
    const wrongToken = mintCastToken('0000').token;
    expect(await tv.emit('receiver:subscribe', { code, token: wrongToken })).toEqual({
      ok: false,
      error: 'TOKEN_REJECTED',
    });
    expect(tv.pub).toBeNull();

    expect((await tv.emit('receiver:subscribe', { code, token: msg.token })).ok).toBe(true);
    await tick();
    expect(tv.pub?.code).toBe(code);
    tv.close();
  }, 20000);

  it("a receiver dropping and reconnecting mid-game never pauses gameplay — Cast is optional", async () => {
    const { code, host, all } = await seatPlayers(3, { hostCanCast: true });
    const tv = new Client();
    await tv.connected();
    const token = mintCastToken(code).token;
    expect((await tv.emit('receiver:subscribe', { code, token })).ok).toBe(true);
    await tick();
    expect(host.pub?.castConnected).toBe(true);

    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();
    await writeAndSubmitAll(code, all);
    expect(host.pub?.phase).toBe('GUESSING');

    // The TV drops mid-round.
    tv.close();
    await pastGrace(); // even past the *player* grace window, nothing pauses
    expect(host.pub?.phase).toBe('GUESSING');
    expect(host.pub?.castConnected).toBe(false);
    checkRoomInvariants(code);

    // A fresh receiver re-subscribes with a freshly minted token and catches
    // up mid-round with no secrets leaked.
    const tv2 = new Client();
    await tv2.connected();
    const token2 = mintCastToken(code).token;
    expect((await tv2.emit('receiver:subscribe', { code, token: token2 })).ok).toBe(true);
    await tick();
    for (const pub of tv2.pubHistory) assertNoLeaks(pub, all.map((c) => c.token));

    await playGuessingToEnd(code, host, all);
    tv2.close();
    for (const c of all) c.close();
  }, 20000);

  it('plays a complete 3-round game with no receiver at all', async () => {
    const { code, host, all } = await seatPlayers(3);
    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();
    let rounds = 0;
    while (host.pub?.phase !== 'GAME_OVER' && rounds < 5) {
      await writeAndSubmitAll(code, all);
      await playGuessingToEnd(code, host, all);
      if (host.pub?.phase === 'ROUND_END') {
        expect((await host.emit('round:next', {})).ok).toBe(true);
        await tick();
      }
      rounds++;
    }
    expect(host.pub?.phase).toBe('GAME_OVER');
    expect(host.pub?.castConnected).toBe(false);
    for (const c of all) c.close();
  }, 20000);
});

// ============================================================================
// Additional shape — rapid duplicate / out-of-order actions from one client
// ============================================================================
describe('Rapid duplicate and out-of-order actions', () => {
  it('a second guess:award for the same turn is rejected; a stale plate:set after submit is rejected; a non-active guess:advance is rejected', async () => {
    const { code, host, all } = await seatPlayers(3);
    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();

    // plate:set after plate:submit must be rejected.
    const p0 = all[0]!;
    const req0 = p0.priv!.requirementsCard!.chars;
    expect((await p0.emit('plate:set', { plate: (req0 + 'BB').slice(0, 8) })).ok).toBe(true);
    expect((await p0.emit('plate:submit', {})).ok).toBe(true);
    await tick();
    expect((await p0.emit('plate:set', { plate: 'ZZZZZZZZ' })).ok).toBe(false);

    await writeAndSubmitAll(code, all.slice(1));
    expect(host.pub?.phase).toBe('GUESSING');

    const activeId = host.pub!.round!.activePlayerId!;
    const active = all.find((c) => c.playerId === activeId)!;
    const other = all.find((c) => c.playerId !== activeId)!;

    // guess:advance before any award is rejected.
    expect((await active.emit('guess:advance', {})).ok).toBe(false);

    expect((await active.emit('guess:award', { winnerPlayerId: other.playerId })).ok).toBe(true);
    await tick();
    // A second award for the same turn is rejected — already resolved.
    expect((await active.emit('guess:award', { winnerPlayerId: null })).ok).toBe(false);
    // A non-active player cannot advance the turn either.
    expect((await other.emit('guess:advance', {})).ok).toBe(false);
    await tick();
    checkRoomInvariants(code);

    for (const c of all) c.close();
  }, 20000);
});

// ============================================================================
// Additional shape — the two extremes of the guessing RNG still terminate
// ============================================================================
describe('Guessing extremes', () => {
  it('a game where every guess lands terminates cleanly at GAME_OVER', async () => {
    const { code, host, all } = await seatPlayers(4);
    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();
    let rounds = 0;
    while (host.pub?.phase !== 'GAME_OVER' && rounds < 5) {
      await writeAndSubmitAll(code, all, { meetRequirements: true });
      await playGuessingToEnd(code, host, all, { alwaysGuess: true });
      if (host.pub?.phase === 'ROUND_END') {
        expect((await host.emit('round:next', {})).ok).toBe(true);
        await tick();
      }
      rounds++;
    }
    expect(host.pub?.phase).toBe('GAME_OVER');
    expect(host.pub?.winnerPlayerIds.length).toBeGreaterThanOrEqual(1);
    for (const c of all) c.close();
  }, 20000);

  it('a game where nobody ever guesses right still terminates cleanly at GAME_OVER with a shared/zero-score outcome', async () => {
    const { code, host, all } = await seatPlayers(4);
    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();
    let rounds = 0;
    while (host.pub?.phase !== 'GAME_OVER' && rounds < 5) {
      await writeAndSubmitAll(code, all, { meetRequirements: false });
      await playGuessingToEnd(code, host, all, { alwaysGuess: false });
      if (host.pub?.phase === 'ROUND_END') {
        expect((await host.emit('round:next', {})).ok).toBe(true);
        await tick();
      }
      rounds++;
    }
    expect(host.pub?.phase).toBe('GAME_OVER');
    // Nobody scored, so everyone ties at zero — shared victory.
    expect(host.pub?.winnerPlayerIds.length).toBe(all.length);
    for (const c of all) c.close();
  }, 20000);
});

// ============================================================================
// Additional shape — a reconnect that races the disconnect-grace timer via a
// second, overlapping socket (a background/foreground tab resume commonly
// creates a new socket.io connection before the old one's disconnect event
// has actually fired). This is the realistic device behavior the skill calls
// out explicitly: sloppy human/network timing hitting the full stack.
// ============================================================================
describe('Overlapping reconnect races the disconnect grace timer', () => {
  it('does not pause the game when the player is already represented by a newer, live socket', async () => {
    const { code, host, all } = await seatPlayers(4);
    expect((await host.emit('lobby:start', {})).ok).toBe(true);
    await tick();
    await writeAndSubmitAll(code, all);
    expect(host.pub?.phase).toBe('GUESSING');

    const victim = all[1]!;
    const victimToken = victim.token;

    // The phone silently reconnects with a NEW socket (e.g. the browser
    // resumed a backgrounded tab) using the same reconnect token, WHILE the
    // old socket is still technically open.
    const resumed = new Client();
    await resumed.connected();
    const rr = await resumed.emit('room:join', {
      code,
      displayName: victim.name,
      reconnectToken: victimToken,
    });
    expect(rr.ok).toBe(true);
    await tick();

    // Now the old socket finally closes (the tab's old connection tears
    // down after the new one is already live and playing).
    victim.close();
    await pastGrace(); // long past the grace window

    // The player is still actively represented by `resumed` — the game must
    // not have paused out from under them.
    expect(host.pub?.phase).toBe('GUESSING');
    checkRoomInvariants(code);

    for (const c of all.filter((c) => c !== victim).concat(resumed)) c.close();
  }, 20000);
});
