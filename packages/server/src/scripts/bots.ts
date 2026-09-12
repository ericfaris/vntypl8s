/**
 * Bot players for local play-testing.
 *
 *   npm run bots                 # host mode — bots create a room, print the
 *                                #   join + TV URLs, wait for you, then run
 *                                #   the lobby and advance rounds themselves
 *   npm run bots -- 4821         # join mode — bots join room 4821; YOU are the
 *                                #   host and drive Start / Next round
 *   npm run bots -- --n 2        # 2 bots instead of 3
 *   npm run bots -- --solo       # host mode, don't wait for a human
 *   npm run bots -- --server http://192.168.1.42:3001
 *
 * While running in host mode, single-key stdin commands:
 *   s  start the game now        n  force next round
 *   r  rematch (after GAME_OVER) q  quit
 *
 * The bots talk to the real server over the same WebSocket protocol the phone
 * app uses — they are ordinary clients, not an engine shortcut. If you changed
 * anything in packages/shared, run `npm run build -w @vntypl8s/shared` first
 * (this script imports its built dist, same as the server does).
 */
import { io, type Socket } from 'socket.io-client';
import {
  MIN_PLAYERS,
  PLATE_DIGITS,
  PLATE_LETTERS,
  PLATE_MAX_LENGTH,
  SOCKET_PATH,
  satisfiesRequirements,
  validatePlate,
  type Ack,
  type PrivateState,
  type PublicRoom,
} from '@vntypl8s/shared';

// --------------------------------------------------------------------- args
const raw = process.argv.slice(2);
const opts = { n: 3, solo: false, server: process.env.SERVER_URL ?? 'http://localhost:3001' };
let joinCode: string | null = null;
for (let i = 0; i < raw.length; i++) {
  const a = raw[i] ?? '';
  if (a === '--n') opts.n = Math.max(1, Number(raw[++i]) || 3);
  else if (a === '--solo') opts.solo = true;
  else if (a === '--server') opts.server = raw[++i] ?? opts.server;
  else if (/^\d{4}$/.test(a)) joinCode = a;
  else if (a === '--help' || a === '-h') {
    console.log('npm run bots [4-digit code] [--n 3] [--solo] [--server http://host:3001]');
    process.exit(0);
  }
}
if (process.env.BOTS) opts.n = Math.max(1, Number(process.env.BOTS) || opts.n);

const HOST_MODE = joinCode === null;
const NAMES = ['Rusty', 'Turbo', 'Miles', 'Dash', 'Chrome', 'Axle', 'Piston', 'Clutch'];
const rnd = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!;
const botName = (i: number): string => NAMES[i % NAMES.length]!;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (base: number, spread: number) => base + Math.random() * spread;
const POOL = (PLATE_LETTERS + PLATE_DIGITS).split('');
const BOTS: Bot[] = [];

// --------------------------------------------------------- plate generation
/** A legal plate. ~80% of the time it satisfies the bot's Requirements card
 *  (so the bonus path gets exercised); the rest of the time it deliberately
 *  doesn't (also legal — scoring just skips the bonus). */
function makePlate(required: string): string {
  const satisfy = Math.random() < 0.8;
  if (!satisfy || !required) {
    let s = '';
    const len = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < len; i++) s += rnd(POOL);
    return validatePlate(s).ok ? s : 'BCDFG';
  }
  const parts: string[] = [];
  for (const ch of required) {
    if (Math.random() < 0.55 && parts.join('').length + 2 < PLATE_MAX_LENGTH) parts.push(rnd(POOL));
    parts.push(ch);
  }
  while (parts.join('').length < PLATE_MAX_LENGTH && Math.random() < 0.4) parts.push(rnd(POOL));
  let s = parts.join('').slice(0, PLATE_MAX_LENGTH);
  if (!satisfiesRequirements(s, required)) s = required.slice(0, PLATE_MAX_LENGTH);
  return validatePlate(s).ok ? s : required.slice(0, PLATE_MAX_LENGTH) || 'BCDFG';
}

// ------------------------------------------------------------------- Bot
class Bot {
  socket: Socket;
  name: string;
  playerId = '';
  token = '';
  priv: PrivateState | null = null;
  pub: PublicRoom | null = null;
  private code = '';
  private joined = false;
  private wroteForRound = -1;
  private turnsActedOn = new Set<string>();

  constructor(name: string) {
    this.name = name;
    this.socket = io(opts.server, { path: SOCKET_PATH, forceNew: true });
    // Re-join after a transparent transport reconnect (server forgot us).
    this.socket.on('connect', () => {
      if (this.joined) void this.doJoin();
    });
    this.socket.on('disconnect', () => this.log('transport dropped — retrying'));
    this.socket.on('you:state', (p: PrivateState) => {
      this.priv = p;
      this.react();
    });
    this.socket.on('room:state', (p: PublicRoom) => {
      this.pub = p;
      this.react();
    });
    this.socket.on('room:closed', ({ reason }: { reason: string }) => this.log(`room closed: ${reason}`));
    this.socket.on('error', ({ message }: { message: string }) => this.log(`server: ${message}`));
  }

  private emit<T>(event: string, payload: unknown): Promise<Ack<T>> {
    return new Promise((resolve) => this.socket.emit(event, payload, resolve));
  }
  private log(msg: string) {
    console.log(`  ${this.name.padEnd(7)} ${msg}`);
  }
  ready(): Promise<void> {
    return new Promise((r) => (this.socket.connected ? r() : this.socket.once('connect', () => r())));
  }

  async createRoom(): Promise<string> {
    await this.ready();
    const r = await this.emit<{ code: string }>('host:create', { canCast: true });
    if (!r.ok) throw new Error(`host:create failed: ${r.error}`);
    this.code = r.data.code;
    return r.data.code;
  }

  async join(code: string): Promise<void> {
    this.code = code;
    await this.ready();
    await this.doJoin();
  }

  private async doJoin() {
    const r = await this.emit<{ playerId: string; reconnectToken: string }>('room:join', {
      code: this.code,
      displayName: this.name,
      reconnectToken: this.token || undefined,
    });
    if (!r.ok) return this.log(`join failed: ${r.error}`);
    this.playerId = r.data.playerId;
    this.token = r.data.reconnectToken;
    if (!this.joined) {
      this.joined = true;
      this.log(`joined ${this.code}`);
    }
  }

  private isBot(id: string): boolean {
    return BOTS.some((b) => b.playerId === id);
  }

  /** Everything a bot does in response to a state update — all idempotent. */
  private react() {
    const { pub, priv } = this;
    if (!pub || !priv || !priv.playerId) return;

    if (pub.phase === 'WRITE_PLATES' && !priv.pendingJoin && !priv.submitted) {
      const round = pub.round?.roundNumber ?? 0;
      if (this.wroteForRound !== round) {
        this.wroteForRound = round;
        void this.writePlate(round);
      }
      return;
    }

    if (pub.phase === 'GUESSING' && priv.isActivePlayer && pub.round && !pub.round.currentResolution) {
      const key = `${pub.round.roundNumber}:${pub.round.turnIndex}`;
      if (!this.turnsActedOn.has(key)) {
        this.turnsActedOn.add(key);
        void this.playActiveTurn(key);
      }
    }
  }

  /** Is it still my turn to act, and this exact turn? Guards every emit. */
  private stillMyTurn(key: string): boolean {
    const r = this.pub?.round;
    return (
      this.pub?.phase === 'GUESSING' &&
      !!r &&
      !r.currentResolution &&
      this.priv?.isActivePlayer === true &&
      `${r.roundNumber}:${r.turnIndex}` === key
    );
  }

  private async writePlate(round: number) {
    const required = this.priv?.requirementsCard?.chars ?? '';
    const plate = makePlate(required);
    await wait(jitter(1200, 3500));
    if (this.pub?.phase !== 'WRITE_PLATES' || this.priv?.submitted) return;
    const setr = await this.emit<{}>('plate:set', { plate });
    if (!setr.ok) return this.log(`plate:set rejected: ${setr.error}`);
    await wait(jitter(400, 1500));
    const sub = await this.emit<{}>('plate:submit', {});
    this.log(
      sub.ok
        ? `R${round} plate "${plate}"${satisfiesRequirements(plate, required) ? ' ✓req' : ''}`
        : `plate:submit rejected: ${sub.error}`,
    );
  }

  /** Bot is the Active Player: "hear" the guesses, award someone (or nobody),
   *  then move the game on. One flow per turn, re-checked before every emit. */
  private async playActiveTurn(key: string) {
    await wait(jitter(3500, 4500)); // let the humans call out their guesses
    if (!this.stillMyTurn(key)) return;

    const pub = this.pub!;
    const others = pub.players.filter((p) => p.id !== this.playerId && !p.pendingJoin && p.connected);
    const humans = others.filter((p) => !this.isBot(p.id));
    let winnerPlayerId: string | null = null;
    if (Math.random() < 0.6 && others.length) {
      const pickFrom = humans.length && Math.random() < 0.65 ? humans : others;
      winnerPlayerId = rnd(pickFrom).id;
    }
    const r = await this.emit<{}>('guess:award', { winnerPlayerId });
    if (!r.ok) return; // turn already moved on — nothing to do
    const who = winnerPlayerId
      ? (pub.players.find((p) => p.id === winnerPlayerId)?.displayName ?? '?')
      : 'nobody';
    this.log(`turn ${key} → awarded ${who}`);

    await wait(jitter(2200, 2500)); // let the room see the reveal
    if (this.pub?.phase === 'GUESSING' && this.priv?.isActivePlayer) {
      await this.emit<{}>('guess:advance', {});
    }
  }

  // host-only (host mode)
  start = () => this.emit<{}>('lobby:start', {});
  nextRound = () => this.emit<{}>('round:next', {});
  rematch = () => this.emit<{}>('host:rematch', {});
  castStatus = (connected: boolean) => this.socket.emit('host:castStatus', { connected });
}

// --------------------------------------------------------------- helpers
async function mintToken(code: string): Promise<string | null> {
  try {
    const res = await fetch(`${opts.server}/api/cast/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    return res.ok ? ((await res.json()) as { token: string }).token : null;
  } catch {
    return null;
  }
}

async function publicBase(): Promise<string> {
  // The dev server proxies /api and /socket, so the browser URLs point at
  // Vite (5173), not the API port. Prefer what the server reports.
  try {
    const r = await fetch(`${opts.server}/api/config`);
    if (r.ok) {
      const c = (await r.json()) as { publicBaseUrl?: string };
      if (c.publicBaseUrl) return c.publicBaseUrl;
    }
  } catch {
    /* fall through */
  }
  return process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173';
}

async function printUrls(code: string) {
  const base = await publicBase();
  const token = await mintToken(code);
  console.log('');
  console.log(`  ROOM ${code}`);
  console.log(`  You (phone view) : ${base}/?code=${code}`);
  console.log(
    token
      ? `  TV (browser tab) : ${base}/receiver.html?dev&code=${code}&token=${encodeURIComponent(token)}`
      : `  TV (browser tab) : ${base}/receiver.html?dev`,
  );
  console.log('');
}

const humansInLobby = (pub: PublicRoom) =>
  pub.players.filter(
    (p) => !p.pendingJoin && p.connected && !BOTS.some((b) => b.playerId === p.id),
  ).length;

// --------------------------------------------------------------- modes
async function hostMode() {
  console.log(`Bot host mode — ${opts.n} bot${opts.n === 1 ? '' : 's'}.`);
  const host = new Bot(botName(0));
  BOTS.push(host);
  const code = await host.createRoom();
  await host.join(code);
  for (let i = 1; i < opts.n; i++) {
    const b = new Bot(botName(i));
    BOTS.push(b);
    await b.join(code);
    await wait(200);
  }
  host.castStatus(true); // lights the cast indicator on the TV lobby
  await printUrls(code);
  console.log(
    opts.solo
      ? 'Starting once the bots are all in…'
      : 'Open the phone URL above, then the bots start the game for you.',
  );
  console.log('Keys:  s start   n next round   r rematch   q quit\n');
  wireStdin(host);

  let stableSince = 0;
  let lastNextRound = -1;
  let lastPhase = '';
  setInterval(() => {
    const pub = host.pub;
    if (!pub) return;
    const tag = pub.phase + (pub.round ? ` R${pub.round.roundNumber}` : '');
    if (tag !== lastPhase) {
      lastPhase = tag;
      console.log(`— ${tag} —`);
    }
    if (pub.phase === 'LOBBY') {
      const present = pub.players.filter((p) => !p.pendingJoin && p.connected).length;
      const ready = present >= MIN_PLAYERS && (opts.solo || humansInLobby(pub) >= 1);
      if (ready) {
        if (!stableSince) stableSince = Date.now();
        else if (Date.now() - stableSince > 4000) {
          stableSince = 0;
          void host.start().then((r) => console.log(r.ok ? '\n▶ game started\n' : `start: ${r.error}`));
        }
      } else stableSince = 0;
    } else if (pub.phase === 'ROUND_END' && pub.round && lastNextRound !== pub.round.roundNumber) {
      lastNextRound = pub.round.roundNumber;
      setTimeout(() => void host.nextRound().then((r) => !r.ok && console.log(`next: ${r.error}`)), 2500);
    } else if (pub.phase === 'GAME_OVER') {
      printGameOver(pub);
    }
  }, 800);
}

let gameOverShown = false;
function printGameOver(pub: PublicRoom) {
  if (gameOverShown) return;
  gameOverShown = true;
  const name = (id: string) => pub.players.find((p) => p.id === id)?.displayName ?? id;
  console.log('\n── GAME OVER ──');
  [...pub.players]
    .sort((a, b) => b.totalScore - a.totalScore)
    .forEach((p) => console.log(`   ${p.displayName.padEnd(8)} ${p.totalScore}`));
  console.log(`   winner: ${pub.winnerPlayerIds.map(name).join(' & ') || '—'}`);
  console.log('   press  r  to rematch,  q  to quit\n');
}

function wireStdin(host: Bot) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    if (chunk.charCodeAt(0) === 3) {
      // Ctrl-C — raw mode swallows the default SIGINT.
      console.log("\nbye");
      process.exit(0);
    }
    const key = chunk.trim().toLowerCase();
    if (!key) return; // bare newline / EOF nudge — never exit on these
    if (key === "q") {
      console.log("bye");
      process.exit(0);
    }
    if (key === "s") void host.start().then((r) => console.log(r.ok ? "▶ started" : r.error));
    if (key === "n") void host.nextRound().then((r) => console.log(r.ok ? "▶ next round" : r.error));
    if (key === "r") {
      gameOverShown = false;
      void host.rematch().then((r) => console.log(r.ok ? "▶ rematch" : r.error));
    }
  });
}

async function joinMode(code: string) {
  console.log(`Bots joining room ${code} — you are the host (drive Start / Next round). Ctrl-C to stop.`);
  for (let i = 0; i < opts.n; i++) {
    const b = new Bot(botName(i));
    BOTS.push(b);
    await b.join(code);
    await wait(300);
  }
}

async function main() {
  if (HOST_MODE) await hostMode();
  else await joinMode(joinCode!);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
