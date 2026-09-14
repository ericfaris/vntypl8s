// Entry for design-system.html — the phone-side showcase. Importing the
// project's real stylesheet (not a copy) so every class rendered on this
// page picks up the actual, current CSS. See ../common/styles.css and
// DESIGN.md at the repo root for the system this page documents.
import '../common/styles.css';

const root = document.documentElement;
const cssVar = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();

// ---- Color: read every phone token live from :root and render a swatch ----
const PHONE_TOKENS = [
  ['--bg', 'app background (gradient base)'],
  ['--bg-2', 'gradient highlight, top-center glow'],
  ['--panel', 'cards, chips, buttons'],
  ['--text', 'primary text'],
  ['--muted', 'secondary text, labels, disabled hints'],
  ['--line', 'all borders (2px default weight)'],
  ['--accent', 'THE brand color — primary buttons, Owner card, active state, winner, links'],
  ['--accent-2', '"good"/confirm buttons (road-sign green)'],
  ['--good', 'success text ("requirements met")'],
  ['--bad', 'error banner border, expired timer'],
  ['--warn', 'timer in the warning window'],
  ['--plate-bg', 'licence-plate face'],
  ['--plate-ink', 'embossed plate lettering'],
  ['--plate-edge', 'plate border'],
] as const;

function renderSwatches(containerId: string, tokens: readonly (readonly [string, string])[]) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = tokens
    .map(([name, role]) => {
      const value = cssVar(name);
      return `
        <div class="swatch">
          <div class="swatch-color" style="background:var(${name})"></div>
          <div class="swatch-meta">
            <code>${name}</code>
            <span class="swatch-value">${value}</span>
            <span class="swatch-role">${role}</span>
          </div>
        </div>`;
    })
    .join('');
}
renderSwatches('phone-swatches', PHONE_TOKENS);

// ---- Type scale: read the actual computed font metrics off real elements --
function annotateType() {
  document.querySelectorAll<HTMLElement>('[data-type-sample]').forEach((elm) => {
    const cs = getComputedStyle(elm);
    const label = elm.parentElement?.querySelector('.type-meta');
    if (label) {
      label.textContent = `${elm.dataset.typeSample} — ${cs.fontSize} / ${cs.fontWeight} / letter-spacing ${cs.letterSpacing} / ${cs.fontFamily.split(',')[0]}`;
    }
  });
}
annotateType();

// ---- Spacing & radius: read real computed values off live components -----
function annotateBoxModel() {
  document.querySelectorAll<HTMLElement>('[data-box-sample]').forEach((elm) => {
    const cs = getComputedStyle(elm);
    const label = elm.closest('.box-demo')?.querySelector('.box-meta');
    if (label) {
      const parts = [elm.dataset.boxSample!];
      if (elm.dataset.showPadding !== undefined) parts.push(`padding ${cs.padding}`);
      if (elm.dataset.showGap !== undefined) parts.push(`gap ${cs.gap}`);
      if (elm.dataset.showRadius !== undefined) parts.push(`radius ${cs.borderRadius}`);
      if (elm.dataset.showBorder !== undefined) parts.push(`border ${cs.borderWidth} ${cs.borderStyle}`);
      label.textContent = parts.join(' · ');
    }
  });
}
annotateBoxModel();

// ---- Motion: read the real transition off a live button -------------------
function annotateMotion() {
  const btn = document.querySelector<HTMLElement>('[data-motion-sample]');
  const label = document.getElementById('motion-meta');
  if (btn && label) {
    label.textContent = `transition: ${getComputedStyle(btn).transition}`;
  }
  const logo = document.querySelector<HTMLElement>('[data-shadow-sample="logo"]');
  const logoLabel = document.getElementById('shadow-meta-logo');
  if (logo && logoLabel) logoLabel.textContent = `filter: ${getComputedStyle(logo).filter}`;
  const sticker = document.querySelector<HTMLElement>('[data-shadow-sample="sticker"]');
  const stickerLabel = document.getElementById('shadow-meta-sticker');
  if (sticker && stickerLabel) stickerLabel.textContent = `filter: ${getComputedStyle(sticker).filter}`;
}
annotateMotion();

// ---- Timer demo: drive the real <Timer>-equivalent countdown classes -----
function wireTimerDemo() {
  const el = document.getElementById('timer-demo');
  if (!el) return;
  let remaining = 20;
  const tick = () => {
    remaining -= 1;
    if (remaining < -2) remaining = 20;
    const cls = remaining <= 0 ? 'over' : remaining <= 15 ? 'warn' : '';
    el.className = `timer ${cls}`;
    el.textContent = remaining <= 0 ? '0s' : `${remaining}s`;
  };
  tick();
  setInterval(tick, 700);
}
wireTimerDemo();

// ---- Mute button demo: real toggle, scoped to this page only -------------
function wireMuteDemo() {
  const btn = document.getElementById('mute-demo') as HTMLButtonElement | null;
  if (!btn) return;
  let muted = false;
  btn.addEventListener('click', () => {
    muted = !muted;
    btn.textContent = muted ? '🔇' : '🔊';
    btn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  });
}
wireMuteDemo();
