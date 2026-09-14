// Entry for tv-showcase.html — embedded via <iframe> from design-system.html.
// It exists as its own page (not just a section of the main showcase)
// because receiver.css sets `overflow:hidden` and a full-bleed 100vh/100vw
// layout on html/body/#root by design (Chromecast guide §3.7) — merging it
// into the phone showcase page would fight that page's own scroll. Loading
// the real receiver.css here, standalone, is the only way to preview the TV
// components without duplicating a single rule of it.
import '../receiver/receiver.css';

const root = document.documentElement;
const cssVar = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();

const TV_TOKENS = [
  ['--tv-bg', '--bg'],
  ['--tv-bg-2', '--bg-2'],
  ['--tv-panel', '--panel'],
  ['--tv-text', '--text'],
  ['--tv-hi', '(TV-only — brighter headline numbers)'],
  ['--tv-muted', '--muted'],
  ['--tv-line', '--line'],
  ['--tv-accent', '--accent'],
  ['--tv-good', '--good'],
  ['--tv-warn', '--warn'],
  ['--tv-bad', '--bad'],
  ['--tv-plate-bg', '--plate-bg'],
  ['--tv-plate-ink', '--plate-ink'],
  ['--tv-plate-edge', '--plate-edge'],
  ['--tv-plate-dim', '(TV-only — discarded/dim plate slots)'],
] as const;

function renderSwatches() {
  const el = document.getElementById('tv-swatches');
  if (!el) return;
  el.innerHTML = TV_TOKENS.map(([name, mapsTo]) => {
    const value = cssVar(name);
    return `
      <div class="swatch">
        <div class="swatch-color" style="background:var(${name})"></div>
        <div class="swatch-meta">
          <code>${name}</code>
          <span class="swatch-value">${value}</span>
          <span class="swatch-role">${mapsTo}</span>
        </div>
      </div>`;
  }).join('');
}
renderSwatches();

function annotateType() {
  document.querySelectorAll<HTMLElement>('[data-type-sample]').forEach((elm) => {
    const cs = getComputedStyle(elm);
    const label = elm.parentElement?.querySelector('.type-meta');
    if (label) {
      label.textContent = `${elm.dataset.typeSample} — ${cs.fontSize} / ${cs.fontWeight} / ${cs.fontFamily.split(',')[0]}`;
    }
  });
}
annotateType();

// Animate the writing-phase dots + timer so the "live projection" feel reads
// on a static preview too.
function wireDots() {
  const dots = document.querySelectorAll<HTMLElement>('.tv-dot[data-demo]');
  let i = 0;
  setInterval(() => {
    dots.forEach((d, idx) => d.classList.toggle('on', idx <= i % (dots.length + 1)));
    i++;
  }, 700);
}
wireDots();
