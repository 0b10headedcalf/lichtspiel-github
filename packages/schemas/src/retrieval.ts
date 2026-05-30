/**
 * Retrieval + mutation contracts. The ML/retrieval layer must NEVER emit
 * raw code at performance time — only a scene id, a parameter vector, ranked
 * alternatives, and a human-readable reason. Mirrors MutationRequest.schema.json.
 */

import type { VisualParamVector } from './visualParams.js';

export interface VisualRetrievalAlternative {
  sceneId: string;
  distance: number;
}

export interface VisualRetrievalResult {
  type: 'visual_retrieval_result';
  version: string;
  sceneId: string;
  /** 0..1 — how confident the retrieval is in the top scene. */
  confidence: number;
  /** 0..1 — semantic distance of the chosen scene (lower = closer match). */
  distance: number;
  /** Human-readable explanation, surfaced in the M4L device + logs. */
  reason: string;
  params: Partial<VisualParamVector>;
  alternatives: VisualRetrievalAlternative[];
}

export const RETRIEVAL_VERSION = '0.1.0';

/** Axes a mutation may touch (Phase 8). */
export type MutationAxis =
  | 'palette'
  | 'geometry'
  | 'motion'
  | 'camera'
  | 'texture'
  | 'feedback';

export interface MutationRequest {
  type: 'mutation_request';
  version: string;
  /** Optional scene to mutate; defaults to the current scene. */
  sceneId?: string;
  /** 0..1 — how far the mutation should travel within safe ranges. */
  amount: number;
  /** Restrict the mutation to these axes; omit for "all safe params". */
  axes?: MutationAxis[];
  /** Deterministic seed so a mutation can be reproduced/saved. */
  seed?: number;
}
