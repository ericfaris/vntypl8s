import { useEffect, useState } from 'react';
import {
  PLATE_DIGITS,
  PLATE_LETTERS,
  PLATE_MAX_LENGTH,
  satisfiesRequirements,
  type PrivateState,
} from '@vntypl8s/shared';
import { store } from '../common/store.js';
import { PlateDisplay } from '../common/ui.js';
import { Paperclip } from '../common/stickers.js';
import { sound } from '../common/sound.js';

/**
 * The tile picker IS the enforcement mechanism for the mechanical Plate
 * Creation Rules: there is no <input> and no contentEditable anywhere on this
 * screen, so illegal characters are structurally unrepresentable. The server
 * still re-validates every plate:set — never trust the client.
 *
 * The "no words from your Owner card" rule is deliberately NOT enforced (it
 * needs semantic judgment). It is restated as static copy and left to social
 * trust, exactly as in the physical game.
 */
export function PlateWriter({ priv }: { priv: PrivateState }) {
  const [plate, setPlate] = useState(priv.plate);
  const [busy, setBusy] = useState(false);

  // Adopt a server-side correction (e.g. after a reconnect replays our draft).
  useEffect(() => {
    setPlate((cur) => (priv.plate !== cur && priv.submitted ? priv.plate : cur));
  }, [priv.plate, priv.submitted]);

  const required = priv.requirementsCard?.chars ?? '';
  const met = satisfiesRequirements(plate, required);
  const full = plate.length >= PLATE_MAX_LENGTH;

  function push(ch: string) {
    if (full) return;
    sound.playSfx('tile-tap');
    const next = plate + ch;
    setPlate(next);
    void store.setPlate(next);
  }
  function backspace() {
    sound.playSfx('tile-tap');
    const next = plate.slice(0, -1);
    setPlate(next);
    void store.setPlate(next);
  }
  function clear() {
    sound.playSfx('back');
    setPlate('');
    void store.setPlate('');
  }
  async function submit() {
    setBusy(true);
    const ok = await store.submitPlate();
    if (ok) sound.playSfx('plate-submit');
    if (!ok) setBusy(false);
  }

  return (
    <div className="stack">
      <div className="ownercard">
        <Paperclip />
        <div className="label">Your Owner card</div>
        <div className="value">{priv.ownerCard?.title ?? '—'}</div>
      </div>

      <div className="spread">
        <div className="row">
          <span className="muted small">Requirements</span>
          <span className="reqcard">
            {[...required].map((c, i) => (
              <span key={i} className="reqchar">
                {c}
              </span>
            ))}
          </span>
        </div>
        <span className={met ? 'met' : 'notmet'} data-testid="req-indicator">
          {met ? '✓ in order' : 'not yet'}
        </span>
      </div>

      <div className="center-text">
        <PlateDisplay plate={plate} slots={PLATE_MAX_LENGTH} size="md" />
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <div className="tilelabel">Letters</div>
        <div className="tiles">
          {[...PLATE_LETTERS].map((ch) => (
            <button
              key={ch}
              className="tile"
              disabled={full}
              onClick={() => push(ch)}
              aria-label={`Add ${ch}`}
            >
              {ch}
            </button>
          ))}
        </div>
        <div className="tilelabel">Numbers</div>
        <div className="tiles digits">
          {[...PLATE_DIGITS].map((ch) => (
            <button
              key={ch}
              className="tile"
              disabled={full}
              onClick={() => push(ch)}
              aria-label={`Add ${ch}`}
            >
              {ch}
            </button>
          ))}
        </div>
      </div>

      <div className="row">
        <button className="grow" disabled={plate.length === 0} onClick={backspace}>
          ⌫ Backspace
        </button>
        <button className="grow ghost" disabled={plate.length === 0} onClick={clear}>
          Clear
        </button>
      </div>

      <button className="primary" disabled={plate.length === 0 || busy} onClick={submit}>
        {busy ? 'Locking in…' : 'Lock in my plate'}
      </button>

      <div className="notice small muted">
        A–Z (no vowels — Y is fine) and 0–9. Max 8. Don&apos;t spell out words from your card —
        hint at it.
      </div>
    </div>
  );
}
