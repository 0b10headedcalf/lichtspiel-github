/**
 * Phase 1 / Phase 8 — safe parameter mutation. Produces a new partial param
 * patch that stays within each param's safe range. Used by the `r` keyboard
 * "randomize safe params" action now; the seed-driven form is the basis for
 * the Phase 8 mutation engine (accept/revert/save preset).
 *
 * It never touches `sceneId` and never emits out-of-range values, so the
 * performance runtime can apply the result blindly.
 */

import {
  type NumericParamKey,
  NUMERIC_PARAM_KEYS,
  type VisualParamRanges,
  type VisualParamVector,
  clampToRange,
} from '@lichtspiel/schemas';
import type { SeededRng } from '../seededRng.js';

/** Params we leave alone unless explicitly asked — strobe is demo-unsafe at full. */
const STROBE_CAP = 0.6;

export interface MutationOptions {
  /** 0..1 — how far params may travel from their current value. */
  amount: number;
  /** Restrict mutation to these params; omit for all. */
  keys?: readonly NumericParamKey[];
  /** Per-param safe ranges (from the template); defaults to [0,1]. */
  ranges?: VisualParamRanges;
}

/**
 * Randomize params around their current values by up to `amount`.
 * Returns a patch (partial vector) — apply with mergeParams.
 */
export function mutateParams(
  current: VisualParamVector,
  rng: SeededRng,
  opts: MutationOptions,
): Partial<VisualParamVector> {
  const amount = clamp01(opts.amount);
  const keys = opts.keys ?? NUMERIC_PARAM_KEYS;
  const patch: Partial<VisualParamVector> = {};
  for (const k of keys) {
    const range = opts.ranges?.[k] ?? defaultRange(k);
    const span = range[1] - range[0];
    // symmetric jitter scaled by amount and the param's range
    const jitter = (rng.random() * 2 - 1) * amount * span;
    patch[k] = clampToRange(current[k] + jitter, range);
  }
  return patch;
}

/** Fully reseed params to fresh safe values (the `r` action). */
export function randomizeParams(
  rng: SeededRng,
  opts: { keys?: readonly NumericParamKey[]; ranges?: VisualParamRanges } = {},
): Partial<VisualParamVector> {
  const keys = opts.keys ?? NUMERIC_PARAM_KEYS;
  const patch: Partial<VisualParamVector> = {};
  for (const k of keys) {
    const range = opts.ranges?.[k] ?? defaultRange(k);
    patch[k] = clampToRange(range[0] + rng.random() * (range[1] - range[0]), range);
  }
  return patch;
}

function defaultRange(k: NumericParamKey): [number, number] {
  if (k === 'strobe') return [0, STROBE_CAP];
  return [0, 1];
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
