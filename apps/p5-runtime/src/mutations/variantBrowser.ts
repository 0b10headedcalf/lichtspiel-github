/**
 * Variant browser — steps through a template's structural variant space, live
 * (no persistence). Adapted (not forked) from windchime apps/web/src/ui/
 * variantBrowser.ts: deterministic seed + divergence. A per-template cursor
 * (idx) drives it — idx 0 = canonical; ± steps enumerate seeds reproducibly;
 * `newVariant` jumps to a random position so stepping continues from there. Each
 * change re-mounts the template with the chosen seed + structural config (the
 * windchime `host.swap` pattern), so a variant is a fully reproducible recipe.
 *
 * Templates with no `variants` factory still re-seed (the visual's internal RNG
 * changes), so the browser degrades gracefully on the legacy scenes.
 */

import type { VisualTemplate } from '../visualTemplate.js';
import type { VariantConfig } from './familyVariants.js';
import { createRng, randomSeed } from '../seededRng.js';

export interface VariantInfo {
  templateId: string;
  seed: number;
  divergence: number;
  /** The active structural config (flows to the sketch via MountContext.config). */
  config: VariantConfig;
  /** The template's canonical config, for diffing which axes diverged. */
  canonical: VariantConfig;
}

export interface VariantBrowserOptions {
  /** Re-mount `template` with this seed + structural config. */
  apply(template: VisualTemplate, seed: number, config: VariantConfig): void;
  /** Notify the UI of the active variant (null = a template with no axes). */
  onChange?(info: VariantInfo | null): void;
  /** Divergence for new / stepped variants, 0..1 (default 0.6, windchime's). */
  divergence?: number;
}

export interface VariantBrowser {
  /** Mount `template` at its current cursor (used on scene switch). */
  show(template: VisualTemplate): void;
  /** Jump to a fresh random variant. */
  newVariant(template: VisualTemplate): void;
  /** Reset to the template's canonical (signature) look. */
  canonical(template: VisualTemplate): void;
  /** Step the deterministic cursor by ±1 (enumerated seeds). */
  step(template: VisualTemplate, dir: 1 | -1): void;
}

/** Spread an integer cursor into a varied 32-bit seed (0 stays canonical). */
const stepSeed = (idx: number): number => Math.imul(idx, 0x9e3779b1) | 0;

export function createVariantBrowser(opts: VariantBrowserOptions): VariantBrowser {
  const div = opts.divergence ?? 0.6;
  const cursor = new Map<string, number>(); // templateId → idx (0 = canonical)

  const resolve = (template: VisualTemplate, idx: number): VariantInfo => {
    const f = template.variants;
    const canonical: VariantConfig = f ? f.canonical(0) : {};
    if (idx === 0) {
      return { templateId: template.id, seed: 0, divergence: 0, config: canonical, canonical };
    }
    const seed = stepSeed(idx);
    const config: VariantConfig = f ? f.generate(createRng(seed), seed, div) : { seed };
    return { templateId: template.id, seed, divergence: div, config, canonical };
  };

  const applyIdx = (template: VisualTemplate, idx: number): void => {
    cursor.set(template.id, idx);
    const info = resolve(template, idx);
    opts.apply(template, info.seed, info.config);
    opts.onChange?.(template.variants || idx !== 0 ? info : null);
  };

  return {
    show(template) {
      applyIdx(template, cursor.get(template.id) ?? 0);
    },
    newVariant(template) {
      applyIdx(template, (randomSeed() % 100000) + 1); // 1..100000 → always a variant
    },
    canonical(template) {
      applyIdx(template, 0);
    },
    step(template, dir) {
      applyIdx(template, (cursor.get(template.id) ?? 0) + dir);
    },
  };
}
