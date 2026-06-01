/**
 * pasHalloween — faithful port (not forked) of windchime-animation
 * packages/sketch-families/src/pasHalloweenV3 (itself a hand-port of
 * processing_corupus_full/PAS_Haloweenv3/PAS_Haloweenv3.pde). A 2D motion-trail
 * field: each frame fades a low-alpha black rect over the canvas, scatters
 * `lineSpeed` random flickering palette lines, and drifts a swarm of spawned
 * elements (circle / triangle / square / star) outward from centre via Perlin
 * noise. A grid step sequencer drives it: on PLAYBACK (not on press) each lane
 * firing under the play-head re-binds a visual parameter by the firing column —
 * row 0 → line thickness, row 1 → line rate, row 2 → element size, row 3 → line
 * length (rows 4-5 bind nothing) — AND spawns a new element at centre. The full
 * variant space is preserved: 5 palettes · 4 trail densities · 4 element shapes.
 *
 * Lichtspiel rewiring: windchime's hardcoded 16-col grid state machine + raw
 * 64-LED arc counters (manual step matrix / cut-loop latch / per-encoder LED
 * fills) become a `stepSequencer` (rows 0-5 toggle steps + play-head + cut/loop
 * latch; 16 steps on a Grid 128, 8 on a Grid 64) driving the step clock, plus
 * `arcMacros` in ABSOLUTE mode — the four windchime arc extensions (enc0
 * trail-fade multiplier, enc1 hue shift, enc2 element-lifespan multiplier, enc3
 * position-jitter amplitude; led 'fill'; press resets that channel to its
 * identity). Each idiom's `values()` folds gently with a VisualParamVector axis,
 * and the idioms own all LED feedback (renderGrid / renderArc each frame), so the
 * surface adapts to the connected device with no per-hardware branch. The visual
 * core — draw(), trigger(row,col), spawnElement(), the four shape paths,
 * trailAlpha + palette helpers, and windchime's own perf cap — is ported
 * verbatim and scaled from windchime's 1024×768 canvas to the live width/height.
 * P2D (2D canvas — no WEBGL). Reuses hslToRgb from lib/palettes.ts.
 */

import type p5 from 'p5';
import { type VisualParamVector, lerp } from '@lichtspiel/schemas';
import type { MountContext, VisualTemplate } from '../visualTemplate.js';
import {
  type ArcMacros,
  type ComposedIdiom,
  type IdiomProfile,
  type StepSequencer,
  composeIdioms,
  createArcMacros,
  createStepSequencer,
  profileFromSetup,
} from '../idioms/index.js';
import { cfg, makeVariantFactory } from '../mutations/familyVariants.js';
import { type Rgb, hslToRgb } from './lib/palettes.js';

const TWO_PI = Math.PI * 2;
const STEP_FRAMES = 5; // windchime STEP_TIME — a quick step rate, @60fps
const MAX_ELEMENTS = 220; // perf guard — cap the spawned swarm (windchime fades, this bounds)
const WC_W = 1024; // windchime authoring canvas — coordinates scale to live width/height
const WC_H = 768;

type PaletteMode = 'mono-white' | 'warm' | 'cool' | 'neon' | 'spectrum';
type TrailMode = 'subtle' | 'standard' | 'heavy' | 'persistent';
type ElementShape = 'circle' | 'triangle' | 'square' | 'star';

/** windchime VisualElement — a drifting spawned shape. */
interface VisualElement {
  x: number;
  y: number;
  size: number;
  alpha: number;
  noiseOffX: number;
  noiseOffY: number;
  color: Rgb;
}

/**
 * The FULL windchime pasHalloweenV3 variant space (params.ts), exact pools +
 * canonical (mono-white / standard / circle). palette / trails / shape only —
 * the arc extensions are continuous (arcMacros), not structural axes.
 */
const variants = makeVariantFactory({
  palette: { canonical: 'mono-white', options: ['mono-white', 'warm', 'cool', 'neon', 'spectrum'] },
  trails: { canonical: 'standard', options: ['subtle', 'standard', 'heavy', 'persistent'] },
  shape: { canonical: 'circle', options: ['circle', 'triangle', 'square', 'star'] },
});

/** windchime trailAlpha — bg fade-rect alpha; lower = more persistent trails. */
function trailAlpha(mode: TrailMode): number {
  switch (mode) {
    case 'subtle':
      return 50;
    case 'heavy':
      return 8;
    case 'persistent':
      return 3;
    case 'standard':
    default:
      return 20;
  }
}

/** windchime paletteColor — a colour for a new line/element, per palette mode. */
function paletteColor(mode: PaletteMode, rng: MountContext['rng']): Rgb {
  switch (mode) {
    case 'warm':
      return hslToRgb(rng.range(0, 60), 0.85, 0.6);
    case 'cool':
      return hslToRgb(rng.range(180, 270), 0.85, 0.6);
    case 'neon': {
      const hues = [330, 280, 195, 60];
      return hslToRgb(hues[rng.int(hues.length)] ?? 0, 1, 0.6);
    }
    case 'spectrum':
      return hslToRgb(rng.range(0, 360), 0.8, 0.55);
    case 'mono-white':
    default: {
      const v = rng.int(80) + 175;
      return [v, v, v];
    }
  }
}

export const pasHalloween: VisualTemplate = {
  id: 'pasHalloween',
  name: 'PAS Halloween',
  family: 'sequencer',
  description:
    'A 2D motion-trail field of drifting circles/triangles/squares/stars and flickering lines, driven by a grid step sequencer: each firing step re-binds a visual parameter by its column (thickness / rate / size / length) and spawns an element. The Grid 128 / Arc 4 parametric-column-trigger showcase.',
  tags: ['sequencer', 'step', 'arc', 'shapes', 'trails', '2d', 'rhythmic', 'percussive', 'monome', 'spawner'],
  defaultParams: { motion: 0.5, turbulence: 0.5, density: 0.5, contrast: 0.6, palette: 0.3 },
  renderer: 'p2d',
  sourceLineage: 'windchime pasHalloweenV3 (PAS_Haloweenv3.pde, faithful port)',
  hardwareTarget: { grid: '128', arc: '4' },
  idioms: ['stepSequencer', 'arcMacros'],
  gestural: {
    name: 'Step Sequencer + Parametric Column Triggers',
    summary:
      "Distinct from monomeArcgridcombo: the column position of each *active step* sets a visual parameter when the play-head fires it. Grid rows 0-5 toggle steps; on playback a firing step at (row, col) sets that row's parameter (row 0 = line thickness, 1 = line rate, 2 = element size, 3 = line length; rows 4-5 bind nothing) and spawns a drifting element at centre with motion trails. Row 7 cuts the play position / latches a loop. Arc encoders extend windchime's arc-also-required principle (the original was grid-only): enc0 trail strength, enc1 hue shift, enc2 element lifespan, enc3 jitter; on an Arc 2 each encoder folds to cover two of them.",
    grid: [
      { area: 'grid rows 0-5, any column', action: 'press', effect: 'toggle a step on/off at (col, row)' },
      {
        area: 'grid rows 0-3 (during playback)',
        action: 'step fires under the play-head',
        effect: "col 0→15 sets that row's parameter (0 = thickness, 1 = line-rate, 2 = element size, 3 = line length); spawns an element",
      },
      { area: 'grid rows 4-5 (during playback)', action: 'step fires under the play-head', effect: 'spawn an element only (no parameter bound)' },
      { area: 'grid row 7, any column', action: 'single press', effect: 'cut the play position to that column' },
      { area: 'grid row 7, two columns held', action: 'press second while first held', effect: 'set loop start + end' },
    ],
    arc: [
      { area: 'arc encoder 0', action: 'turn', effect: 'motion-trail strength (lower = more persistent trails)' },
      { area: 'arc encoder 1', action: 'turn', effect: 'hue shift across the active palette' },
      { area: 'arc encoder 2', action: 'turn', effect: 'element lifespan multiplier (slower fade)' },
      { area: 'arc encoder 3', action: 'turn', effect: 'position-jitter amplitude on drifting elements' },
      { area: 'arc encoder 0', action: 'press', effect: 'clear the field (wipe all elements)' },
      { area: 'arc encoder 1', action: 'press', effect: 'spawn a burst of elements' },
      { area: 'arc encoder 2', action: 'press', effect: 'thin the swarm (cull half)' },
      { area: 'arc encoder 3', action: 'press', effect: 'scatter the elements' },
    ],
  },
  variants,

  create(ctx: MountContext) {
    const paletteMode = cfg<PaletteMode>(ctx.config, 'palette', 'mono-white');
    const trailMode = cfg<TrailMode>(ctx.config, 'trails', 'standard');
    const shape = cfg<ElementShape>(ctx.config, 'shape', 'circle');

    let profile: IdiomProfile = profileFromSetup(ctx.setup);

    // ── arc channel ranges (windchime onArcDelta) + the encoder phase 0..1 that
    //    yields each channel's identity, so a press (onPress → set to identity
    //    phase) restores trail 1× / hue 0 / lifespan 1× / jitter 1× exactly. ──
    const TRAIL_AT = (f: number): number => 0.25 + f * 3; //  ident 1×  @ 0.25
    const HUE_AT = (f: number): number => (f - 0.5) * 2; //  ident 0   @ 0.5
    const LIFE_AT = (f: number): number => 0.3 + f * 2.7; //  ident 1×  @ 0.2593
    const JIT_AT = (f: number): number => f * 4; //  ident 1×  @ 0.25
    const TRAIL_MID = 0.25;
    const HUE_MID = 0.5;
    const LIFE_MID = (1 - 0.3) / 2.7; // ≈ 0.2593
    const JIT_MID = 0.25;

    // ── idioms (the control map) ───────────────────────────────────
    const seq: StepSequencer = createStepSequencer({ steps: 16 }); // 16 steps; pages on a Grid 64
    // Each arc PRESS is a distinct, thematic event on the element swarm (not a uniform
    // reset). On an Arc 2 the turns couple (enc0 → trail+lifespan, enc1 → hue+jitter) and
    // the presses cycle, so all four events stay reachable.
    const arc: ArcMacros = createArcMacros({
      encoders: [
        { name: 'trail', label: 'motion-trail strength', pressLabel: 'clear the field', mode: 'absolute', initial: TRAIL_MID, led: 'fillNotched', onPress: () => (elements.length = 0) },
        { name: 'hue', label: 'palette hue shift', pressLabel: 'spawn a burst', mode: 'absolute', initial: HUE_MID, led: 'fillNotched', onPress: () => { for (let i = 0; i < 8; i++) spawnElement(centerX, centerY); } },
        { name: 'lifespan', label: 'element lifespan', pressLabel: 'thin the swarm', mode: 'absolute', initial: LIFE_MID, led: 'fillNotched', onPress: () => elements.splice(0, Math.floor(elements.length / 2)) },
        { name: 'jitter', label: 'position jitter', pressLabel: 'scatter the elements', mode: 'absolute', initial: JIT_MID, led: 'fillNotched', onPress: () => { for (const el of elements) { el.x += ctx.rng.range(-1, 1) * 220; el.y += ctx.rng.range(-1, 1) * 220; } } },
      ],
    });
    const idioms: ComposedIdiom = composeIdioms([seq, arc]);
    idioms.setProfile(profile);

    // ── windchime PortableState (trigger-driven params + the element swarm) ──
    let lineThickness = 2;
    let lineSpeed = 1;
    let elementSize = 100;
    let lineLength = 100;
    const elements: VisualElement[] = [];

    let stepTimer = 0; // frames since the last advance
    let userEdited = false;
    let cur: VisualParamVector = ctx.initialParams;
    let centerX = ctx.width / 2; // live canvas centre (updated each frame) for arc-press spawns
    let centerY = ctx.height / 2;

    /** A sparse default pattern (windchime ships grid-only / blank, but the
     *  digital twin should play on mount). Re-fits across a hot-swap until edited. */
    function seedPattern(): void {
      seq.reset?.();
      const steps = seq.values().steps;
      for (let s = 0; s < steps; s += 4) seq.toggle(0, s, true); // row 0 → thickness sweep
      seq.toggle(1, Math.min(2, steps - 1), true); // row 1 → line rate
      seq.toggle(2, Math.min(6, steps - 1), true); // row 2 → element size
      seq.toggle(3, Math.min(10, steps - 1), true); // row 3 → line length
    }
    seedPattern();

    // ── current folded arc-channel values (recomputed each frame in draw) ──
    let trailMultiplier = 1;
    let hueShift = 0;
    let lifespanMultiplier = 1;
    let jitterAmp = 1;

    /** windchime spawnElement — a new drifting element at canvas centre, its
     *  colour nudged by the hue-shift channel, scattered by jitterAmp. */
    function spawnElement(cx: number, cy: number): void {
      const base = paletteColor(paletteMode, ctx.rng);
      const shifted: Rgb = [
        Math.max(0, Math.min(255, base[0] + hueShift * 30)),
        Math.max(0, Math.min(255, base[1] - hueShift * 15)),
        Math.max(0, Math.min(255, base[2] + hueShift * 20)),
      ];
      elements.push({
        x: cx + ctx.rng.range(-30, 30) * jitterAmp,
        y: cy + ctx.rng.range(-30, 30) * jitterAmp,
        size: elementSize,
        alpha: 255,
        noiseOffX: ctx.rng.range(0, 1000),
        noiseOffY: ctx.rng.range(0, 1000),
        color: shifted,
      });
      while (elements.length > MAX_ELEMENTS) elements.shift(); // perf cap (oldest out)
    }

    /**
     * windchime trigger(row, col): the firing column re-binds the row's visual
     * parameter (rows 0-3), and ALWAYS spawns an element (incl. rows 4-5). Sizes
     * are kept in windchime's authoring units (px @1024×768) + scaled at draw.
     */
    function trigger(row: number, col: number, cx: number, cy: number): void {
      const frac = col / 15;
      if (row === 0) lineThickness = 1 + frac * 9;
      else if (row === 1) lineSpeed = 1 + frac * 9;
      else if (row === 2) elementSize = 20 + frac * 180;
      else if (row === 3) lineLength = 50 + frac * 450;
      // rows 4-5: no param bound — spawn only
      spawnElement(cx, cy);
    }

    /** windchime drawShape — element geometry in local (translated) coords. */
    function drawShape(p: p5, sz: number): void {
      switch (shape) {
        case 'triangle': {
          const r = sz / 2;
          p.beginShape();
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * TWO_PI - Math.PI / 2;
            p.vertex(Math.cos(a) * r, Math.sin(a) * r);
          }
          p.endShape(p.CLOSE);
          return;
        }
        case 'square':
          p.rect(0, 0, sz, sz);
          return;
        case 'star': {
          const r = sz / 2;
          p.beginShape();
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * TWO_PI - Math.PI / 2;
            const rad = i % 2 === 0 ? r : r * 0.45;
            p.vertex(Math.cos(a) * rad, Math.sin(a) * rad);
          }
          p.endShape(p.CLOSE);
          return;
        }
        case 'circle':
        default:
          p.ellipse(0, 0, sz, sz);
          return;
      }
    }

    return {
      setup(p): void {
        p.createCanvas(ctx.width, ctx.height); // P2D — no WEBGL
        p.rectMode(p.CENTER);
        p.ellipseMode(p.CENTER);
        p.background(0);
      },

      update(params): void {
        cur = params;
      },

      setProfile(setup): void {
        profile = profileFromSetup(setup);
        idioms.setProfile(profile);
        if (!userEdited) seedPattern(); // re-fit the default pattern to the new width
      },
      controlMap: (setup) => idioms.describe(profileFromSetup(setup)),

      onGridKey(e): void {
        userEdited = true;
        idioms.onGridKey?.(e); // toggles steps / cut-loop latch — triggers fire on playback only
      },
      onArcDelta(e): void {
        idioms.onArcDelta?.(e);
      },
      onArcKey(e): void {
        idioms.onArcKey?.(e);
      },

      draw({ p, width, height, dt }): void {
        const frames = dt * 60;
        const cx = width / 2;
        const cy = height / 2;
        centerX = cx; // keep the arc-press spawns at the live canvas centre
        centerY = cy;
        const sx = width / WC_W; // scale windchime authoring px → live canvas
        const sy = height / WC_H;
        const s = Math.min(sx, sy); // isotropic scale for sizes/lengths

        // ── fold each arc channel gently with a VisualParamVector axis ──
        //    (centre 0.5 = the device value; the axis nudges around it).
        const a = arc.values();
        const ph = (v: number, axis: number, lo: number, hi: number): number => {
          const f = Math.max(lo, Math.min(hi, v + (axis - 0.5) * 0.4));
          return f;
        };
        trailMultiplier = TRAIL_AT(ph(a.trail ?? TRAIL_MID, cur.contrast, 0, 1));
        hueShift = HUE_AT(ph(a.hue ?? HUE_MID, cur.palette, 0, 1));
        lifespanMultiplier = LIFE_AT(ph(a.lifespan ?? LIFE_MID, cur.turbulence, 0, 1));
        jitterAmp = JIT_AT(ph(a.jitter ?? JIT_MID, cur.turbulence, 0, 1));

        // ── windchime motion-trail bg — low-alpha black fade rect each frame ──
        const effectiveTrail = Math.max(2, trailAlpha(trailMode) * trailMultiplier);
        p.noStroke();
        p.fill(0, effectiveTrail);
        p.rect(cx, cy, width, height);

        // ── windchime random flickering lines — count from lineSpeed ──
        //    density axis rides the rate; contrast rides line alpha.
        const lineCol = paletteColor(paletteMode, ctx.rng);
        const rate = lineSpeed * lerp(0.6, 1.5, cur.density);
        let numLines = Math.floor(rate);
        if (ctx.rng.random() < rate - numLines) numLines++;
        p.strokeWeight(Math.max(1, lineThickness * s));
        for (let i = 0; i < numLines; i++) {
          const x1 = ctx.rng.range(0, width);
          const y1 = ctx.rng.range(0, height);
          const x2 = x1 + ctx.rng.range(-lineLength, lineLength) * s;
          const y2 = y1 + ctx.rng.range(-lineLength, lineLength) * s;
          p.stroke(lineCol[0], lineCol[1], lineCol[2], ctx.rng.range(50, 150) * (0.5 + cur.contrast * 0.5));
          p.line(x1, y1, x2, y2);
        }

        // ── windchime element update + draw (Perlin drift, fade, shape) ──
        const fadeRate = 5 / Math.max(0.1, lifespanMultiplier);
        const driftScale = jitterAmp * s; // windchime ±2*jitter px, scaled to canvas
        for (let i = elements.length - 1; i >= 0; i--) {
          const el = elements[i];
          if (!el) continue;
          el.x += (p.noise(el.noiseOffX) - 0.5) * 2 * driftScale;
          el.y += (p.noise(el.noiseOffY) - 0.5) * 2 * driftScale;
          el.noiseOffX += 0.01;
          el.noiseOffY += 0.01;
          el.alpha -= fadeRate * frames; // dt-paced (windchime ran -=5 per 60fps frame)
          if (el.alpha <= 0) {
            elements.splice(i, 1);
            continue;
          }
          p.push();
          p.translate(el.x, el.y);
          p.noFill();
          p.stroke(el.color[0], el.color[1], el.color[2], el.alpha);
          p.strokeWeight(Math.max(1, 2 * s));
          drawShape(p, el.size * s);
          p.pop();
        }

        // ── step clock (windchime STEP_TIME = 5 frames); motion nudges the rate ──
        //    triggers fire ONLY here, on playback advancing under the play-head.
        stepTimer += frames * lerp(1.4, 0.7, cur.motion);
        if (stepTimer >= STEP_FRAMES) {
          stepTimer = 0;
          seq.advance();
          const sv = seq.values();
          const playhead = sv.playhead;
          for (let lane = 0; lane < sv.active.length; lane++) {
            if (sv.active[lane]) trigger(lane, playhead, cx, cy);
          }
        }

        // idiom LED feedback → ledOut (host mirrors to the twin + hardware)
        idioms.renderGrid(ctx.ledOut, profile);
        idioms.renderArc(ctx.ledOut, profile);
      },
    };
  },
};
