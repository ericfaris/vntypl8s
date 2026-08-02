/**
 * One-time offline card generator. NOT imported by the server; never on a
 * request path (plan §8).
 *
 *   npm run gen:cards
 *   npm run gen:cards -- --owners=200 --requirements=36 --seed=1234 --dry-run
 *   npm run gen:cards -- --out=../shared/src/data
 *
 * Owner titles are LLM-generated (creative judgment is the whole point of a
 * good Owner card) and need ANTHROPIC_API_KEY. Requirements cards are
 * generated programmatically under an explicit distribution — "pick 3
 * characters" has no creativity to extract from a model, and a seeded shuffle
 * gives strictly better distribution than asking for one. If a key IS present
 * an optional LLM pass rates candidates for plate-friendliness and keeps the
 * best 36; without one the programmatic set ships as-is.
 *
 * The output is CANDIDATES. Read owners.json end to end afterwards and
 * replace anything unguessable, offensive or duplicative, then top back up to
 * exactly the target count.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLATE_ALPHABET,
  PLATE_DIGITS,
  PLATE_LETTERS,
  type OwnerCard,
  type RequirementsCard,
} from '@vntypl8s/shared';
import { OwnerTitleGenerator, OWNER_THEMES } from '../ai/generator.js';
import { normalizeText, validateOwnerTitle, type RejectReason } from '../ai/validation.js';
import { makeRng, type Rng } from '../engine/rng.js';
import { loadRootEnv } from '../env.js';

loadRootEnv();

// ------------------------------------------------------------------- args
interface Args {
  owners: number;
  requirements: number;
  out: string;
  seed: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const here = dirname(fileURLToPath(import.meta.url));
  const get = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  return {
    owners: Number(get('owners') ?? 200),
    requirements: Number(get('requirements') ?? 36),
    out: resolve(here, get('out') ?? '../../../shared/src/data'),
    seed: Number(get('seed') ?? 20250205),
    dryRun: argv.includes('--dry-run'),
  };
}

const MAX_OWNER_BATCHES = 12;
const OWNERS_PER_BATCH = 40;

// ------------------------------------------------------- requirements deck
type Shape = 'LLD' | 'LLL' | 'LDL' | 'DLL';

/** Rulebook examples (RF5, CF4, SY3) are all letter-letter-digit — weight to match. */
const SHAPE_WEIGHTS: [Shape, number][] = [
  ['LLD', 0.55],
  ['LLL', 0.25],
  ['LDL', 0.15],
  ['DLL', 0.05],
];

function pickShape(rng: Rng): Shape {
  const r = rng.next();
  let acc = 0;
  for (const [shape, w] of SHAPE_WEIGHTS) {
    acc += w;
    if (r < acc) return shape;
  }
  return 'LLD';
}

function charFor(kind: 'L' | 'D', rng: Rng): string {
  const pool = kind === 'L' ? PLATE_LETTERS : PLATE_DIGITS;
  return pool[rng.int(pool.length)]!;
}

/** Enumerate a large pool of legal, distinct, non-degenerate candidates. */
function generateRequirementCandidates(count: number, rng: Rng): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 500) {
    const shape = pickShape(rng);
    const chars = [...shape].map((k) => charFor(k as 'L' | 'D', rng)).join('');
    if (chars.length !== 3) continue;
    // No card where all three characters are identical — unplayable filler.
    if (chars[0] === chars[1] && chars[1] === chars[2]) continue;
    if (seen.has(chars)) continue;
    seen.add(chars);
    out.push(chars);
  }
  return rng.shuffle(out);
}

function shapeOf(chars: string): Shape {
  const kind = (c: string) => (PLATE_DIGITS.includes(c) ? 'D' : 'L');
  return [...chars].map(kind).join('') as Shape;
}

// -------------------------------------------------------------------- main
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5';
  const rng = makeRng(args.seed);

  console.log('=== VNTYPL8S card generation ===');
  console.log(`out=${args.out} seed=${args.seed} dryRun=${args.dryRun}`);
  console.log(
    apiKey
      ? `ANTHROPIC_API_KEY present — Owner titles will be LLM-generated with ${model}.`
      : 'ANTHROPIC_API_KEY NOT set.',
  );
  console.log('');

  // ---------------------------- Requirements (no API key required) --------
  console.log(`--- Requirements cards (${args.requirements}) ---`);
  console.log('Generated programmatically: "pick 3 characters" has no creativity for an');
  console.log('LLM to add, and a seeded shuffle beats a model on distribution.');
  const poolSize = Math.max(args.requirements * 6, 200);
  let candidates = generateRequirementCandidates(poolSize, rng);
  console.log(`  ${candidates.length} distinct candidates generated`);

  if (apiKey) {
    console.log('  API key present — running the optional plate-friendliness curation pass…');
    const generator = new OwnerTitleGenerator({ apiKey, model });
    const ratings = await generator.rateRequirements(candidates.slice(0, 120));
    if (ratings.size > 0) {
      candidates = candidates
        .slice()
        .sort((a, b) => (ratings.get(b) ?? 3) - (ratings.get(a) ?? 3));
      console.log(`  rated ${ratings.size} candidates; keeping the top ${args.requirements}`);
    } else {
      console.log('  rating pass returned nothing usable — keeping the seeded order');
    }
  } else {
    console.log('  no API key — the seeded programmatic set is used as-is (fully shippable).');
  }

  const requirements: RequirementsCard[] = candidates
    .slice(0, args.requirements)
    .map((chars, i) => ({ id: `req_${String(i + 1).padStart(2, '0')}`, chars }));

  const shapeCounts = new Map<string, number>();
  for (const c of requirements) {
    const s = shapeOf(c.chars);
    shapeCounts.set(s, (shapeCounts.get(s) ?? 0) + 1);
  }
  console.log(
    `  shape distribution: ${[...shapeCounts].map(([s, n]) => `${s}=${n}`).join(' ')}`,
  );

  // -------------------------------- Owner titles (needs an API key) -------
  console.log('');
  console.log(`--- Owner cards (${args.owners}) ---`);
  let owners: OwnerCard[] | null = null;

  if (!apiKey) {
    console.log('  BLOCKED: Owner titles are LLM-generated and ANTHROPIC_API_KEY is not set.');
    console.log('  Set it in the repo-root .env and re-run. owners.json is left untouched —');
    console.log('  hand-authoring 200 titles here would fake a generation run that did not');
    console.log('  happen, so this step deliberately stops instead.');
  } else {
    const generator = new OwnerTitleGenerator({ apiKey, model });
    const seen = new Set<string>();
    const accepted: string[] = [];
    const rejectionCounts = new Map<RejectReason, number>();

    for (let batch = 0; batch < MAX_OWNER_BATCHES && accepted.length < args.owners; batch++) {
      const theme = OWNER_THEMES[batch % OWNER_THEMES.length]!;
      process.stdout.write(`  batch ${batch + 1}/${MAX_OWNER_BATCHES} (${theme.slice(0, 28)}…) `);
      const res = await generator.generateBatch(OWNERS_PER_BATCH, theme, seen);
      if (res.refused) {
        console.log('refused');
        continue;
      }
      for (const t of res.accepted) {
        if (accepted.length >= args.owners) break;
        accepted.push(t);
        seen.add(normalizeText(t));
      }
      for (const r of res.rejected) {
        rejectionCounts.set(r.reason, (rejectionCounts.get(r.reason) ?? 0) + 1);
      }
      console.log(`+${res.accepted.length} accepted, ${res.rejected.length} rejected (total ${accepted.length})`);
    }

    console.log('  rejection summary:');
    if (rejectionCounts.size === 0) console.log('    (none)');
    for (const [reason, n] of [...rejectionCounts].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${reason}: ${n}`);
    }

    if (accepted.length < args.owners) {
      console.log(
        `  WARNING: only ${accepted.length}/${args.owners} titles survived validation. ` +
          'Re-run to top up, or curate by hand.',
      );
    }
    owners = accepted
      .slice(0, args.owners)
      .map((title, i) => ({ id: `own_${String(i + 1).padStart(3, '0')}`, title }));
  }

  // -------------------------------------------------------------- write ---
  console.log('');
  if (args.dryRun) {
    console.log('--dry-run: nothing written.');
    console.log('requirements:', requirements.map((c) => c.chars).join(' '));
    if (owners) console.log('owners:', owners.map((c) => c.title).join(' | '));
    return;
  }

  mkdirSync(args.out, { recursive: true });
  const reqPath = join(args.out, 'requirements.json');
  writeFileSync(reqPath, JSON.stringify(requirements, null, 2) + '\n');
  console.log(`wrote ${requirements.length} Requirements cards -> ${reqPath}`);

  if (owners) {
    const ownersPath = join(args.out, 'owners.json');
    const sorted = [...owners].sort((a, b) => a.id.localeCompare(b.id));
    writeFileSync(ownersPath, JSON.stringify(sorted, null, 2) + '\n');
    console.log(`wrote ${sorted.length} Owner cards -> ${ownersPath}`);
  } else {
    console.log('owners.json NOT written (see the block above).');
  }

  // ------------------------------------------------------------ validate --
  console.log('');
  console.log('--- re-reading and validating the written files ---');
  const reRead = <T>(name: string): T =>
    JSON.parse(readFileSync(join(args.out, name), 'utf8')) as T;

  const reqOut = reRead<RequirementsCard[]>('requirements.json');
  assert(reqOut.length === args.requirements, `requirements: ${reqOut.length} !== ${args.requirements}`);
  assert(new Set(reqOut.map((c) => c.id)).size === reqOut.length, 'requirements: duplicate ids');
  assert(new Set(reqOut.map((c) => c.chars)).size === reqOut.length, 'requirements: duplicate chars');
  for (const c of reqOut) {
    assert(c.chars.length === 3, `requirements: ${c.id} is not 3 chars`);
    for (const ch of c.chars) {
      assert(PLATE_ALPHABET.includes(ch), `requirements: ${c.id} has illegal char ${ch}`);
    }
  }
  console.log(`  requirements.json OK (${reqOut.length} cards, all legal)`);

  const ownerOut = reRead<OwnerCard[]>('owners.json');
  assert(new Set(ownerOut.map((c) => c.id)).size === ownerOut.length, 'owners: duplicate ids');
  const seenTitles = new Set<string>();
  for (const c of ownerOut) {
    const res = validateOwnerTitle(c.title, seenTitles);
    assert(res.ok, `owners: ${c.id} "${c.title}" failed validation (${res.reason})`);
    seenTitles.add(normalizeText(c.title));
  }
  if (ownerOut.length === args.owners) {
    console.log(`  owners.json OK (${ownerOut.length} cards, all valid)`);
  } else {
    console.log(
      `  owners.json has ${ownerOut.length} cards, NOT the target ${args.owners} ` +
        '(placeholder deck still in place — see the Owner card block above).',
    );
  }
}

function assert(cond: boolean, message: string): void {
  if (!cond) {
    console.error(`FAILED: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
