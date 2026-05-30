/**
 * Monome LED feedback — the controller's self-feedback, faithful to the
 * `Lichtspiel_v3` idiom + the `monome_grid64_arc2_diagnostic7` capability
 * sweeps, generalized to whichever device is connected (grid 64/128, arc 2/4).
 *
 * Two roles, both expressed as pure `(state) → level 0..15` functions so the
 * digital twin's canvas and the real hardware frame render from EXACTLY the
 * same data (they can never drift):
 *
 *  1. PERFORMANCE (Mirror mode) — mirrors what's happening on the instrument:
 *     - grid columns are vertical VU fader bars showing the live param each
 *       column drives (COLUMN_AXES), lit from the value-row down (top = high,
 *       matching the press→value mapping); a held cell flashes; on a grid 128
 *       the extra columns are scene-select buttons with the active scene lit.
 *     - arc rings show each mapped param (ARC_AXES) as a filled "amount" arc
 *       with a glowing comet head + every-8th orientation ticks + a press
 *       boost — the diagnostic7 `updateArcRing` aesthetic, driven by value.
 *
 *  2. DIAGNOSTIC SWEEPS — a sequential ('normal') and a parallel ('fast')
 *     sweep that exercise every LED capability, adapted from diagnostic7 and
 *     sized to the active device. They loop until stopped.
 */

import {
  type VisualParamVector,
  ARC_RING_LEDS,
  LED_LEVEL_MAX,
  clamp01,
  clampLevel,
} from '@lichtspiel/schemas';
import { ARC_AXES, COLUMN_AXES } from '../monomeMapping.js';

export type SweepKind = 'normal' | 'fast';

/** Live state the performance feedback renders from. */
export interface PerfState {
  params: VisualParamVector;
  sceneIndex: number;
  sceneCount: number;
  held: boolean[][]; // [rows][cols] momentary grid press state
  arcHeld: boolean[]; // [encoder] momentary encoder press state
}

// ── shared helpers ────────────────────────────────────────────────
function circDist(a: number, b: number, n: number): number {
  const d = Math.abs(a - b) % n;
  return Math.min(d, n - d);
}

/** diagnostic7 comet falloff around a head LED (0 elsewhere). */
function cometAt(i: number, head: number): number {
  const d = circDist(i, head, ARC_RING_LEDS);
  if (d === 0) return 15;
  if (d === 1) return 11;
  if (d === 2) return 7;
  if (d === 3) return 4;
  return 0;
}

// ── performance (Mirror-mode) feedback ────────────────────────────

/** PERF_GRID_INTENSITY: performance mode runs the grid at full global brightness. */
export const PERF_GRID_INTENSITY = LED_LEVEL_MAX;

export function perfGridLevel(x: number, y: number, rows: number, st: PerfState): number {
  if (st.held[y]?.[x]) return LED_LEVEL_MAX; // a pressed cell flashes full
  if (x < COLUMN_AXES.length) {
    const axis = COLUMN_AXES[x];
    if (!axis) return 0;
    const v = clamp01(st.params[axis] ?? 0);
    // Press row y → value (rows-1-y)/(rows-1): top = high. The bar fills from
    // the value's row down to the bottom (LEDs "fill below the chosen row").
    const headRow = Math.round((rows - 1) * (1 - v));
    if (y < headRow) return 0;
    return y === headRow ? 15 : 10; // bright head, mid body
  }
  // grid-128 extra columns → scene-select buttons (one column per scene)
  const scene = x - COLUMN_AXES.length;
  if (scene < 0 || scene >= st.sceneCount) return 0;
  if (scene === st.sceneIndex) return y === 0 ? 15 : 10; // active scene column lit
  return y === 0 ? 3 : 0; // available-scene marker
}

export function perfArcLevel(e: number, i: number, encoders: number, st: PerfState): number {
  if (e >= encoders) return 0;
  const axis = ARC_AXES[e];
  if (!axis) return 0;
  const v = clamp01(st.params[axis] ?? 0);
  const head = Math.round(v * (ARC_RING_LEDS - 1));
  let level = 0;
  if (i <= head) level = 6; // filled "amount" arc from the top to the value
  if (i % 8 === 0) level = Math.max(level, 3); // orientation ticks
  level = Math.max(level, cometAt(i, head)); // glowing value head
  if (st.arcHeld[e]) level = Math.max(level, 10); // press boost
  return clampLevel(level);
}

/**
 * Standalone global-dimmer breath 0→15→0 (the "Intensity" test). On a monobright
 * grid this is the ONLY brightness control, so the whole grid fades up and down.
 */
export function breathIntensity(elapsedMs: number): number {
  const periodMs = 2400;
  const t = (elapsedMs % periodMs) / periodMs; // 0..1
  const tri = t < 0.5 ? t * 2 : (1 - t) * 2; // 0..1..0 triangle
  return Math.round(tri * LED_LEVEL_MAX);
}

// ── diagnostic sweeps ─────────────────────────────────────────────
const NORMAL_STEP_MS = 70;
const FAST_STEP_MS = 42;

interface Stage {
  id: string;
  steps: number;
}

const GRID_STAGE_IDS = new Set(['binary', 'varibright', 'intensity', 'row', 'col', 'map']);

function gridStages(rows: number, cols: number): Stage[] {
  return [
    { id: 'binary', steps: 12 },
    { id: 'varibright', steps: 12 },
    { id: 'intensity', steps: 32 }, // 0..15..0 global dimmer
    { id: 'row', steps: Math.max(1, rows) },
    { id: 'col', steps: Math.max(1, cols) },
    { id: 'map', steps: 12 },
  ];
}

function arcStages(): Stage[] {
  return [
    { id: 'gradient', steps: 12 },
    { id: 'brightness', steps: 32 }, // 0..15..0 all-ring
    { id: 'ticks', steps: 12 },
    { id: 'range', steps: 12 },
    { id: 'pulse', steps: 8 },
    { id: 'spin', steps: ARC_RING_LEDS },
  ];
}

function totalSteps(stages: Stage[]): number {
  return stages.reduce((s, st) => s + st.steps, 0);
}

/** Which stage is active at globalStep, looped, with its local step index. */
function locate(stages: Stage[], globalStep: number): { id: string; local: number } {
  const total = totalSteps(stages);
  let g = ((globalStep % total) + total) % total;
  for (const st of stages) {
    if (g < st.steps) return { id: st.id, local: g };
    g -= st.steps;
  }
  const last = stages[stages.length - 1];
  return { id: last?.id ?? 'binary', local: 0 };
}

function stepMs(kind: SweepKind): number {
  return kind === 'fast' ? FAST_STEP_MS : NORMAL_STEP_MS;
}

/** The active (stageId, local) for the grid, given the sweep kind + elapsed. */
function gridActive(kind: SweepKind, elapsedMs: number, rows: number, cols: number): { id: string; local: number } {
  const step = Math.floor(elapsedMs / stepMs(kind));
  // fast: grid runs its own track in parallel; normal: grid stages then arc.
  const stages = kind === 'fast' ? gridStages(rows, cols) : [...gridStages(rows, cols), ...arcStages()];
  return locate(stages, step);
}

/** The active (stageId, local) for the arc, given the sweep kind + elapsed. */
function arcActive(kind: SweepKind, elapsedMs: number, rows: number, cols: number): { id: string; local: number } {
  const step = Math.floor(elapsedMs / stepMs(kind));
  const stages = kind === 'fast' ? arcStages() : [...gridStages(rows, cols), ...arcStages()];
  return locate(stages, step);
}

function gridStagePattern(id: string, local: number, x: number, y: number, rows: number, cols: number): number {
  switch (id) {
    case 'binary':
      return (x + y) % 2 === 0 ? 15 : 0;
    case 'varibright':
      return clampLevel(x * 2 + y); // diagonal ramp
    case 'intensity':
      return 15; // all on; brightness varies via gridIntensity (see below)
    case 'row':
      return y === local % Math.max(1, rows) ? 15 : 0;
    case 'col':
      return x === local % Math.max(1, cols) ? 15 : 0;
    case 'map':
      return x === y ? 15 : 0; // diagonal
    default:
      return 0; // an arc stage is active → grid is dark
  }
}

function arcStagePattern(id: string, local: number, e: number, i: number): number {
  switch (id) {
    case 'gradient':
      return i % 16;
    case 'brightness':
      return local <= 15 ? local : Math.max(0, 31 - local);
    case 'ticks': {
      if (i % 8 === 0) return Math.floor(i / 8) % 2 === 0 ? 15 : 8;
      if (i % 8 === 1 || i % 8 === 7) return 4;
      return 0;
    }
    case 'range':
      return i < 16 ? 3 : i < 32 ? 7 : i < 48 ? 11 : 15;
    case 'pulse':
      return local % 2 === 0 ? 15 : 0;
    case 'spin': {
      const head = (local + e * 16) % ARC_RING_LEDS;
      let lv = cometAt(i, head);
      if (i % 8 === 0) lv = Math.max(lv, 4);
      return lv;
    }
    default:
      return 0; // a grid stage is active → arc is dark
  }
}

export function sweepGridLevel(
  kind: SweepKind,
  elapsedMs: number,
  x: number,
  y: number,
  rows: number,
  cols: number,
): number {
  const { id, local } = gridActive(kind, elapsedMs, rows, cols);
  if (!GRID_STAGE_IDS.has(id)) return 0; // arc stage active in a normal sweep
  return gridStagePattern(id, local, x, y, rows, cols);
}

export function sweepGridIntensity(kind: SweepKind, elapsedMs: number, rows: number, cols: number): number {
  const { id, local } = gridActive(kind, elapsedMs, rows, cols);
  if (id !== 'intensity') return LED_LEVEL_MAX;
  return local <= 15 ? local : Math.max(0, 31 - local); // 0..15..0
}

export function sweepArcLevel(
  kind: SweepKind,
  elapsedMs: number,
  e: number,
  i: number,
  rows: number,
  cols: number,
  encoders: number,
): number {
  if (e >= encoders) return 0;
  const { id, local } = arcActive(kind, elapsedMs, rows, cols);
  if (GRID_STAGE_IDS.has(id)) return 0; // grid stage active in a normal sweep
  return arcStagePattern(id, local, e, i);
}

/** Human-readable label of the currently-running sweep stage (for the dashboard). */
export function sweepStageLabel(kind: SweepKind, elapsedMs: number, rows: number, cols: number): string {
  if (kind === 'fast') {
    const g = gridActive(kind, elapsedMs, rows, cols);
    const a = arcActive(kind, elapsedMs, rows, cols);
    return `grid:${g.id} ∥ arc:${a.id}`;
  }
  return gridActive(kind, elapsedMs, rows, cols).id;
}
