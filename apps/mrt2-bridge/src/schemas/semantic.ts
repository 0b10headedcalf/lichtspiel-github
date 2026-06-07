/**
 * The shared semantic model — the heart of the bridge. ONE normalized state
 * drives BOTH audio (MRT2 prompts) and visuals (Lichtspiel). All numerics are
 * normalized to [0,1]; the visual param vector is always length 16.
 */
import { z } from 'zod';

/** A value constrained to [0,1]. */
export const unit = z.number().min(0).max(1);

/** Mirror of Lichtspiel's clamp semantics: NaN -> 0, then clamp to [0,1]. */
export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export const PromptSlotSchema = z.object({
  promptId: z.string().optional(),
  text: z.string(),
  weight: unit,
});
export type PromptSlot = z.infer<typeof PromptSlotSchema>;

export const SEMANTIC_VECTOR_LENGTH = 16 as const;

export const SemanticStateSchema = z.object({
  semanticPosition: z.object({ x: unit, y: unit, z: unit }),
  energy: unit,
  density: unit,
  mutation: unit,
  certainty: unit,
  exploration: unit,
  visualCluster: z.string(),
  promptBlend: z.array(PromptSlotSchema),
  visualParamVector: z.array(unit).length(SEMANTIC_VECTOR_LENGTH),
});
export type SemanticState = z.infer<typeof SemanticStateSchema>;

/**
 * Deterministic fallback state (also what SafetyController.emergencyBypass emits).
 * The 16-float vector mirrors Lichtspiel's DEFAULT_PARAMS ordering; index 15 is
 * the bridge-internal `energyReserve`.
 */
export const DEFAULT_SEMANTIC_STATE: SemanticState = Object.freeze({
  semanticPosition: { x: 0.5, y: 0.5, z: 0.5 },
  energy: 0.5,
  density: 0.5,
  mutation: 0.0,
  certainty: 1.0,
  exploration: 0.0,
  visualCluster: 'neutral',
  promptBlend: [{ promptId: 'neutral', text: 'neutral ambient', weight: 1.0 }],
  // density,motion,turbulence,symmetry,strobe,cameraDepth,rotX,rotY,rotZ,
  // palette,contrast,lineWeight,feedback,mutationAmount,semanticDistance,energyReserve
  visualParamVector: [0.5, 0.5, 0.5, 0.5, 0.0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, 0.5],
}) as SemanticState;

/** Fresh deep copy of the default (DEFAULT_SEMANTIC_STATE is frozen/shared). */
export function defaultSemanticState(): SemanticState {
  return structuredClone(DEFAULT_SEMANTIC_STATE);
}

/** A normalized monome gesture (already bounded by the adapter). */
export const NormalizedGestureSchema = z.object({
  source: z.enum(['grid', 'arc']),
  /** Grid press -> a target point in semantic space [0,1]. */
  targetX: unit.optional(),
  targetY: unit.optional(),
  /** Arc encoder deltas, normalized to [-1,1]. */
  explorationDelta: z.number().min(-1).max(1).optional(),
  blendDelta: z.number().min(-1).max(1).optional(),
  /** Human-readable label for the demo trace, e.g. "arc enc0 +0.10". */
  label: z.string(),
});
export type NormalizedGesture = z.infer<typeof NormalizedGestureSchema>;
