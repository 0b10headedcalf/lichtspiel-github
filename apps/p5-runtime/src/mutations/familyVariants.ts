/**
 * Family variant system — the STRUCTURAL layer, distinct from paramMutation's
 * CONTINUOUS one. Two orthogonal knobs the plan keeps separate:
 *   - paramMutation.ts → jitters the VisualParamVector axes (0..1) the performer
 *     rides live.
 *   - familyVariants.ts → re-rolls a sketch's STRUCTURE (palette mode, arrangement,
 *     object kinds, …) and re-mounts, producing a different *version* of the scene.
 *
 * Adapted (not forked) from the windchime per-family pattern: `canonical(seed)`
 * gives a template's signature look; `generate(rng, seed, divergence)` flips each
 * structural axis with probability `divergence` (0 = canonical, 1 = fully random).
 * The resulting config flows to the sketch via `MountContext.config`; `seed` rides
 * along so the sketch can derive any further internal randomness reproducibly.
 */

import type { SeededRng } from '../seededRng.js';

/** A structural config produced by a variant factory (flows via MountContext.config). */
export type VariantConfig = Record<string, unknown>;

export interface VariantFactory {
  /** The template's canonical (signature) structural config for a seed. */
  canonical(seed: number): VariantConfig;
  /** A variant: each axis diverges from canonical with probability `divergence`. */
  generate(rng: SeededRng, seed: number, divergence: number): VariantConfig;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** windchime axis rule: keep the canonical value unless the RNG says to diverge. */
export function varyAxis<T>(
  rng: SeededRng,
  divergence: number,
  canonical: T,
  options: readonly T[],
): T {
  if (divergence <= 0 || options.length === 0) return canonical;
  if (rng.random() >= clamp01(divergence)) return canonical;
  return rng.pick(options);
}

/** A declarative variant axis: the canonical value + the pool a variant may pick. */
export interface VariantAxis<T = unknown> {
  canonical: T;
  options: readonly T[];
}
export type VariantAxes = Record<string, VariantAxis>;

/**
 * Build a VariantFactory from a declarative axis map — the common case, so a
 * template's `.params.ts` just lists its axes. `canonical()` returns every axis
 * at its signature value; `generate()` varies each independently by `divergence`.
 */
export function makeVariantFactory(axes: VariantAxes): VariantFactory {
  const entries = Object.entries(axes);
  return {
    canonical(seed: number): VariantConfig {
      const out: VariantConfig = { seed };
      for (const [k, a] of entries) out[k] = a.canonical;
      return out;
    },
    generate(rng: SeededRng, seed: number, divergence: number): VariantConfig {
      const out: VariantConfig = { seed };
      for (const [k, a] of entries) out[k] = varyAxis(rng, divergence, a.canonical, a.options);
      return out;
    },
  };
}

/**
 * Read a structural axis from a MountContext.config with a typed fallback. Keeps
 * sketch code terse + safe: `cfg(ctx.config, 'palette', 'electric')`.
 */
export function cfg<T>(config: Record<string, unknown>, key: string, fallback: T): T {
  const v = config[key];
  return (v === undefined ? fallback : (v as T));
}
