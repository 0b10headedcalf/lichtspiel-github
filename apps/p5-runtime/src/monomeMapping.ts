/**
 * Profile-aware monome mapping — the canonical grid64/arc2 idiom from
 * `Lichtspiel_v3` (the idiom master), generalized to the active device:
 *
 *   GRID — each column is a vertical fader. Press a cell → set that column's
 *   param to (rows-1-y)/(rows-1). Columns 0..7 drive an 8-axis param bank
 *   (col 6 = palette, col 7 = strobe — echoing v3's palette + damage columns).
 *   Extra grid-128 columns (8..15) are IGNORED here — the monome never switches
 *   templates; scene/template nav lives on the keyboard + Ableton.
 *
 *   ARC — enc0 turn = semantic distance, enc1 turn = mutation amount
 *   (arc 4 adds enc2 = motion, enc3 = palette). Encoder PRESSES are no-ops in this
 *   fallback (they must never switch the sketch — that was the "encoder click
 *   switched the template" bug).
 *
 * It reads the active MonomeSetup on every event, so swapping grid 64 ↔ 128
 * or arc 2 ↔ 4 (by detection or the emulator switch) adapts with no re-wiring.
 */

import {
  type ArcDeltaEvent,
  type ArcKeyEvent,
  type GridKeyEvent,
  type MonomeSetup,
  type NumericParamKey,
  clamp01,
} from '@lichtspiel/schemas';

/** Grid column → param axis. 8 entries; aligns col6→palette, col7→strobe with v3. */
export const COLUMN_AXES: readonly NumericParamKey[] = [
  'motion',
  'density',
  'turbulence',
  'symmetry',
  'cameraDepth',
  'contrast',
  'palette',
  'strobe',
];

/** Arc encoder → param axis. enc0/1 on an Arc 2; enc2/3 added on an Arc 4. */
export const ARC_AXES: readonly NumericParamKey[] = [
  'semanticDistance',
  'mutationAmount',
  'motion',
  'palette',
];

export interface MonomeHandlers {
  /** Set a param to an absolute 0..1 value (grid fader). */
  setParam(key: NumericParamKey, value: number): void;
  /** Nudge a param by a relative delta (arc turn). */
  nudgeParam(key: NumericParamKey, delta: number): void;
}

export interface MonomeMapping {
  onGrid(e: GridKeyEvent): void;
  onArcDelta(e: ArcDeltaEvent): void;
  onArcKey(e: ArcKeyEvent): void;
}

export function createMonomeMapping(
  getSetup: () => MonomeSetup,
  h: MonomeHandlers,
): MonomeMapping {
  return {
    onGrid(e: GridKeyEvent): void {
      if (e.state !== 1) return; // act on press
      const grid = getSetup().grid;
      const rows = grid?.rows ?? 8;
      if (e.x >= COLUMN_AXES.length) return; // extra grid-128 cols: no-op (no scene-switching)
      const axis = COLUMN_AXES[e.x];
      if (!axis) return;
      const value = rows > 1 ? (rows - 1 - e.y) / (rows - 1) : 1;
      h.setParam(axis, clamp01(value));
    },

    onArcDelta(e: ArcDeltaEvent): void {
      const step = e.delta / 64; // arc rings are 64 LEDs (v3 convention)
      const axis = ARC_AXES[e.encoder];
      if (axis) h.nudgeParam(axis, step);
    },

    onArcKey(): void {
      // Encoder presses do NOT switch templates in the fallback mapping — scene/
      // template nav is keyboard + Ableton only (this was the "encoder click
      // switched the sketch" bug). Legacy templates simply ignore arc presses.
    },
  };
}
