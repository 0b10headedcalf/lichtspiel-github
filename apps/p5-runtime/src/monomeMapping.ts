/**
 * Profile-aware monome mapping — the canonical grid64/arc2 idiom from
 * `Lichtspiel_v3` (the idiom master), generalized to the active device:
 *
 *   GRID — each column is a vertical fader. Press a cell → set that column's
 *   param to (rows-1-y)/(rows-1). Columns 0..7 drive an 8-axis param bank
 *   (col 6 = palette, col 7 = strobe — echoing v3's palette + damage columns).
 *   On a grid 128 the extra columns (8..15) become scene-select buttons.
 *
 *   ARC — enc0 turn = semantic distance, enc1 turn = mutation amount
 *   (arc 4 adds enc2 = motion, enc3 = palette). enc0 press = surprise,
 *   enc1 press = next scene (mirrors v3's "advance + burst").
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

export interface MonomeHandlers {
  /** Set a param to an absolute 0..1 value (grid fader). */
  setParam(key: NumericParamKey, value: number): void;
  /** Nudge a param by a relative delta (arc turn). */
  nudgeParam(key: NumericParamKey, delta: number): void;
  /** Select a template by registry index (extra grid columns). */
  selectSceneIndex(index: number): void;
  nextScene(): void;
  surprise(): void;
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
      if (e.x < COLUMN_AXES.length) {
        const axis = COLUMN_AXES[e.x];
        if (!axis) return;
        const value = rows > 1 ? (rows - 1 - e.y) / (rows - 1) : 1;
        h.setParam(axis, clamp01(value));
      } else {
        // grid 128 extra columns → scene buttons (one column per scene)
        h.selectSceneIndex(e.x - COLUMN_AXES.length);
      }
    },

    onArcDelta(e: ArcDeltaEvent): void {
      const step = e.delta / 64; // arc rings are 64 LEDs (v3 convention)
      switch (e.encoder) {
        case 0:
          h.nudgeParam('semanticDistance', step);
          break;
        case 1:
          h.nudgeParam('mutationAmount', step);
          break;
        case 2:
          h.nudgeParam('motion', step);
          break;
        case 3:
          h.nudgeParam('palette', step);
          break;
        default:
          break;
      }
    },

    onArcKey(e: ArcKeyEvent): void {
      if (e.state !== 1) return;
      if (e.encoder === 0) h.surprise();
      else if (e.encoder === 1) h.nextScene();
    },
  };
}
