/**
 * VisualTemplate *metadata* — the p5-free, serializable description of a
 * template. The full runtime interface (with setup/update/draw and a live
 * p5 instance) lives in apps/p5-runtime, which extends VisualTemplateMeta.
 *
 * Keeping the metadata here lets the bridge + ml-service reason about the
 * template catalog (for retrieval/descriptors) without importing p5.
 *
 * Mirrors VisualTemplate.schema.json.
 */

import type { VisualParamRanges, VisualParamVector } from './visualParams.js';

/** Which p5 renderer the template's canvas uses. */
export type TemplateRenderer = 'p2d' | 'webgl';

/**
 * The monome combo a template was authored for. Advisory only — every template
 * still adapts to whatever is connected (via the idiom layer) — but it records
 * the bespoke hardware a sketch was designed around (e.g. the Opus III hero on a
 * Grid 64 / Arc 2) so UIs can surface "native on …" and retrieval can prefer it.
 */
export interface HardwareTarget {
  grid?: '64' | '128' | 'any';
  arc?: '2' | '4' | 'any';
}

export interface VisualTemplateMeta {
  id: string;
  name: string;
  /** Family groups related templates (e.g. all tunnel variants). */
  family: string;
  description: string;
  tags: string[];
  /** Param overrides applied on top of DEFAULT_PARAMS when this scene loads. */
  defaultParams: Partial<VisualParamVector>;
  /** Optional per-param safe ranges; params outside these are never sent in performance mode. */
  safeParamRanges?: VisualParamRanges;
  renderer?: TemplateRenderer;
  /** Provenance: the Processing/Windchime source this was adapted from, if any. */
  sourceLineage?: string;
  /** The monome combo this template was authored for (advisory; it adapts to any). */
  hardwareTarget?: HardwareTarget;
  /** Names of the monome idiom(s) this template drives (faderBank, stepSequencer, …). */
  idioms?: string[];
}

/** A descriptor entry used by metadata retrieval (Phase 5). */
export interface TemplateDescriptor {
  sceneId: string;
  /** Free-text tags/keywords matched against clip/track/scene names. */
  keywords: string[];
  /** Coarse musical affinities, each 0..1 (e.g. percussive, harmonic, dense). */
  affinities: Record<string, number>;
  /** Suggested default params when this descriptor is the best match. */
  params: Partial<VisualParamVector>;
}
