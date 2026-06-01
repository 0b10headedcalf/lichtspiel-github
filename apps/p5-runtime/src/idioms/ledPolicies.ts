/**
 * LED policies — the pure `(state) → level 0..15` shape functions the idioms
 * render with. Kept pure + side-effect-free so the digital twin's canvas and
 * the real hardware frame draw from EXACTLY the same data (they can never
 * drift), and so the idiom smoke can assert their output with no browser.
 *
 * The numeric aesthetics are lifted verbatim from the hardware-verified
 * sources so the look is preserved as control moves into the idiom layer:
 *   - grid fader bar + arc comet ............ ../ui/monomeFeedback.ts
 *     (perfGridLevel / perfArcLevel / cometAt)
 *   - arc fill / gauge / marker / segments ... windchime-animation
 *     pasArcgridv7 + monomeArc4Shapesv12 ring policies
 *   - arc playhead ........................... windchime monomeArc4Shapesv12
 *     (dim fill + quarter markers + bright playhead)
 *   - step cell + playhead ................... windchime monomeArcgridcombo
 *
 * `monomeFeedback.ts` keeps its own copies (it is hardware-verified and the
 * global Mirror-mode authority); this module is the generalized home the
 * idioms — and, later, code generation — build on.
 */

import { LED_LEVEL_MAX, clamp01, clampLevel } from '@lichtspiel/schemas';

// ── shared geometry ───────────────────────────────────────────────
/** Shortest circular distance between ring LEDs a and b on a ring of n. */
export function circDist(a: number, b: number, n: number): number {
  const d = Math.abs(a - b) % n;
  return Math.min(d, n - d);
}

/** value 0..1 → the "head" LED index (0..ringLeds-1). */
export function headLed(value01: number, ringLeds: number): number {
  return Math.round(clamp01(value01) * (ringLeds - 1));
}

/** value 0..1 → a count of lit LEDs (0..ringLeds), for fill-style arcs. */
export function fillCount(value01: number, ringLeds: number): number {
  return Math.round(clamp01(value01) * ringLeds);
}

/** diagnostic7 comet falloff around `head` (0 elsewhere), ring-size aware. */
export function cometAt(i: number, head: number, ringLeds: number): number {
  const d = circDist(i, head, ringLeds);
  if (d === 0) return 15;
  if (d === 1) return 11;
  if (d === 2) return 7;
  if (d === 3) return 4;
  return 0;
}

// ── grid policies ─────────────────────────────────────────────────

/**
 * Vertical VU fader bar (perfGridLevel policy). A column's value 0..1 maps to a
 * head row near the top (high value = top); the bar fills from that row down.
 * `held` flashes the whole column full while a cell is pressed.
 */
export function faderBarLevel(y: number, rows: number, value01: number, held = false): number {
  if (held) return LED_LEVEL_MAX;
  if (rows <= 1) return value01 > 0 ? LED_LEVEL_MAX : 0;
  const headRow = Math.round((rows - 1) * (1 - clamp01(value01)));
  if (y < headRow) return 0;
  return y === headRow ? 15 : 10; // bright head, mid body
}

/**
 * Step-sequencer cell (monomeArcgridcombo policy): an active step glows mid
 * (11); the playhead column adds +4 so an active step under it reads full and
 * an empty step under it shows a faint playhead trace.
 */
export function stepCellLevel(active: boolean, underPlayhead: boolean): number {
  return clampLevel((active ? 11 : 0) + (underPlayhead ? 4 : 0));
}

/** Per-cell paint mirror (patternGridWorld): the cell IS the level. */
export function cellLevel(level: number): number {
  return clampLevel(level);
}

// ── arc ring policies ─────────────────────────────────────────────
export type ArcLedPolicy = 'fill' | 'comet' | 'gauge' | 'marker' | 'segments' | 'playhead';

/** Solid fill from 12 o'clock up to the value (windchime `fill`). */
export function fillRingLevel(i: number, value01: number, ringLeds: number): number {
  return i < fillCount(value01, ringLeds) ? LED_LEVEL_MAX : 0;
}

/**
 * Filled "amount" arc + every-8th ticks + a glowing comet head (perfArcLevel).
 * Press-boost is applied by the caller (arcMacros) when the encoder is held.
 */
export function cometRingLevel(i: number, value01: number, ringLeds: number): number {
  const head = headLed(value01, ringLeds);
  let level = 0;
  if (i <= head) level = 6; // filled amount arc to the value
  if (i % 8 === 0) level = Math.max(level, 3); // orientation ticks
  level = Math.max(level, cometAt(i, head, ringLeds)); // glowing value head
  return clampLevel(level);
}

/** Symmetric gauge growing outward from 12 o'clock both ways (windchime `gauge`). */
export function gaugeRingLevel(i: number, value01: number, ringLeds: number): number {
  const half = Math.floor(fillCount(value01, ringLeds) / 2);
  return i < half || i >= ringLeds - half ? LED_LEVEL_MAX : 0;
}

/** Bright head + dim opposite marker + faint trail to 0 (windchime `marker`). */
export function markerRingLevel(i: number, value01: number, ringLeds: number): number {
  const head = headLed(value01, ringLeds);
  const opp = (head + Math.floor(ringLeds / 2)) % ringLeds;
  let level = 0;
  if (i < Math.min(head, 8)) level = 3; // trail toward 0
  if (i === opp) level = Math.max(level, 6); // dim opposite marker
  if (i === head) level = LED_LEVEL_MAX; // bright value head
  return clampLevel(level);
}

/** 8-LED segments, each brighter than the last (windchime `segments`). */
export function segmentsRingLevel(i: number, value01: number, ringLeds: number): number {
  const STEP = 8;
  const litSegments = Math.floor(fillCount(value01, ringLeds) / STEP);
  const seg = Math.floor(i / STEP);
  if (seg >= litSegments) return 0;
  if (i % STEP === STEP - 1) return 0; // 1-LED gap between segments
  return clampLevel(Math.min(LED_LEVEL_MAX, 4 + seg * 2));
}

/** Dim background + quarter markers + a bright playhead (windchime arc4 `playhead`). */
export function playheadRingLevel(i: number, value01: number, ringLeds: number): number {
  const head = headLed(value01, ringLeds);
  let level = 2; // dim background fill
  if (i % Math.max(1, Math.floor(ringLeds / 4)) === 0) level = Math.max(level, 8); // quarter markers
  if (i === head) level = LED_LEVEL_MAX; // bright playhead
  return clampLevel(level);
}

/** Dispatch a ring policy by name. */
export function arcRingLevel(
  policy: ArcLedPolicy,
  i: number,
  value01: number,
  ringLeds: number,
): number {
  switch (policy) {
    case 'fill':
      return fillRingLevel(i, value01, ringLeds);
    case 'gauge':
      return gaugeRingLevel(i, value01, ringLeds);
    case 'marker':
      return markerRingLevel(i, value01, ringLeds);
    case 'segments':
      return segmentsRingLevel(i, value01, ringLeds);
    case 'playhead':
      return playheadRingLevel(i, value01, ringLeds);
    case 'comet':
    default:
      return cometRingLevel(i, value01, ringLeds);
  }
}
