import { describe, expect, it } from 'vitest';
import { OWNER_CARDS, PLATE_ALPHABET, REQUIREMENT_CARDS } from '@vntypl8s/shared';
import { StaticDeckSource, SyntheticDeckSource } from '../deck.js';
import { makeRng } from '../rng.js';

describe('StaticDeckSource', () => {
  it('returns the full Owner deck, shuffled, with unique ids', () => {
    const deck = new StaticDeckSource().ownerDeck(makeRng(1));
    expect(deck).toHaveLength(OWNER_CARDS.length);
    expect(new Set(deck.map((c) => c.id)).size).toBe(deck.length);
    // same multiset of ids as the source
    expect(deck.map((c) => c.id).sort()).toEqual(OWNER_CARDS.map((c) => c.id).sort());
  });

  it('returns the full Requirements deck with unique ids', () => {
    const deck = new StaticDeckSource().requirementsDeck(makeRng(2));
    expect(deck).toHaveLength(REQUIREMENT_CARDS.length);
    expect(new Set(deck.map((c) => c.id)).size).toBe(deck.length);
  });

  it('does not hand out references into the shared module-level deck', () => {
    const deck = new StaticDeckSource().ownerDeck(makeRng(3));
    deck[0]!.title = 'MUTATED';
    expect(OWNER_CARDS.some((c) => c.title === 'MUTATED')).toBe(false);
  });

  it('is deterministic for a given seed', () => {
    const a = new StaticDeckSource().ownerDeck(makeRng(42)).map((c) => c.id);
    const b = new StaticDeckSource().ownerDeck(makeRng(42)).map((c) => c.id);
    expect(a).toEqual(b);
  });
});

describe('SyntheticDeckSource', () => {
  it('mints unbounded unique owner cards', () => {
    const deck = new SyntheticDeckSource().ownerDeck(makeRng(1));
    expect(deck.length).toBeGreaterThanOrEqual(8 * 3 + 6 * 3);
    expect(new Set(deck.map((c) => c.id)).size).toBe(deck.length);
  });

  it('mints only legal 3-char requirement strings', () => {
    const deck = new SyntheticDeckSource().requirementsDeck(makeRng(1));
    for (const c of deck) {
      expect(c.chars).toHaveLength(3);
      for (const ch of c.chars) expect(PLATE_ALPHABET).toContain(ch);
    }
  });
});
