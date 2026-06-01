/**
 * faderBank — grid columns as vertical faders. Generalizes the Lichtspiel
 * column-fader (`monomeMapping.ts` COLUMN_AXES) + windchime's per-panel fader
 * grids (pasArcgridv7 / upfAvTestv14). Each lane is one fader; on a wider grid
 * the lanes spread into multi-column panels so a Grid 128 reads as cleanly as a
 * Grid 64 ("columns vs panels"). Pure control/LED — owns no arc, draws nothing.
 *
 * Modes per lane:
 *   continuous — press a row → analog value (top = 1, bottom = 0); LED = bar.
 *   select     — press a row → that row is the chosen option; LED = single cell.
 *   toggle     — press anywhere → advance through `steps` discrete levels; LED = bar.
 *
 * `values()` returns a name→0..1 map a sketch folds into its params.
 */

import { type GridKeyEvent, type LedFrame, clamp01 } from '@lichtspiel/schemas';
import type { Idiom, IdiomProfile } from './types.js';
import { EMPTY_PROFILE } from './types.js';
import { faderBarLevel } from './ledPolicies.js';

export type FaderMode = 'continuous' | 'select' | 'toggle';

export interface FaderLane {
  name: string;
  mode?: FaderMode;
  /** initial normalized value 0..1 (default 0.5). */
  initial?: number;
  /** number of discrete levels for 'toggle' (default 2 = off/on). */
  steps?: number;
}

export interface FaderBankOptions {
  lanes: FaderLane[];
  /** spread lanes into panels across the full grid width (default true). */
  spread?: boolean;
}

export type FaderValues = Record<string, number>;

export interface FaderBank extends Idiom<FaderValues> {
  /** Programmatically set a lane's value (e.g. seed from params at mount). */
  set(name: string, value01: number): void;
}

interface LaneState {
  name: string;
  mode: FaderMode;
  steps: number;
  value: number; // canonical normalized 0..1 for every mode
  step: number; // discrete index for 'toggle'
}

export function createFaderBank(opts: FaderBankOptions): FaderBank {
  const spread = opts.spread ?? true;
  let profile: IdiomProfile = EMPTY_PROFILE;
  const lanes: LaneState[] = opts.lanes.map((l) => ({
    name: l.name,
    mode: l.mode ?? 'continuous',
    steps: Math.max(2, l.steps ?? 2),
    value: clamp01(l.initial ?? 0.5),
    step: 0,
  }));
  const held = new Set<number>(); // lane indices currently pressed

  /** Columns per lane for a given grid width (1 on a tight fit, wider when spread). */
  const widthFor = (cols: number): number =>
    spread ? Math.max(1, Math.floor(cols / Math.max(1, lanes.length))) : 1;
  /** Columns the bank occupies: the whole grid when spread, else one per lane. */
  const occupiedCols = (cols: number): number => (spread ? cols : Math.min(cols, lanes.length));
  /** Lane under column x, or -1 if x is outside the bank (free for other use). */
  const laneAt = (x: number, cols: number): number => {
    if (x < 0 || x >= occupiedCols(cols)) return -1;
    return Math.min(lanes.length - 1, Math.floor(x / widthFor(cols)));
  };

  const apply = (lane: LaneState, y: number): void => {
    const rows = profile.rows;
    const top = rows > 1 ? (rows - 1 - y) / (rows - 1) : 1; // top row = high
    if (lane.mode === 'toggle') {
      lane.step = (lane.step + 1) % lane.steps;
      lane.value = lane.steps > 1 ? lane.step / (lane.steps - 1) : lane.step ? 1 : 0;
    } else {
      lane.value = clamp01(top); // continuous + select both read the pressed row
    }
  };

  return {
    name: 'faderBank',

    onGridKey(e: GridKeyEvent): void {
      if (profile.cols <= 0 || e.x < 0 || e.x >= profile.cols) return;
      const idx = laneAt(e.x, profile.cols);
      if (idx < 0) return; // outside the bank (e.g. a Grid 128's scene-select columns)
      const lane = lanes[idx];
      if (!lane) return;
      if (e.state === 1) {
        apply(lane, e.y);
        held.add(idx);
      } else {
        held.delete(idx);
      }
    },

    renderGrid(frame: LedFrame, p: IdiomProfile): void {
      const { rows, cols } = p;
      for (let y = 0; y < rows; y++) {
        const row = frame.grid[y];
        if (!row) continue;
        for (let x = 0; x < cols; x++) {
          const idx = laneAt(x, cols);
          const lane = idx >= 0 ? lanes[idx] : undefined;
          if (!lane) {
            row[x] = 0; // outside the bank (scene-select columns, etc.)
            continue;
          }
          if (lane.mode === 'select') {
            const selRow = Math.round((rows - 1) * (1 - lane.value));
            row[x] = y === selRow ? 15 : held.has(idx) ? 4 : 0;
          } else {
            row[x] = faderBarLevel(y, rows, lane.value, held.has(idx));
          }
        }
      }
      frame.gridDirty = true;
    },

    renderArc(): void {
      /* faderBank owns no arc */
    },

    values(): FaderValues {
      const out: FaderValues = {};
      for (const l of lanes) out[l.name] = l.value;
      return out;
    },

    set(name: string, value01: number): void {
      const lane = lanes.find((l) => l.name === name);
      if (!lane) return;
      lane.value = clamp01(value01);
      if (lane.mode === 'toggle') lane.step = Math.round(lane.value * (lane.steps - 1));
    },

    setProfile(p: IdiomProfile): void {
      profile = p;
    },

    reset(): void {
      held.clear();
      for (let i = 0; i < lanes.length; i++) {
        const src = opts.lanes[i];
        const lane = lanes[i];
        if (!lane || !src) continue;
        lane.value = clamp01(src.initial ?? 0.5);
        lane.step = 0;
      }
    },
  };
}
