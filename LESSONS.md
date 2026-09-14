# Lessons

## 2026-09-14 — design-system showcase page vs. receiver.css's global resets

Building a live design-system showcase that renders real component CSS
(not a mockup) for both the phone and TV surfaces: `receiver.css`
intentionally sets `html,body,#root { height:100%; overflow:hidden }` and a
full-bleed `100vw/100vh` `.tv` layout (Chromecast hardware needs a fixed
frame, no page scroll). Loading it directly on the same page as the phone
showcase breaks that page's normal scrolling. Fix: gave the TV components
their own standalone Vite entry (`tv-showcase.html`) that imports only
`receiver.css`, and embedded it via `<iframe>` in the main showcase. Don't
try to defeat `receiver.css`'s resets with page-level overrides on a shared
document — a separate document is the actual isolation boundary, and it's
also what lets Vite hash/build the CSS reference correctly (a `srcdoc`
iframe with a hardcoded `<link>` path breaks under the production build's
content-hashed filenames).

Also noticed in passing (not fixed — out of scope for a docs-only pass):
`packages/client/src/receiver/main.tsx` imports `../common/styles.css` in
addition to `./receiver.css`, which appears to contradict the documented
"the two stylesheets must never be merged" rule (Chromecast guide §3.7,
also stated in `docs/DESIGN_SYSTEM.md`/`DESIGN.md`). Worth checking whether
that phone import is load-bearing (some shared reset it relies on) or a
leftover that should be removed, next time someone touches the receiver
bundle.
