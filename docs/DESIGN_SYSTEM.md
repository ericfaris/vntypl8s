# VNTYPL8S Design System

The visual, audio, and interaction language for VNTYPL8S. This is the
reference for future design decisions — when adding a screen, a component, or
an asset, match what is here rather than inventing a parallel style.

The source of truth for values is the code:

| Concern            | File |
| ------------------ | ---- |
| Phone tokens + components | `packages/client/src/common/styles.css` |
| TV (receiver) styles       | `packages/client/src/receiver/receiver.css` |
| Stickers (inline SVG)      | `packages/client/src/common/stickers.tsx` |
| Sound manager              | `packages/client/src/common/sound.ts` |
| Brand / audio assets       | `packages/client/public/brand/`, `packages/client/public/audio/` |

Colours, spacing, and type live as CSS custom properties in two `:root`
blocks — `common/styles.css` (phone) and `receiver/receiver.css` (TV), which
carry the same values under `--tv-*` names. If you change a token, change it
in **both** blocks and update the tables below in the same commit.

---

## 1. Design principles

1. **Road-trip DMV, not neon arcade.** The reference is a physical boxed party
   game: reflective plate white, road-sign green, amber warning lights,
   asphalt. Embossed monospace lettering. Bumper stickers. Keep that world.
2. **Two surfaces, one identity, different rules.** The phone is a modern
   browser — modern CSS is fine. The TV receiver runs a Chrome 86-class engine
   on real Chromecast hardware; its stylesheet is deliberately restricted and
   **must not** be merged with the phone's (see `chromecast` guide §3.7).
3. **The phone acts, the TV narrates.** All input, all sound, and all private
   information live on the phone. The TV is a read-only public projection —
   large type, glanceable from a couch, never anything secret (no draft plate
   text, no hand contents).
4. **Delight lives in the margins.** Stickers, the paperclip on the Owner card,
   the chrome wordmark, the announcer. The functional core (tiles, timer,
   scoreboard) stays plain and legible.
5. **Sound is a reward, never a requirement.** Every effect follows a tap or a
   phase change moments after one. Muteable per-device. The game is fully
   playable silent.

---

## 2. Color

### Phone palette (`styles.css` `:root`)

| Token | Value | Role |
| ----- | ----- | ---- |
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

Ad-hoc shades that appear inline (keep using these exact values, don't add
near-duplicate tokens): `#131a26` / `#26303f` inputs & tiles, `#182031` /
`#141b27` recessed rows & notices, `#2a3548` button hover, `#3a2320` +
`#ffd9d4` the error banner fill/text.

### TV palette (`receiver.css` `:root`)

`receiver.css` declares its **own** `--tv-*` token block — the same values as
the phone tokens above, redeclared (never `@import`ed or shared: the two
stylesheets must not be merged, guide §3.7). Custom properties are Chrome 49+
so they are safe on real hardware. Keep the two `:root` blocks in sync when a
value changes.

| Token | Value | = phone token |
| ----- | ----- | ------------- |
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
- Green is strictly "commit / correct". Never use it decoratively.
- Borders carry the structure — `2px solid var(--line)` almost everywhere,
  `2px dashed` for the informational `.notice`, `3px` only on the plate.
- On the TV, prefer a heavier scrim over lighter text. Legibility from 3 m
  beats artwork.

---

## 3. Typography

Two families only:

- **UI:** `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
- **Plate / display:** `--font-plate` =
  `"DejaVu Sans Mono", "SF Mono", Menlo, Consolas, monospace` — used for
  anything that should read as *stamped metal*: the plate, room code, tile
  keys, requirement chars, the `.title`.

### Phone scale

| Class | Size | Weight | Tracking | Use |
| ----- | ---- | ------ | -------- | --- |
| `.title` | 2rem | 800 | 0.12em | screen title (mono) |
| `.code-big` | 3rem | 800 | 0.2em | room code (mono) |
| `.plate-lg / -md / -sm` | 2.6 / 1.7 / 1.1rem | 800 | — | plate characters |
| `.h2` | 1.05rem | 700 | — | section headings |
| body | 1rem | 400 | — | default |
| `.small` | 0.85rem | — | — | captions, hints |
| label caps | 0.72–0.75rem | — | 0.1–0.16em, uppercase | `.tilelabel`, `.ownercard .label` |

### TV scale

Sized in **viewport units** so it fills any panel: `.tv-brand` 2.2vw / 800 /
0.08em uppercase, `.tv-logo` 26vw (max 420px), `.tv-muted` 1.8vw. Keep new TV
type in `vw` and test at 1280×720 (the receiver reference resolution).

Rules: uppercase + positive tracking for anything "signage" (brand, labels).
Never uppercase body copy. Tabular numerals (`font-variant-numeric`) on
anything counting (timer, scores).

---

## 4. Space, radius, elevation

- **Spacing rhythm:** 6 / 10 / 14 / 18 / 20 px. `.stack` gap is `14px`,
  `.row` gap `10px`. Card padding `18px`, button padding `12px 16px`.
- **Radii:** `8px` tiles & plate, `10px` buttons / inputs / small rows,
  `12–14px` cards & the Owner card, `999px` pills (`.pchip`, mute button).
- **Container:** `.app` is `max-width: 560px`, centered, `padding: 20px 16px
  60px` (the 60px bottom clears the fixed version tag).
- **Elevation:** there are no drop shadows on panels — depth comes from
  border + fill contrast. Shadows are reserved for things that "sit on top":
  the logo (`drop-shadow(0 10px 24px …)`), stickers, the paperclip.

---

## 5. Components

| Component | Class(es) | Notes |
| --------- | --------- | ----- |
| Card | `.card` | the default surface; combine with `.stack` |
| Primary button | `button.primary` | amber, one per screen |
| Confirm button | `button.good` | green, "award this guess" etc. |
| Ghost button | `button.ghost` | transparent, back / dismiss |
| Text input | `input` | full-width, amber focus outline |
| Plate | `.plate` + `.plate-inner` + `.plate-char` | `.empty` renders an underscore slot; size via `.plate-sm/md/lg` |
| Tile picker | `.tiles` (7-col letters) / `.tiles.digits` (5-col) | mono keys; the picker *is* the input-validation mechanism — no `<input>` |
| Player chip | `.pchip` | `.active` = amber, `.offline` = 45% opacity |
| Owner card | `.ownercard` | amber-bordered gradient, uppercase label, `<Paperclip/>` pinned top-left |
| Requirement chars | `.reqcard` / `.reqchar` | mono, boxed |
| Score chip | `.scorechip` | inline, total + breakdown |
| Standings row | `.standings` / `.standing` | `.winner` = amber border |
| Timer | `.timer` | `.warn` amber ≤15s, `.over` red at 0 |
| Banner | `.banner` | red — reconnecting / errors only |
| Notice | `.notice` | dashed border, informational; `a.notice` is the block link variant (dev preview, etc.) |
| Mute button | `.mutebtn` | fixed top-right pill, 🔊 / 🔇 |
| Version tag | inline style in `App.tsx` | fixed bottom-right, 0.7rem, 60% opacity |

### TV components

`.tv` is the full-screen flex column (`3vh 4vw` padding, `2vh` gap). Helpers:
`.tv-center`, `.tv-stack`, `.tv-spread`, `.tv-grow`. Backgrounds: `.tv-lobby-bg`,
`.tv-round-bg` (play screens — heavy scrim), `.tv-gameover-bg`. The plate,
scoreboard, and card grid have dedicated `.tv-*` classes — keep TV markup on
those and never import a phone class into the receiver.

### Adding a component

1. Reuse a token; do not introduce a hex value that is within ~5% of an
   existing one.
2. `2px solid var(--line)` border, a `--panel`-family fill, a radius from §4.
3. If it counts or spells something mechanical, use `--font-plate`.
4. If it needs a TV counterpart, author a separate `.tv-*` rule in
   `receiver.css` — do not share the class.

---

## 6. Motion

Minimal and fast. The only transitions in the system:

- `button`: `transform .06s`, `background .15s`, `opacity .15s`.
- `button:active` nudges `translateY(1px)`.

No page transitions, no entrance animations, no spinners (loading states are
text: "Creating…", "Locking in…"). If you add motion, keep it ≤150ms and
tie it to a direct interaction. The receiver gets **no** animation — old
hardware, and nobody is looking at it closely.

---

## 7. Sound

Managed entirely by `common/sound.ts` (phone only — the TV is silent by
design). Per-device mute in `localStorage` (`vp:muted`), never game state.

**SFX** (`/audio/sfx/*.mp3`) — short, dry, ≤0.5s unless noted:
`tile-tap`, `plate-submit`, `reveal`, `correct`, `wrong`, `timer-tick`,
`countdown` (sharper, last 3s), `round-end`, `game-over`, `player-join`,
`back`, `sticker-peel`.

**Announcer VO** (`/audio/speech/*.mp3`) — ElevenLabs "Ed – Late Night
Announcer", over-the-top game-show host, generic (no player names) so no
runtime generation: `round1/2/3`, `welcome`, `reveal`, `winner`, `tie`,
`game-over`.

Rules:
- One announcer line per moment, and only on the *first* plate of a round —
  subsequent reveals get the SFX alone.
- Layer at most two sounds (e.g. `sticker-peel` then the outcome sting ~220ms
  later). Never stack an announcer line on top of a fanfare.
- New audio: text-to-sound / TTS via the ElevenLabs MCP, loudness-normalized
  (`loudnorm I=-16` speech, `I=-18` SFX), stereo MP3 `-q:a 4/5`, filenames
  lowercase-with-hyphens and **no spaces** (Chromecast demuxer, guide §3.6).

---

## 8. Imagery & brand

- **Wordmark:** `brand/logo.png` — chrome embossed "VNTYPL8S" plate badge.
  Used as the phone header (`.brand-logo`, 82% width) and the TV brand
  (`.tv-logo`). Source of `favicon.ico` and the PWA icons.
- **PWA icons:** `brand/icon-192.png`, `brand/icon-512.png` (also the maskable
  512), `brand/apple-touch-icon.png` — the plate badge centered on the dark
  ground, wired via `manifest.webmanifest`.
- **TV backgrounds:** 1280×720 JPG, dark, muted teal/navy, generous empty sky
  for text, no lettering. `bg-lobby`, `bg-round` (darker — dense screens),
  `bg-gameover`. Always paired with an `rgba(16,20,28,·)` gradient scrim.
- **Stickers:** hand-authored inline SVG in `stickers.tsx` (alien/UFO, Route 66
  shield, paw print, paperclip). Die-cut vinyl look, ~46px, rotated ±8–18°,
  `drop-shadow`, `pointer-events: none`, positioned into a `.stickerfield`
  parent (`.tl/.tr/.br`). Prefer adding SVG stickers over raster art — crisp,
  cheap, themeable.
- **Generated art:** one-time, shipped as static files, documented in the
  README "Assets" section. Same pattern as the curated card decks. Ideogram
  for backgrounds/icons, ElevenLabs for audio.

---

## 9. Accessibility & robustness

- Contrast: `--text` on `--panel` and `--accent` on `#201803` (primary button
  ink) both clear AA. Keep new text combinations ≥ 4.5:1.
- Focus: inputs show `outline: 2px solid var(--accent)`. Don't remove focus
  rings from interactive elements.
- Tiles carry `aria-label` ("Add A"); the mute button and stickers are marked
  `aria-hidden` / decorative appropriately. Match that.
- Every sound call is wrapped so a blocked or missing clip never breaks play.
- The phone keeps a wake-lock during a game (`useWakeLock`). The TV sets
  `disableIdleTimeout`.
- Nothing secret on the TV. The `WriteTV` screen shows plate *length* as dots,
  never characters — preserve that class of restraint in any new TV screen.

---

## 10. Quick checklist for a new screen

- [ ] Phone: sits in `.app` → `.stack` of `.card`s; one `button.primary` max.
- [ ] Uses existing tokens; no near-duplicate colors; borders `2px var(--line)`.
- [ ] Mechanical text (codes, plates, counts) in `--font-plate`.
- [ ] Any sound follows a tap or an immediately-preceding phase change; added
      to `sound.ts`; layered ≤2 deep.
- [ ] If it appears on the TV: separate `.tv-*` rules in `receiver.css`, tested
      at 1280×720, Chrome-86-safe CSS, no animation, nothing private.
- [ ] New static asset documented in the README "Assets" section.
