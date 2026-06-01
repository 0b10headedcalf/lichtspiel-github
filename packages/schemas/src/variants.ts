/**
 * VariantRecord — a saved STRUCTURAL variant of a template. Adapted (not forked)
 * from the windchime variant/mutation system: a `seed` + `divergence` reproduce
 * a specific structural look (palette mode, arrangement, object kinds, …), and
 * `params` carries the VisualParamVector overrides that look implies.
 *
 * This is deliberately distinct from a VisualParamVector. Two orthogonal knobs:
 *   - VisualParamVector / paramMutation = the CONTINUOUS axis layer (density,
 *     motion, … 0..1) the performer rides live.
 *   - VariantRecord / familyVariants    = the DISCRETE structural layer realized
 *     by re-seeding + re-mounting (a "different version" of the same sketch).
 *
 * Variants are a build-/play-time artifact (saving, the Phase-8 mutation lab),
 * not a runtime wire payload — hence a plain type with no JSON-schema validator.
 */

import type { VisualParamVector } from './visualParams.js';

export interface VariantRecord {
  id: string;
  templateId: string;
  /** The RNG seed that reproduces this variant's structural config. */
  seed: number;
  /** 0..1 — how far this variant diverges from the template's canonical form. */
  divergence: number;
  /** Param overrides this variant implies (folded over the template defaults). */
  params: Partial<VisualParamVector>;
  /** ISO-8601 timestamp when the variant was saved. */
  createdAt: string;
  label?: string;
  tags?: string[];
}

/** Build a VariantRecord (timestamp + params supplied by the caller). */
export function makeVariantRecord(
  init: Omit<VariantRecord, 'params'> & { params?: Partial<VisualParamVector> },
): VariantRecord {
  return { ...init, params: init.params ?? {} };
}
