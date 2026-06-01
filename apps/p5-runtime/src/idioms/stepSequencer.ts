/**
 * stepSequencer — a rows×cols step matrix with a playhead and a loop/cut latch.
 * Generalizes the windchime `monomeArcgridcombo` grid idiom (toggle steps on the
 * upper rows, a playhead display row, a cut/loop latch on the bottom row).
 *
 * Width adaptation (the compression rule): one page of `cols` steps by default,
 * so a Grid 128 gives 16 steps and a Grid 64 gives 8 — fewer steps, not a
 * squashed 16. Pass `steps` to fix a step count regardless of width; the view
 * then pages and follows the playhead (e.g. 16 steps over two pages on a Grid 64).
 *
 * Pure control/LED: it owns no arc and never draws. The host advances the
 * playhead via `advance()` on its musical clock — the idiom keeps no timer, so
 * it stays deterministic + testable. Provenance: windchime monomeArcgridcombo
 * (index.ts grid handling + step/playhead LEDs), ledPolicies.stepCellLevel.
 */

import { type GesturalEntry, type GridKeyEvent, type LedFrame } from '@lichtspiel/schemas';
import type { Idiom, IdiomControlMap, IdiomProfile } from './types.js';
import { EMPTY_PROFILE } from './types.js';
import { stepCellLevel } from './ledPolicies.js';

export interface StepSequencerOptions {
  /** sequencer lanes (step rows). Default: grid rows − 2 (reserve display + latch). */
  rows?: number;
  /** total steps across pages. Default: grid cols (one page; fewer on a Grid 64). */
  steps?: number;
}

export interface StepValues {
  laneRows: number;
  steps: number;
  page: number;
  playhead: number;
  loopStart: number;
  loopEnd: number;
  /** [lane][step] toggles (live reference — read, don't mutate). */
  matrix: boolean[][];
  /** lanes firing at the current playhead step. */
  active: boolean[];
  /** fraction of all cells that are on (0..1). */
  density: number;
}

export interface StepSequencer extends Idiom<StepValues> {
  /** Advance the playhead one step within the loop (call on a beat clock). */
  advance(): void;
  /** Jump the playhead to a specific step. */
  setPlayhead(step: number): void;
  /** Toggle a step programmatically (on omitted = flip). */
  toggle(lane: number, step: number, on?: boolean): void;
}

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.round(v)));

export function createStepSequencer(opts: StepSequencerOptions = {}): StepSequencer {
  let profile: IdiomProfile = EMPTY_PROFILE;
  let laneRows = 1;
  let steps = 1;
  let page = 0;
  let playhead = 0;
  let loopStart = 0;
  let loopEnd = 0;
  let matrix: boolean[][] = [[false]];
  let latchBuf: number[] = [];

  const cols = (): number => Math.max(1, profile.cols);
  const stepForCol = (x: number): number => page * cols() + x;

  const reshape = (): void => {
    const newLanes = Math.max(1, Math.min(Math.max(1, profile.rows), opts.rows ?? Math.max(1, profile.rows - 2)));
    const newSteps = Math.max(1, opts.steps ?? cols());
    matrix = Array.from({ length: newLanes }, (_, r) =>
      Array.from({ length: newSteps }, (_, s) => matrix[r]?.[s] ?? false),
    );
    laneRows = newLanes;
    steps = newSteps;
    playhead = clampInt(playhead, 0, steps - 1);
    loopStart = clampInt(loopStart, 0, steps - 1);
    loopEnd = clampInt(loopEnd <= 0 ? steps - 1 : loopEnd, 0, steps - 1);
    if (loopEnd < loopStart) loopEnd = steps - 1;
    page = Math.floor(playhead / cols());
  };

  const handleLatch = (s: number): void => {
    if (latchBuf.length === 0) {
      playhead = s;
      loopStart = s;
      loopEnd = steps - 1;
      latchBuf = [s];
    } else if (latchBuf.length === 1) {
      const a = latchBuf[0] ?? s;
      loopStart = Math.min(a, s);
      loopEnd = Math.max(a, s);
      playhead = loopStart;
      latchBuf = [a, s];
    } else {
      loopStart = 0;
      loopEnd = steps - 1;
      playhead = s;
      latchBuf = [s];
    }
    page = Math.floor(playhead / cols());
  };

  return {
    name: 'stepSequencer',

    onGridKey(e: GridKeyEvent): void {
      if (e.state !== 1) return; // act on press
      if (profile.cols <= 0 || e.x < 0 || e.x >= profile.cols) return;
      const s = stepForCol(e.x);
      if (s < 0 || s >= steps) return;
      if (e.y >= 0 && e.y < laneRows) {
        const lane = matrix[e.y];
        if (lane) lane[s] = !lane[s];
        return;
      }
      const reserved = profile.rows - laneRows;
      const latchRow = reserved >= 1 ? profile.rows - 1 : -1;
      if (e.y === latchRow) handleLatch(s); // display row (if any) takes no input
    },

    advance(): void {
      const next = playhead < loopStart || playhead >= loopEnd ? loopStart : playhead + 1;
      playhead = clampInt(next, 0, steps - 1);
      page = Math.floor(playhead / cols());
    },

    setPlayhead(step: number): void {
      playhead = clampInt(step, 0, steps - 1);
      page = Math.floor(playhead / cols());
    },

    toggle(lane: number, step: number, on?: boolean): void {
      const r = matrix[lane];
      if (!r || step < 0 || step >= steps) return;
      r[step] = on ?? !r[step];
    },

    renderGrid(frame: LedFrame, p: IdiomProfile): void {
      const colsN = Math.max(1, p.cols);
      const reserved = p.rows - laneRows;
      const dRow = reserved >= 2 ? laneRows : -1; // playhead display row
      const lRow = reserved >= 1 ? p.rows - 1 : -1; // cut/loop latch row
      const phCol = playhead - page * colsN;
      for (let y = 0; y < p.rows; y++) {
        const row = frame.grid[y];
        if (!row) continue;
        for (let x = 0; x < p.cols; x++) {
          const s = page * colsN + x;
          let lv = 0;
          if (y < laneRows) {
            lv = stepCellLevel(matrix[y]?.[s] ?? false, s === playhead);
          } else if (y === dRow) {
            if (x === phCol) lv = 15;
            else if (s >= loopStart && s <= loopEnd) lv = 3;
          } else if (y === lRow) {
            if (s === loopStart || s === loopEnd) lv = 8;
            if (x === phCol) lv = Math.max(lv, 12);
          }
          row[x] = lv;
        }
      }
      frame.gridDirty = true;
    },

    renderArc(): void {
      /* stepSequencer owns no arc */
    },

    values(): StepValues {
      const active = matrix.map((lane) => lane[playhead] ?? false);
      let on = 0;
      let total = 0;
      for (const lane of matrix)
        for (const c of lane) {
          total++;
          if (c) on++;
        }
      return {
        laneRows,
        steps,
        page,
        playhead,
        loopStart,
        loopEnd,
        matrix,
        active,
        density: total ? on / total : 0,
      };
    },

    describe(p: IdiomProfile): IdiomControlMap {
      const cols = Math.max(1, p.cols);
      const pages = Math.ceil(steps / cols);
      const grid: GesturalEntry[] = [
        {
          area: `rows 0–${Math.max(0, laneRows - 1)}`,
          action: 'press',
          effect: `toggle a step — ${steps} steps${pages > 1 ? ` over ${pages} pages (follows the play-head)` : ''}`,
        },
      ];
      const reserved = p.rows - laneRows;
      if (reserved >= 1) {
        grid.push({ area: `row ${p.rows - 1}`, action: 'press (1 or 2 cols)', effect: 'cut the play position / latch a loop' });
      }
      return { grid, arc: [] };
    },

    setProfile(p: IdiomProfile): void {
      profile = p;
      reshape();
    },

    reset(): void {
      for (const lane of matrix) lane.fill(false);
      playhead = 0;
      loopStart = 0;
      loopEnd = steps - 1;
      page = 0;
      latchBuf = [];
    },
  };
}
