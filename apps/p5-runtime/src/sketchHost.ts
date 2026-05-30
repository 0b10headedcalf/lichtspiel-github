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
  type GridKeyEvent,
  type LedFrame,
  type LiveSessionState,
  type VisualParamVector,
  DEFAULT_PARAMS as DEFAULTS,
  createLedFrame,
  lerpParams,
  mergeParams,
} from '@lichtspiel/schemas';
import { createRng, randomSeed } from './seededRng.js';
import type { DrawContext, MountContext, VisualSketch, VisualTemplate } from './visualTemplate.js';

export interface MountOptions {
  seed?: number;
  config?: Record<string, unknown>;
  /** Params to apply at mount (merged over the template's defaults). */
  params?: Partial<VisualParamVector>;
}

export interface SketchHostOptions {
  parent: HTMLElement;
  /** Returns the desired canvas size; re-queried on window resize. */
  getSize?: () => { width: number; height: number };
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
  private readonly onLedFrameDirty: ((frame: LedFrame) => void) | undefined;
  private readonly onFrame: SketchHostOptions['onFrame'];
  private readonly tau: number;

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

  constructor(opts: SketchHostOptions) {
    this.parent = opts.parent;
    this.getSize = opts.getSize ?? (() => ({ width: window.innerWidth, height: window.innerHeight }));
    this.onLedFrameDirty = opts.onLedFrameDirty;
    this.onFrame = opts.onFrame;
    this.tau = opts.smoothingTau ?? 0.12;
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

  private teardown(): void {
    try {
      this.sketch?.dispose?.();
    } catch (err) {
      console.error('[host] sketch.dispose threw', err);
    }
    this.instance?.remove();
    this.sketch = null;
    this.instance = null;
  }

  mount(template: VisualTemplate, opts: MountOptions = {}): void {
    this.teardown();
    this.template = template;

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
    };

    const sketch = template.create(ctx);
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

        if (this.ledOut.gridDirty || this.ledOut.arcDirty.some((d) => d)) {
          this.onLedFrameDirty?.(this.ledOut);
          this.ledOut.gridDirty = false;
          for (let i = 0; i < this.ledOut.arcDirty.length; i++) this.ledOut.arcDirty[i] = false;
        }

        this.onFrame?.({ fps: this.fps, params: this.smoothed, templateId: this.template?.id ?? '' });
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
