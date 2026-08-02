// ============================================================================
// Plate alphabet & the mechanical Plate Creation Rules.
// Shared by the client (tile picker renders exactly this alphabet) and the
// server (which re-validates every submission — never trust the client).
// ============================================================================

/** A–Z minus vowels (Y is legal), plus 0–9. 31 symbols. Order = tile-picker order. */
export const PLATE_LETTERS = 'BCDFGHJKLMNPQRSTVWXYZ' as const; // 21
export const PLATE_DIGITS = '0123456789' as const; // 10
export const PLATE_ALPHABET: string[] = (PLATE_LETTERS + PLATE_DIGITS).split('');
export const PLATE_MAX_LENGTH = 8;
export const PLATE_MIN_LENGTH = 1;
export const VOWELS = 'AEIOU';

export type PlateError =
  | 'EMPTY'
  | 'TOO_LONG'
  | 'ILLEGAL_CHAR'
  | 'LOWERCASE'
  | 'VOWEL'
  | 'WHITESPACE';

export interface PlateValidation {
  ok: boolean;
  error: PlateError | null;
}

const ALPHABET_SET = new Set(PLATE_ALPHABET);

/**
 * Mechanical Plate Creation Rules only. Deliberately does NOT check the
 * "no Owner-title words" rule — that is social/honour-system (plan §2.4).
 */
export function validatePlate(plate: string): PlateValidation {
  if (plate.length < PLATE_MIN_LENGTH) return { ok: false, error: 'EMPTY' };
  if (plate.length > PLATE_MAX_LENGTH) return { ok: false, error: 'TOO_LONG' };
  for (const ch of plate) {
    if (/\s/.test(ch)) return { ok: false, error: 'WHITESPACE' };
    if (ch >= 'a' && ch <= 'z') return { ok: false, error: 'LOWERCASE' };
    if (VOWELS.includes(ch)) return { ok: false, error: 'VOWEL' };
    if (!ALPHABET_SET.has(ch)) return { ok: false, error: 'ILLEGAL_CHAR' };
  }
  return { ok: true, error: null };
}

/**
 * True iff the required chars appear in `plate` in order (subsequence match).
 * NOT contiguous — the rulebook only demands "all 3 characters, in order".
 */
export function satisfiesRequirements(plate: string, required: string): boolean {
  if (!required) return true;
  let ptr = 0;
  for (const ch of plate) {
    if (ch === required[ptr]) ptr += 1;
    if (ptr === required.length) return true;
  }
  return ptr === required.length;
}
