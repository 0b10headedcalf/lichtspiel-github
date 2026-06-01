/**
 * The monome idiom library — barrel exports + `composeIdioms`.
 *
 * A sketch typically keeps direct, typed references to the idioms it builds (to
 * read their `values()`), and uses `composeIdioms([...])` to fan controller
 * events to all of them and composite their LED writes into one frame. Where two
 * idioms light the same LED, the brighter wins (`Math.max`) — so a grid idiom
 * (faderBank / stepSequencer / cellPaint) and the arc idiom (arcMacros) combine
 * cleanly, and even two grid idioms overlay sensibly.
 */

import { type LedFrame, createLedFrame } from '@lichtspiel/schemas';
import type { Idiom, IdiomProfile } from './types.js';

export * from './types.js';
export * from './ledPolicies.js';
export * from './faderBank.js';
export * from './stepSequencer.js';
export * from './cellPaint.js';
export * from './arcMacros.js';

export interface ComposedIdiom extends Idiom<Record<string, unknown>> {
  /** The composed idioms, in order, for typed `values()` access by the sketch. */
  readonly idioms: readonly Idiom[];
}

function zeroGrid(f: LedFrame): void {
  for (const row of f.grid) row.fill(0);
}
function zeroArc(f: LedFrame): void {
  for (const ring of f.arc) ring.fill(0);
}

/**
 * Combine several idioms into one. Events fan to every idiom that handles them;
 * LED renders composite by `Math.max`; `values()` shallow-merges (give lanes /
 * encoders distinct names to avoid key collisions); `setProfile` / `reset`
 * forward to all; `gridIntensity` takes the brightest requested value.
 */
export function composeIdioms(idioms: Idiom[]): ComposedIdiom {
  const scratch: LedFrame = createLedFrame();

  return {
    name: 'composite',
    idioms,

    onGridKey(e): void {
      for (const idiom of idioms) idiom.onGridKey?.(e);
    },
    onArcDelta(e): void {
      for (const idiom of idioms) idiom.onArcDelta?.(e);
    },
    onArcKey(e): void {
      for (const idiom of idioms) idiom.onArcKey?.(e);
    },

    renderGrid(frame: LedFrame, profile: IdiomProfile): void {
      zeroGrid(frame);
      for (const idiom of idioms) {
        zeroGrid(scratch);
        idiom.renderGrid(scratch, profile);
        for (let y = 0; y < frame.grid.length; y++) {
          const a = frame.grid[y];
          const b = scratch.grid[y];
          if (!a || !b) continue;
          for (let x = 0; x < a.length; x++) a[x] = Math.max(a[x] ?? 0, b[x] ?? 0);
        }
      }
      frame.gridDirty = true;
    },

    renderArc(frame: LedFrame, profile: IdiomProfile): void {
      zeroArc(frame);
      const dirty = new Array<boolean>(frame.arc.length).fill(false);
      for (const idiom of idioms) {
        zeroArc(scratch);
        scratch.arcDirty.fill(false);
        idiom.renderArc(scratch, profile);
        for (let e = 0; e < frame.arc.length; e++) {
          if (!scratch.arcDirty[e]) continue;
          dirty[e] = true;
          const a = frame.arc[e];
          const b = scratch.arc[e];
          if (!a || !b) continue;
          for (let i = 0; i < a.length; i++) a[i] = Math.max(a[i] ?? 0, b[i] ?? 0);
        }
      }
      for (let e = 0; e < frame.arcDirty.length; e++) if (dirty[e]) frame.arcDirty[e] = true;
    },

    gridIntensity(): number | undefined {
      let best: number | undefined;
      for (const idiom of idioms) {
        const gi = idiom.gridIntensity?.();
        if (gi === undefined) continue;
        best = best === undefined ? gi : Math.max(best, gi);
      }
      return best;
    },

    values(): Record<string, unknown> {
      const out: Record<string, unknown> = {};
      for (const idiom of idioms) Object.assign(out, idiom.values());
      return out;
    },

    setProfile(profile: IdiomProfile): void {
      for (const idiom of idioms) idiom.setProfile(profile);
    },

    reset(): void {
      for (const idiom of idioms) idiom.reset?.();
    },
  };
}
