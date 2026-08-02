// Deterministic validation for AI-generated Owner titles. Runs before any
// candidate may enter the shipped deck — the LLM produces *candidates*, this
// file plus human curation produces the deck.
const BLOCKLIST = [
  'nigger', 'faggot', 'cunt', 'rape', 'rapist', 'nazi', 'hitler', 'kike',
  'spic', 'chink', 'retard', 'molest', 'pedophile', 'porn', 'slut', 'whore',
];

/**
 * Words too abstract to allude to obliquely in 8 characters. A good Owner
 * title is a concrete, widely-known role or identity ("Park Ranger"), not a
 * quality ("Ambitious") or an abstraction ("Leadership").
 */
const ABSTRACT_SUFFIXES = ['ness', 'ity', 'ism', 'tion', 'ance', 'ence', 'ship', 'hood'];

export type RejectReason =
  | 'empty'
  | 'too-short'
  | 'too-long'
  | 'word-count'
  | 'charset'
  | 'not-title-case'
  | 'proper-noun'
  | 'abstract'
  | 'blocked'
  | 'duplicate';

export interface ValidationResult {
  ok: boolean;
  reason?: RejectReason;
}

export function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Small stop-list of words that would make a title a brand/proper noun. */
const PROPER_NOUN_HINTS = [
  'disney', 'google', 'apple', 'amazon', 'nasa', 'nike', 'coca', 'pepsi',
  'netflix', 'walmart', 'tesla', 'mcdonald', 'starbucks', 'microsoft',
];

const LOWERCASE_JOINERS = new Set(['of', 'the', 'a', 'an', 'and', 'in', 'on', 'for']);

/**
 * A shipped Owner title must be: 1–3 words, 3–28 chars, Title Case, letters /
 * spaces / hyphens only, not a brand or proper noun, not abstract, not
 * blocked, and not a duplicate of anything already accepted.
 */
export function validateOwnerTitle(title: string, seen: ReadonlySet<string>): ValidationResult {
  const t = title.trim();
  if (!t) return { ok: false, reason: 'empty' };
  if (t.length < 3) return { ok: false, reason: 'too-short' };
  if (t.length > 28) return { ok: false, reason: 'too-long' };
  if (!/^[A-Za-z][A-Za-z '-]*[A-Za-z]$/.test(t)) return { ok: false, reason: 'charset' };

  const words = t.split(/\s+/);
  if (words.length < 1 || words.length > 3) return { ok: false, reason: 'word-count' };

  for (const w of words) {
    const bare = w.replace(/[^A-Za-z-]/g, '');
    if (!bare) return { ok: false, reason: 'charset' };
    if (LOWERCASE_JOINERS.has(bare.toLowerCase())) continue;
    // Title Case: every significant word starts capitalised. Hyphenated
    // compounds must capitalise each part ("Ice-Road Trucker").
    for (const part of bare.split('-')) {
      if (!part) continue;
      if (!/^[A-Z][a-z'-]*$/.test(part)) return { ok: false, reason: 'not-title-case' };
    }
  }

  const lower = t.toLowerCase();
  if (BLOCKLIST.some((bad) => lower.includes(bad))) return { ok: false, reason: 'blocked' };
  if (PROPER_NOUN_HINTS.some((brand) => lower.includes(brand))) {
    return { ok: false, reason: 'proper-noun' };
  }
  // A single abstract noun is unguessable — you can't hint at "Resilience".
  if (words.length === 1 && ABSTRACT_SUFFIXES.some((s) => lower.endsWith(s))) {
    return { ok: false, reason: 'abstract' };
  }

  if (seen.has(normalizeText(t))) return { ok: false, reason: 'duplicate' };
  return { ok: true };
}
