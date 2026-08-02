// Socket client + tiny observable store shared by the player and receiver UIs.
import { io, type Socket } from 'socket.io-client';
import { SOCKET_PATH, type Ack, type PrivateState, type PublicRoom } from '@vntypl8s/shared';

export interface GameState {
  connected: boolean;
  pub: PublicRoom | null;
  priv: PrivateState | null;
  code: string | null;
  /** Cast token this client last used (receiver side) — needed to resubscribe. */
  castToken: string | null;
  error: string | null;
  /** client_now - server_now at last projection, to reconcile timer deadlines */
  serverOffset: number;
}

type Listener = () => void;

const LS_CODE = 'vp:code';
const LS_TOKEN = 'vp:token';
const LS_NAME = 'vp:name';

class GameStore {
  private socket: Socket;
  private listeners = new Set<Listener>();
  /** Set once the transport has connected at least once, so we can tell a
   * fresh connect apart from a reconnect after a drop. */
  private hasConnectedBefore = false;

  state: GameState = {
    connected: false,
    pub: null,
    priv: null,
    code: null,
    castToken: null,
    error: null,
    serverOffset: 0,
  };

  constructor() {
    this.socket = io({ path: SOCKET_PATH, autoConnect: true });

    this.socket.on('connect', () => {
      const isReconnect = this.hasConnectedBefore;
      this.hasConnectedBefore = true;
      this.patch({ connected: true });
      // socket.io transparently reconnects the transport, but that does NOT
      // re-run room:join / receiver:subscribe server-side — the server has no
      // idea this new connection belongs to the room it just dropped. Without
      // this, a player whose phone locked the screen stays marked
      // disconnected and the game stays PAUSED forever, with nothing on
      // screen telling them why.
      if (!isReconnect) return;
      if (this.state.priv?.playerId) {
        const code = this.savedCode();
        const name = this.savedName();
        if (code && name) void this.join(code, name);
      } else if (this.state.code && this.state.castToken) {
        void this.receiverSubscribe(this.state.code, this.state.castToken);
      }
    });

    this.socket.on('disconnect', () => this.patch({ connected: false }));
    this.socket.on('room:state', (pub: PublicRoom) =>
      this.patch({ pub, serverOffset: Date.now() - pub.serverNow }),
    );
    this.socket.on('you:state', (priv: PrivateState) => this.patch({ priv }));
    this.socket.on('host:created', ({ code }: { code: string }) => this.patch({ code }));
    this.socket.on('error', ({ message }: { message: string }) => this.patch({ error: message }));
    this.socket.on('room:closed', () =>
      this.patch({ pub: null, priv: null, error: 'Room closed.' }),
    );
    this.socket.on('cast:roomCode', ({ code, token }: { code: string; token: string }) =>
      this.receiverSubscribe(code, token),
    );
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private patch(p: Partial<GameState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }
  private emit<T>(event: string, payload: unknown): Promise<Ack<T>> {
    return new Promise((resolve) => this.socket.emit(event, payload, (ack: Ack<T>) => resolve(ack)));
  }

  setError(error: string | null) {
    this.patch({ error });
  }

  // ---- saved identity for reconnection ----
  savedCode(): string | null {
    return localStorage.getItem(LS_CODE);
  }
  savedToken(): string | null {
    return localStorage.getItem(LS_TOKEN);
  }
  savedName(): string | null {
    return localStorage.getItem(LS_NAME);
  }
  clearSaved() {
    localStorage.removeItem(LS_CODE);
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_NAME);
  }

  // ---- host ----
  async hostCreate(canCast: boolean): Promise<string | null> {
    const res = await this.emit<{ code: string }>('host:create', { canCast });
    if (res.ok) {
      this.patch({ code: res.data.code });
      return res.data.code;
    }
    this.patch({ error: res.error });
    return null;
  }
  castStatus(connected: boolean) {
    this.socket.emit('host:castStatus', { connected });
  }

  // ---- join ----
  async join(code: string, displayName: string, canCast = false): Promise<boolean> {
    const token = this.savedToken() ?? undefined;
    const reconnectToken = this.savedCode() === code ? token : undefined;
    const res = await this.emit<{ playerId: string; reconnectToken: string }>('room:join', {
      code,
      displayName,
      reconnectToken,
      canCast,
    });
    if (res.ok) {
      localStorage.setItem(LS_CODE, code);
      localStorage.setItem(LS_TOKEN, res.data.reconnectToken);
      localStorage.setItem(LS_NAME, displayName);
      this.patch({ code, error: null });
      return true;
    }
    this.patch({ error: res.error });
    return false;
  }

  // ---- lobby ----
  async start(): Promise<boolean> {
    const res = await this.emit('lobby:start', {});
    if (!res.ok) this.patch({ error: res.error });
    return res.ok;
  }

  // ---- writing ----
  async setPlate(plate: string): Promise<boolean> {
    const res = await this.emit('plate:set', { plate });
    if (!res.ok) this.patch({ error: res.error });
    return res.ok;
  }
  async submitPlate(): Promise<boolean> {
    const res = await this.emit('plate:submit', {});
    if (!res.ok) this.patch({ error: res.error });
    return res.ok;
  }

  // ---- guessing ----
  async award(winnerPlayerId: string | null): Promise<boolean> {
    const res = await this.emit('guess:award', { winnerPlayerId });
    if (!res.ok) this.patch({ error: res.error });
    return res.ok;
  }
  async advance(): Promise<boolean> {
    const res = await this.emit('guess:advance', {});
    if (!res.ok) this.patch({ error: res.error });
    return res.ok;
  }

  // ---- round / host powers ----
  async nextRound(): Promise<boolean> {
    const res = await this.emit('round:next', {});
    if (!res.ok) this.patch({ error: res.error });
    return res.ok;
  }
  forceEnd() {
    this.socket.emit('host:forceEnd', {});
  }
  async rematch(): Promise<boolean> {
    const res = await this.emit('host:rematch', {});
    if (!res.ok) this.patch({ error: res.error });
    return res.ok;
  }

  // ---- receiver ----
  receiverStandby() {
    this.socket.emit('receiver:standby', {});
  }

  async receiverSubscribe(code: string, token: string): Promise<boolean> {
    const res = await this.emit('receiver:subscribe', { code, token });
    if (res.ok) {
      this.patch({ code, castToken: token, error: null });
      // Every code-delivery path (Cast message, server push, ?code= in the
      // URL, HTTP poll) converges here. A successful subscribe means the
      // receiver.html HTTP-polling fallback is no longer needed — stop it so
      // it can't reload the page (a real socket disconnect for the TV) on top
      // of a session that is already live.
      const w = window as unknown as { __castPollTimer?: number };
      if (w.__castPollTimer) {
        clearInterval(w.__castPollTimer);
        w.__castPollTimer = undefined;
      }
    } else {
      this.patch({ error: res.error });
    }
    return res.ok;
  }
}

export const store = new GameStore();
