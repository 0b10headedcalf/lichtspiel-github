/**
 * SketchHost — owns the single p5 instance, mounts/swaps templates, smooths
 * the param vector toward its target each frame, tracks FPS, and dispatches
 * monome events to the active sketch. Adapted from the Windchime animation
 * `createSketchHost`, retargeted to Lichtspiel's VisualParamVector + Live state.
 */

import p5 from 'p5';
import {
  type ArcDeltaEvent,
  type ArcKeyEvent,
  type GesturalControlMap,
  type GridKeyEvent,
  type LedFrame,
  type LiveSessionState,
  type MonomeSetup,
  type VisualParamVector,
  DEFAULT_PARAMS as DEFAULTS,
  createLedFrame,
  describeSetup,
  lerpParams,
  mergeParams,
} from '@lichtspiel/schemas';
import { createRng, randomSeed } from './seededRng.js';
import type {
  DrawContext,
  HostControls,
  MountContext,
  VisualSketch,
  VisualTemplate,
} from './visualTemplate.js';

const NO_SETUP: MonomeSetup = { grid: null, arc: null };
const NOOP_CONTROLS: HostControls = {
  selectSceneIndex: () => {},
  nextScene: () => {},
  prevScene: () => {},
  variant: () => {},
};

export interface MountOptions {
  seed?: number;
  config?: Record<string, unknown>;
  /** Params to apply at mount (merged over the template's defaults). */
  params?: Partial<VisualParamVector>;
  /** Select an alternative implementation (VisualTemplate.altImpls) by id. */
  impl?: string;
}

/**
 * One raw (un-smoothed) per-frame measurement, emitted to any attached sampler.
 * `jsMs` is the synchronous main-thread cost of update()+draw() (CPU command
 * building); `frameMs` is the wall-clock frame interval (CPU + GPU + vsync). The
 * residual `frameMs - jsMs` is the GPU/vsync signal — see docs/perf-profiling.
 */
export interface FrameSample {
  frameMs: number;
  jsMs: number;
  fps: number;
  templateId: string;
}

export interface SketchHostOptions {
  parent: HTMLElement;
  /** Returns the desired canvas size; re-queried on window resize. */
  getSize?: () => { width: number; height: number };
  /** Returns the active monome setup; read at mount + forwarded on setProfile. */
  getSetup?: () => MonomeSetup;
  /** Host actions a sketch may invoke from hardware (scene/variant control). */
  controls?: HostControls;
  /** Called after the active sketch mutates ledOut (for the emulator/bridge). */
  onLedFrameDirty?: (frame: LedFrame) => void;
  /** Called once per rendered frame with fps + smoothed params. */
  onFrame?: (info: { fps: number; params: VisualParamVector; templateId: string }) => void;
  /** Param smoothing time-constant in seconds (lower = snappier). */
  smoothingTau?: number;
}

export class SketchHost {
  private readonly parent: HTMLElement;
  private readonly getSize: () => { width: number; height: number };
  private readonly getSetup: () => MonomeSetup;
  private readonly controls: HostControls;
  private readonly onLedFrameDirty: ((frame: LedFrame) => void) | undefined;
  private readonly onFrame: SketchHostOptions['onFrame'];
  private readonly tau: number;
  private setup: MonomeSetup = NO_SETUP;

  private template: VisualTemplate | null = null;
  private sketch: VisualSketch | null = null;
  private instance: p5 | null = null;
  private ledOut: LedFrame = createLedFrame();

  private target: VisualParamVector;
  private smoothed: VisualParamVector;
  private live: LiveSessionState | null = null;

  private lastTimeMs = 0;
  private frame = 0;
  private fps = 0;

  /** Raw per-frame samplers (the profiler attaches here); empty in normal use. */
  private readonly samplers = new Set<(s: FrameSample) => void>();

  constructor(opts: SketchHostOptions) {
    this.parent = opts.parent;
    this.getSize = opts.getSize ?? (() => ({ width: window.innerWidth, height: window.innerHeight }));
    this.getSetup = opts.getSetup ?? (() => NO_SETUP);
    this.controls = opts.controls ?? NOOP_CONTROLS;
    this.onLedFrameDirty = opts.onLedFrameDirty;
    this.onFrame = opts.onFrame;
    this.tau = opts.smoothingTau ?? 0.12;
    this.setup = this.getSetup();
    // Initialized properly on first mount.
    this.target = { ...DEFAULTS };
    this.smoothed = { ...DEFAULTS };
    window.addEventListener('resize', this.handleResize);
  }

  private handleResize = (): void => {
    if (!this.instance) return;
    const { width, height } = this.getSize();
    this.instance.resizeCanvas(width, height);
  };

  current(): VisualTemplate | null {
    return this.template;
  }
  currentTemplateId(): string {
    return this.template?.id ?? '';
  }
  smoothedParams(): VisualParamVector {
    return this.smoothed;
  }
  targetParams(): VisualParamVector {
    return this.target;
  }
  currentFps(): number {
    return this.fps;
  }
  ledFrame(): LedFrame {
    return this.ledOut;
  }

  /** Attach a raw per-frame sampler (for the profiler). Returns a detach fn. */
  addSampler(fn: (s: FrameSample) => void): () => void {
    this.samplers.add(fn);
    return () => this.samplers.delete(fn);
  }

  private teardown(): void {
    const had = this.instance !== null;
    try {
      this.sketch?.dispose?.();
    } catch (err) {
      console.error('[host] sketch.dispose threw', err);
    }
    this.instance?.remove();
    this.sketch = null;
    this.instance = null;
    // Clear LEDs on scene teardown so an idiom sketch's last frame doesn't
    // linger on the grid/arc under the next scene.
    if (had) this.clearLeds();
  }

  /** Zero the LED frame + emit it, so hardware/twin clear stale feedback. */
  private clearLeds(): void {
    for (const row of this.ledOut.grid) row.fill(0);
    for (const ring of this.ledOut.arc) ring.fill(0);
    this.ledOut.gridDirty = true;
    for (let i = 0; i < this.ledOut.arcDirty.length; i++) this.ledOut.arcDirty[i] = true;
    this.onLedFrameDirty?.(this.ledOut);
  }

  /** The active monome setup changed (hot-swap) — reshape the sketch in place. */
  setProfile(setup: MonomeSetup): void {
    this.setup = setup;
    try {
      this.sketch?.setProfile?.(setup);
    } catch (err) {
      console.error('[host] sketch.setProfile threw', err);
    }
  }

  /** The active sketch's live control map for the connected hardware (or null). */
  describeControls(): GesturalControlMap | null {
    try {
      const map = this.sketch?.controlMap?.(this.setup);
      if (!map) return null;
      return { hardware: describeSetup(this.setup), grid: map.grid, arc: map.arc, page: map.page };
    } catch (err) {
      console.error('[host] sketch.controlMap threw', err);
      return null;
    }
  }

  mount(template: VisualTemplate, opts: MountOptions = {}): void {
    this.teardown();
    this.template = template;
    this.setup = this.getSetup();

    const seed = opts.seed ?? randomSeed();
    const rng = createRng(seed);
    const { width, height } = this.getSize();
    this.ledOut = createLedFrame();

    // target = global defaults <- template defaults <- explicit mount params
    this.target = mergeParams(
      mergeParams({ ...DEFAULTS, sceneId: template.id }, template.defaultParams),
      opts.params ?? {},
    );
    this.target.sceneId = template.id;
    this.smoothed = { ...this.target };

    const ctx: MountContext = {
      seed,
      rng,
      width,
      height,
      config: opts.config ?? {},
      initialParams: { ...this.target },
      initialLive: this.live,
      ledOut: this.ledOut,
      setup: this.setup,
      controls: this.controls,
    };

    // Pick an alternative implementation if requested, else the canonical one.
    const factory =
      (opts.impl ? template.altImpls?.find((a) => a.id === opts.impl)?.create : undefined) ??
      template.create;
    const sketch = factory(ctx);
    this.frame = 0;
    this.lastTimeMs = 0;

    this.instance = new p5((p: p5) => {
      p.setup = () => {
        sketch.setup(p);
        // Hand the sketch its first param/live snapshot before the first draw.
        sketch.update(this.smoothed, this.live, 0);
      };
      p.draw = () => {
        const now = performance.now();
        const dt = this.lastTimeMs === 0 ? 1 / 60 : Math.min(0.1, (now - this.lastTimeMs) / 1000);
        this.lastTimeMs = now;
        this.frame++;

        // Smooth params toward target (exponential approach).
        const k = 1 - Math.exp(-dt / this.tau);
        this.smoothed = lerpParams(this.smoothed, this.target, k);

        const instantFps = dt > 0 ? 1 / dt : 0;
        this.fps = this.fps === 0 ? instantFps : this.fps * 0.9 + instantFps * 0.1;

        // Synchronous main-thread cost of update()+draw() — CPU command building,
        // not GPU execution (WebGL draw calls return before the GPU runs them).
        const jsStart = performance.now();
        try {
          sketch.update(this.smoothed, this.live, dt);
        } catch (err) {
          console.error('[host] sketch.update threw', err);
        }
        const drawCtx: DrawContext = { p, width: p.width, height: p.height, dt, frame: this.frame };
        try {
          sketch.draw(drawCtx);
        } catch (err) {
          console.error('[host] sketch.draw threw', err);
        }
        const jsMs = performance.now() - jsStart;

        if (this.ledOut.gridDirty || this.ledOut.arcDirty.some((d) => d)) {
          this.onLedFrameDirty?.(this.ledOut);
          this.ledOut.gridDirty = false;
          for (let i = 0; i < this.ledOut.arcDirty.length; i++) this.ledOut.arcDirty[i] = false;
        }

        this.onFrame?.({ fps: this.fps, params: this.smoothed, templateId: this.template?.id ?? '' });

        if (this.samplers.size > 0) {
          const sample: FrameSample = {
            frameMs: dt * 1000,
            jsMs,
            fps: instantFps,
            templateId: this.template?.id ?? '',
          };
          for (const fn of this.samplers) fn(sample);
        }
      };
    }, this.parent);

    this.sketch = sketch;
  }

  /** Merge a partial patch into the target params (smoothed toward over time). */
  setTargetParams(patch: Partial<VisualParamVector>): void {
    this.target = mergeParams(this.target, patch);
    if (this.template) this.target.sceneId = this.template.id;
  }

  /** Snap params immediately (no smoothing) — e.g. on a hard scene reset. */
  snapParams(patch: Partial<VisualParamVector>): void {
    this.setTargetParams(patch);
    this.smoothed = { ...this.target };
  }

  setLive(state: LiveSessionState | null): void {
    this.live = state;
  }

  dispatchGridKey(e: GridKeyEvent): void {
    this.sketch?.onGridKey?.(e);
  }
  dispatchArcDelta(e: ArcDeltaEvent): void {
    this.sketch?.onArcDelta?.(e);
  }
  dispatchArcKey(e: ArcKeyEvent): void {
    this.sketch?.onArcKey?.(e);
  }

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.teardown();
    this.template = null;
  }
}
