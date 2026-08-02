// Curated static decks. Same fixed deck every game — no runtime generation,
// ever (plan §8).
//
// TODO(step 13): owners.json / requirements.json are currently the
// hand-written PLACEHOLDER starter set (24 / 12). They are replaced wholesale
// by `npm run gen:cards` (packages/server/src/scripts/generate-cards.ts),
// which writes exactly 200 Owner cards and 36 Requirements cards here. The
// Owner half needs ANTHROPIC_API_KEY; the Requirements half is programmatic.
import type { OwnerCard, RequirementsCard } from '../types.js';
import ownersRaw from './owners.json' with { type: 'json' };
import requirementsRaw from './requirements.json' with { type: 'json' };

export const OWNER_CARDS: OwnerCard[] = ownersRaw as OwnerCard[];
export const REQUIREMENT_CARDS: RequirementsCard[] = requirementsRaw as RequirementsCard[];
