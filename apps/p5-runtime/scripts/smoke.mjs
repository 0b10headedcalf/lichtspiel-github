/**
 * Structural smoke for the template catalog. Cheap, dependency-free, and
 * runs in plain Node (the templates themselves need a browser/p5 + DOM, so
 * a full render+FPS smoke via Playwright is a Phase-1 follow-up — see
 * ROADMAP). This catches the common breakage: missing/duplicate ids, a
 * template not wired into the catalog, or a missing renderer declaration.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tplDir = join(here, '..', 'src', 'templates');
const skip = new Set(['index.ts', 'palette.ts']);

const files = readdirSync(tplDir).filter((f) => f.endsWith('.ts') && !skip.has(f));
const ids = new Map();
let failures = 0;

for (const file of files) {
  const src = readFileSync(join(tplDir, file), 'utf8');
  const idMatch = src.match(/\bid:\s*'([^']+)'/);
  const rendererMatch = src.match(/\brenderer:\s*'(p2d|webgl)'/);
  if (!idMatch) {
    console.error(`✗ ${file}: no template id found`);
    failures++;
    continue;
  }
  const id = idMatch[1];
  if (ids.has(id)) {
    console.error(`✗ ${file}: duplicate id "${id}" (also ${ids.get(id)})`);
    failures++;
  }
  ids.set(id, file);
  if (!rendererMatch) {
    console.error(`✗ ${file}: no renderer declared`);
    failures++;
  } else {
    console.log(`✓ ${id} (${rendererMatch[1]}) — ${file}`);
  }
}

const indexSrc = readFileSync(join(tplDir, 'index.ts'), 'utf8');
for (const id of ids.keys()) {
  if (!indexSrc.includes(id)) {
    console.error(`✗ template "${id}" is not referenced in templates/index.ts`);
    failures++;
  }
}

const EXPECTED = 8;
if (ids.size < EXPECTED) {
  console.error(`✗ expected at least ${EXPECTED} templates, found ${ids.size}`);
  failures++;
}

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log(`\nsmoke OK — ${ids.size} templates, all wired + unique`);
