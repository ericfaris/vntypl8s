// Deck source abstraction. The engine depends only on this interface so it can
// be driven by the curated static decks in production and by an unbounded
// synthetic source in tests (which must never exhaust regardless of player
// count / round count).
import {
  OWNER_CARDS,
  PLATE_ALPHABET,
  REQUIREMENT_CARDS,
  type OwnerCard,
  type RequirementsCard,
} from '@vntypl8s/shared';
import type { Rng } from './rng.js';

export interface DeckSource {
  /** A full shuffled *copy* of the Owner deck. Never hands out the shared array. */
  ownerDeck(rng: Rng): OwnerCard[];
  requirementsDeck(rng: Rng): RequirementsCard[];
}

/** Production: the curated static JSON from @vntypl8s/shared. */
export class StaticDeckSource implements DeckSource {
  ownerDeck(rng: Rng): OwnerCard[] {
    return rng.shuffle(OWNER_CARDS.map((c) => ({ ...c })));
  }
  requirementsDeck(rng: Rng): RequirementsCard[] {
    return rng.shuffle(REQUIREMENT_CARDS.map((c) => ({ ...c })));
  }
}

/**
 * Tests: unbounded synthetic decks. Mints `Owner N` titles and cycles valid
 * 3-char requirement strings so a game can never run a deck dry.
 */
export class SyntheticDeckSource implements DeckSource {
  /** Enough for 8 players x 3 rounds x (1 dealt + 6 filler) with huge headroom. */
  constructor(private readonly size = 400) {}

  ownerDeck(rng: Rng): OwnerCard[] {
    const cards: OwnerCard[] = [];
    for (let i = 1; i <= this.size; i++) {
      cards.push({ id: `syn_own_${String(i).padStart(4, '0')}`, title: `Owner ${i}` });
    }
    return rng.shuffle(cards);
  }

  requirementsDeck(rng: Rng): RequirementsCard[] {
    const cards: RequirementsCard[] = [];
    const n = PLATE_ALPHABET.length;
    for (let i = 0; i < this.size; i++) {
      const chars =
        PLATE_ALPHABET[i % n]! + PLATE_ALPHABET[(i * 7 + 3) % n]! + PLATE_ALPHABET[(i * 13 + 5) % n]!;
      cards.push({ id: `syn_req_${String(i + 1).padStart(4, '0')}`, chars });
    }
    return rng.shuffle(cards);
  }
}
