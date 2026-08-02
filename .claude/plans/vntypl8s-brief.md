# Concept Brief: VNTYPL8S — Online Multiplayer + Chromecast

## Problem

The user owns the physical party game **VNTYPL8S** (rulebook: `25C034-VNTYPL8S-Rulebook-190x190-20250205.pdf`, copied into the repo root). They want a fully digital, online multiplayer version, cast to a shared TV via Chromecast — following the same architecture pattern as their existing project `pinpoint` (a sibling repo at `/home/eric/projects/pinpoint`), which they explicitly said to model this on ("just like we do pinpoint").

## Game rules (from the rulebook — ground truth, see full text below)

- 3–8 players. Physical components: 36 Requirements cards, 184 Owner cards, dry-erase plate boards/markers (digital version replaces the physical boards/markers with in-app UI).
- **Setup**: each player is dealt one Owner card (secret, face-down) and one Requirements card (secret, face-down — 3 characters).
- **Writing Phase** (simultaneous, all players at once): each player composes a "vanity plate" string that hints at their Owner card, while trying to include all 3 characters from their Requirements card, in order, for it to be worth points. Plate Creation Rules (must enforce):
  - Only A–Z (uppercase) and 0–9.
  - Max 8 characters.
  - No vowels (A, E, I, O, U) — numbers may substitute for vowel sounds; "Y" is allowed.
  - No spaces, no punctuation, no emoji/drawings.
  - No words from the Owner card's title may appear represented in the plate (e.g. Owner "Fire Fighter" → "FGHTSF1R" illegal, "N0FL4M3S" OK). This is a judgment call, not purely mechanical — enforce the mechanical rules (chars/length/vowels) automatically; the "no title words represented" rule is likely left to honor system / self-policing rather than automatic validation, since it requires semantic judgment. Flag this as an open design question for the planner (see below).
  - When a player finishes, their Owner card goes face-down to a shared center pool; their Requirements card stays with them, face-down.
  - After all players finish, 6 extra Owner cards are added to the center pool, then all pooled Owner cards are shuffled and dealt face-up into a grid visible to everyone — this is the shared "guessing grid," and it is exactly the kind of shared, low-interactivity, read-mostly display Chromecast should drive per the house Chromecast guide.
- **Guessing Phase** (turn-based, clockwise, starting with the first player to finish writing... rulebook says "starting with the first Active Player" — order = order in which players finished the Writing Phase): for each Active Player in turn:
  1. Active Player's plate is revealed to everyone (on the shared/TV display).
  2. Players verbally call out guesses (NOT typed into the app — see decision below). Each player gets exactly one guess per plate; if wrong, they must wait for the next plate to guess again.
  3. **Decision (confirmed with user): the Active Player taps the name of whichever player verbally guessed correctly, on their own phone**, to award the point — mirrors the physical game's self-adjudication. There is no in-app free-text or grid-tap guessing UI for non-active players; guessing itself stays verbal/social, off-app.
  4. If someone guessed correctly, that player takes the matching Owner card into their personal scoring pile (removing it from the shared grid).
  5. If no one guesses correctly, the Active Player reveals which Owner card was correct and it's discarded from the grid (not scored by anyone).
  6. The Active Player then reveals their Requirements card. If (a) their plate contained all 3 required characters in order AND (b) someone guessed their Owner correctly, the Active Player also scores the Requirements card into their pile. If they didn't use the requirements correctly, they get no points even if guessed correctly (the guesser still scores as normal).
  7. Move to the next Active Player (in finish order), repeat.
  - After all players have gone through the Guessing Phase, discard all cards not in a scoring pile, and proceed to the next round.
- 3 rounds total. Winner = most cards in scoring pile at the end; tiebreak = most Requirements cards in pile; still tied = shared victory.

## Goal

A web app, played primarily on players' phones (as the "sender"/controller UI) with a shared Chromecast-cast TV display (the "receiver") showing the round state, the writing-phase countdown, the reveal-and-guess grid, and running scores — same split as `pinpoint`: phones are the interactive controller, TV is the shared read-only display.

## In scope

- npm workspaces monorepo mirroring `pinpoint`'s shape: `packages/shared`, `packages/server`, `packages/client` (client contains both the player-facing app and the `receiver/` CAF app, built from the same Vite bundle per `pinpoint`'s existing pattern).
- Real-time multiplayer game engine (Socket.io, server-authoritative) covering: room creation/join by code, dealing Owner + Requirements cards, simultaneous Writing Phase with the Plate Creation Rules enforced live via the on-screen letter/number tile picker (confirmed: tile picker, not free-text keyboard — this structurally prevents illegal characters/vowels/punctuation by only offering legal tiles), shared Owner-card grid assembly (own 6 extra + pool + shuffle), turn-based Guessing Phase with the Active-Player-taps-the-winner scoring flow described above, Requirements-card bonus scoring, 3-round structure, and end-game scoring/tiebreak per the rules above.
- Chromecast support following `/home/eric/.claude/commands/chromecast.md` (the "chromecast" skill/guide) as house style: Custom Receiver (CAF) hosted as a page in the client bundle; Cast channel carries only a bootstrap/sync handshake (room code + short-lived cast token) plus a periodic PING and optional TOGGLE_DEBUG; all real game state (room state, current phase, revealed plate, grid, scores) flows over the normal backend transport, with the receiver as a read-only client — likely via Socket.io directly (joining the room as a receiver-role socket), OR the SSE/poll `/api/cast/*` pattern described in the guide's §5 as an alternative. **Open question for the planner**: pinpoint already has a working CAF receiver in `packages/client/src/receiver/` — the planner should read that implementation first and decide whether this new receiver reuses Socket.io-room-as-receiver (simpler, since we already have real-time rooms) vs. the guide's SSE/poll public-state-endpoint pattern; the guide explicitly endorses "Cast as pairing only, then receiver joins the normal backend room as an ordinary read-only client" as the right approach when a room-based real-time backend already exists (§5), which this project will have — that's the recommended default here, but the planner should confirm by reading pinpoint's receiver code for the concrete precedent.
- Full Chromecast pre-ship checklist from the guide (§7) should be treated as required, not optional, for whatever receiver approach is chosen: CAF boot-order (init before mount), `disableIdleTimeout` + `maxInactivity`, defensive validation of inbound messages, no double-JSON-serialization, on-screen debug overlay, dev-mode `?dev` stub path, LAN-based dev workflow notes.
- **AI-generated content, one-time seed generation (confirmed decision)**: generate 200 Owner cards and 36 Requirements cards once via a script (following the pattern in `pinpoint/packages/server/src/ai/generator.ts` — Anthropic Messages API, structured JSON output, validation pass), review the output, and bundle the curated result as static JSON shipped with the app (e.g. `packages/shared/src/data/owners.json`, `packages/shared/src/data/requirements.json`). This is NOT runtime/per-game generation — same fixed deck every game, closer to the physical product. The generation script itself should live in the repo (e.g. `packages/server/src/scripts/generate-cards.ts` or similar — planner's call) so it can be re-run later, but it is a one-time/offline tool, not part of the running server's request path.
  - Requirements cards are exactly 3 characters each, drawn from the legal plate alphabet (A–Z minus vowels, plus Y, plus 0–9) — the physical game's example Requirements cards shown are things like "RF5", "CF4", "SY3" (see extracted rulebook text). AI generation for these 36 is really "generate 36 valid, reasonably-distributed 3-character combos from the legal alphabet" — likely mostly programmatic/random rather than needing an LLM for creativity, but the user asked for AI generation of both decks, so the planner should decide the right split (e.g. LLM for Owner card *titles*, which need to be interesting/guessable proper concepts a plate-writer can allude to; straightforward randomized/validated generation, possibly LLM-assisted for variety, for the 3-char Requirements strings) and note the reasoning in the plan.
  - Owner cards are short role/identity titles a plate-writer can allude to without repeating the words verbatim (rulebook examples: "Elementary Teacher", "Truck Driver", "Farmer", "Park Ranger", "Film Critic", "Chemist", "Cowboy", "Car Guy", "Photographer", "Nanny", "Chef"). Generate 200 (physical game has 184 — user asked for 200, confirmed).
- Basic room lifecycle: create room, join via code/QR (QR shown on the TV/receiver, per pinpoint's `PUBLIC_BASE_URL` pattern), lobby, start game, play 3 rounds, game-end screen, ability to start a new game.

## Out of scope (v1)

- Runtime/live AI generation of cards during a game (explicitly rejected in favor of one-time seed generation).
- Enforcing the "no words from the Owner card title represented in the plate" rule automatically/semantically — this needs human judgment per the rulebook's own example, so v1 should NOT try to build an automatic semantic checker for it. Mechanical rules (char set, length, vowels, spaces/punctuation) ARE enforced automatically via the tile picker's legal-character set. The planner should decide whether to soft-warn or simply leave it to social trust (like the physical game).
- Any in-app free-text guessing UI or automatic guess-checking for the Guessing Phase — guessing is verbal/social; the app only records the Active Player's tap of who won the point.
- Deployment specifics (subdomain, exact port, Cloudflare Tunnel route) — deferred to the `deploy` skill in Phase 6 of this lifecycle. A free host port was checked (8100, 8200, 8300, 8400, 8420, 8500, 8600/8601, 8700, 8800, 3000, 8000 are already in use across other projects on this machine; 8900 appears free) — note this as a suggestion for whoever wires up `docker-compose.yml`, not a hard requirement.
- Account systems / persistent user identity across games — rooms are ephemeral like pinpoint's, identified by join code, in-memory state.
- Mobile native apps — this is a responsive web app (phones use the browser), matching pinpoint.

## Constraints

- Must follow `/home/eric/.claude/commands/chromecast.md` as house style for all Chromecast work — quote from it above; the planner and executor should both read this file directly before designing/building the Cast pieces.
- Must mirror `pinpoint`'s architecture and conventions closely (it's the explicit reference implementation the user pointed at): npm workspaces (`packages/shared`, `packages/server`, `packages/client`), TypeScript throughout, Socket.io for real-time transport, Express server, Vite client build, Anthropic SDK (`@anthropic-ai/sdk`) for the one-time AI generation script, vitest for tests, Docker single-image build (see `pinpoint/Dockerfile` and `docker-compose.yml` for the exact pattern to replicate — build stage compiles shared→client→server, runtime stage runs `node packages/server/dist/index.js`), env vars loaded via a root `.env` (see `pinpoint/packages/server/src/env.ts`'s path-resolution approach), `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`/`CAST_RECEIVER_APP_ID`/`PUBLIC_BASE_URL` as the env var shape to reuse.
- Repo is currently empty except the rulebook PDF; this is a from-scratch build, not an existing-codebase feature addition.
- Node v24.14.0 / npm 11.9.0 are the available toolchain on this machine (pinpoint's own Dockerfile uses `node:22-slim` for the build — planner can choose to match pinpoint's Docker node version even though the host has v24, since Docker is what actually ships).
- No real Chromecast device access has been confirmed available for this session; real-hardware testing (guide §6's "register as Unpublished + whitelist device serial") may need to happen later with the user directly, or be deferred/flagged rather than claimed as verified.

## Acceptance criteria

1. `npm install && npm run build` succeeds at the repo root (mirroring pinpoint's root scripts: build shared → client → server).
2. `npm run dev` starts server + client concurrently; a browser can create a room, get a join code, and a second browser tab/device can join it.
3. A full 3-round game can be played start-to-finish across ≥3 simulated/browser player sessions: dealing, tile-picker plate writing respecting all mechanical Plate Creation Rules (rejects vowels/spaces/punctuation/lowercase/>8 chars at the UI level), shared grid assembly (pool + 6 extra + shuffle), turn-based reveal/guess/score flow including the Active-Player-taps-winner mechanic, Requirements-card bonus scoring logic (all 3 chars in order AND correct guess required), and correct final scoring + tiebreak logic.
4. A Chromecast receiver page exists, boots CAF context at module scope before mount, and in `?dev` stub mode (no real device) renders the shared game display (lobby/QR, writing-phase countdown, reveal grid, scores) by fetching/subscribing to real room state — verified in a desktop browser per the guide's dev-workflow section, since real-hardware testing may not be available this session.
5. Sender-side Cast integration (`requestSession`/session-state machine/sync-retry-with-idempotency-key per guide §4) is implemented behind the same no-op/real controller factory pattern as the guide recommends, gated on a `CAST_RECEIVER_APP_ID` env var, so the app functions normally with Cast simply unavailable when unset.
6. The one-time card-generation script runs, produces ≥200 valid Owner card candidates and ≥36 valid Requirements card candidates (3-char, legal-alphabet), and the curated/bundled static JSON actually shipped with the app has exactly 200 Owner cards and 36 Requirements cards.
7. `npm run typecheck` and `npm test` (vitest, per pinpoint's workspace scripts) pass across all three packages.

## Open questions & decisions made

- **Confirmed**: user will skip the Phase 3 plan-review gate — go straight from Opus plan to execution, but I (this session) will still sanity-check the plan before dispatching the build.
- **Confirmed**: cards generated once, offline, as a curated static seed — not at runtime.
- **Confirmed**: plate input is an on-screen legal-character tile picker, not free-text.
- **Confirmed**: guessing is verbal/social exactly like the physical game; only "who won the point" is recorded in-app, and only by the Active Player tapping the winner on their own phone.
- **Open, left to planner**: exact Cast transport approach for the receiver (Socket-room-as-receiver vs SSE/poll public-state endpoint) — recommended default is Socket-room-as-receiver per the guide's §5 guidance, given a real-time room backend already exists, but planner should confirm against pinpoint's actual receiver implementation.
- **Open, left to planner**: how literally to split "AI generation" between the two decks (LLM-driven creative Owner titles vs. more mechanical/validated generation for 3-char Requirements strings) — reasoning should be documented in the plan.
- **Open, left to planner**: whether/how to softly nudge players about the "no Owner-title words in the plate" rule in the UI (out-of-scope to auto-enforce, but a warning could be reasonable) — planner's call, default to doing nothing beyond restating the rule in-UI if uncertain.
- **Open, left to planner**: exact room/lobby UX details (host controls, minimum/maximum 3–8 player enforcement, disconnect/reconnect handling) — should mirror pinpoint's existing room-lifecycle patterns in `packages/server/src/net/rooms.ts`.

## Relevant files/areas

- `/home/eric/projects/vanity-plates/25C034-VNTYPL8S-Rulebook-190x190-20250205.pdf` — full rulebook (extracted text captured in this brief's "Game rules" section above; the planner/executor do not need OCR/PDF tools again — the brief above is a complete and faithful transcription of every mechanical rule).
- `/home/eric/projects/pinpoint/` — the explicit reference implementation to mirror. Key files:
  - `pinpoint/package.json`, `pinpoint/packages/{shared,server,client}/package.json` — workspace/script conventions.
  - `pinpoint/packages/server/src/ai/generator.ts`, `validation.ts`, `buffer.ts` — AI content generation pattern (Anthropic SDK, structured JSON, validation).
  - `pinpoint/packages/server/src/engine/` (`cards.ts`, `engine.ts`, `rng.ts`, `project.ts`) — game engine structure to mirror for VNTYPL8S's own engine (dealing, phases, scoring).
  - `pinpoint/packages/server/src/net/` (`server.ts`, `rooms.ts`) — Socket.io room/server pattern.
  - `pinpoint/packages/client/src/receiver/` (`App.tsx`, `main.tsx`) — CAF receiver reference implementation; `pinpoint/packages/client/receiver.html` — receiver HTML entry.
  - `pinpoint/packages/client/src/player/` — phone-facing sender UI pattern.
  - `pinpoint/packages/shared/src/` (`types.ts`, `protocol.ts`, `projection.ts`) — shared types/socket protocol/public-state-projection pattern (the `toPublicState()`-style allowlist the Chromecast guide requires).
  - `pinpoint/packages/server/src/env.ts` — env/config loading pattern.
  - `pinpoint/Dockerfile`, `pinpoint/docker-compose.yml`, `pinpoint/.env.example` — deploy/build pattern (deploy itself deferred to Phase 6, but the planner should set up equivalent files now so deploy "just works" later, matching pinpoint's shape).
- `/home/eric/.claude/commands/chromecast.md` — the full Chromecast implementation guide (house style), quoted in relevant part above; planner and executor should both read the full file directly rather than relying solely on this brief's excerpt.

## Repo commands & tree state

- This is a brand-new repo: `git init` already run, working tree currently has one untracked file (the rulebook PDF), no commits yet. The planner/executor should build the full npm-workspaces structure from scratch (no existing `package.json` at the repo root yet).
- No install/build/test commands exist yet since nothing has been scaffolded. The executor should establish them mirroring pinpoint's root `package.json` scripts exactly:
  - `npm install` (root, workspaces)
  - `npm run build` (root) → builds shared, then client, then server in that order
  - `npm run dev` (root) → `concurrently` runs `dev:server` (`tsx watch src/index.ts`) and `dev:client` (Vite dev server)
  - `npm run typecheck` (root, `--workspaces --if-present`)
  - `npm test` (root, `--workspaces --if-present`, vitest per package)
- Toolchain available on this host: Node v24.14.0, npm 11.9.0. No `pytest`/Python build tooling relevant to this project.
- No `ANTHROPIC_API_KEY` has been confirmed present in this environment yet for this new project — the one-time card-generation script will need a valid key to actually run; if none is available when the executor gets to that step, it should stop and report rather than fabricating card content without the API.
