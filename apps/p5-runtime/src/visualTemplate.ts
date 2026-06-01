/**
 * Runtime VisualTemplate contract. A template is a catalog entry
 * (VisualTemplateMeta from @lichtspiel/schemas) plus a `create` factory
 * that returns a per-mount VisualSketch. The host owns the p5 instance and
 * the param smoother; the sketch just renders.
 *
 * Split rationale (vs the spec's single object): a factory gives each mount
 * fresh state, so re-selecting a scene or swapping seeds never leaks state.
 */

import type p5 from 'p5';
import type {
  ArcDeltaEvent,
  ArcKeyEvent,
  GridKeyEvent,
  LedFrame,
  LiveSessionState,
  MonomeSetup,
  VisualParamVector,
  VisualTemplateMeta,
} from '@lichtspiel/schemas';
import type { SeededRng } from './seededRng.js';
import type { VariantFactory } from './mutations/familyVariants.js';

/**
 * Safe host actions a sketch may invoke from hardware — so a performable
 * instrument can change scene / re-roll a variant from the grid or arc (e.g. the
 * Opus III hero's extra grid-128 columns → scene-select). All no-ops if the host
 * provides none.
 */
export interface HostControls {
  selectSceneIndex(index: number): void;
  nextScene(): void;
  prevScene(): void;
  /** Re-mount the current scene as a new structural variant. */
  variant(): void;
}

/** Everything a sketch factory receives at mount time. */
export interface MountContext {
  seed: number;
  rng: SeededRng;
  /** Canvas dimensions chosen by the host (CSS pixels). */
  width: number;
  height: number;
  /** Family/template-specific config (the structural variant; usually empty). */
  config: Record<string, unknown>;
  /** Param vector at mount. */
  initialParams: VisualParamVector;
  /** Live state at mount, or null in browser-only mode. */
  initialLive: LiveSessionState | null;
  /** Mutable LED state the sketch may write for monome feedback. */
  ledOut: LedFrame;
  /** The active monome setup at mount — sketches size their idioms from it. */
  setup: MonomeSetup;
  /** Host actions a sketch may invoke from hardware (scene/variant control). */
  controls: HostControls;
}

/** Context handed to draw() each frame (for convenience helpers). */
export interface DrawContext {
  p: p5;
  width: number;
  height: number;
  /** Seconds since the previous frame. */
  dt: number;
  /** Monotonic frame counter since mount. */
  frame: number;
}

/** A live, mounted sketch instance. */
export interface VisualSketch {
  /** Create the canvas + initialize state. Called once. */
  setup(p: p5): void;
  /** Receive the latest smoothed params + live state. Called before draw. */
  update(params: VisualParamVector, live: LiveSessionState | null, dt: number): void;
  /** Render one frame. */
  draw(ctx: DrawContext): void;
  /** Free non-p5 resources. p5 instance teardown is handled by the host. */
  dispose?(): void;
  onGridKey?(e: GridKeyEvent): void;
  onArcDelta?(e: ArcDeltaEvent): void;
  onArcKey?(e: ArcKeyEvent): void;
  /**
   * The active monome setup changed (hot-swap). The sketch reshapes its idioms
   * in place — no re-mount, so playing state (fader values, step matrix) is kept.
   */
  setProfile?(setup: MonomeSetup): void;
}

export type VisualSketchFactory = (ctx: MountContext) => VisualSketch;

/**
 * An alternative visual implementation of a template that shares its idioms +
 * gestural mapping but renders differently (windchime's `altImpl` pattern).
 * Selectable at mount via `MountOptions.impl`.
 */
export interface AltImpl {
  id: string;
  name: string;
  create: VisualSketchFactory;
}

/** A catalog entry: serializable metadata + the factory that builds it. */
export interface VisualTemplate extends VisualTemplateMeta {
  create: VisualSketchFactory;
  /** Alternative renderers sharing this template's idioms/gestures. */
  altImpls?: AltImpl[];
  /** Structural variant factory (the `v`-key / arc-press re-mount). */
  variants?: VariantFactory;
}
