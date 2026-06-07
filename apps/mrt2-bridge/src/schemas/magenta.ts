/**
 * Magenta RealTime 2 contracts — grounded in the real MRT2 API
 * (RealtimeRunner / MLXEngine / EngineMetrics; see docs/mrt2-integration.md).
 *
 * Control IN: prompt blend (text+weight, <=6 slots) and generation params.
 * Telemetry OUT: the real EngineMetrics fields. NOTE: real MRT2 emits no
 * `entropy` — it is optional here, synthesized by the mock / derived by the
 * real adapter, so the spec's "entropy -> visual mutation" rule still works.
 */
import { z } from 'zod';
import { PromptSlotSchema, unit } from './semantic.js';

/** MRT2 `kMaxPrompts`. */
export const MRT2_MAX_PROMPTS = 6 as const;

export const MagentaMetricsSchema = z.object({
  transformerMs: z.number().min(0), // GPU inference time per frame
  totalMs: z.number().min(0), // end-to-end wall time per frame
  bufferAvailable: z.number().min(0), // samples currently in the ring buffer
  bufferCapacity: z.number().positive(), // ring capacity (samples)
  bufferOccupancy: unit, // bufferAvailable / bufferCapacity, clamped
  droppedFrames: z.number().int().min(0), // cumulative real-time underruns
  underruns: z.number().int().min(0), // delta dropped frames since last sample
  rtf: z.number().min(0), // real-time factor = totalMs / frameBudgetMs (40ms @ 25Hz)
  transportFlags: z.number().int(), // DAW transport state (-1 uninit, ...)
  connected: z.boolean(),
  entropy: unit.optional(), // synthesized/derived — see header
});
export type MagentaMetrics = z.infer<typeof MagentaMetricsSchema>;

export const MagentaPromptUpdateSchema = z.object({
  promptBlend: z.array(PromptSlotSchema).max(MRT2_MAX_PROMPTS),
  applyAt: z.enum(['immediate', 'next_bar']),
});
export type MagentaPromptUpdate = z.infer<typeof MagentaPromptUpdateSchema>;

/** Real-time generation knobs (maps onto the RealtimeRunner atomic setters). */
export const MagentaParamsSchema = z.object({
  temperature: z.number().optional(),
  topK: z.number().int().optional(),
  cfgMusiccoca: z.number().optional(),
  cfgNotes: z.number().optional(),
  cfgDrums: z.number().optional(),
  unmaskWidth: z.number().int().optional(),
  drumless: z.boolean().optional(),
});
export type MagentaParams = z.infer<typeof MagentaParamsSchema>;

export const MagentaTransportSchema = z.object({
  bar: z.number(),
  beat: z.number(),
  bpm: z.number().positive(),
  playing: z.boolean(),
});
export type MagentaTransport = z.infer<typeof MagentaTransportSchema>;

export const MagentaStateSchema = z.object({
  ready: z.boolean(),
  model: z.string(),
  promptBlend: z.array(PromptSlotSchema),
});
export type MagentaState = z.infer<typeof MagentaStateSchema>;

/** Derived audio features (computed in the sidecar; raw audio never crosses JSON). */
export const AudioFeaturesSchema = z.object({
  rms: unit,
  spectralCentroid: unit,
  onsetRate: unit,
});
export type AudioFeatures = z.infer<typeof AudioFeaturesSchema>;
