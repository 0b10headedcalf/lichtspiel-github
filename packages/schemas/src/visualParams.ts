/**
 * VisualParamVector — the stable, normalized control surface every p5
 * template understands. All numeric params are 0..1 unless documented
 * otherwise. `sceneId` names the template the vector targets.
 *
 * This is the single runtime source of truth; VisualParamVector.schema.json
 * mirrors it for JSON validation at the bridge boundary.
 */

export interface VisualParamVector {
  sceneId: string;
  density: number;
  motion: number;
  turbulence: number;
  symmetry: number;
  strobe: number;
  cameraDepth: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  palette: number;
  contrast: number;
  lineWeight: number;
  feedback: number;
  mutationAmount: number;
  semanticDistance: number;
}

export const NUMERIC_PARAM_KEYS = [
  'density',
  'motion',
  'turbulence',
  'symmetry',
  'strobe',
  'cameraDepth',
  'rotationX',
  'rotationY',
  'rotationZ',
  'palette',
  'contrast',
  'lineWeight',
  'feedback',
  'mutationAmount',
  'semanticDistance',
] as const;

export type NumericParamKey = (typeof NUMERIC_PARAM_KEYS)[number];

export const DEFAULT_PARAMS: VisualParamVector = Object.freeze({
  sceneId: 'minimalPulse',
  density: 0.5,
  motion: 0.5,
  turbulence: 0.5,
  symmetry: 0.5,
  strobe: 0.0,
  cameraDepth: 0.5,
  rotationX: 0.5,
  rotationY: 0.5,
  rotationZ: 0.5,
  palette: 0.5,
  contrast: 0.5,
  lineWeight: 0.5,
  feedback: 0.0,
  mutationAmount: 0.0,
  semanticDistance: 0.0,
});

/** Per-param safe ranges a template may declare; defaults to [0,1]. */
export type VisualParamRanges = Partial<Record<NumericParamKey, [number, number]>>;

export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Return a new vector with every numeric param clamped to 0..1. */
export function clampParams(p: VisualParamVector): VisualParamVector {
  const out = { ...p };
  for (const k of NUMERIC_PARAM_KEYS) out[k] = clamp01(p[k]);
  return out;
}

/** Merge a partial patch over a base vector (patch wins where present). */
export function mergeParams(
  base: VisualParamVector,
  patch: Partial<VisualParamVector>,
): VisualParamVector {
  const out: VisualParamVector = { ...base };
  if (patch.sceneId !== undefined) out.sceneId = patch.sceneId;
  for (const k of NUMERIC_PARAM_KEYS) {
    const v = patch[k];
    if (v !== undefined) out[k] = clamp01(v);
  }
  return out;
}

/**
 * Per-frame interpolation toward a target. Numeric params lerp by `t`;
 * `sceneId` snaps to the target (scene changes are discrete). Used by the
 * runtime's param smoother so monome/Live moves feel continuous.
 */
export function lerpParams(
  current: VisualParamVector,
  target: VisualParamVector,
  t: number,
): VisualParamVector {
  const out: VisualParamVector = { ...current, sceneId: target.sceneId };
  for (const k of NUMERIC_PARAM_KEYS) out[k] = lerp(current[k], target[k], t);
  return out;
}

/** Clamp a value into an optional [min,max] safe range (defaults to 0..1). */
export function clampToRange(value: number, range?: [number, number]): number {
  const [lo, hi] = range ?? [0, 1];
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}
