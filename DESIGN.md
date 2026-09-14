# VNTYPL8S — Design System

The complete visual, type, motion, sound, and component reference for
VNTYPL8S. This is a **living document plus a live showcase**: the showcase
page renders every token and component below straight from the project's
real CSS, so if the two ever disagree, the CSS is right and this file is
stale — fix the file.

- **Live showcase:** `packages/client/design-system.html` — open it via
  `npm run dev` at `http://localhost:5173/design-system.html` (or
  `/design-system.html` on a built/deployed instance). It embeds
  `tv-showcase.html` for the TV/receiver components in an iframe.
- **Source of truth for values:** the code, not this file —
  `packages/client/src/common/styles.css` (phone) and
  `packages/client/src/receiver/receiver.css` (TV).
- **Prior reference:** `docs/DESIGN_SYSTEM.md` — the original design doc this
  file supersedes and expands on; kept for history.

| Concern | File |
| --- | --- |
| Phone tokens + components | `packages/client/src/common/styles.css` |
| TV (receiver) styles | `packages/client/src/receiver/receiver.css` |
| Stickers (inline SVG) | `packages/client/src/common/stickers.tsx` |
| Sound manager | `packages/client/src/common/sound.ts` |
| Brand / audio assets | `packages/client/public/brand/`, `packages/client/public/audio/` |
| Live showcase (phone) | `packages/client/design-system.html` + `src/design-system/main.ts` |
| Live showcase (TV) | `packages/client/tv-showcase.html` + `src/design-system/tv-main.ts` |

---

## 1. Direction narrative

**Chosen direction: "Road-trip DMV."** VNTYPL8S is a party game about
composing an 8-character vanity plate that hints at a secret identity card,
then having everyone guess it out loud off a shared TV while phones do the
writing. The reference is the physical boxed game it's adapted from: a DMV
plate-application form, a bumper covered in stickers, a highway shoulder at
dusk. That's the world the UI lives in — reflective plate white, road-sign
amber and green, asphalt navy, embossed monospace lettering, paperclips and
die-cut vinyl stickers as the only ornament.

This direction predates this pass (see `docs/DESIGN_SYSTEM.md`, written
2026-09-12) and was already fully built out: tokens, both stylesheets, brand
art, PWA icons, and a full sound design. This pass's job was to confirm the
direction was still the right call rather than drift into something more
generic, formalize it into one comprehensive reference plus a live showcase,
and fill gaps (asset inventory, contrast notes, an explicit mood-board
comparison) that the original doc didn't cover.

### Mood-board comparison

Per the design process, three 16:9 mood boards were generated with Ideogram
before confirming the direction, each exploring a different genre-appropriate
take on "party game about writing something on a novelty object":

1. **"Road-trip DMV"** (chosen) — asphalt texture, embossed stamped-metal
   wordmark, amber CTA, a bumper-sticker reading "LICENSED TO DRIVE," a
   paperclip, small highway-sign icons. This is, almost element for element,
   what's already shipped: the same palette, the same paperclip flourish on
   the Owner card, the same "chunky amber primary button." It's also the
   direction whose CTA and texture read correctly on a TV at couch distance —
   flat fills, high contrast, no fine detail to lose at 3 meters.
2. **"Neon Drive-In Arcade"** — hot pink/cyan neon, chrome-and-glow wordmark,
   a synthwave grid horizon. Visually loud and distinctive, but wrong genre:
   it reads as a twitch-reflex arcade game, not a card-and-conversation party
   game played around a room. The glow and gradients would also fight the
   "legibility from 3 m beats artwork" rule the TV surface depends on.
3. **"Diner Placemat Kitsch"** — checkerboard diner floor, chrome-bezel
   wordmark, Route 66 badge, a burger-joint sticker. Charming and on-theme
   (America road-trip kitsch), but the busy checkerboard background is
   exactly the kind of texture that has to be suppressed everywhere text sits
   on it — it would fight the TV's "heavy scrim over lighter text" rule
   constantly, and it pulls away from the DMV-bureaucratic irony that's the
   game's actual joke (a *government form* asks you to be a Park Ranger).

Road-trip DMV wins on genre fit, on TV legibility, and because the entire
shipped app was already built to it — reversing course now would mean
discarding working, tested, well-executed brand art and sound design for no
gain. See the "Where the mood boards live" row in the asset inventory (§9)
for the images themselves.

### Key moments the system is designed around

1. **The Owner-card reveal** — a player's secret identity, on an amber-bordered
   card with a paperclip flourish, `sticker-peel` SFX.
2. **Writing under the clock** — the tile picker + timer, escalating from a
   soft tick to a sharper countdown blip in the last 3 seconds.
3. **The TV reveal** — a plate appears large on the shared screen, the
   announcer VO fires (first plate of a round only), everyone guesses aloud.
4. **A correct guess awarded** — the `.good` green button, `correct` SFX/VO,
   the scoreboard updating live on the TV.
5. **Game over / standings** — the winner's row picks up the amber
   `.winner` border, a `winner`/`tie` VO line plays, the phone shows a
   full-bleed `bg-gameover.jpg` card.

---

## 2. Color

### Phone palette (`common/styles.css` `:root`)

| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `#10141c` | app background (base of the radial gradient) |
| `--bg-2` | `#1a2130` | gradient highlight, top-center glow |
| `--panel` | `#1e2635` | cards, chips, buttons |
| `--text` | `#eef2f8` | primary text |
| `--muted` | `#93a0b5` | secondary text, labels, disabled hints |
| `--line` | `#3a465c` | all borders (2px is the default weight) |
| `--accent` | `#ffc233` | **the** brand color — primary buttons, Owner card, active state, winner, links |
| `--accent-2` | `#2f8f5b` | "good" / confirm buttons (road-sign green) |
| `--good` | `#3fbf72` | success text ("requirements met") |
| `--bad` | `#e0554b` | error banner border, expired timer |
| `--warn` | `#ffb020` | timer in the warning window |
| `--plate-bg` | `#f4f3ee` | licence-plate face |
| `--plate-ink` | `#16202e` | embossed plate lettering |
| `--plate-edge` | `#0d1420` | plate border |

Ad-hoc shades that appear inline (keep using these exact values — don't add
near-duplicate tokens): `#131a26` / `#26303f` inputs & tiles, `#182031` /
`#141b27` recessed rows & notices, `#2a3548` button hover, `#3a2320` +
`#ffd9d4` the error banner fill/text, `#2b3450`/`#223047` the Owner-card
gradient, `#d99b00`/`#1f6b41` primary/good button border shades, `#201803`/
`#f2fff7` primary/good button ink.

### TV palette (`receiver/receiver.css` `:root`)

`receiver.css` declares its **own** `--tv-*` token block — the same values as
the phone tokens above, redeclared (never `@import`ed or shared: the two
stylesheets must never be merged — see the `chromecast` house-style guide
§3.7, and §5 below). Custom properties are Chrome 49+, so they're safe on
real Chromecast hardware.

| Token | Value | = phone token |
| --- | --- | --- |
| `--tv-bg` / `--tv-bg-2` | `#10141c` / `#1a2130` | `--bg` / `--bg-2` |
| `--tv-panel` | `#1e2635` | `--panel` — every raised box (chip, card, score, reveal) |
| `--tv-text` | `#eef2f8` | `--text` |
| `--tv-hi` | `#ffffff` | — brighter headline numbers only (room code, live timer) |
| `--tv-muted` | `#93a0b5` | `--muted` |
| `--tv-line` | `#3a465c` | `--line` |
| `--tv-accent` | `#ffc233` | `--accent` — `.tv-brand`, active borders, `.tv-dot.on` |
| `--tv-good` / `--tv-warn` / `--tv-bad` | `#3fbf72` / `#ffb020` / `#e0554b` | `--good` / `--warn` / `--bad` |
| `--tv-plate-bg` / `--tv-plate-ink` / `--tv-plate-edge` / `--tv-plate-dim` | `#f4f3ee` / `#16202e` / `#0d1420` / `#b9b6ab` | plate family |
| `--tv-font-mono` | `"DejaVu Sans Mono", Menlo, Consolas, monospace` | shorter stack than `--font-plate` (no `"SF Mono"` — not on the device) |

Scrims stay literal: `rgba(16, 20, 28, ·)` gradient overlays on every
background image, `0.4`–`0.9` alpha depending on how much text sits on top.
The `.tv-qr` background is a literal `#ffffff` (it's paper, not UI).

### Usage rules

- **Amber (`--accent`) is a spotlight, not a fill.** One primary action per
  screen. The Owner card, the active-player chip, and the winner row are the
  only large amber surfaces.
- Green is strictly "commit / correct." Never use it decoratively.
- Borders carry the structure — `2px solid var(--line)` almost everywhere,
  `2px dashed` for the informational `.notice`, `3px` only on the plate.
- On the TV, prefer a heavier scrim over lighter text. Legibility from 3 m
  beats artwork.

### Contrast

- `--text` (`#eef2f8`) on `--panel` (`#1e2635`) → ~12.6:1. Comfortably clears
  AA (4.5:1) and AAA (7:1).
- `--accent` (`#ffc233`) on the primary button's ink (`#201803`) → ~10.9:1.
  Clears AAA.
- `--good`/`--warn`/`--bad` text on `--bg` (`#10141c`) all clear AA for
  normal-size text (each ≥ 6:1).
- `--muted` (`#93a0b5`) on `--panel` → ~4.6:1 — clears AA for normal text by a
  narrow margin; don't drop it further or pair it with small (`.small`) text
  on a lighter surface without checking again.

---

## 3. Typography

Two families only:

- **UI:** `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` — loaded
  from the OS, no web-font request, no `font-display` concern.
- **Plate / display:** `--font-plate` =
  `"DejaVu Sans Mono", "SF Mono", Menlo, Consolas, monospace` — used for
  anything that should read as *stamped metal*: the plate, room code, tile
  keys, requirement chars, `.title`, `.code-big`.

### Phone type scale

| Class | Size | Weight | Tracking | Family | Use |
| --- | --- | --- | --- | --- | --- |
| `.title` | 2rem | 800 | 0.12em | plate mono | screen title |
| `.code-big` | 3rem | 800 | 0.2em | plate mono | room code |
| `.plate-lg .plate-char` | 2.6rem | 800 | — | plate mono | plate characters, large (TV-adjacent phone views) |
| `.plate-md .plate-char` | 1.7rem | 800 | — | plate mono | plate characters, default |
| `.plate-sm .plate-char` | 1.1rem | 800 | — | plate mono | plate characters, compact (lists, recap) |
| `.h2` | 1.05rem | 700 | — | UI sans | section headings |
| body (unclassed) | 1rem | 400 | — | UI sans | default copy |
| `.small` | 0.85rem | inherit | — | UI sans | captions, hints |
| `.tilelabel` / `.ownercard .label` | 0.72–0.75rem | inherit | 0.1–0.16em, uppercase | UI sans | label caps |

### TV type scale

Sized in **viewport units** so it fills any panel — test at 1280×720, the
receiver's reference resolution:

| Class | Size | Weight | Notes |
| --- | --- | --- | --- |
| `.tv-brand` | 2.2vw | 800 | 0.08em tracking, uppercase |
| `.tv-logo` | 26vw (max 420px) | — | image, not text |
| `.tv-code` | 9vw | 800 | 0.12em tracking, tabular numerals |
| `.tv-timer` | 5vw | 800 | tabular numerals |
| `.tv-reveal-card` | 3.4vw | 800 | — |
| `.tv-score-total` | 3vw | 800 | tabular numerals |
| `.tv-reveal-title` | 2.6vw | 800 | amber |
| `.tv-writename` | 2.2vw | 700 | — |
| `.tv-join` | 2vw | 400 | — |
| `.tv-prompt` | 2vw | 400 | muted |
| `.tv-muted` | 1.8vw | 400 | muted |
| `.tv-recaprow` | 1.8vw | 400 | — |
| `.tv-writestatus` | 1.6vw | 400 | muted, right-aligned |
| `.tv-pchip` | 1.7vw | 400 | — |
| `.tv-card` | 1.5vw | 700 | — |
| `.tv-score-name` | 1.5vw | 400 | muted |
| `.tv-error` | 1.4vw | 400 | `--tv-bad` |
| `.tv-score-sub` | 1.1vw | 400 | muted |
| `.tv-version` | 1vw | 400 | 50% opacity |

Rules: uppercase + positive tracking for anything "signage" (brand, labels).
Never uppercase body copy. Tabular numerals (`font-variant-numeric`) on
anything counting (timer, scores, room code).

---

## 4. Space, radius, elevation, motion

No formal `--space-*`/`--radius-*` token scale exists in the codebase — the
rhythm lives directly on components. This is documented here as the scale to
match, not retrofitted as CSS variables (that would be a bigger refactor than
this pass's scope).

### Spacing

| Value | Where |
| --- | --- |
| 6px | tile grid gap |
| 10px | `.row` gap, button padding (vertical) |
| 14px | `.stack` gap |
| 16px | button padding (horizontal), `.app` side padding |
| 18px | `.card` padding |
| 20px | `.app` top padding |
| 60px | `.app` bottom padding (clears the fixed version tag) |

### Radius

| Value | Where |
| --- | --- |
| 6px | `.reqchar` |
| 8px | `.tile`, `.plate` |
| 10px | buttons, `input`, `.banner`, `.notice`, `.standing` |
| 12px | `.ownercard` |
| 14px | `.card` |
| 999px | pills — `.pchip`, `.mutebtn` |

### Elevation

No drop shadows on panels — depth comes from `2px solid var(--line)` border +
fill contrast against the background gradient. Shadows are reserved for
things that visually "sit on top" of the layout rather than sit in it:

- `.brand-logo` — `filter: drop-shadow(0 10px 24px rgba(0,0,0,0.45))`
- `.sticker` — `filter: drop-shadow(0 3px 6px rgba(0,0,0,0.5))`

### Motion

Minimal and fast — the entire motion system:

| Target | Transition | Purpose |
| --- | --- | --- |
| `button` | `transform 0.06s ease, background 0.15s ease, opacity 0.15s` | hover/press feedback |
| `button:active` | `transform: translateY(1px)` | tactile press nudge |

No page transitions, no entrance animations, no spinners — loading states
are text ("Creating…", "Locking in…"). Any new motion should stay ≤150ms and
tie to a direct interaction. **The TV receiver gets zero animation** — old
hardware, and nobody examines it up close; motion there is limited to state
changes driven by real data (a dot lighting up, a timer counting down), never
decorative.

---

## 5. Components

The phone is a modern browser — modern CSS is fine there. The TV receiver
runs a Chrome 86-class engine on real Chromecast hardware, so `receiver.css`
is hand-written plain CSS with a hard ban on `@layer`, `oklch()`/`lab()`,
logical properties, `aspect-ratio`, `:is()`/`:where()`, container queries,
and nesting (see the file's own header comment and the `chromecast` guide
§3.7). **The two stylesheets are never merged and never share a class name**
— every TV surface gets its own `.tv-*` rule even when it looks identical to
a phone component.

### Phone components

| Component | Class(es) | States / variants | Notes |
| --- | --- | --- | --- |
| Card | `.card` | — | the default surface; combine with `.stack` |
| Primary button | `button.primary` | `:hover`, `:active`, `:disabled` | amber, one per screen |
| Confirm button | `button.good` | `:hover`, `:active`, `:disabled` | green, "award this guess" etc. |
| Ghost button | `button.ghost` | `:hover`, `:active`, `:disabled` | transparent, back / dismiss |
| Default button | `button` (unclassed) | `:hover`, `:active`, `:disabled` | panel-colored fallback |
| Text input | `input` | default, `:focus` | full-width, amber focus outline |
| Plate | `.plate` + `.plate-inner` + `.plate-char` | `.empty` slot, `.plate-sm/md/lg` sizes | `.empty` renders an underscore slot |
| Tile picker | `.tiles` (7-col letters) / `.tiles.digits` (5-col) | `:disabled` (25% opacity) | mono keys; the picker *is* the input-validation mechanism — no `<input>` |
| Player chip | `.pchip` | `.active` (amber), `.offline` (45% opacity) | shows 👑 host / ⏳ pending inline |
| Owner card | `.ownercard` | — | amber-bordered gradient, uppercase label, `<Paperclip/>` pinned top-left |
| Requirement chars | `.reqcard` / `.reqchar` | `.met` (green), `.notmet` (muted) | mono, boxed |
| Score chip | `.scorechip` | — | inline, total + owner/requirement breakdown |
| Standings row | `.standings` / `.standing` | `.winner` (amber border) | |
| Timer | `.timer` | default, `.warn` (≤15s, amber), `.over` (0s, red) | tabular numerals |
| Banner | `.banner` | — | red — reconnecting / errors only |
| Notice | `.notice` | `a.notice` block-link variant | dashed border, informational |
| Mute button | `.mutebtn` | 🔊 / 🔇 | fixed top-right pill, per-device (localStorage), never game state |
| Version tag | inline style in `App.tsx` | — | fixed bottom-right, 0.7rem, 60% opacity |
| Stickers | inline SVG, `.sticker` class | `.tl` / `.tr` / `.br` positions | decorative, `aria-hidden`, `pointer-events: none` |

### TV components

`.tv` is the full-screen flex column (`3vh 4vw` padding, `2vh` gap). Layout
helpers: `.tv-center`, `.tv-stack`, `.tv-spread`, `.tv-grow`. Backgrounds:
`.tv-lobby-bg`, `.tv-round-bg` (play screens — heavy scrim), `.tv-gameover-bg`.

| Component | Class(es) | Notes |
| --- | --- | --- |
| Brand | `.tv-brand`, `.tv-logo` | amber uppercase label / wordmark image |
| Room code | `.tv-code` | huge, white, tabular numerals |
| Player chips | `.tv-pchip` | in a `.tv-players` wrap |
| Scoreboard | `.tv-scores` / `.tv-score` (`.active`) / `.tv-score-name` / `.tv-score-total` / `.tv-score-sub` | |
| Writing grid | `.tv-writegrid` / `.tv-writerow` (`.done`) / `.tv-writename` / `.tv-writestatus` / `.tv-dots` / `.tv-dot` (`.on`) | dots show plate *length* only, never characters |
| Timer | `.tv-timer` (`.warn`) | |
| Plate | `.tv-plate` / `.tv-plate-inner` / `.tv-plate-char` (`.dim`) | |
| Reveal | `.tv-reveal` / `.tv-reveal-title` / `.tv-reveal-card` / `.tv-reveal-sub` | amber border |
| Card grid | `.tv-grid` / `.tv-card` (`.scored`, `.discarded`) | |
| Recap | `.tv-recap` / `.tv-recaprow` / `.tv-recapname` / `.tv-recapcard` / `.tv-recapwho` | |
| QR | `.tv-qr` | literal white paper background |
| Chrome | `.tv-version`, `.tv-debug` / `.tv-debug-line` (`.warn`, `.error`) | dev-only debug overlay |

### Adding a component

1. Reuse a token; do not introduce a hex value within ~5% of an existing one.
2. `2px solid var(--line)` border, a `--panel`-family fill, a radius from §4.
3. If it counts or spells something mechanical, use `--font-plate`.
4. If it needs a TV counterpart, author a **separate** `.tv-*` rule in
   `receiver.css` — never share the class, never import phone CSS into the
   receiver bundle.

---

## 6. Backgrounds & generated art

| Asset | Prompt direction (for a consistent follow-up generation) | Where used |
| --- | --- | --- |
| `brand/logo.png` | Chrome-embossed "VNTYPL8S" wordmark on a license-plate badge, road-sign palette, DMV/highway signage feel | phone header (`.brand-logo`), TV brand (`.tv-logo`), showcase hero |
| `brand/bg-lobby.jpg` | 1280×720, dark muted teal/navy highway-at-dusk scene, generous empty sky for text, no lettering | `.tv-lobby-bg` |
| `brand/bg-round.jpg` | 1280×720, same palette, darker/denser — text-heavy screens sit on top | `.tv-round-bg` |
| `brand/bg-gameover.jpg` | 1280×720, same palette, celebratory but still dark | `.tv-gameover-bg`, phone `.gameover-card` |

All three backgrounds are always paired with an `rgba(16,20,28,·)` gradient
scrim (`0.4`–`0.9` alpha) — never shown at full brightness under text.

Stickers (`stickers.tsx`) are hand-authored inline SVG, not generated
images — an alien/UFO, a Route 66 shield, a paw print, plus the paperclip
flourish. Deliberately not raster art: crisp at any size, themeable via
fill/stroke, and free to ship (no image weight). Prefer this approach for
any new decorative flourish over adding another generated PNG.

---

## 7. Sound

Managed entirely by `common/sound.ts` (phone only — the TV is silent by
design; see `receiver.html`'s CAF boot-block comment "we play no audio").
Per-device mute lives in `localStorage` (`vp:muted`), never in game state.

### SFX (`/audio/sfx/*.mp3`) — short, dry, ≤0.5s unless noted

| File | Fires on |
| --- | --- |
| `tile-tap.mp3` | tapping a letter/digit tile |
| `plate-submit.mp3` | locking in a finished plate |
| `reveal.mp3` | a plate is revealed for guessing |
| `correct.mp3` | a guess is awarded |
| `wrong.mp3` | time runs out unguessed |
| `timer-tick.mp3` | countdown, 5s–4s remaining (softer) |
| `countdown.mp3` | countdown, sharper, last 3s |
| `round-end.mp3` | round recap begins |
| `game-over.mp3` | final standings appear |
| `player-join.mp3` | a player joins the lobby |
| `back.mp3` | dismiss / go back |
| `sticker-peel.mp3` | Owner-card reveal flourish |

### Announcer VO (`/audio/speech/*.mp3`) — ElevenLabs "Ed – Late Night Announcer"

Over-the-top game-show host, generic lines only (no player names), so no
runtime generation is needed:

| File | Fires on |
| --- | --- |
| `welcome.mp3` | first time landing in a lobby |
| `round1.mp3` / `round2.mp3` / `round3.mp3` | that round begins |
| `reveal.mp3` | first plate reveal of a round (subsequent reveals get SFX only) |
| `correct.mp3` | first correct guess of a round |
| `winner.mp3` | game over, clear winner |
| `tie.mp3` | game over, tied score |
| `game-over.mp3` | final-standings VO bed |

### Rules

- One announcer line per moment, and only on the *first* plate of a round —
  subsequent reveals get the SFX alone.
- Layer at most two sounds (e.g. `sticker-peel` then the outcome sting ~220ms
  later). Never stack an announcer line on top of a fanfare.
- New audio: text-to-sound / TTS via the ElevenLabs MCP, loudness-normalized
  (`loudnorm I=-16` speech, `I=-18` SFX), stereo MP3 `-q:a 4/5`, filenames
  lowercase-with-hyphens and **no spaces** (Chromecast demuxer, `chromecast`
  guide §3.6).
- Every `sound.ts` call wraps `play()` in a try/catch and swallows a rejected
  promise — a blocked or missing clip never breaks gameplay.

All sounds are auditioned inline on the showcase page (§8 there).

---

## 8. Accessibility & robustness

- **Contrast:** see §2 above — the text/panel and accent/button-ink pairs
  both clear AA (several clear AAA). Keep new text combinations ≥ 4.5:1.
- **Focus:** `input:focus` shows `outline: 2px solid var(--accent)`. Never
  remove focus rings from interactive elements.
- **Labels:** tiles carry `aria-label` ("Add A"); the mute button and
  stickers/paperclip are marked `aria-hidden`/decorative appropriately —
  match that pattern for new decorative elements.
- **Sound failure is silent, not broken:** every `sound.ts` call is wrapped
  so a blocked or missing clip never interrupts play; the mute control makes
  the game fully playable silent.
- **Wake lock:** the phone keeps a wake-lock during a game (`useWakeLock`);
  the TV sets `disableIdleTimeout`.
- **Nothing secret on the TV:** the writing-phase TV grid shows plate
  *length* as dots, never characters (`.tv-dots`/`.tv-dot`); the security
  boundary lives in `packages/server/src/engine/project.ts`. Preserve that
  class of restraint in any new TV screen.
- **Reduced motion:** the system's own motion budget is already minimal
  (§4) — a `prefers-reduced-motion` media query hasn't been needed since the
  only transitions are the 60–150ms button feedback states, which are not
  disorienting. If a future addition introduces anything longer or
  auto-playing, gate it behind `prefers-reduced-motion: no-preference`.

---

## 9. Asset inventory

| File | Role |
| --- | --- |
| `packages/client/public/favicon.ico` | browser tab icon |
| `packages/client/public/brand/logo.png` | wordmark, phone header + TV brand |
| `packages/client/public/brand/icon-192.png` | PWA icon (192×192) |
| `packages/client/public/brand/icon-512.png` | PWA icon (512×512, also maskable) |
| `packages/client/public/brand/apple-touch-icon.png` | iOS home-screen icon |
| `packages/client/public/brand/bg-lobby.jpg` | TV lobby/join background |
| `packages/client/public/brand/bg-round.jpg` | TV play-screen background |
| `packages/client/public/brand/bg-gameover.jpg` | TV + phone game-over background |
| `packages/client/public/manifest.webmanifest` | PWA manifest, wired to the icons above |
| `packages/client/public/audio/sfx/*.mp3` (12 files) | see §7 |
| `packages/client/public/audio/speech/*.mp3` (9 files) | see §7 |
| `packages/client/src/common/stickers.tsx` | inline-SVG sticker components (not files — code) |
| `packages/client/design-system.html` (new, this pass) | live phone showcase |
| `packages/client/tv-showcase.html` (new, this pass) | live TV showcase, embedded in the above |
| `packages/client/src/design-system/main.ts` (new, this pass) | showcase wiring — reads live tokens/computed styles, no hand-duplicated values |
| `packages/client/src/design-system/tv-main.ts` (new, this pass) | same, for the TV showcase |

Icon/favicon/PWA manifest already existed before this pass and needed no
changes — see §10.

---

## 10. Changelog

- **2026-09-14** — `ui-design` skill pass (this document). Confirmed the
  existing "Road-trip DMV" direction against two alternative mood boards
  (Neon Drive-In Arcade, Diner Placemat Kitsch — see §1); direction
  unchanged, no token/CSS values changed. Added: this file (consolidating
  and expanding `docs/DESIGN_SYSTEM.md` into the fuller `ui-design` format —
  contrast ratios, asset inventory, mood-board rationale, a changelog); the
  live showcase pages `design-system.html` + `tv-showcase.html` and their
  `src/design-system/` entry scripts; two new Vite build entries in
  `vite.config.ts`. No existing component, token, or asset was modified,
  moved, or deleted — favicon/PWA icons were already in place and did not
  need generating.
- **2026-09-12** — original `docs/DESIGN_SYSTEM.md` written alongside the
  Chromecast sync/sound-system pass (commit `02e2b35`) — see that file's own
  history for everything before this entry.
