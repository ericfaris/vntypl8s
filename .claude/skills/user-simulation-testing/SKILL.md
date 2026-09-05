---
name: user-simulation-testing
description: Play a batch of simulated multi-player VNTYPL8S sessions end-to-end (varied lobby sizes, realistic messy human behavior) to hunt for real bugs, then file/fix/verify them via GitHub issues. Use when the user wants "user testing", "simulate games/sessions", "play through as real users", or asks to find edge-case bugs a normal player would hit.
triggers:
  - "simulate games"
  - "simulate users"
  - "user testing"
  - "play through as a user"
  - "play some games and find bugs"
  - "test with different numbers of players"
  - "edge case testing"
---

This skill drives a batch of full, realistic VNTYPL8S sessions against the
**real server/engine** (not just unit-level fuzzing, not a browser UI
simulation) to surface bugs that only show up when actual messy human
behavior meets the full stack — network drops mid-round, a receiver that
never pairs, sloppy plate input, mid-game joins, rematches with a stale
roster — then turns confirmed bugs into filed, fixed, and verified GitHub
issues.

There is no `user-simulation.test.ts` here yet — this skill's job is to
create it (modeled on `pinpoint`'s sibling suite) and then leave it behind as
a permanent regression suite. The closest existing references to build from:
`packages/server/src/net/__tests__/integration.test.ts` (the real-WebSocket
harness pattern: boot `RoomManager` + `attachSocketServer` on an ephemeral
`http.Server`, drive a `Client` wrapper over real `socket.io-client`
sockets) and `packages/server/src/engine/__tests__/harness.ts`
(`checkInvariants`, `makeEngine`, `SyntheticDeckSource` — reuse both rather
than re-deriving them).

## Parameters

- **Number of games** (`args`, default **6** if the user doesn't say): how
  many full simulated sessions the batch plays. Scale the *shapes* in step 2
  to fit this count — with more games, add more distinct behaviors-on-top
  rather than repeating the same scenario at a new player count; with fewer
  (e.g. 3), prioritize the highest-yield shapes: `MIN_PLAYERS` (3),
  `MAX_PLAYERS` (8), and a permanent Active-Player disconnect mid-`GUESSING`.
  If the user names specific player counts or scenarios instead of (or in
  addition to) a plain number, honor those directly rather than re-deriving
  them from the count.
- **Player-count range**: default to spanning `MIN_PLAYERS..MAX_PLAYERS`
  (3–8, from `@vntypl8s/shared`'s `types.ts`) unless the user asks for a
  narrower band.

## When to reach for this vs. other testing

- `engine/__tests__/simulation.test.ts` already fuzzes pure game-engine logic
  in isolation across many seeds (25 seeded 3-round games per player count
  3..8) — good for state-machine correctness, blind to integration bugs
  (wire protocol, socket lifecycle, timers, cast-token gating, host-authority
  edge cases).
- `webapp-testing` (Playwright) drives the actual browser UI, including the
  `PlateWriter` tile picker and the CAF receiver — use it when the suspected
  bug is in rendering/interaction, not server logic.
- **This skill** sits in between: real client↔server traffic over actual
  WebSockets (`socket.io-client`, exactly like `integration.test.ts`), plus
  real HTTP for the cast-token endpoints, asserting on protocol acks and
  server-side state, without a browser. It's the fastest way to exercise
  realistic multi-player, multi-device (phones + one TV receiver) scenarios
  with tight control over timing.

## Workflow

1. **Learn the stack before writing anything.**
   - Wire protocol: `packages/shared/src/protocol.ts` (`ClientToServer` /
     `ServerToClient` events, `Ack<T>`, the Cast custom-message types). Model
     shapes: `types.ts` (`GameRoom`, `RoundState`, phases), `projection.ts`
     (`PublicRoom` / `PrivateState` — the leak boundary), `plate.ts`
     (`validatePlate`, `satisfiesRequirements`).
   - Reuse `attachSocketServer(io, rooms, { disconnectGraceMs })` and
     `RoomManager` from `packages/server/src/net/{server,rooms}.ts` exactly
     as `integration.test.ts` does — same `Client` class (wraps a real
     `socket.io-client` socket, tracks `pub`/`priv`/a `pubHistory` array for
     leak-scanning), same short `disconnectGraceMs` override so tests don't
     burn real minutes.
   - Reuse `SyntheticDeckSource` (`engine/deck.ts`) so games never exhaust
     the deck regardless of player count or round count — never wire the
     real curated `owners.json`/`requirements.json` into this suite.
   - Reuse `checkInvariants` from `engine/__tests__/harness.ts` and call it
     after every mutating step, exactly like `simulation.test.ts` does. If a
     new invariant matters for a network-level scenario harness.ts doesn't
     already check (e.g. "a receiver socket's `you:state` is always
     all-null"), add it there rather than duplicating a private check in
     this suite — one shared invariant checker is the point.
   - Grep `packages/server/src/cast/tokens.ts` and the `receiver:*` /
     `cast:*` handlers in `net/server.ts` before scripting any receiver
     scenario — token minting/expiry and the standby-vs-subscribed
     distinction are easy to get wrong from memory.

2. **Design the game batch around VNTYPL8S-specific *shapes*, not just a
   count.** Pick player counts that hit real rule boundaries —
   `MIN_PLAYERS` (3), `MAX_PLAYERS` (8), one in the middle (5 or 6) — and
   layer one or two realistic human/network/device behaviors onto each
   game's normal play-through (lobby → 3 rounds → `GAME_OVER`):
   - **sloppy input at the tile picker's edges**: submit with an empty
     draft (only legal because the write timer forced it — see below,
     never via `plate:submit` on a genuinely empty string if the engine
     should reject that; check `validatePlate`'s actual behavior rather
     than assuming), a plate at exactly `PLATE_MAX_LENGTH` (8), a plate
     that does **not** satisfy its own Requirements card (legal — scoring
     just skips the bonus), whitespace/case-only duplicate display names
     at `room:join`.
   - **the write-timer expiring on stragglers**: don't submit every
     player; let `writeTimerExpired()` auto-submit the rest with whatever
     draft (including empty) they had, and confirm the round still
     assembles a correct-size grid (`activePlayers + FILLER_CARDS_PER_ROUND`)
     and that an auto-submitted empty plate simply can never be the
     Active Player's revealed plate in a way that breaks `GUESSING`.
   - **the Active Player disconnecting mid-`GUESSING`** — the single
     highest-yield scenario. Confirm the room actually pauses (not just
     "some" player pausing it), and that a token-rejoin resumes with
     `currentResolution` state intact rather than skipping or duplicating
     a turn.
   - **a non-Active-Player disconnecting** while someone else's turn is
     being guessed verbally — should pause the same way; confirm it does
     not accidentally advance the turn or clear `currentResolution`.
   - **a participant who disconnects and never comes back** — confirm the
     host has an actual recovery path (`host:forceEnd`, or the game
     eventually reaching `GAME_OVER`/closable rather than being stuck
     `PAUSED` forever with no host action available).
   - **mid-game joins**: a new `room:join` after `lobby:start` should land
     `pendingJoin: true` and only become active at the next round boundary
     — confirm they are excluded from the current round's grid/turnOrder
     and correctly promoted in `beginRound(n+1)`.
   - **host disconnect / host transfer**: the host leaves mid-round; the
     next connected player becomes host (`isHost`); confirm the *new*
     host — not the old one — is the only socket whose `host:*` calls
     succeed afterward (`lobby:start` before game start, `host:rematch`/
     `host:forceEnd` after).
   - **rematch with a stale roster**: play a full game to `GAME_OVER`,
     disconnect one player without a rejoin, then `host:rematch` — confirm
     piles clear, decks reshuffle, phase returns to `LOBBY`, and the
     disconnected player's stale socket/token doesn't resurrect broken
     state.
   - **Chromecast pairing edge cases layered onto an otherwise-normal
     game**: a receiver in `receiver:standby` before any host casts (should
     get pushed `cast:roomCode` the moment a `canCast` host creates a
     room); a receiver that subscribes with a token minted for a
     *different* room code (must be rejected, distinct from a bogus
     token); a receiver that disconnects and reconnects mid-game (should
     not pause gameplay — Cast is optional per §2.3 of the plan, never
     gates phase transitions); a game that runs start-to-finish with
     **no** receiver at all.
   - **rapid duplicate/out-of-order actions from the same client**: two
     `guess:award` calls back-to-back for the same turn (the second must
     be rejected — `currentResolution` is already non-null); a
     `plate:set` after `plate:submit` (must be rejected — already
     submitted); `guess:advance` called by someone other than the Active
     Player.
   - **the two extremes of the scoring RNG**: a full game where every
     guess lands (`GUESSED`) and one where every guess misses (`MISSED`
     / "Nobody got it" every time) — confirm both terminate cleanly at
     `GAME_OVER` after exactly 3 rounds with `winnerPlayerIds.length >= 1`.

3. **Drive it for real, assert on real state.** Boot the actual
   `http.Server` + Socket.io server in-process on an ephemeral port, connect
   real `socket.io-client` sockets (and real `POST /api/cast/token` HTTP
   calls for the receiver flows), and drive every action through the real
   protocol events — never call `GameEngine` methods directly except to run
   `checkInvariants` or to inspect state the protocol wouldn't otherwise
   expose. A bug that only reproduces through the real transport (ack
   timing, reconnect-token flow, the disconnect-grace timer, cast-token
   expiry) is exactly what this layer is for. On every `tv.pubHistory` you
   collect, run the same leak scan `integration.test.ts` already does
   (`reconnectToken`, `ownerPlayerId`, `ownerDeck`, `requirementsDeck`,
   `phaseBeforePause`, `ownerPile`/`requirementsPile`, any other player's
   plate text, any player's token) — a user-simulation scenario is a second,
   independent chance to catch a projection leak the happy-path integration
   test's exact scripting didn't happen to trigger.

4. **When a test fails, determine test-bug vs. product-bug before touching
   product code.** Read the failure against `engine.ts`/`server.ts`'s actual
   intended behavior. Common test-harness mistakes to rule out first:
   awaiting an ack on a fire-and-forget event like `host:castStatus` or
   `host:forceEnd` (hangs to timeout — check `protocol.ts` for which events
   take an `ack` callback), holding a stale `Client` reference after a
   reconnect instead of the new one returned by `room:join`, routing a
   "player forgot to come back" scenario through the host socket so the
   scenario accidentally kills the room's only host action, forgetting that
   `SyntheticDeckSource` cycles requirement strings differently than the
   curated deck (a scenario asserting on specific card content, rather than
   shape, will flake). Only once you've confirmed the server did something
   the plan (`.claude/plans/vntypl8s-plan.md`) or the rulebook doesn't
   intend is it a real bug.

5. **File one issue per confirmed bug** (use the `create-issue` skill or
   `gh issue create` directly) before fixing, with: what happens, the
   scenario that found it (name the test), player-facing impact in concrete
   terms (e.g. "the Active Player's phone shows no way to recover and the
   TV just freezes on the last reveal"), and root cause once known. This
   creates a paper trail independent of the fix commit and gives you an
   issue number to close.

6. **Fix minimally and re-verify.**
   - Fix the root cause in the smallest surface area — don't refactor
     adjacent code while you're in there.
   - If the bug has a player-facing surface (a missing recovery action on
     `Paused`, a confusing `GUESSING` state with no way out, a receiver
     stuck on stale data), also add or update the client (a store method in
     `common/store.ts` and a screen in `player/screens.tsx`, or the CAF
     handler in `receiver.html`/`receiver/App.tsx`) so a real player can
     actually reach the fix — a server-only fix for a host-facing recovery
     flow is incomplete.
   - Re-run the specific failing scenario, then the **entire** existing
     suite: `npm test -w @vntypl8s/server`, `npm test -w @vntypl8s/client`,
     and this new batch together — a fix for one scenario regressing
     another is exactly what `checkInvariants` is meant to catch. Also
     re-run `npm run typecheck` across the monorepo if the fix touched
     `packages/shared` — `server` and `client` both compile against its
     built `dist/`, so rebuild shared first (`npm run build -w
     @vntypl8s/shared`) before trusting a downstream typecheck.

7. **Land the batch as one changeset**: the new
   `packages/server/src/net/__tests__/user-simulation.test.ts` suite plus
   every fix it motivated, referencing the filed issues (`Fixes #N`) so they
   auto-close on merge. Branch off `main` first (this repo has no PR-gating
   convention established yet, but branching is still the safer default);
   open a PR with a summary of bugs found/fixed and the verification that
   was run.

8. **Leave the suite behind.** The batch of simulated games is a regression
   suite now, not a one-off script — it belongs in
   `packages/server/src/net/__tests__/` alongside `integration.test.ts` and
   `rooms.test.ts`, runs under the existing `npm test -w @vntypl8s/server`
   path, and should be mentioned in the README's test-command table if it
   isn't already covered by the existing `npm test` line.
