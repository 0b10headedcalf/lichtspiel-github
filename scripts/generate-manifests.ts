/**
 * Generate template manifest JSON from the p5 template catalog.
 * Reads all templates, extracts serializable metadata, writes templates.json.
 *
 * Run: npx tsx scripts/generate-manifests.ts
 */

import { TEMPLATES } from '../apps/p5-runtime/src/templates/index.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const manifests = TEMPLATES.map((t) => {
  const manifest: Record<string, unknown> = {
    id: t.id,
    name: t.name,
    family: t.family,
    description: t.description,
    tags: t.tags,
    defaultParams: t.defaultParams,
    renderer: t.renderer ?? 'p2d',
  };

  if (t.safeParamRanges) manifest.safeParamRanges = t.safeParamRanges;
  if (t.sourceLineage) manifest.sourceLineage = t.sourceLineage;
  if (t.hardwareTarget) manifest.hardwareTarget = t.hardwareTarget;
  if (t.idioms) manifest.idioms = t.idioms;
  if (t.gestural) manifest.gestural = t.gestural;

  // Variant metadata
  if (t.variants) {
    try {
      const axes = t.variants.axes ?? {};
      manifest.variants = { axes };
    } catch {
      // variants might be a factory, skip
    }
  }

  // Backend declaration
  manifest.backends = [
    {
      id: 'p5',
      entry: `./templates/${t.id}.ts`,
    },
  ];

  return manifest;
});

const outDir = join(__dirname, '..', 'packages', 'visual-corpus', 'manifests');
mkdirSync(outDir, { recursive: true });

const outPath = join(outDir, 'templates.json');
writeFileSync(outPath, JSON.stringify(manifests, null, 2) + '\n', 'utf-8');

console.log(`Generated ${manifests.length} template manifests → ${outPath}`);
