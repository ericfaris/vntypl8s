// tsc does not reliably copy imported .json files into outDir across
// configurations, but the emitted dist/data/index.js imports them at runtime
// (Node ESM import attributes). Copy them explicitly so `node
// packages/server/dist/index.js` can resolve @vntypl8s/shared's decks.
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../src/data');
const out = join(here, '../dist/data');

await mkdir(out, { recursive: true });
for (const f of ['owners.json', 'requirements.json']) {
  await cp(join(src, f), join(out, f));
}
