// Owner-title generation via the Anthropic Messages API.
//
// OFFLINE ONLY. This file is imported by src/scripts/generate-cards.ts and by
// nothing else — never by src/index.ts, never on a request path. Cards are a
// fixed, curated static deck (plan §8).
import Anthropic from '@anthropic-ai/sdk';
import { normalizeText, validateOwnerTitle, type RejectReason } from './validation.js';

/**
 * Batching across themes rather than one giant prompt: asking for 200 titles
 * in a single call reliably produces near-duplicates clustered in one
 * semantic neighbourhood.
 */
export const OWNER_THEMES = [
  'trades and manual labour (builders, mechanics, operators, installers)',
  'the outdoors and animals (rangers, guides, keepers, handlers, farmers)',
  'food and drink (cooks, bakers, brewers, servers, growers)',
  'arts and media (performers, writers, makers, broadcasters, critics)',
  'science, tech and medicine (researchers, engineers, clinicians, analysts)',
  'service and civic life (teachers, officials, carers, emergency services)',
] as const;

export interface GeneratorOptions {
  apiKey: string;
  model: string;
}

export interface BatchResult {
  accepted: string[];
  rejected: { title: string; reason: RejectReason }[];
  refused: boolean;
}

export class OwnerTitleGenerator {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: GeneratorOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model;
  }

  /**
   * Generate one themed batch of validated Owner titles. Returns only
   * candidates that pass deterministic validation.
   */
  async generateBatch(
    count: number,
    theme: string,
    excludeNormalized: ReadonlySet<string>,
  ): Promise<BatchResult> {
    const prompt =
      `Generate ${count} distinct Owner cards for a party guessing game called VNTYPL8S.\n\n` +
      `An Owner card is a short role or identity title. A player is secretly dealt one and ` +
      `must compose an 8-character vanity licence plate that HINTS at it without using its ` +
      `words, for the others to guess out loud.\n\n` +
      `Theme for this batch: ${theme}.\n\n` +
      `Rules for every title:\n` +
      `- A concrete, widely-known role or identity a normal adult would recognise instantly.\n` +
      `- 1 to 3 words, Title Case, letters and spaces only (a hyphen is fine).\n` +
      `- Guessable but not trivially so. Good: "Park Ranger", "Film Critic", "Storm Chaser", ` +
      `"Pastry Chef", "Crossing Guard". Bad: "Person", "Worker" (too vague), "Resilience" ` +
      `(abstract), "Disney Imagineer" (brand), "Consulting Cetacean Acoustician" (too obscure).\n` +
      `- Something a player could allude to obliquely: it should suggest images, tools, ` +
      `places or sounds.\n` +
      `- No real people, no brands or companies, no offensive or adult content.\n` +
      `- No duplicates.\n\n` +
      `Respond with ONLY a JSON object of the form {"titles": ["...", "..."]} and nothing else.`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    if (response.stop_reason === 'refusal') {
      return { accepted: [], rejected: [], refused: true };
    }

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return { accepted: [], rejected: [], refused: false };

    const titles = extractTitles(text.text);
    const seen = new Set(excludeNormalized);
    const accepted: string[] = [];
    const rejected: { title: string; reason: RejectReason }[] = [];
    for (const raw of titles) {
      const t = raw.trim();
      const res = validateOwnerTitle(t, seen);
      if (res.ok) {
        accepted.push(t);
        seen.add(normalizeText(t));
      } else {
        rejected.push({ title: t, reason: res.reason! });
      }
    }
    return { accepted, rejected, refused: false };
  }

  /**
   * Optional curation pass for the programmatically generated Requirements
   * candidates: rate each 1–5 for "plate-friendliness" — how plausible is it
   * to build a readable 8-character plate containing these 3 chars in order?
   * Falls back to a neutral rating if anything goes wrong; the programmatic
   * set is fully shippable on its own.
   */
  async rateRequirements(candidates: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const prompt =
      `A vanity licence plate is at most 8 characters from A-Z (no vowels; Y allowed) ` +
      `and 0-9. Players must include 3 required characters IN ORDER (not necessarily ` +
      `adjacent) somewhere in their plate, while still making the plate read as a hint ` +
      `at a role like "Park Ranger".\n\n` +
      `Rate each of the following 3-character requirement sets from 1 to 5 for how easy ` +
      `it is to build a readable, expressive plate around it (5 = very easy, 1 = painful).\n\n` +
      candidates.join(', ') +
      `\n\nRespond with ONLY a JSON object mapping each set to its integer rating, e.g. ` +
      `{"RF5": 4, "CF4": 3} and nothing else.`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });
      if (response.stop_reason === 'refusal') return out;
      const text = response.content.find((b) => b.type === 'text');
      if (!text || text.type !== 'text') return out;
      const match = text.text.match(/\{[\s\S]*\}/);
      if (!match) return out;
      const parsed = JSON.parse(match[0]) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        const n = Number(v);
        if (Number.isFinite(n)) out.set(k.toUpperCase(), Math.max(1, Math.min(5, n)));
      }
    } catch (e) {
      console.warn('[gen] requirements rating pass failed, using the seeded order:', e);
    }
    return out;
  }
}

/** Robustly pull the titles array out of the model's reply (JSON-first). */
export function extractTitles(raw: string): string[] {
  const jsonMatch = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      const arr = Array.isArray(parsed)
        ? parsed
        : (parsed as { titles?: unknown })?.titles;
      if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string');
    } catch {
      /* fall through to line parsing */
    }
  }
  // Fallback: one title per line, stripping list markers and trailing commas.
  return raw
    .split('\n')
    .map((l) =>
      l
        .replace(/^[\s\-*\d.)"']+/, '')
        .replace(/["',]+$/, '')
        .trim(),
    )
    .filter((l) => l.length > 0 && l.length < 60);
}
