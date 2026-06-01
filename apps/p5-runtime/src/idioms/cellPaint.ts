/**
 * cellPaint — every grid cell is an independent brightness well. A press cycles
 * that cell up one level (wrapping at the top) and freezes it; un-pressed cells
 * may idly flicker. Generalizes the windchime `patternGridWorld` grid idiom,
 * whose LED frame is a direct 1:1 mirror of the per-cell brightness grid.
 *
 * Width/height adaptation: the cell grid reshapes to the active profile,
 * preserving the overlapping top-left region on a hot-swap, so a Grid 128's
 * 8×16 painting clamps cleanly to a Grid 64's 8×8 ("clean dims clamp").
 *
 * Flicker is deterministic through an injected RNG (default Math.random), so the
 * idioms smoke can keep it off and assert the press-cycle exactly. The host
 * drives flicker via `tick(dtMs)`. Pure control/LED — owns no arc, draws nothing.
 *
 * Provenance: windchime patternGridWorldV11 (index.ts gridLed cycle + flicker),
 *   ledPolicies.cellLevel.
 */

import { type GridKeyEvent, type LedFrame, clamp01 } from '@lichtspiel/schemas';
import type { Idiom, IdiomControlMap, IdiomProfile } from './types.js';
import { EMPTY_PROFILE } from './types.js';
import { cellLevel } from './ledPolicies.js';

export interface CellPaintOptions {
  /** brightness levels to cycle through on press (default 16 → 0..15). */
  levels?: number;
  /** idle flicker on un-pressed cells (default false). */
  flicker?: boolean;
  /** ms between flicker updates (default 120). */
  flickerMs?: number;
  /** fraction of idle cells re-rolled each flicker update, 0..1 (default 0.5). */
  flickerDensity?: number;
  /** deterministic RNG in [0,1) for flicker (default Math.random). */
  rng?: () => number;
}

export interface CellValues {
  /** [rows][cols] normalized brightness 0..1 (live reference — read, don't mutate). */
  cells: number[][];
  /** mean normalized brightness over the active region. */
  mean: number;
}

export interface CellPaint extends Idiom<CellValues> {
  /** Advance idle flicker by `dtMs` (no-op unless flicker is enabled). */
  tick(dtMs: number): void;
}

export function createCellPaint(opts: CellPaintOptions = {}): CellPaint {
  const levels = Math.max(2, opts.levels ?? 16);
  const flicker = opts.flicker ?? false;
  const flickerMs = Math.max(1, opts.flickerMs ?? 120);
  const flickerDensity = clamp01(opts.flickerDensity ?? 0.5);
  const rng = opts.rng ?? Math.random;

  let profile: IdiomProfile = EMPTY_PROFILE;
  let cell: number[][] = [[0]]; // per-cell step 0..levels-1
  let frozen: boolean[][] = [[false]];
  let acc = 0;

  const reshape = (): void => {
    const rows = Math.max(1, profile.rows);
    const cols = Math.max(1, profile.cols);
    cell = Array.from({ length: rows }, (_, y) =>
      Array.from({ length: cols }, (_, x) => cell[y]?.[x] ?? 0),
    );
    frozen = Array.from({ length: rows }, (_, y) =>
      Array.from({ length: cols }, (_, x) => frozen[y]?.[x] ?? false),
    );
  };

  const norm = (step: number): number => (levels > 1 ? step / (levels - 1) : step ? 1 : 0);

  return {
    name: 'cellPaint',

    onGridKey(e: GridKeyEvent): void {
      if (e.state !== 1) return; // act on press
      if (e.y < 0 || e.y >= profile.rows || e.x < 0 || e.x >= profile.cols) return;
      const row = cell[e.y];
      const fr = frozen[e.y];
      if (!row || !fr) return;
      row[e.x] = ((row[e.x] ?? 0) + 1) % levels;
      fr[e.x] = true; // a touched cell stops flickering
    },

    tick(dtMs: number): void {
      if (!flicker) return;
      acc += dtMs;
      if (acc < flickerMs) return;
      acc = 0;
      for (let y = 0; y < profile.rows; y++) {
        const row = cell[y];
        const fr = frozen[y];
        if (!row || !fr) continue;
        for (let x = 0; x < profile.cols; x++) {
          if (fr[x]) continue;
          if (rng() < flickerDensity) row[x] = Math.floor(rng() * levels);
        }
      }
    },

    renderGrid(frame: LedFrame, p: IdiomProfile): void {
      for (let y = 0; y < p.rows; y++) {
        const out = frame.grid[y];
        const row = cell[y];
        if (!out) continue;
        for (let x = 0; x < p.cols; x++) {
          out[x] = cellLevel(Math.round(norm(row?.[x] ?? 0) * 15));
        }
      }
      frame.gridDirty = true;
    },

    renderArc(): void {
      /* cellPaint owns no arc */
    },

    values(): CellValues {
      const rows = Math.max(0, profile.rows);
      const cols = Math.max(0, profile.cols);
      const cells: number[][] = [];
      let sum = 0;
      let count = 0;
      for (let y = 0; y < rows; y++) {
        const row: number[] = [];
        for (let x = 0; x < cols; x++) {
          const v = norm(cell[y]?.[x] ?? 0);
          row.push(v);
          sum += v;
          count++;
        }
        cells.push(row);
      }
      return { cells, mean: count ? sum / count : 0 };
    },

    describe(p: IdiomProfile): IdiomControlMap {
      return {
        grid: [
          {
            area: `any cell (${Math.max(0, p.rows)}×${Math.max(0, p.cols)})`,
            action: 'press / idle',
            effect: 'press cycles a cell 0→max + freezes it; idle cells flicker',
          },
        ],
        arc: [],
      };
    },

    setProfile(p: IdiomProfile): void {
      profile = p;
      reshape();
    },

    reset(): void {
      for (const row of cell) row.fill(0);
      for (const fr of frozen) fr.fill(false);
      acc = 0;
    },
  };
}
