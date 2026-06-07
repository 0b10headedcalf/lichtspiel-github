/**
 * Demo + test fixtures: the prompt map (loaded from the spec's JSON file via
 * fs, cwd-independent), the scripted MRT2 telemetry timeline, and the scripted
 * monome gesture. Kept as the single source of truth for both the demo and tests.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PromptMapFileSchema, type PromptMapEntry } from '../core/promptMapper.js';
import type { MagentaMetrics } from '../schemas/magenta.js';
import type { ArcDeltaEvent } from '../schemas/lichtspiel.js';

const here = dirname(fileURLToPath(import.meta.url));

export const PROMPT_MAP_PATH = resolve(here, './prompt-map.example.json');
export const PROMPT_MAP: PromptMapEntry[] = PromptMapFileSchema.parse(
  JSON.parse(readFileSync(PROMPT_MAP_PATH, 'utf8')) as unknown,
).scenes;

export const DESERT_RITUAL = 'Desert Ritual';
export const NEON_MARKET = 'Neon Market';

/** Base MRT2 metrics the mock holds; the timeline patches override hot fields. */
export const MRT2_BASE_METRICS: MagentaMetrics = {
  transformerMs: 9,
  totalMs: 14,
  bufferAvailable: 1638,
  bufferCapacity: 2048,
  bufferOccupancy: 0.8,
  droppedFrames: 0,
  underruns: 0,
  rtf: 0.35,
  transportFlags: 0,
  connected: true,
  entropy: 0.5,
};

export interface MetricPatch {
  atMs: number;
  patch: Partial<MagentaMetrics>;
}

/** ~10s of telemetry: steady -> entropy bump -> low-buffer freeze -> brief underrun -> recover. */
export const DEMO_METRICS_TIMELINE: MetricPatch[] = [
  { atMs: 1000, patch: { entropy: 0.72, bufferOccupancy: 0.84, underruns: 0 } },
  { atMs: 4000, patch: { entropy: 0.66, bufferOccupancy: 0.2, underruns: 0 } },
  { atMs: 7000, patch: { entropy: 0.6, bufferOccupancy: 0.5, underruns: 1, droppedFrames: 1 } },
  { atMs: 9000, patch: { entropy: 0.58, bufferOccupancy: 0.7, underruns: 0 } },
];

/** The scripted monome gesture, injected as a raw arc.delta over the mock WS. */
export const DEMO_MONOME_EVENT: ArcDeltaEvent = {
  type: 'arc.delta',
  deviceId: 'arc-mock',
  encoder: 0,
  delta: 16, // /64 ticks -> +0.25 exploration delta (bounded)
};
