# Implementation Plan: VNTYPL8S — Online Multiplayer + Chromecast

> **Audience:** the build model executing this plan. You have this file, the repo at
> `/home/eric/projects/vanity-plates`, the reference repo at `/home/eric/projects/pinpoint`,
> and the Chromecast house-style guide at `/home/eric/.claude/commands/chromecast.md`.
> Read the brief at `.claude/plans/vntypl8s-brief.md` for game rules; this plan is the
> authority on architecture, file layout, and types.
>
> **Read before coding** (in this order, ~30 min):
> 1. `/home/eric/.claude/commands/chromecast.md` — all of it, §0/§3/§4/§5/§7 are load-bearing.
> 2. `/home/eric/projects/pinpoint/packages/shared/src/{types.ts,protocol.ts,projection.ts}`
> 3. `/home/eric/projects/pinpoint/packages/server/src/engine/{engine.ts,project.ts,rng.ts,cards.ts}`
> 4. `/home/eric/projects/pinpoint/packages/server/src/net/{rooms.ts,server.ts}` and `src/index.ts`, `src/env.ts`
> 5. `/home/eric/projects/pinpoint/packages/client/src/{common,player,receiver}/*`
> 6. `/home/eric/projects/pinpoint/{Dockerfile,docker-compose.yml,.env.example,package.json}`

---

## 1. Summary

Build **VNTYPL8S** — a from-scratch npm-workspaces monorepo implementing an online,
server-authoritative multiplayer adaptation of the physical party game of the same name,
played on players' phones with a shared Chromecast TV display. Players are secretly dealt an
Owner card (a role/identity title, e.g. "Park Ranger") and a Requirements card (3 characters),
compose an 8-character legal vanity plate hinting at their Owner card using an on-screen tile
picker, then take turns having their plate revealed on the TV while everyone else guesses
*verbally*; the Active Player taps whoever guessed right to award the point. Three rounds,
then a scoring/tiebreak screen. Architecturally it mirrors `pinpoint` one-for-one — same
workspace shape, same Socket.io + Express + Vite + React stack, same engine/projection/rooms
decomposition, same single-image Dockerfile — so the two projects stay maintainable together
and the `deploy` skill can ship this the same way. Cast is used **only as a pairing channel**;
all game state flows over the same Socket.io room the phones use.

---

## 2. Approach & key decisions

### 2.1 Cast transport — RESOLVED: Cast is pairing only; the receiver is a read-only Socket.io client

**Decision.** The Cast custom-message channel carries exactly three message types
(`SYNC_ROOM`, `PING`, `TOGGLE_DEBUG`) sender→receiver and two (`SYNCED`, `ERROR`)
receiver→sender. Nothing else. The receiver takes the room code + cast token it received over
Cast and calls `receiver:subscribe` on the **same Socket.io server the phones use**, joining
the room as a tracked read-only "receiver" socket. It then renders `room:state`
(`PublicRoom`) broadcasts exactly like any other client.

**Rationale.** The Chromecast guide §0 and §5 both point here, and §5's "if a real
backend/room-based multiplayer model exists … treat Cast as pairing only" is precisely our
case. `pinpoint` already proves the pattern end-to-end: see
`pinpoint/packages/server/src/net/server.ts` (`receiver:subscribe` / `receiver:standby`
handlers, `runtime.receivers` set), `pinpoint/packages/server/src/net/rooms.ts`
(`receivers: Set<string>`, `closeIfEmpty` requiring both players **and** receivers empty plus a
`ROOM_EMPTY_GRACE_MS` window), and `pinpoint/packages/client/src/common/store.ts`
(`receiverSubscribe`). We inherit push updates for free, sidestep Cast payload/rate limits,
and need no SSE plumbing.

**Rejected alternative:** the guide's §3.5 SSE-first/poll-fallback `/api/cast/stream-*` +
`/api/cast/public-*` endpoints. Correct when the backend is REST-shaped, but here it would
mean building a *second* transport that re-derives the same `PublicRoom` we already push over
sockets. We do keep **one** small piece of that pattern as belt-and-braces (guide §5's
"secondary HTTP fallback for room-code delivery"): a `GET /api/cast/pending` endpoint the
receiver polls when no Cast message has arrived (mirrors pinpoint's `/api/cast-room` +
the inline poll script in `pinpoint/packages/client/receiver.html`).

**Improvement over pinpoint (do this):** pinpoint's `receiver:subscribe` takes a bare room
code with no auth. Room codes are 4 digits and therefore guessable, and the guide (§5, and the
§7 checklist line "cast endpoints validate a scoped access token even for 'public' data")
requires token scoping. So: add `POST /api/cast/token` which mints a short-lived
(2 h TTL) opaque token scoped to a room code, and require a valid token on `receiver:subscribe`
and on `GET /api/cast/pending`. The sender fetches the token before syncing; the receiver
passes it through.

### 2.2 AI card generation split — RESOLVED: LLM for Owner titles, programmatic for Requirements (with an optional LLM curation pass)

**Decision.**
- **Owner cards (200): LLM-generated.** These need genuine creative judgment — a good Owner
  title is a concrete, widely-known role/identity that a player can allude to obliquely
  without using its words ("Park Ranger", "Film Critic", "Storm Chaser"). That is exactly the
  kind of thing `pinpoint/packages/server/src/ai/generator.ts` already does: batched Anthropic
  Messages API calls, JSON-first extraction with a line-parsing fallback
  (`extractNames()`), then a deterministic validation pass
  (`pinpoint/packages/server/src/ai/validation.ts`) before anything enters the pool. Mirror
  that structure closely.
- **Requirements cards (36): programmatic generation + validation, with an *optional* LLM
  curation pass.** A Requirements card is three characters from a 31-symbol alphabet — there is
  no creativity to extract from an LLM in "pick 3 characters", and asking one to do it produces
  worse distribution than a seeded shuffle. Generate candidates deterministically under
  explicit distribution constraints (see §6.3), validate, then — *only if an API key is
  present* — run one LLM pass that rates each candidate for "plate-friendliness" (is it
  plausible to build a readable 8-char plate containing these 3 in order?) and we keep the
  top 36. If no key, the programmatic set is used as-is and is fully shippable. This honours
  the user's "AI-generate both decks" ask where AI adds value, and says so out loud in the
  script's output.

**Rejected alternative:** LLM-generating the 3-char strings directly. Tried mentally against
`generator.ts`'s shape — the model would need to be told the alphabet, the ordering
constraint, and a distribution target, all of which are cheaper and more reliable as code.

**Both decks ship as curated static JSON** in `packages/shared/src/data/` and are imported at
build time. No runtime generation, ever. Same fixed deck every game.

### 2.3 Room / lobby UX — RESOLVED: mirror `pinpoint/packages/server/src/net/rooms.ts` almost verbatim

- 4-digit numeric join code, collision-checked (`RoomManager.generateCode()`).
- First player to join is host (`isHost`); host transfers to the next connected player if the
  host leaves (`GameEngine.transferHost()` in pinpoint's engine).
- `MIN_PLAYERS = 3`, `MAX_PLAYERS = 8`. `lobby:start` rejects outside that range.
- Per-player `reconnectToken` persisted to `localStorage` client-side (see pinpoint
  `store.ts` `LS_CODE`/`LS_TOKEN`/`LS_NAME`, and its `connect` handler that re-issues
  `room:join` / `receiver:subscribe` after a transport reconnect — copy this, it is the fix for
  "player backgrounded their phone and the game stayed paused").
- Display names unique case-insensitively within a room.
- Disconnect handling: Socket.io `pingInterval: 25_000` / `pingTimeout: 60_000` (pinpoint
  `index.ts`) **plus** a `DISCONNECT_GRACE_MS = 60_000` timer before a drop actually pauses the
  game (pinpoint `net/server.ts`). Mid-game joiners are queued as `pendingJoin: true` and
  become active at the next round boundary.
- `closeIfEmpty` requires zero connected players **and** zero receivers **and** the room to be
  older than `ROOM_EMPTY_GRACE_MS = 60_000` — guide §5 explicitly calls out the premature-GC
  trap here.
- **Deviation from pinpoint:** pinpoint gates leaving LOBBY on `castConnected`. VNTYPL8S must
  **not** require a Cast session to start — Cast is optional (acceptance criterion 5:
  "the app functions normally with Cast simply unavailable"). Keep the `castConnected` flag in
  state for UI, but never block on it.

### 2.4 "No Owner-title words in the plate" — RESOLVED: social trust, restated in UI, not enforced

Per the brief and rulebook, this rule needs semantic judgment. We do **not** build a checker
and we do **not** soft-warn (a false-positive warning mid-composition is worse than nothing).
The writing screen shows the rule as static copy next to the player's Owner card:
*"Don't spell out words from your card. Hint at it."* That's all.

### 2.5 Guessing is verbal

No free-text input, no grid tapping by guessers. The only recorded action is the Active
Player tapping one of the other players' names (or "Nobody got it"). Enforced server-side:
`guess:award` rejects any `winnerPlayerId` equal to the Active Player, or not an active
player in the room.

### 2.6 Plate input is a tile picker

The keyboard is never used. `PlateWriter` renders 31 tap targets (21 non-vowel letters
including Y, plus 0–9) plus backspace/clear. Illegal characters are structurally
unrepresentable. The server *still* re-validates every `plate:setPlate` — never trust the
client (this is the same "filter server-side, don't rely on the client not rendering it"
principle from guide §0).

---

## 3. Repo layout to create

```
vanity-plates/
├── package.json                       # workspaces root, mirrors pinpoint/package.json
├── package-lock.json                  # generated
├── .gitignore  .dockerignore  .env.example
├── Dockerfile  docker-compose.yml
├── README.md
├── 25C034-VNTYPL8S-Rulebook-...pdf    # already present, leave it
└── packages/
    ├── shared/
    │   ├── package.json  tsconfig.json
    │   └── src/
    │       ├── index.ts                # re-exports types/protocol/projection/plate/data
    │       ├── types.ts                # canonical server-side model
    │       ├── protocol.ts             # socket event map + Ack + SOCKET_PATH
    │       ├── projection.ts           # PublicRoom / PrivateState (the allowlist shapes)
    │       ├── plate.ts                # legal alphabet + validatePlate + satisfiesRequirements
    │       └── data/
    │           ├── owners.json         # 200 curated Owner cards
    │           ├── requirements.json   # 36 curated Requirements cards
    │           └── index.ts            # typed loaders (OWNER_CARDS, REQUIREMENT_CARDS)
    ├── server/
    │   ├── package.json  tsconfig.json  vitest.config.ts
    │   └── src/
    │       ├── index.ts                # express + socket.io bootstrap
    │       ├── env.ts                  # root-.env resolution (copy pinpoint's verbatim)
    │       ├── engine/
    │       │   ├── rng.ts              # mulberry32 — copy pinpoint's verbatim
    │       │   ├── deck.ts             # DeckSource interface + StaticDeckSource + SyntheticDeckSource
    │       │   ├── engine.ts           # GameEngine state machine
    │       │   ├── project.ts          # toPublicRoom / toPrivateState
    │       │   └── __tests__/{harness.ts,simulation.test.ts,rules.test.ts,plate.test.ts}
    │       ├── net/
    │       │   ├── rooms.ts            # RoomManager + cast-token registry
    │       │   ├── server.ts           # attachSocketServer
    │       │   └── __tests__/{rooms.test.ts,integration.test.ts}
    │       ├── cast/tokens.ts          # mint/verify short-lived cast tokens
    │       ├── ai/
    │       │   ├── generator.ts        # Anthropic Owner-title generation (mirrors pinpoint)
    │       │   └── validation.ts       # deterministic validation of generated content
    │       └── scripts/
    │           └── generate-cards.ts   # one-time offline CLI; writes to shared/src/data/
    └── client/
        ├── package.json  tsconfig.json  vite.config.ts  vitest.config.ts
        ├── index.html                  # player entry
        ├── receiver.html               # TV entry (CAF boot happens HERE, see §5.10)
        ├── public/favicon.ico
        └── src/
            ├── common/{store.ts,useGame.ts,ui.tsx,styles.css,useWakeLock.ts}
            ├── common/cast/{types.ts,controller.ts,useCastSync.ts,CastProvider.tsx}
            ├── player/{main.tsx,App.tsx,screens.tsx,PlateWriter.tsx,__tests__/screens.test.tsx}
            ├── receiver/{main.tsx,App.tsx,debug.ts,receiver.css}
            └── test/{setup.ts,fixtures.ts}
```

Package names: `@vntypl8s/shared`, `@vntypl8s/server`, `@vntypl8s/client`. Root package name
`vntypl8s`, version `0.1.0`.

---

## 4. Data / model / API changes

All types below go in `packages/shared/src`. They are the contract — write them first, before
any engine or UI code, so both sides compile against the same shapes.

### 4.1 `shared/src/plate.ts` — plate alphabet & rules

```ts
/** A–Z minus vowels (Y is legal), plus 0–9. 31 symbols. Order = tile-picker order. */
export const PLATE_LETTERS = 'BCDFGHJKLMNPQRSTVWXYZ' as const;      // 21
export const PLATE_DIGITS  = '0123456789' as const;                  // 10
export const PLATE_ALPHABET = (PLATE_LETTERS + PLATE_DIGITS).split('');
export const PLATE_MAX_LENGTH = 8;
export const PLATE_MIN_LENGTH = 1;
export const VOWELS = 'AEIOU';

export type PlateError =
  | 'EMPTY' | 'TOO_LONG' | 'ILLEGAL_CHAR' | 'LOWERCASE' | 'VOWEL' | 'WHITESPACE';

export interface PlateValidation { ok: boolean; error: PlateError | null }

/** Mechanical Plate Creation Rules only. Deliberately does NOT check the
 *  "no Owner-title words" rule — that is social/honour-system (§2.4). */
export function validatePlate(plate: string): PlateValidation;

/** True iff the 3 required chars appear in `plate` in order (subsequence match). */
export function satisfiesRequirements(plate: string, required: string): boolean;
```

`satisfiesRequirements` is a plain subsequence scan: walk `plate`, advance a pointer through
`required`, return `pointer === required.length`. Not contiguous — the rulebook only demands
"all 3 characters, in order".

### 4.2 `shared/src/types.ts` — canonical model

```ts
// ---------- Cards ----------
export interface OwnerCard {
  id: string;            // 'own_001'
  title: string;         // 'Park Ranger'
}
export interface RequirementsCard {
  id: string;            // 'req_01'
  chars: string;         // exactly 3, all in PLATE_ALPHABET, e.g. 'RF5'
}

// ---------- Phases ----------
export type RoomPhase =
  | 'LOBBY'
  | 'WRITE_PLATES'   // simultaneous composition
  | 'GUESSING'       // turn-based reveal/guess/award
  | 'ROUND_END'      // interstitial
  | 'GAME_OVER'
  | 'PAUSED';

// ---------- Players ----------
export interface Player {
  id: string;
  reconnectToken: string;        // secret
  displayName: string;
  connected: boolean;
  isHost: boolean;
  canCast: boolean;              // device reported Cast Sender support
  pendingJoin: boolean;          // joined mid-game; active next round
  joinOrder: number;
  /** Scoring piles — persist across rounds, cleared only on rematch. */
  ownerPile: OwnerCard[];
  requirementsPile: RequirementsCard[];
}

// ---------- Per-player round state ----------
export interface PlayerRoundState {
  playerId: string;
  ownerCard: OwnerCard;            // SERVER-ONLY until revealed/awarded
  requirementsCard: RequirementsCard; // SERVER-ONLY until this player's turn resolves
  plate: string;                   // draft while writing, final once submitted
  submitted: boolean;
  submittedAt: number | null;      // drives finish order == guessing turn order
  /** Computed at submit time; server-authoritative. */
  requirementsMet: boolean;
}

// ---------- Grid ----------
export interface GridCard {
  card: OwnerCard;
  /** playerId whose card this is, or null for one of the 6 filler cards.
   *  NEVER projected publicly while face-up in the grid. */
  ownerPlayerId: string | null;
  status: 'IN_GRID' | 'SCORED' | 'DISCARDED';
}

// ---------- Turn resolution ----------
export type TurnOutcome = 'GUESSED' | 'MISSED';
export interface TurnResolution {
  activePlayerId: string;
  outcome: TurnOutcome;
  /** who guessed it (null when MISSED) */
  winnerPlayerId: string | null;
  /** the Active Player's Owner card — revealed once the turn resolves */
  revealedOwnerCard: OwnerCard;
  /** the Active Player's Requirements card — revealed once the turn resolves */
  revealedRequirementsCard: RequirementsCard;
  requirementsMet: boolean;
  /** true iff requirementsMet && outcome === 'GUESSED' */
  requirementsScored: boolean;
}

// ---------- Round ----------
export interface RoundState {
  roundNumber: number;             // 1..3
  playerStates: PlayerRoundState[];
  /** Assembled at the end of WRITE_PLATES: every player's card + 6 filler, shuffled. */
  grid: GridCard[];
  /** playerIds in submit order; the guessing turn order. */
  turnOrder: string[];
  turnIndex: number;               // index into turnOrder; -1 while writing
  /** Set once the current Active Player's turn resolves; cleared on advance. */
  currentResolution: TurnResolution | null;
  /** Every resolution this round, in order — drives the TV recap. */
  resolutions: TurnResolution[];
}

// ---------- Room ----------
export interface GameRoom {
  code: string;
  phase: RoomPhase;
  players: Player[];
  round: RoundState | null;
  /** Undealt remainder of the shuffled decks for this game. */
  ownerDeck: OwnerCard[];
  requirementsDeck: RequirementsCard[];
  timer: TimerState;
  pause: PauseState;
  castConnected: boolean;
  winnerPlayerIds: string[];       // supports shared victory
  createdAt: number;
  phaseBeforePause: RoomPhase | null;
}

export interface TimerState { enabled: boolean; phaseDeadline: number | null }
export interface PauseState {
  active: boolean;
  reason: 'PLAYER_DISCONNECT' | null;
  waitingForPlayerId: string | null;
}

// ---------- Constants ----------
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const TOTAL_ROUNDS = 3;
export const FILLER_CARDS_PER_ROUND = 6;
export const WRITE_SECONDS = 120;     // generous; timer is advisory, see §5.4
```

### 4.3 `shared/src/projection.ts` — the public/cast allowlist

**This is the security boundary the Chromecast guide demands (§0, §7).** The receiver gets
`PublicRoom` and nothing else. Build it with an explicit field-by-field constructor — never
`{...room}` with deletions, never `JSON.parse(JSON.stringify(room))`.

**Explicitly stripped and never present in `PublicRoom`:**
`Player.reconnectToken`; `PlayerRoundState.ownerCard`/`requirementsCard` (until resolved);
`PlayerRoundState.plate` for anyone whose turn hasn't come up; `GridCard.ownerPlayerId`;
`GameRoom.ownerDeck`/`requirementsDeck`; `phaseBeforePause`; anything socket-related.

```ts
export interface PublicPlayer {
  id: string;
  displayName: string;
  connected: boolean;
  isHost: boolean;
  canCast: boolean;
  pendingJoin: boolean;
  joinOrder: number;
  ownerScore: number;          // ownerPile.length  (counts, never contents)
  requirementsScore: number;   // requirementsPile.length
  totalScore: number;
  /** WRITE_PLATES only: has this player locked in? Never their plate text. */
  submitted: boolean;
  /** WRITE_PLATES only: character count so the TV can show progress dots. */
  plateLength: number;
}

/** A face-up grid card. Title only — the owner mapping is the whole game. */
export interface PublicGridCard {
  cardId: string;
  title: string;
  status: 'IN_GRID' | 'SCORED' | 'DISCARDED';
  /** Only set once status !== 'IN_GRID'; who ended up with it (or null if discarded). */
  claimedByPlayerId: string | null;
}

export interface PublicTurnResolution {
  activePlayerId: string;
  outcome: 'GUESSED' | 'MISSED';
  winnerPlayerId: string | null;
  ownerCardTitle: string;
  requirementsChars: string;
  requirementsMet: boolean;
  requirementsScored: boolean;
}

export interface PublicRound {
  roundNumber: number;
  turnOrder: string[];
  turnIndex: number;
  activePlayerId: string | null;
  /** The Active Player's plate — the ONLY plate ever public, and only on their turn. */
  revealedPlate: string | null;
  grid: PublicGridCard[];
  currentResolution: PublicTurnResolution | null;
  resolutions: PublicTurnResolution[];
}

export interface PublicRoom {
  code: string;
  phase: RoomPhase;
  players: PublicPlayer[];
  round: PublicRound | null;
  timer: TimerState;
  pause: PauseState;
  castConnected: boolean;
  winnerPlayerIds: string[];
  totalRounds: number;
  serverNow: number;   // clients reconcile timer deadlines against this (pinpoint pattern)
}

/** Sent only to the owning socket. */
export interface PrivateState {
  playerId: string | null;
  reconnectToken: string | null;
  isHost: boolean;
  pendingJoin: boolean;
  /** Your secret cards this round. */
  ownerCard: OwnerCard | null;
  requirementsCard: RequirementsCard | null;
  /** Your own plate draft (others never see it until your turn). */
  plate: string;
  submitted: boolean;
  /** Live indicator while composing — do your 3 chars appear in order yet? */
  requirementsMet: boolean;
  isActivePlayer: boolean;
  /** Your pile contents, for a personal score screen. */
  ownerPile: OwnerCard[];
  requirementsPile: RequirementsCard[];
}
```

### 4.4 `shared/src/protocol.ts` — socket + cast wire protocol

```ts
export const SOCKET_PATH = '/socket';
export const CAST_NAMESPACE = 'urn:x-cast:com.mooseflip.vntypl8s.v1';
export type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ClientToServer {
  'host:create': (p: { canCast: boolean }, ack: (r: Ack<{ code: string }>) => void) => void;
  'host:castStatus': (p: { connected: boolean }) => void;

  'room:join': (
    p: { code: string; displayName: string; reconnectToken?: string; canCast?: boolean },
    ack: (r: Ack<{ playerId: string; reconnectToken: string }>) => void,
  ) => void;

  /** TV receiver joins read-only. Token is required and validated server-side. */
  'receiver:subscribe': (p: { code: string; token: string }, ack: (r: Ack<{}>) => void) => void;
  /** TV receiver has no code yet; park it until a host casts. */
  'receiver:standby': (p: {}) => void;

  'lobby:start': (p: {}, ack: (r: Ack<{}>) => void) => void;

  /** Tile-picker writes the whole current draft each tap. Server re-validates. */
  'plate:set': (p: { plate: string }, ack: (r: Ack<{}>) => void) => void;
  'plate:submit': (p: {}, ack: (r: Ack<{}>) => void) => void;

  /** Active Player taps the winner, or null for "nobody got it". */
  'guess:award': (p: { winnerPlayerId: string | null }, ack: (r: Ack<{}>) => void) => void;
  /** Active Player moves to the next plate after seeing the resolution. */
  'guess:advance': (p: {}, ack: (r: Ack<{}>) => void) => void;

  'round:next': (p: {}, ack: (r: Ack<{}>) => void) => void;
  'host:forceEnd': (p: {}) => void;
  'host:rematch': (p: {}, ack: (r: Ack<{}>) => void) => void;
}

export interface ServerToClient {
  'host:created': (p: { code: string }) => void;
  'room:state': (p: PublicRoom) => void;
  'you:state': (p: PrivateState) => void;
  'room:closed': (p: { reason: string }) => void;
  'error': (p: { message: string }) => void;
  /** Server pushes a code to a standby receiver when a host casts. */
  'cast:roomCode': (p: { code: string; token: string }) => void;
}
```

Cast-channel messages (also in `protocol.ts`, so sender and receiver import the **same
literal namespace string** — guide §2.5 warns namespace drift is a silent killer):

```ts
export type SenderToReceiverMessage =
  | { type: 'SYNC_ROOM'; roomCode: string; token: string; apiBaseUrl: string }
  | { type: 'PING'; t: number }
  | { type: 'TOGGLE_DEBUG' };

export type ReceiverToSenderMessage =
  | { type: 'SYNCED'; roomCode: string }
  | { type: 'ERROR'; code: 'INVALID_PAYLOAD' | 'TOKEN_REJECTED' | 'ROOM_NOT_FOUND'
        | 'BACKEND_UNREACHABLE' | 'INTERNAL'; message?: string };
```

### 4.5 HTTP endpoints (`server/src/index.ts`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/config` | `{ castReceiverAppId, publicBaseUrl, appVersion }` — pinpoint parity |
| GET | `/api/health` | `{ ok, version, rooms }` |
| POST | `/api/cast/token` | body `{ code }` → `{ token, expiresAt }`; 404 if room unknown |
| GET | `/api/cast/pending` | `{ code, token } \| { code: null }` — HTTP fallback for code delivery (guide §5), `Cache-Control: no-store`, 120 s validity like pinpoint's `getPendingCastCode()` |
| GET | `/receiver.html` | 302 to `?v=<DEPLOY_VERSION>` for cache-busting (copy pinpoint's `index.ts` block — guide §6 "version-bust aggressively") |
| — | static | `express.static(clientDist)` + SPA fallback for `/` and `/join` |

Cast tokens (`server/src/cast/tokens.ts`): in-memory `Map<token, { code, expiresAt }>`,
`randomBytes(24).toString('base64url')`, 2 h TTL, swept lazily on lookup. No JWT, no
persistence — rooms are ephemeral.

---

## 5. Step-by-step tasks

Each step is independently verifiable. Run `npm run typecheck` after every step from step 2
onward; it should stay green.

### Step 1 — Monorepo scaffold

**Create:** root `package.json`, `.gitignore`, `.dockerignore`, `.env.example`,
`packages/{shared,server,client}/package.json`, `packages/{shared,server,client}/tsconfig.json`,
`packages/{server,client}/vitest.config.ts`, `packages/client/vite.config.ts`.

Copy `pinpoint`'s equivalents verbatim, substituting `@pinpoint/*` → `@vntypl8s/*` and the
name/description. Specifically:

- Root scripts exactly as pinpoint's: `build` (shared → client → server in that order),
  `dev` (`concurrently -n server,client -c blue,green "npm:dev:server" "npm:dev:client"`),
  `dev:server`, `dev:client`, `typecheck` (`--workspaces --if-present`),
  `test` (`--workspaces --if-present`).
- Root devDeps: `concurrently ^9.1.0`, `typescript ^5.7.2`.
- `shared/tsconfig.json`: add `"resolveJsonModule": true` to pinpoint's version (we import
  `data/*.json`). Everything else identical.
- `server/tsconfig.json`, `client/tsconfig.json`, both `vitest.config.ts`, `vite.config.ts`:
  identical to pinpoint's modulo the alias rename. **Keep** `vite.config.ts`'s two-input
  rollup (`player: index.html`, `receiver: receiver.html`) and the dev proxy to
  `http://localhost:3001` for `/socket` (ws) and `/api`. **Add** `server: { host: true }` so
  the Vite dev server binds `0.0.0.0` — the Chromecast can't resolve `localhost` (guide §6).
- `.env.example`:
  ```
  ANTHROPIC_API_KEY=
  ANTHROPIC_MODEL=claude-sonnet-4-5
  PORT=3001
  CAST_RECEIVER_APP_ID=
  PUBLIC_BASE_URL=http://localhost:5173
  ```
- Deps per package: match pinpoint's `package.json` dependency lists exactly (server:
  `@anthropic-ai/sdk`, `dotenv`, `express ^4`, `socket.io`; client: `qrcode`, `react ^18`,
  `react-dom`, `socket.io-client`; plus the same devDeps).

**Verify:** `npm install` at root completes; `npm run typecheck` runs (trivially passes, no
source yet).

### Step 2 — `packages/shared` types, protocol, projection, plate rules

**Create:** `shared/src/{index.ts,types.ts,protocol.ts,projection.ts,plate.ts}` exactly as
specified in §4. `index.ts` re-exports all of them plus `./data/index.js`.

**Create placeholder decks now** so nothing downstream is blocked on the AI step
(§5.11): `shared/src/data/owners.json` and `requirements.json` with a small hand-written
starter set (say 24 owners, 12 requirements) and a `TODO` note in `data/index.ts` that these
are replaced by the generation script. `data/index.ts`:

```ts
import ownersRaw from './owners.json' with { type: 'json' };
import requirementsRaw from './requirements.json' with { type: 'json' };
export const OWNER_CARDS: OwnerCard[] = ownersRaw;
export const REQUIREMENT_CARDS: RequirementsCard[] = requirementsRaw;
```
(If the `with { type: 'json' }` import attribute causes friction under the `Bundler`
moduleResolution + Vite combination, fall back to a plain `import x from './owners.json'`
with `resolveJsonModule`. Verify whichever form builds in **both** `tsc -p shared` and the
Vite client build before moving on — the shared package is consumed both ways.)

**Verify:** `npm run build -w @vntypl8s/shared` emits `dist/index.d.ts` with all types.

### Step 3 — Engine: RNG + deck source

**Create:** `server/src/engine/rng.ts` — copy `pinpoint/packages/server/src/engine/rng.ts`
verbatim (mulberry32, `next/int/pick/shuffle`). Determinism here is what makes step 5's
simulation test possible.

**Create:** `server/src/engine/deck.ts`:

```ts
export interface DeckSource {
  ownerDeck(rng: Rng): OwnerCard[];          // full shuffled copy
  requirementsDeck(rng: Rng): RequirementsCard[];
}
/** Production: the curated static JSON from @vntypl8s/shared. */
export class StaticDeckSource implements DeckSource { … }
/** Tests: unbounded synthetic decks, mirrors pinpoint's SyntheticCardSource. */
export class SyntheticDeckSource implements DeckSource { … }
```

`SyntheticDeckSource` mints `Owner N` titles and cycles valid 3-char requirement strings so
tests never exhaust a deck regardless of player count/round count.

**Verify:** trivial unit test that `StaticDeckSource.ownerDeck()` returns the full deck
shuffled and with unique ids.

### Step 4 — Engine: `GameEngine`

**Create:** `server/src/engine/engine.ts`. Structure it like
`pinpoint/packages/server/src/engine/engine.ts`: a class owning exactly one `GameRoom`,
constructor `(code: string, deps: { rng?, deckSource, now? })`, every mutator returning
`EngineResult = { ok: true } | { ok: false; error: string }`, zero I/O, zero timers (the net
layer owns `setTimeout`). Deterministic given `{ rng, deckSource, now }`.

Public API:

| Method | Behaviour |
|---|---|
| `join({displayName, reconnectToken, canCast})` | Reconnect by token reclaims the seat (clears `connected: false`); new joins get id + token; first joiner is host; rejects duplicate names (case-insensitive), rejects >`MAX_PLAYERS`. Mid-game joins land as `pendingJoin: true`. |
| `start(hostId)` | Host-only; requires `MIN_PLAYERS..MAX_PLAYERS` connected non-pending players; shuffles `ownerDeck`/`requirementsDeck` from `DeckSource`; calls `beginRound(1)`. |
| `beginRound(n)` *(private)* | Promotes `pendingJoin` players to active; deals **one** Owner + **one** Requirements card per active player from the decks; builds `RoundState` with empty grid, `turnIndex: -1`; sets phase `WRITE_PLATES`; starts the write timer. |
| `setPlate(playerId, plate)` | Rejects if not `WRITE_PLATES`, if already `submitted`, or if `validatePlate(plate)` fails. Stores draft; recomputes `requirementsMet`. |
| `submitPlate(playerId)` | Rejects if plate empty/invalid. Sets `submitted`, `submittedAt = now()`, freezes `requirementsMet`. Then `maybeAssembleGrid()`. |
| `writeTimerExpired()` | Auto-submits every unsubmitted player with whatever draft they have (empty draft → empty plate, `requirementsMet: false`, and they simply can't be guessed — allowed, matches the physical game's "time's up"). Then `maybeAssembleGrid()`. |
| `maybeAssembleGrid()` *(private)* | When every active player has submitted: `turnOrder` = playerIds sorted by `submittedAt` asc (ties broken by `joinOrder`); grid = each player's Owner card (`ownerPlayerId` set) **plus** `FILLER_CARDS_PER_ROUND` (6) drawn from `ownerDeck` (`ownerPlayerId: null`), then `rng.shuffle()`; phase → `GUESSING`; `turnIndex = 0`. |
| `award(activePlayerId, winnerPlayerId \| null)` | Rejects unless caller is the current Active Player, phase is `GUESSING`, and `currentResolution === null`. Rejects `winnerPlayerId === activePlayerId` or a non-active/unknown player. Builds a `TurnResolution`: marks the Active Player's grid card `SCORED` (pushed into the winner's `ownerPile`) or `DISCARDED`; if `requirementsMet && outcome === 'GUESSED'`, pushes the Requirements card into the **Active Player's** `requirementsPile` and sets `requirementsScored`. Stores as `currentResolution` and appends to `resolutions`. |
| `advanceTurn(activePlayerId)` | Rejects unless caller is the Active Player and `currentResolution !== null`. Clears `currentResolution`, `turnIndex++`. If `turnIndex >= turnOrder.length`: mark every remaining `IN_GRID` card `DISCARDED`, phase → `ROUND_END` (or `GAME_OVER` via `endGame()` if `roundNumber === TOTAL_ROUNDS`). |
| `nextRound(hostId)` | Host-only, `ROUND_END` only; `beginRound(roundNumber + 1)`. |
| `endGame()` *(private)* | `totalScore = ownerPile.length + requirementsPile.length`; winners = all players with max `totalScore`; tiebreak by max `requirementsPile.length` among those; if still tied, **all** remain in `winnerPlayerIds` (shared victory). Phase → `GAME_OVER`. |
| `disconnect(playerId)` / `removePlayer` / `transferHost` | Copy pinpoint's semantics: mark disconnected, pause the game if it's in progress and the disconnected player is needed, transfer host if the host left. |
| `pause` / `maybeResume` | Copy pinpoint's. Only `PLAYER_DISCONNECT` (no `CAST_DROPPED` — Cast is optional here, §2.3). |
| `setCastConnected(b)` | Sets the flag for UI only; never gates phase transitions. |
| `forceEnd(hostId)`, `rematch(hostId)` | Copy pinpoint's shape; `rematch` clears piles, reshuffles decks, returns to `LOBBY`. |

**Ordering constraint:** `award` must mark the grid card **before** computing
`requirementsScored`, and must never mutate `ownerDeck` (fillers were already drawn at grid
assembly). Requirements cards are never returned to the deck — a 36-card deck against a
max of 8 players × 3 rounds = 24 draws, so it never exhausts.

**Verify:** `npm run typecheck -w @vntypl8s/server`.

### Step 5 — Engine: projection + engine tests

**Create:** `server/src/engine/project.ts` with `toPublicRoom(room, now)` and
`toPrivateState(engine, playerId)`, built field-by-field per §4.3. Model on
`pinpoint/packages/server/src/engine/project.ts`.

Critical projection rules, each of which gets an assertion in the harness:
- `PublicGridCard` never carries `ownerPlayerId` while `status === 'IN_GRID'`.
- `PublicRound.revealedPlate` is non-null **only** for the current Active Player, and only in
  `GUESSING`.
- `PublicPlayer` carries `ownerScore`/`requirementsScore` counts, never pile contents.
- No `reconnectToken` anywhere in `PublicRoom`.
- `toPrivateState(engine, null)` (the receiver's private state) is all-nulls/zeros.

**Create:** `server/src/engine/__tests__/harness.ts` — mirror pinpoint's harness:
- `Clock` with `now()`/`advance()`.
- `makeEngine(seed)` → `{ engine, clock }` using `makeRng(seed)` + `SyntheticDeckSource`.
- `addPlayers(engine, n)` → seats.
- `checkInvariants(engine, prevScores?)` asserting: scores monotonically non-decreasing;
  exactly one host when non-empty; unique case-insensitive names; every plate in
  `playerStates` passes `validatePlate` or is `''`; grid card count ===
  `activePlayers + 6`; no duplicate card ids in the grid; `turnIndex` within bounds;
  **and the five projection leak checks above**.
- `playFullGame(engine, hostId, opts)` — drives 3 rounds: each player writes a plate (some
  satisfying requirements, some not, driven by seeded rand), submits in varied order, then
  each Active Player awards a winner or "nobody", advances, and the host calls `nextRound`.

**Create:**
- `__tests__/plate.test.ts` — table-driven `validatePlate` cases: lowercase rejected, vowels
  rejected, spaces/punctuation/emoji rejected, 9 chars rejected, 8 chars accepted, `Y`
  accepted, digits accepted; `satisfiesRequirements` cases: exact `'RF5'` vs `'BRF5X'` (ok),
  `'B5RF'` (out of order → false), `'RF'` (missing → false), duplicate-char handling.
- `__tests__/rules.test.ts` — targeted scoring cases: (a) guessed + requirements met → guesser
  gets the Owner card, Active Player gets the Requirements card; (b) guessed + requirements
  **not** met → guesser scores, Active Player gets nothing; (c) missed + requirements met →
  nobody scores, card discarded; (d) Active Player cannot award themselves; (e) turn order
  equals submit order; (f) grid size = players + 6; (g) tiebreak: equal totals resolved by
  requirements count, and full tie → shared `winnerPlayerIds`.
- `__tests__/simulation.test.ts` — for each player count 3..8, run ~25 seeded full 3-round
  games; assert termination at `GAME_OVER` after exactly 3 rounds, `winnerPlayerIds.length >= 1`,
  every winner's total equals the max total, and `checkInvariants` after every mutation.

**Verify:** `npm test -w @vntypl8s/server` — all green. This is acceptance criterion 3's
automated half.

### Step 6 — Net: `RoomManager` + cast tokens

**Create:** `server/src/net/rooms.ts` — port pinpoint's `RoomManager` directly:
`Map<code, RoomRuntime>`, `RoomRuntime { engine, sockets: Map<socketId, playerId>,
receivers: Set<socketId>, timer, disconnectGraceTimers }`, `generateCode()` (4-digit,
collision-checked), `create()`, `close()`, `closeIfEmpty()` with `ROOM_EMPTY_GRACE_MS = 60_000`
and the both-empty requirement, `setPendingCastCode`/`getPendingCastCode` (120 s window).

**Create:** `server/src/cast/tokens.ts` — `mintCastToken(code)`, `verifyCastToken(token, code)`,
2 h TTL, in-memory Map, lazy sweep.

**Create:** `server/src/net/__tests__/rooms.test.ts` — code uniqueness across many creates;
`closeIfEmpty` false inside the grace window; true after (advance a fake clock / inject
`createdAt`); receivers alone keep a room alive; token verify rejects wrong code, unknown
token, and expired token.

### Step 7 — Net: `attachSocketServer`

**Create:** `server/src/net/server.ts`, modelled directly on
`pinpoint/packages/server/src/net/server.ts`. Same skeleton:
- `broadcast(runtime)`: `io.to(code).emit('room:state', toPublicRoom(...))`, then per-socket
  `you:state` for each player socket, and `toPrivateState(engine, null)` to each receiver
  socket, then `reconcileTimer(runtime)`.
- `reconcileTimer`: one timer per room; arm only for `WRITE_PLATES` with a deadline, firing
  `engine.writeTimerExpired()` then `broadcast`.
- `host:create` → `rooms.create()`, join the socket to the room, emit `host:created`, and if
  `canCast`, `setPendingCastCode` + push `cast:roomCode` (with a freshly minted token) to any
  standby receivers.
- `room:join` → engine join, cancel any pending disconnect-grace timer, register the socket.
- `receiver:subscribe` → **verify the cast token against the code first**; on failure
  `ack({ ok:false, error:'TOKEN_REJECTED' })`. On success add to `runtime.receivers`,
  `socket.join(code)`, `engine.setCastConnected(true)`, broadcast.
- `receiver:standby` → park in a module-level `standbyReceivers: Set<socketId>`; immediately
  serve `getPendingCastCode()` if one exists.
- Gameplay handlers `plate:set`, `plate:submit`, `guess:award`, `guess:advance`, `round:next`,
  `lobby:start`, `host:forceEnd`, `host:rematch` — each: resolve runtime + playerId, call the
  engine, ack with the engine result, broadcast on success.
- `disconnect` — copy pinpoint's two-branch handling verbatim: receiver branch (remove from
  `receivers`, `setCastConnected(false)` when it hits zero, `closeIfEmpty`) and player branch
  (`DISCONNECT_GRACE_MS = 60_000` timer before `engine.disconnect()` actually lands).
  Keep `attachSocketServer(io, rooms, { disconnectGraceMs })` overridable so tests don't burn
  60 real seconds — pinpoint does exactly this.

**Create:** `server/src/index.ts` — Express + Socket.io bootstrap, copying pinpoint's:
`loadRootEnv()`, `readAppVersion()`, `/api/config`, `/api/health`, the versioned
`/receiver.html` redirect, `express.static(clientDist)`, SPA fallback regex, and the Socket.io
options (`path: SOCKET_PATH`, `pingInterval: 25_000`, `pingTimeout: 60_000`). Add
`POST /api/cast/token` and `GET /api/cast/pending` per §4.5. Needs `express.json()`.

**Create:** `server/src/env.ts` — copy pinpoint's verbatim (the
`dirname(fileURLToPath(import.meta.url)) + '../../../.env'` resolution and `readAppVersion()`).
Do not substitute `process.cwd()`; the comment in pinpoint's file explains exactly why.

**Create:** `server/src/net/__tests__/integration.test.ts` — boot a real `http.Server` + `io`
on an ephemeral port, connect 3 `socket.io-client` sockets plus one receiver socket, and drive:
create → join ×3 → start → set/submit plates → assert each socket's `you:state` shows only its
own cards → award/advance through a round → assert the receiver's `room:state` never contains
a `reconnectToken`, a non-active player's plate, or a `ownerPlayerId` on an `IN_GRID` card.
Also assert `receiver:subscribe` with a bogus token is rejected.

**Verify:** `npm test -w @vntypl8s/server`.

### Step 8 — Client: store, shared UI, player app shell

**Create:** `client/src/common/store.ts` — port pinpoint's `GameStore`: singleton
`io({ path: SOCKET_PATH })`, observable `patch()`/`subscribe()`, `GameState
{ connected, pub, priv, code, castToken, error, serverOffset }`, `localStorage` keys
`vp:code` / `vp:token` / `vp:name`, and — **important, copy this** — the `connect` handler that
distinguishes a first connect from a reconnect and re-issues `room:join` (players) or
`receiver:subscribe` (receiver) so a backgrounded phone silently rejoins.
Methods: `hostCreate`, `join`, `castStatus`, `start`, `setPlate`, `submitPlate`, `award`,
`advance`, `nextRound`, `forceEnd`, `rematch`, `receiverStandby`, `receiverSubscribe(code, token)`.

**Create:** `client/src/common/useGame.ts` (3-line `useSyncExternalStore`, copy pinpoint's),
`client/src/common/useWakeLock.ts` (copy pinpoint's), `client/src/common/ui.tsx`
(`useNow`, `Timer`, `ScoreChip`, `PlateDisplay`, `PlayerChip`), and
`client/src/common/styles.css` (player-facing; free to use modern CSS — the phone is a modern
browser. The **receiver** gets its own restricted stylesheet, see step 10).

**Create:** `client/index.html` (copy pinpoint's, retitled), `client/src/player/main.tsx`
(copy pinpoint's 10-liner), `client/src/player/App.tsx` — landing → host / join flows,
`/api/config` fetch, `?code=` deep-link handling, `VersionTag`, and the `CastProvider` wrapper
(step 11). Model on `pinpoint/packages/client/src/player/App.tsx`.

### Step 9 — Client: player phase screens + tile-picker plate writer

**Create:** `client/src/player/PlateWriter.tsx`:
- Renders `PLATE_ALPHABET` from `@vntypl8s/shared` as a grid of 31 tap tiles (letters block,
  then digits block), plus Backspace and Clear.
- The current plate shows as 8 slot boxes, filled left to right.
- Tiles are `disabled` when `plate.length === PLATE_MAX_LENGTH`. There is **no** text input
  and no `contentEditable` anywhere on this screen — that is the entire enforcement mechanism
  for the mechanical rules (§2.6).
- Above the picker: the player's Owner card title (large), the Requirements card's 3 chars,
  and a live "requirements met" tick driven off `priv.requirementsMet`.
- Static rule copy: *"A–Z (no vowels — Y is fine) and 0–9. Max 8. Don't spell out words from
  your card — hint at it."* (§2.4: restate, don't enforce.)
- Each tap calls `store.setPlate(next)`; Submit calls `store.submitPlate()`.

**Create:** `client/src/player/screens.tsx` exporting one component per phase, mirroring
`pinpoint/packages/client/src/player/screens.tsx`:
- `Lobby` — player list, code, host's Start button (disabled outside 3–8), Cast button (only
  when the cast controller reports a state other than `'unavailable'`).
- `WritePlates` — `PlateWriter` before submit; a "waiting for N players" panel after.
- `Guessing` — two sub-views. **Active Player:** their plate large, then a list of every other
  connected player as tap targets plus a "Nobody got it" button → `guess:award`; after the
  resolution arrives, show what was revealed (Owner card, Requirements card, whether the bonus
  scored) and a "Next plate" button → `guess:advance`. **Everyone else:** the Active Player's
  plate (mirroring the TV, so people can play without looking up), their own name, and
  "Say your guess out loud" copy. No input.
- `RoundEnd` — round scores, host's "Next round" button.
- `GameOver` — final standings, winner(s) incl. shared-victory wording, host's "New game".
- `Paused` — waiting-for-player state.

**Create:** `client/src/test/{setup.ts,fixtures.ts}` (fixture builders for `PublicRoom` /
`PrivateState`, modelled on pinpoint's `test/fixtures.ts`) and
`client/src/player/__tests__/screens.test.tsx` — render each phase from a fixture; assert the
`PlateWriter` exposes no vowel tiles and no `<input>`; assert the Active Player's award list
excludes themselves; assert non-active players get no award buttons.

**Verify:** `npm test -w @vntypl8s/client`.

### Step 10 — CAF receiver

**Create:** `client/receiver.html`. This file is where CAF boots — **before** the React module
runs. Model on `pinpoint/packages/client/receiver.html`, which relies on a deliberate ordering
trick: the `<script type="module">` is deferred by spec, so a plain inline `<script>` placed
after it still executes *first*. That is what satisfies guide §3.1 ("initialize at module
scope, before any framework mounts"). Contents, in order:

1. `<script src="//www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js">`
   in `<head>`.
2. `<div id="root">`.
3. `<script type="module" src="/src/receiver/main.tsx">`.
4. Inline plain script — the CAF boot block:
   - Bail out cleanly (setting `window.__castInitError`) if `?dev` is present or
     `window.cast?.framework?.CastReceiverContext` is missing.
   - `const ctx = cast.framework.CastReceiverContext.getInstance();`
   - `const pm = ctx.getPlayerManager();` **before** `ctx.start()` (CAF requires this ordering;
     pinpoint's receiver.html comments on it). Attach a DOM `<audio>` element via
     `pm.setMediaElement(el)` even though we play no audio — it keeps CAF's media session
     happy and costs nothing (guide §3.6).
   - `ctx.addCustomMessageListener(NS, handler)` where `NS` is the literal
     `'urn:x-cast:com.mooseflip.vntypl8s.v1'` (must match `CAST_NAMESPACE` in
     `shared/src/protocol.ts` character for character — grep both before shipping, guide §2.5).
   - **Defensive validation in the handler** (guide §3.3): accept both object and string
     payloads (`typeof d === 'object' ? d : JSON.parse(d)`); require `type` in the known set;
     for `SYNC_ROOM` require `roomCode` to be a 4-char digit string, `token` a string of
     length ≥ 16, and `apiBaseUrl` to parse via `new URL()` with protocol in
     `{http:, https:}`. On any failure reply with a typed `ERROR` and **return** — no throw,
     no silent no-op.
   - **Never `JSON.stringify` the reply** (guide §3.4): `ctx.sendCustomMessage(NS, senderId,
     { type: 'SYNCED', roomCode })` with a plain object.
   - Handle `PING` (no-op ack, its only job is keeping CAF's session clock alive) and
     `TOGGLE_DEBUG` (flip `window.__vpDebug` and call `window.__vpOnDebugToggle?.()`).
   - `ctx.start({ disableIdleTimeout: true, maxInactivity: 3600 });` — **both** options, per
     guide §3.2. Note that pinpoint sets only `disableIdleTimeout`; that is the bug the guide
     warns about, so do not copy that line as-is.
   - Stash any code that arrives before React mounts in `window.__castPending = { roomCode,
     token }`, and expose `window.__castOnSync` for `main.tsx` to install.
5. Second inline script: the HTTP fallback poller — every 2 s `fetch('/api/cast/pending')`;
   if it returns a code and no sync has arrived yet, hand it to the same path. Copy pinpoint's
   `__castPollTimer` pattern **including** the part where the store clears the interval the
   moment a subscribe succeeds (pinpoint's `store.receiverSubscribe` does this; the comment
   there explains the reload race it prevents).

**Create:** `client/src/receiver/debug.ts` — the on-screen debug overlay (guide §3.8):
monkey-patch `console.log/warn/error`, `window.onerror`, `window.onunhandledrejection` into a
bounded ring buffer (200 entries), expose `subscribe()` for the overlay component. Import this
**first** in `main.tsx` so it captures boot-time errors.

**Create:** `client/src/receiver/main.tsx`:
```tsx
import './debug.js';               // must be first
import '../common/styles.css';
import './receiver.css';
store.receiverStandby();
(window as any).__castOnSync = (roomCode: string, token: string) =>
  void store.receiverSubscribe(roomCode, token);
const pending = (window as any).__castPending;
if (pending) (window as any).__castOnSync(pending.roomCode, pending.token);
createRoot(document.getElementById('root')!).render(<App />);
```
Plus the `?dev` path: if `?dev` is present, read `?code=` and `?token=` from the query string
(or fetch `/api/cast/pending`) and call `receiverSubscribe` directly, skipping `window.cast`
entirely — guide §6's stub-mode requirement, and acceptance criterion 4.

**Create:** `client/src/receiver/App.tsx` — the TV display, one view per phase:
- **No room yet** — brand mark + "Waiting for a room…" + `__castInitError` if set.
- **`LOBBY`** — join URL, the 4-digit code huge, a QR code (via `qrcode`'s `toDataURL`, using
  `publicBaseUrl` from `/api/config` — pinpoint's `LobbyTV` is the template), and the player
  list.
- **`WRITE_PLATES`** — countdown timer, a per-player progress row (name + submitted tick +
  `plateLength` dots). **Never** render `plateLength`'s content — the projection doesn't
  carry it, but assert this in review anyway.
- **`GUESSING`** — Active Player's name and their plate rendered as an oversized license
  plate; the grid of face-up Owner cards below (dimming/striking cards whose status is
  `SCORED`/`DISCARDED`); the running scoreboard. When `currentResolution` is present, overlay
  the reveal: which card it was, who got it, and whether the Requirements bonus scored.
- **`ROUND_END`** — round recap from `resolutions`, scoreboard, "Round N of 3".
- **`GAME_OVER`** — final standings, winner(s), shared-victory wording.
- **`PAUSED`** — waiting state.
- Always-on: a small version tag corner-bottom (pinpoint's `VersionTag`) and the debug overlay
  when `window.__vpDebug` is on.

**Create:** `client/src/receiver/receiver.css` — **hand-written, plain CSS only** (guide §3.7).
Rules: no `@layer`, no `oklch()`, no CSS logical properties (`padding-inline`, `inset`,
`margin-block`, …) — use `rgb()`/`hsl()` and physical longhands (`padding-left`/`padding-right`,
`top`/`right`/`bottom`/`left`). Size everything in `vw`/`vh` like pinpoint's `.tv` styles. Do
not pull in a CSS framework for the receiver bundle.

Also expose `window.render = (state: PublicRoom) => …` (or a `window.__vpSetState`) so a future
Playwright pass can drive the receiver's rendering directly per guide §6 — a five-line addition
now, invaluable later.

**Verify (acceptance criterion 4):** `npm run dev`, then open
`http://localhost:5173/receiver.html?dev&code=<code>&token=<token>` in a desktop browser while
a game is running in other tabs; confirm lobby/QR, write-phase countdown, reveal grid and
scoreboard all render and update live.

### Step 11 — Sender-side Cast integration

**Create:** `client/src/common/cast/types.ts`:
```ts
export type CastConnectionState =
  'unavailable' | 'disconnected' | 'connecting' | 'connected' | 'failed';
export interface CastSessionController {
  requestSession(): Promise<void> | void;
  endSession(): void;
  sendMessage(msg: SenderToReceiverMessage): void;
  onMessage(cb: (msg: ReceiverToSenderMessage) => void): () => void;
  onSessionChanged(cb: (s: CastConnectionState) => void): () => void;
}
```

**Create:** `client/src/common/cast/controller.ts` — guide §4.2 exactly:
- `NoopCastSessionController` — total no-op implementing the identical interface, reporting
  `'unavailable'`. **Not** memoized: return a fresh instance every call, so a later call can
  upgrade to the real controller once the SDK appears.
- `WebCastSessionController` — wraps the real SDK. Memoized as a module singleton.
- `getCastController(appId)` factory → no-op when `appId` is falsy, `typeof window ===
  'undefined'`, or `window.cast?.framework` / `window.chrome?.cast` are absent.
- SDK loading (guide §4.1): `window.__onGCastApiAvailable` bootstrap + an eager
  `window.cast?.framework` check on every call (the callback can fire before we subscribe);
  lazy script injection guarded against double-injection during HMR by checking for an
  existing `<script>` and chaining onto any previous handler.
- `setOptions({ receiverApplicationId: appId, autoJoinPolicy:
  chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED })`, plus a `getCurrentSession()` check on
  construction (auto-join can mean a session already exists — guide §4.3).
- `SESSION_STATE_CHANGED` mapped onto our narrow union per guide §4.4's table. Swallow
  `chrome.cast.ErrorCode.CANCEL` from `requestSession()` silently; log everything else.
- Message-listener attachment is **idempotent and detach-before-attach** (guide §4.4) —
  keep a ref to the session we're attached to and remove the old listener before adding a new
  one, or reconnects multiply message handling.
- `sendMessage` uses `session.sendMessage(CAST_NAMESPACE, msg)`. Note the asymmetry called out
  in guide §3.4: the *sender* SDK generally wants a string while the *receiver* SDK
  auto-serializes. Check what the loaded SDK accepts and, if it needs a string, stringify
  **only here, only in the sender direction** — never in the receiver's `sendCustomMessage`.

**Create:** `client/src/common/cast/useCastSync.ts` — guide §4.6, all five mechanisms together:
1. Idempotency key `${roomCode}:${token}`; `confirmedKeyRef` skips redundant sends.
2. Send on every relevant transition: session → `'connected'`, inbound
   `ERROR/TOKEN_REJECTED`, or the room code becoming available while already connected.
3. Unconditional retry `setInterval(trySync, 3000)` until confirmed — **not optional**,
   this is the belt to the ack's braces.
4. `inFlightRef` guard against overlapping syncs.
5. Only a `SYNCED` whose `roomCode` matches the current one sets `confirmedKeyRef`.
   Plus: a `PING` every 120 s once connected (guide §3.2's second inactivity trap — without it
   the Cast session dies at ~5 min because *all* real traffic is on the socket).
   Persist `{ roomCode, token }` to `sessionStorage` so a sender reload can resync without a
   fresh token round-trip (guide §4.7).
   The token comes from `POST /api/cast/token`; `apiBaseUrl` sent to the receiver is
   `config.publicBaseUrl` — and in dev it must be a LAN address, never `localhost`
   (guide §6). Note this in the README.

**Create:** `client/src/common/cast/CastProvider.tsx` — guide §4.5: `useCastSync` is called
**exactly once**, inside `CastProvider`, and everything else reads it via `useCast()`. Never
let the Cast button and the status chip each instantiate their own hook — that is the
documented three-token production bug.

Wire `CastProvider` around the player app in `player/App.tsx`, and have the Cast button render
only when `state !== 'unavailable'`. Report `store.castStatus(connected)` on state changes.

**Verify (acceptance criterion 5):** with `CAST_RECEIVER_APP_ID` unset, the app must run
completely normally, the Cast button must simply not appear, and no console errors about Cast
should occur. Grep for the namespace literal in exactly two places (`shared/src/protocol.ts`
and `client/receiver.html`) and confirm they match.

### Step 12 — Docker, compose, env, README

**Create:** `Dockerfile` — copy pinpoint's verbatim (two-stage: `node:22-slim` build stage
copying root + per-package `package.json`s, `npm ci`, `COPY . .`, `npm run build`; runtime
stage `node:22-slim`, `NODE_ENV=production`, `COPY --from=build /app ./`, `EXPOSE 3001`,
`CMD ["node", "packages/server/dist/index.js"]`). Stay on `node:22-slim` even though the host
runs Node 24 — Docker is what ships and this keeps parity with pinpoint.

**Create:** `docker-compose.yml` — copy pinpoint's, changing: `name: vntypl8s`,
`image: ericfaris/vntypl8s:latest`, port mapping `"127.0.0.1:8900:3001"` (8900 was the free
port identified in the brief — a suggestion, not a hard requirement), and
`PUBLIC_BASE_URL=${PUBLIC_BASE_URL:-https://vntypl8s.mooseflip.com}`. Keep `user: "1000:1000"`,
`security_opt: no-new-privileges:true`, `restart: unless-stopped`.

**Create:** `README.md` — run instructions, the dev-LAN note (`vite --host`, Chromecast can't
resolve `localhost`), the Cast app registration steps (guide §2: register Unpublished,
whitelist the device serial), and how to re-run the card generator.

**Verify (acceptance criteria 1 & 2):** `npm install && npm run build` at root;
`npm run dev` then create a room in one tab and join from another.

### Step 13 — One-time AI card generation (RUN LAST; may be blocked)

> **⚠️ `ANTHROPIC_API_KEY` is NOT set in this environment** (verified: `printenv
> ANTHROPIC_API_KEY` → unset, and there is no `.env` in this repo yet). This step is
> deliberately ordered last and is the **only** step with an external dependency. Steps 1–12
> must be complete, building, and passing tests *before* you touch this one, using the
> placeholder decks from step 2. If no key is available when you get here: **write the script,
> commit it, run the Requirements half (which needs no key), and then stop and report** that
> Owner-card generation is blocked pending a key. Do **not** hand-author 200 Owner titles to
> fake a completed generation run, and do not claim acceptance criterion 6 is met.

**Create:** `server/src/ai/generator.ts` — mirror
`pinpoint/packages/server/src/ai/generator.ts`: an `OwnerTitleGenerator` class wrapping
`new Anthropic({ apiKey })`, a `generateBatch(count, excludeNormalized)` method issuing a
`messages.create` with `max_tokens: 4096`, a prompt demanding
`{"titles": ["..."]}` and nothing else, `response.stop_reason === 'refusal'` handling, and the
same robust `extractTitles()` (JSON-first regex match, line-parsing fallback stripping list
markers). Batch ~40 per call across ~6 themed calls (trades & labour, outdoors & animals,
food & drink, arts & media, science & tech, service & civic) to get spread rather than 200
near-duplicates from one prompt.

**Create:** `server/src/ai/validation.ts` — mirror pinpoint's, adapted:
`validateOwnerTitle(title, seen)` requires 1–3 words, 3–28 chars, Title Case, letters/spaces/
hyphens only, no proper nouns/brand names, not on the blocklist (copy pinpoint's), not a
duplicate after `normalizeText()`. Also reject titles that are *too* abstract to allude to
(single-word adjectives, etc.) via a small heuristic.

**Create:** `server/src/scripts/generate-cards.ts` — the offline CLI. It must **not** be
imported by `index.ts` and must not be on any request path.
- `--owners=200 --requirements=36 --out=../shared/src/data --seed=N --dry-run`
- **Owners:** loop `generateBatch` until 200 validated unique titles or 12 batches; assign ids
  `own_001`…`own_200`; write `owners.json` sorted by id, 2-space-indented. Print a rejection
  summary by reason.
- **Requirements:** generate programmatically (§2.2) — enumerate candidates from
  `PLATE_ALPHABET` under a distribution: ~55% `LLD` (two letters + digit, matching the
  rulebook's `RF5`/`CF4`/`SY3` examples), ~25% `LLL`, ~15% `LDL`, ~5% `DLL`; no card with all
  three characters identical; no duplicates; seeded shuffle for reproducibility. Then, **only
  if `ANTHROPIC_API_KEY` is present**, one LLM pass rating each candidate 1–5 for
  plate-friendliness, keeping the top 36; otherwise take the first 36 from the seeded shuffle.
  Ids `req_01`…`req_36`.
- Validate the final files by re-importing them and asserting: exactly 200 / exactly 36; unique
  ids; every `chars` is 3 symbols all within `PLATE_ALPHABET`; every title passes
  `validateOwnerTitle`.
- Add root script `"gen:cards": "npm run gen:cards -w @vntypl8s/server"` and server script
  `"gen:cards": "tsx src/scripts/generate-cards.ts"`.

**Human curation:** after the run, read `owners.json` end to end and delete/replace anything
unguessable, offensive, or duplicative, then top back up to exactly 200. The brief calls this
out explicitly — the AI output is *candidates*, the shipped file is *curated*.

**Verify (acceptance criterion 6):** `node -e` (or a small vitest case in
`shared`/`server`) asserting `OWNER_CARDS.length === 200`, `REQUIREMENT_CARDS.length === 36`,
all ids unique, all `chars` legal. Add that assertion as a permanent test in
`server/src/engine/__tests__/rules.test.ts` so a future deck edit can't silently break it.

---

## 6. Testing & verification — acceptance criteria mapping

| # | Criterion | How to verify |
|---|---|---|
| 1 | `npm install && npm run build` succeeds | Run both at repo root. Build order must be shared → client → server (root `package.json`). A failure here usually means the shared JSON import form doesn't work in one of the two consumers — see step 2's note. |
| 2 | `npm run dev` starts both; room create + join works | `npm run dev`; open `http://localhost:5173`, click Host, note the code; open a second tab, join with that code; both should show each other in the lobby within a second. |
| 3 | Full 3-round game across ≥3 players, all rules correct | Automated: `npm test -w @vntypl8s/server` runs `__tests__/simulation.test.ts` (25 seeded games × player counts 3–8, full 3 rounds each, invariants after every mutation), `rules.test.ts` (the 7 targeted scoring/tiebreak cases), `plate.test.ts` (mechanical rule table). Manual: three browser profiles, play a round end-to-end and confirm the tile picker offers no vowels/lowercase/punctuation and caps at 8. |
| 4 | Receiver boots CAF at module scope; `?dev` renders real room state | Read `client/receiver.html` and confirm the CAF block is a plain inline `<script>` after the deferred module (and that `ctx.getPlayerManager()` precedes `ctx.start()`, and `ctx.start` passes **both** `disableIdleTimeout: true` and `maxInactivity`). Then `npm run dev` and load `/receiver.html?dev&code=<code>&token=<token>`: lobby+QR, write countdown, reveal grid, scoreboard must all render and update live as the phone tabs play. |
| 5 | Sender Cast behind a no-op/real factory, gated on `CAST_RECEIVER_APP_ID` | With the var unset: app runs, no Cast button, no console errors — the factory returns `NoopCastSessionController`. Grep the codebase for `window.cast` / `chrome.cast` and confirm every hit is inside `common/cast/controller.ts` (guide §4.2's "zero conditional Cast-support branching in UI code"). Grep the namespace literal and confirm sender and receiver agree exactly. |
| 6 | Generator produces ≥200/≥36 candidates; shipped JSON is exactly 200/36 | `npm run gen:cards` (needs a key for the Owner half — see step 13's blocker note), then the permanent deck-shape test in `rules.test.ts`. |
| 7 | `npm run typecheck` and `npm test` pass across all three packages | Run both at repo root. `typecheck` uses `--workspaces --if-present`; shared and server use `tsc --noEmit`, client uses `tsc --noEmit` too. |

Additional non-criterion checks worth running: `npm run build` then `docker compose build`
(catches anything that only breaks in the container's `npm ci` path), and a manual
`/api/health` hit.

---

## 7. Risks & watch-outs

**Ordering constraints**
1. **CAF boot order is the #1 gotcha (guide §3.1).** `CastReceiverContext.getInstance()`,
   `addCustomMessageListener`, and `ctx.start()` must all run *before* `createRoot().render()`.
   The mechanism is the deferred-module trick in `receiver.html` (a plain inline `<script>`
   placed after a `<script type="module">` still runs first). Do **not** "tidy" this by moving
   CAF init into `main.tsx` or a `useEffect` — a `SENDER_CONNECTED` or early `SYNC_ROOM` that
   arrives before the listener exists is silently dropped, and it fails only on real hardware.
   Within the CAF block, `ctx.getPlayerManager()` must precede `ctx.start()`.
2. Write `shared/` (step 2) fully before the engine or any UI — both compile against it.
3. Run the AI generation step (13) **last**; it's the only externally-blocked step.

**Chromecast gotchas most likely to bite**
4. **Idle timeout, two separate traps (guide §3.2).** Set `disableIdleTimeout: true` **and**
   `maxInactivity`. Separately, because *all* our real traffic is on Socket.io, the Cast
   session's own liveness clock sees zero traffic and kills the session at ~5 minutes even
   though the game is fine. The sender's 120 s `PING` in `useCastSync` is the only thing
   preventing that — it is not decorative, and a game round can easily exceed 5 minutes.
   Note pinpoint sets only `disableIdleTimeout`; do not copy that line as-is.
5. **Double serialization (guide §3.4).** Receiver → sender: pass a plain object to
   `ctx.sendCustomMessage`. Sender → receiver: the Web Sender SDK's contract differs. Handle
   both shapes on receipt (`typeof d === 'object' ? d : JSON.parse(d)`) in the receiver.
6. **Sync retry is mandatory (guide §4.6).** Ack-only is documented as insufficient on real
   hardware. Ship the idempotency key **and** the ack **and** the 3 s interval **and** the
   in-flight guard. All four.
7. **Receiver CSS targets Chrome 86 (guide §3.7).** `receiver.css` is hand-written plain CSS:
   no `@layer`, no `oklch()`, no logical properties. Desktop `?dev` mode will *not* catch these
   — they render fine in modern Chrome and silently no-op on the device.
8. **Namespace drift (guide §2.5).** One literal, defined in `shared/src/protocol.ts`, and one
   copy in `receiver.html` (which can't import from the bundle at that point). Grep both.
9. **Dev LAN addressing (guide §6).** The Chromecast cannot resolve `localhost`. `vite --host`
   plus a LAN `apiBaseUrl`/`PUBLIC_BASE_URL`.
10. **No real Chromecast hardware is confirmed available this session.** Everything Cast-related
    can be verified only in `?dev` stub mode and by code review against the §7 checklist. Say
    so plainly in the final report; do not claim on-device verification.

**Game/engine watch-outs**
11. **The "no Owner-title words" rule is deliberately unenforced** (§2.4). It is social trust,
    exactly as in the physical game. Do not build a semantic checker, do not add a warning.
    Restate the rule as static copy on the writing screen and move on. If a reviewer flags
    this as missing validation, point them at this section.
12. **Projection leaks are the real security surface**, not the Cast channel. The grid is
    face-up *by the rules* — but `ownerPlayerId` is the entire secret. Any accidental
    `{...gridCard}` spread in `project.ts` hands the TV the answer key. The harness invariants
    in step 5 exist specifically to catch this; keep them.
13. **Empty/auto-submitted plates.** A player who runs out the clock with nothing typed gets an
    empty plate. That's legal (the physical game has the same failure mode) — but make sure
    `award` still works for them (outcome will realistically be `MISSED`) and that
    `requirementsMet` is `false`. Cover it in `rules.test.ts`.
14. **Requirements are a subsequence, not a substring.** "In order" ≠ "contiguous". Getting
    this wrong makes the bonus nearly unwinnable and is easy to miss.
15. **Room GC (guide §5).** `closeIfEmpty` must require players **and** receivers empty **and**
    past the 60 s grace. A room legitimately has zero players for a moment right after
    `host:create` (host hasn't entered a name yet) and zero receivers during the cache-bust
    redirect. Without the grace window this destroys live rooms.
16. **Reconnect re-join.** Socket.io transparently reconnects the transport but the server has
    no idea the new socket belongs to the old room. Copy pinpoint's `store.ts` `connect`
    handler that re-issues `room:join`/`receiver:subscribe` on a *re*connect — without it a
    phone that locked its screen stays "disconnected" forever with nothing on screen telling
    the user why.

---

## 8. Out of scope (restated — do not build these)

- **Runtime / per-game AI generation.** Cards are a fixed, curated static deck. The generator
  is an offline CLI in `scripts/`, never imported by the server.
- **Automatic enforcement of "no Owner-card title words in the plate."** Honour system.
  Mechanical rules only (charset / length / vowels / case / whitespace), enforced by the tile
  picker *and* re-validated server-side.
- **Any in-app guess entry or automatic guess checking.** No free-text guessing, no grid
  tapping by guessers, no per-player guess tracking. Guessing is verbal; the app records only
  the Active Player's tap of the winner.
- **Deployment specifics** — no Cloudflare Tunnel route, no DNS, no subdomain wiring. Create
  `Dockerfile`/`docker-compose.yml`/`.env.example` in pinpoint's shape so the `deploy` skill
  can take over later; port 8900 is a suggestion, not a decision.
- **Accounts / persistent identity / cross-game history.** Rooms are ephemeral, in-memory,
  identified by a 4-digit code, exactly like pinpoint.
- **Native mobile apps.** Responsive web only.
- **On-device Chromecast verification.** Not available this session; `?dev` stub mode plus the
  guide's §7 checklist review is the bar. Real-hardware testing (register Unpublished +
  whitelist the device serial, guide §2.4/§6) happens later with the user.
