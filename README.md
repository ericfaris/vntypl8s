# VNTYPL8S

Online, server-authoritative multiplayer adaptation of the **VNTYPL8S** party
game. Players use their phones; a shared Chromecast TV shows the round state,
the writing countdown, the reveal grid and running scores.

Each player is secretly dealt an **Owner card** (a role/identity title, e.g.
"Park Ranger") and a **Requirements card** (3 characters). They compose an
8-character legal vanity plate that hints at their Owner card, then take turns
having it revealed on the TV while everyone else guesses **out loud**. The
Active Player taps whoever got it. Three rounds, then scoring.

Architecture mirrors [`pinpoint`](../pinpoint) one-for-one: npm workspaces,
Socket.io + Express + Vite + React, the same engine / projection / rooms
decomposition, and the same single-image Dockerfile.

---

## Quick start

```bash
npm install
npm run dev        # server on :3001, Vite on :5173 (bound to 0.0.0.0)
```

Open <http://localhost:5173>, click **Host a game**, note the 4-digit code,
then join from another tab or phone.

| Command | What it does |
|---|---|
| `npm install` | Install all three workspaces |
| `npm run build` | shared → client → server, in that order |
| `npm run dev` | `concurrently` runs the tsx server watcher + Vite |
| `npm run typecheck` | `tsc --noEmit` across all workspaces |
| `npm test` | vitest across all workspaces |
| `npm run gen:cards` | **Offline** one-time card generation (see below) |

`GET /api/health` returns `{ ok, version, rooms }`.

---

## Repo layout

```
packages/
  shared/   types, wire protocol, the public/private projection shapes,
            plate rules, and the curated static decks (src/data/*.json)
  server/   Express + Socket.io, the game engine, room registry, cast tokens,
            and the offline AI card generator (src/ai, src/scripts)
  client/   the phone UI (index.html) and the TV receiver (receiver.html),
            built from one Vite bundle
```

The **security boundary** is `packages/server/src/engine/project.ts`. Everything
the TV and other players see is constructed there field by field. It must never
leak `ownerPlayerId` on a face-up grid card, a `reconnectToken`, or any plate
except the Active Player's. `src/engine/__tests__/harness.ts` asserts all of
that after every single engine mutation — keep those invariants.

---

## Chromecast

Cast is used **only as a pairing channel**. The Cast custom-message channel
carries exactly `SYNC_ROOM` / `PING` / `TOGGLE_DEBUG` (sender→receiver) and
`SYNCED` / `ERROR` (receiver→sender). All real game state flows over the same
Socket.io room the phones use — the receiver joins it as a read-only client.

Cast is entirely optional: with `CAST_RECEIVER_APP_ID` unset the app runs
normally, the Cast button simply doesn't render, and nothing logs an error.

### Registering the receiver

1. <https://cast.google.com/publish> → Add new application → **Custom Receiver**.
2. Point it at your public HTTPS receiver URL, e.g.
   `https://vntypl8s.example.com/receiver.html`.
3. Register it as **Unpublished** and add your physical Chromecast's serial
   number under "Manage devices" — only whitelisted devices can discover an
   unpublished receiver. This is the standard dev loop; do it before any real
   device testing.
4. Put the resulting App ID in `.env` as `CAST_RECEIVER_APP_ID`.

The message namespace is `urn:x-cast:com.mooseflip.vntypl8s.v1`. It is defined
in `packages/shared/src/protocol.ts` and duplicated (by necessity — it is
needed before the bundle loads) in `packages/client/receiver.html`. **Grep both
before shipping**; namespace drift is a silent, hard-to-debug failure.

### Developing the receiver without a device

```
http://localhost:5173/receiver.html?dev&code=<code>&token=<token>
```

`?dev` skips `window.cast` entirely and subscribes directly. Get a token with:

```bash
curl -s -X POST localhost:3001/api/cast/token \
  -H 'Content-Type: application/json' -d '{"code":"1234"}'
```

Or omit `code`/`token` and the page falls back to `GET /api/cast/pending`,
which serves the most recent hosting code within a 120-second window.

For visual-regression work, the receiver exposes `window.__vpSetState(publicRoom)`
so a Playwright script can drive its rendering directly with no network.

### Dev on a real device: LAN addressing

**A Chromecast cannot resolve your machine's `localhost`.** The Vite dev server
already binds `0.0.0.0` (`server.host: true`). You must also set
`PUBLIC_BASE_URL` to a LAN address, because that value is what gets sent to the
receiver as `apiBaseUrl` and printed into the join QR code:

```
PUBLIC_BASE_URL=http://192.168.1.42:5173
```

### Receiver CSS constraint

`packages/client/src/receiver/receiver.css` is hand-written plain CSS and
targets a **Chrome 86-class** engine (what real Chromecast hardware runs). No
`@layer`, no `oklch()`, no logical properties (`padding-inline`, `inset`, …).
Desktop `?dev` mode will *not* catch a violation — it renders fine in modern
Chrome and silently no-ops on the device. Review this file by reading it.

---

## Cards

Both decks ship as curated static JSON in `packages/shared/src/data/` and are
imported at build time. There is **no runtime generation, ever** — the same
fixed deck every game, closer to the physical product.

Re-run the one-time generator with:

```bash
npm run gen:cards                        # 200 owners + 36 requirements
npm run gen:cards -- --dry-run           # print, don't write
npm run gen:cards -- --owners=200 --requirements=36 --seed=1234
```

- **Owner titles are LLM-generated** (Anthropic Messages API, batched across
  six themes, JSON-first extraction with a line-parsing fallback, then a
  deterministic validation pass). This needs `ANTHROPIC_API_KEY` in `.env`.
- **Requirements cards are generated programmatically** — three characters from
  the 31-symbol plate alphabet under an explicit distribution (~55% two-letters
  -then-digit like the rulebook's `RF5`/`CF4`/`SY3`, ~25% all-letters, ~15%
  letter-digit-letter, ~5% digit-then-letters), seeded and reproducible. No
  API key needed. If a key *is* present, an optional LLM pass rates each
  candidate for plate-friendliness and keeps the top 36.

The generator's output is **candidates**. Read `owners.json` end to end and
replace anything unguessable, offensive or duplicative, then top back up to
exactly 200. `packages/server/src/engine/__tests__/rules.test.ts` has a
permanent deck-shape guard so a later edit can't silently break the decks.

---

## Environment

Copy `.env.example` to `.env` at the repo root (it is gitignored, and
`packages/server/src/env.ts` resolves it relative to its own file location, not
`process.cwd()`).

| Var | Purpose |
|---|---|
| `PORT` | Server HTTP/WS port (default 3001) |
| `PUBLIC_BASE_URL` | Public origin for the join QR + the receiver's `apiBaseUrl` |
| `CAST_RECEIVER_APP_ID` | Google Cast App ID. Unset ⇒ Cast disabled, app fine |
| `ANTHROPIC_API_KEY` | **Offline card generation only.** Never used at runtime |
| `ANTHROPIC_MODEL` | Model for the generator |

## Docker

```bash
docker compose build
docker compose up -d
```

Single image: the build stage compiles shared → client → server, the runtime
stage runs `node packages/server/dist/index.js`, which serves the built client
and the Socket.io endpoint. Host binding stays on `127.0.0.1:8900` — put a
tunnel or reverse proxy in front of it.
