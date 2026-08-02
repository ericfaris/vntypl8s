// Socket.IO wiring: clients send intents, the server validates via the engine
// and broadcasts spectator-safe projections. Also schedules phase timers.
import type { Server, Socket } from 'socket.io';
import type { Ack, ClientToServer, ServerToClient } from '@vntypl8s/shared';
import { toPrivateState, toPublicRoom } from '../engine/project.js';
import { mintCastToken, verifyCastToken } from '../cast/tokens.js';
import type { RoomManager, RoomRuntime } from './rooms.js';

type IO = Server<ClientToServer, ServerToClient>;
type Sock = Socket<ClientToServer, ServerToClient>;

interface SocketData {
  code?: string;
  playerId?: string;
  isReceiver?: boolean;
}

const okAck = <T>(data: T): Ack<T> => ({ ok: true, data });
const errAck = (error: string): Ack<never> => ({ ok: false, error });

// How long a disconnected player gets before it actually pauses the game.
// A backgrounded tab / brief network drop looks identical to a real
// disconnect at the socket level. Combined with the ~60s Socket.IO
// pingTimeout (index.ts) that's a ~2min total tolerance for a player to
// wander off and come back unnoticed. Overridable so tests don't burn
// 60 real seconds.
const DEFAULT_DISCONNECT_GRACE_MS = 60_000;

export function attachSocketServer(
  io: IO,
  rooms: RoomManager,
  opts: { disconnectGraceMs?: number } = {},
): void {
  const disconnectGraceMs = opts.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS;
  const data = (s: Sock) => s.data as SocketData;
  const standbyReceivers = new Set<string>(); // socketIds waiting for a room code

  function broadcast(runtime: RoomRuntime): void {
    const now = Date.now();
    const pub = toPublicRoom(runtime.engine.room, now);
    io.to(runtime.engine.room.code).emit('room:state', pub);
    for (const [socketId, playerId] of runtime.sockets) {
      io.to(socketId).emit('you:state', toPrivateState(runtime.engine, playerId));
    }
    // Receivers get the all-null private state — never a player's secrets.
    for (const socketId of runtime.receivers) {
      io.to(socketId).emit('you:state', toPrivateState(runtime.engine, null));
    }
    reconcileTimer(runtime);
  }

  /** Re-arm the single phase timer for a room based on current state. */
  function reconcileTimer(runtime: RoomRuntime): void {
    if (runtime.timer) {
      clearTimeout(runtime.timer);
      runtime.timer = null;
    }
    const room = runtime.engine.room;
    // Only the plate-writing timer drives an automatic action.
    if (room.phase === 'WRITE_PLATES' && room.timer.phaseDeadline) {
      const delay = Math.max(0, room.timer.phaseDeadline - Date.now());
      runtime.timer = setTimeout(() => {
        runtime.timer = null;
        const res = runtime.engine.writeTimerExpired();
        if (res.ok) broadcast(runtime);
      }, delay + 20);
    }
  }

  function runtimeForSocket(s: Sock): RoomRuntime | undefined {
    const code = data(s).code;
    return code ? rooms.get(code) : undefined;
  }

  /** Push a room code + a freshly minted, code-scoped token to standby TVs. */
  function notifyStandbyReceivers(code: string): void {
    if (standbyReceivers.size === 0) return;
    for (const sid of standbyReceivers) {
      const { token } = mintCastToken(code);
      io.to(sid).emit('cast:roomCode', { code, token });
    }
    standbyReceivers.clear();
  }

  io.on('connection', (socket: Sock) => {
    // ---- Host creates a room ----
    socket.on('host:create', (payload, ack) => {
      try {
        const runtime = rooms.create();
        const code = runtime.engine.room.code;
        console.log(`[room] ${code} created`);
        data(socket).code = code;
        socket.join(code);
        socket.emit('host:created', { code });
        if (payload?.canCast) {
          rooms.setPendingCastCode(code);
          notifyStandbyReceivers(code);
        }
        ack(okAck({ code }));
      } catch (e) {
        ack(errAck((e as Error).message));
      }
    });

    socket.on('host:castStatus', ({ connected }) => {
      const runtime = runtimeForSocket(socket);
      if (!runtime) return;
      runtime.engine.setCastConnected(connected);
      if (connected) {
        const code = runtime.engine.room.code;
        rooms.setPendingCastCode(code);
        notifyStandbyReceivers(code);
      }
      broadcast(runtime);
    });

    // ---- Join (lobby or mid-game; reconnect via token) ----
    socket.on('room:join', ({ code, displayName, reconnectToken, canCast }, ack) => {
      const runtime = rooms.get(code);
      if (!runtime) return ack(errAck('Room not found.'));
      const res = runtime.engine.join({ displayName, reconnectToken, canCast });
      if (!res.ok) return ack(errAck(res.error));
      // They're back — cancel any pending grace-period pause so a stale
      // delayed pause can't land on top of them.
      const pendingGrace = runtime.disconnectGraceTimers.get(res.player.id);
      if (pendingGrace) {
        clearTimeout(pendingGrace);
        runtime.disconnectGraceTimers.delete(res.player.id);
      }
      data(socket).code = code;
      data(socket).playerId = res.player.id;
      runtime.sockets.set(socket.id, res.player.id);
      socket.join(code);
      ack(okAck({ playerId: res.player.id, reconnectToken: res.player.reconnectToken }));
      broadcast(runtime);
    });

    // ---- TV receiver subscribes read-only (token required) ----
    socket.on('receiver:subscribe', (payload, ack) => {
      const code = typeof payload?.code === 'string' ? payload.code : '';
      const token = typeof payload?.token === 'string' ? payload.token : '';
      // Verify the token BEFORE touching the room: a 4-digit code is
      // guessable, so "public" state still has to be scoped to a token holder.
      if (!verifyCastToken(token, code)) {
        console.log(`[receiver] subscribe to ${code} rejected: bad token`);
        return ack(errAck('TOKEN_REJECTED'));
      }
      const runtime = rooms.get(code);
      if (!runtime) {
        console.log(`[receiver] subscribe to ${code} failed: room not found`);
        return ack(errAck('ROOM_NOT_FOUND'));
      }
      console.log(`[receiver] subscribed to ${code}`);
      standbyReceivers.delete(socket.id);
      data(socket).code = code;
      data(socket).isReceiver = true;
      runtime.receivers.add(socket.id);
      socket.join(code);
      runtime.engine.setCastConnected(true);
      ack(okAck({}));
      broadcast(runtime);
    });

    socket.on('receiver:standby', () => {
      const code = rooms.getPendingCastCode();
      if (code) {
        const { token } = mintCastToken(code);
        io.to(socket.id).emit('cast:roomCode', { code, token });
      } else {
        standbyReceivers.add(socket.id);
      }
    });

    // ---- Gameplay ----
    const withPlayer = (
      ack: (r: Ack<{}>) => void,
      fn: (rt: RoomRuntime, playerId: string) => { ok: true } | { ok: false; error: string },
    ) => {
      const runtime = runtimeForSocket(socket);
      const playerId = data(socket).playerId;
      if (!runtime || !playerId) return ack(errAck('Not in a room.'));
      const res = fn(runtime, playerId);
      if (!res.ok) return ack(errAck(res.error));
      ack(okAck({}));
      broadcast(runtime);
    };

    socket.on('lobby:start', (_p, ack) => withPlayer(ack, (rt, pid) => rt.engine.start(pid)));
    socket.on('plate:set', ({ plate }, ack) =>
      withPlayer(ack, (rt, pid) => rt.engine.setPlate(pid, typeof plate === 'string' ? plate : '')),
    );
    socket.on('plate:submit', (_p, ack) =>
      withPlayer(ack, (rt, pid) => rt.engine.submitPlate(pid)),
    );
    socket.on('guess:award', ({ winnerPlayerId }, ack) =>
      withPlayer(ack, (rt, pid) =>
        rt.engine.award(pid, typeof winnerPlayerId === 'string' ? winnerPlayerId : null),
      ),
    );
    socket.on('guess:advance', (_p, ack) =>
      withPlayer(ack, (rt, pid) => rt.engine.advanceTurn(pid)),
    );
    socket.on('round:next', (_p, ack) => withPlayer(ack, (rt, pid) => rt.engine.nextRound(pid)));
    socket.on('host:rematch', (_p, ack) => withPlayer(ack, (rt, pid) => rt.engine.rematch(pid)));

    socket.on('host:forceEnd', () => {
      const runtime = runtimeForSocket(socket);
      const pid = data(socket).playerId;
      if (!runtime || !pid) return;
      runtime.engine.forceEnd(pid);
      broadcast(runtime);
    });

    // ---- Disconnect ----
    socket.on('disconnect', () => {
      standbyReceivers.delete(socket.id);
      const code = data(socket).code;
      if (!code) return;
      const runtime = rooms.get(code);
      if (!runtime) return;

      if (data(socket).isReceiver) {
        runtime.receivers.delete(socket.id);
        console.log(
          `[receiver] disconnected from ${code} (${runtime.receivers.size} receivers left)`,
        );
        if (runtime.receivers.size === 0) runtime.engine.setCastConnected(false);
        if (rooms.closeIfEmpty(code)) console.log(`[room] ${code} closed (empty)`);
        else broadcast(runtime);
        return;
      }

      const playerId = runtime.sockets.get(socket.id);
      runtime.sockets.delete(socket.id);
      if (!playerId) return;

      // Don't pause the game the instant a socket drops — give them a window
      // to reconnect silently (room:join cancels this timer).
      const existingGrace = runtime.disconnectGraceTimers.get(playerId);
      if (existingGrace) clearTimeout(existingGrace);
      const graceTimer = setTimeout(() => {
        runtime.disconnectGraceTimers.delete(playerId);
        if (rooms.get(code) !== runtime) return; // room was replaced/closed meanwhile
        runtime.engine.disconnect(playerId);
        if (rooms.closeIfEmpty(code)) console.log(`[room] ${code} closed (empty)`);
        else broadcast(runtime);
      }, disconnectGraceMs);
      runtime.disconnectGraceTimers.set(playerId, graceTimer);
    });
  });
}
