/**
 * pasHalloween — adapted (not forked) from windchime-animation
 * packages/sketch-families/src/pasHalloweenV3/index.ts (itself a hand-port of
 * processing_corupus_full/PAS_Haloweenv3/PAS_Haloweenv3.pde). A 2D parametric
 * element spawner (circle/triangle/square/star) with motion trails, driven by a
 * step sequencer: when a step fires, the firing lane + the playhead column set
 * the spawned element's size/speed/length, and a drifting element is born at
 * canvas centre.
 *
 * Lichtspiel rewiring: the bespoke per-sketch grid/arc state machine (manual
 * step matrix, cut/loop latch, raw arc LED counts) is replaced by the Part-2
 * idioms — a `stepSequencer` (toggle steps + playhead + loop/cut latch; 16 steps
 * on a Grid 128, 8 on a Grid 64) drives the step clock, and `arcMacros` map the
 * four encoders (enc0 trail-fade, enc1 hue shift, enc2 element lifespan, enc3
 * position jitter; press resets to 0.5). The visual core (element drift, fading
 * translucent backdrop trails, flickering lines, palettes/shapes) is concept-
 * adapted and parameterised by a structural variant. P2D, browser-resilient,
 * seeded RNG / Perlin only. Concept-adapted (not pixel-faithful).
 */

import type p5 from 'p5';
import { type VisualParamVector, clamp01, lerp } from '@lichtspiel/schemas';
import type { MountContext, VisualTemplate } from '../visualTemplate.js';
import {
  type ArcLedPolicy,
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

const TWO_PI = Math.PI * 2;
const MAX_ELEMENTS = 90; // 60fps particle cap

type Shape = 'circle' | 'triangle' | 'square' | 'star';

interface VisualElement {
  x: number;
  y: number;
  size: number;
  alpha: number;
  noiseOffX: number;
  noiseOffY: number;
  color: [number, number, number];
}

const variants = makeVariantFactory({
  palette: { canonical: 'random', options: ['random', 'warm', 'cool', 'neon', 'monochrome'] },
  trails: { canonical: 'medium', options: ['fast', 'medium', 'slow'] },
  shape: { canonical: 'circle', options: ['circle', 'triangle', 'square', 'star'] },
  arcLed: { canonical: 'fill', options: ['fill', 'comet', 'gauge', 'segments'] },
});

/** HSL→RGB (0..255). h in degrees, s/l in 0..1. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (h < 60) {
    r1 = c;
    g1 = x;
  } else if (h < 120) {
    r1 = x;
    g1 = c;
  } else if (h < 180) {
    g1 = c;
    b1 = x;
  } else if (h < 240) {
    g1 = x;
    b1 = c;
  } else if (h < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

export const pasHalloween: VisualTemplate = {
  id: 'pasHalloween',
  name: 'PAS Halloween',
  family: 'sequencer',
  description:
    'A 2D parametric element spawner with motion trails: each firing step spawns a drifting circle/triangle/square/star whose size, rate, and length come from its lane + column. The Grid 128 / Arc 4 trail-painter.',
  tags: ['sequencer', 'step', 'arc', 'shapes', 'trails', '2d', 'rhythmic', 'monome', 'spawner'],
  defaultParams: {
    motion: 0.5,
    density: 0.5,
    turbulence: 0.5,
    lineWeight: 0.5,
    palette: 0.4,
    contrast: 0.6,
    feedback: 0.5,
  },
  renderer: 'p2d',
  sourceLineage: 'windchime pasHalloweenV3 (PAS_Haloweenv3.pde, concept-adapted)',
  hardwareTarget: { grid: '128', arc: '4' },
  idioms: ['stepSequencer', 'arcMacros'],
  variants,

  create(ctx: MountContext) {
    const paletteMode = cfg<string>(ctx.config, 'palette', 'random');
    const trailMode = cfg<string>(ctx.config, 'trails', 'medium');
    const shape = cfg<Shape>(ctx.config, 'shape', 'circle');
    const arcLed = cfg<ArcLedPolicy>(ctx.config, 'arcLed', 'fill');

    let profile: IdiomProfile = profileFromSetup(ctx.setup);

    // ── idioms (the control map) ───────────────────────────────────
    const seq: StepSequencer = createStepSequencer();
    const arc: ArcMacros = createArcMacros({
      encoders: [
        { name: 'trail', initial: 0.5, led: arcLed, onPress: () => arc.set('trail', 0.5) },
        { name: 'hue', initial: 0.5, led: arcLed, onPress: () => arc.set('hue', 0.5) },
        { name: 'lifespan', initial: 0.5, led: arcLed, onPress: () => arc.set('lifespan', 0.5) },
        { name: 'jitter', initial: 0.5, led: arcLed, onPress: () => arc.set('jitter', 0.5) },
      ],
    });
    const idioms: ComposedIdiom = composeIdioms([seq, arc]);
    idioms.setProfile(profile);

    // ── structural state ───────────────────────────────────────────
    const elements: VisualElement[] = [];
    let stepClock = 0;
    let userEdited = false;
    let cur: VisualParamVector = ctx.initialParams;
    let driftPhase = 0; // advances the Perlin walk deterministically

    // base trail-fade alpha for the variant (lower = more persistent trails)
    const baseTrail = trailMode === 'slow' ? 4 : trailMode === 'fast' ? 30 : 14;

    /** A sparse default pattern, scaled to the step count, so the scene plays on
     *  mount and re-seeds across a hot-swap until the performer edits it. */
    function seedPattern(): void {
      seq.reset?.();
      const steps = seq.values().steps;
      for (let s = 0; s < steps; s += 4) seq.toggle(0, s, true); // lane 0: 4-on-the-floor
      seq.toggle(1, Math.min(2, steps - 1), true);
      seq.toggle(2, Math.min(6, steps - 1), true);
      seq.toggle(3, Math.min(10, steps - 1), true);
    }
    seedPattern();

    /** Pick a colour for a new element, conditioned on the palette variant. */
    function pickColor(): [number, number, number] {
      switch (paletteMode) {
        case 'warm':
          return hslToRgb(ctx.rng.range(0, 60), 0.85, 0.6);
        case 'cool':
          return hslToRgb(ctx.rng.range(180, 270), 0.85, 0.6);
        case 'neon': {
          const hues = [330, 280, 195, 60];
          return hslToRgb(ctx.rng.pick(hues), 1, 0.6);
        }
        case 'monochrome': {
          const v = ctx.rng.int(80) + 175;
          return [v, v, v];
        }
        case 'random':
        default:
          return hslToRgb(ctx.rng.range(0, 360), 0.8, 0.55);
      }
    }

    /** Spawn a drifting element at centre. `lane`+`col` shape its size; hueShift
     *  and jitter come from the arc (folded with the axes in draw). */
    function spawnElement(
      cx: number,
      cy: number,
      minDim: number,
      laneFrac: number,
      colFrac: number,
      size: number,
      hueShift: number,
      jitter: number,
    ): void {
      const base = pickColor();
      // arc enc1 hue-shift nudges the channels (concept-adapted from v3)
      const color: [number, number, number] = [
        clamp01((base[0] + hueShift * 60) / 255) * 255,
        clamp01((base[1] - hueShift * 30 + laneFrac * 20) / 255) * 255,
        clamp01((base[2] + hueShift * 40 + colFrac * 20) / 255) * 255,
      ];
      const spread = minDim * 0.05 * (0.4 + jitter);
      elements.push({
        x: cx + ctx.rng.range(-spread, spread),
        y: cy + ctx.rng.range(-spread, spread),
        size,
        alpha: 255,
        noiseOffX: ctx.rng.range(0, 1000),
        noiseOffY: ctx.rng.range(0, 1000),
        color,
      });
      while (elements.length > MAX_ELEMENTS) elements.shift();
    }

    function drawShape(p: p5, size: number): void {
      switch (shape) {
        case 'triangle': {
          const r = size * 0.5;
          p.beginShape();
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * TWO_PI - Math.PI / 2;
            p.vertex(Math.cos(a) * r, Math.sin(a) * r);
          }
          p.endShape(p.CLOSE);
          return;
        }
        case 'square':
          p.rect(0, 0, size, size);
          return;
        case 'star': {
          const r = size * 0.5;
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
          p.ellipse(0, 0, size, size);
          return;
      }
    }

    return {
      setup(p): void {
        p.createCanvas(ctx.width, ctx.height, p.P2D);
        p.noiseSeed(ctx.seed);
        p.ellipseMode(p.CENTER);
        p.rectMode(p.CENTER);
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

      onGridKey(e): void {
        userEdited = true;
        idioms.onGridKey?.(e);
      },
      onArcDelta(e): void {
        idioms.onArcDelta?.(e);
      },
      onArcKey(e): void {
        idioms.onArcKey?.(e);
      },

      draw({ p, width, height, dt }): void {
        const cx = width * 0.5;
        const cy = height * 0.5;
        const minDim = Math.min(width, height);

        // ── fold idiom values with the param axes (centred 0.5 = no nudge) ──
        const a = arc.values();
        const fold = (v: number, axis: number): number => clamp01(v + (axis - 0.5) * 0.4);
        const trail = fold(a.trail ?? 0.5, cur.feedback); // 0 = persistent .. 1 = clears fast
        const hueShift = ((a.hue ?? 0.5) - 0.5) * 2; // -1..+1
        const lifespan = lerp(0.4, 3, fold(a.lifespan ?? 0.5, cur.turbulence));
        const jitter = lerp(0, 4, fold(a.jitter ?? 0.5, cur.turbulence));

        // ── fading translucent backdrop → motion trails (enc0 controls alpha) ──
        const trailAlpha = Math.max(2, baseTrail * lerp(2, 0.2, trail));
        p.noStroke();
        p.fill(0, trailAlpha);
        p.rect(cx, cy, width, height);

        // ── step clock — rides motion (faster when motion is high) ──
        stepClock += dt;
        const interval = lerp(0.26, 0.07, cur.motion);
        let triggered = false;
        if (stepClock >= interval) {
          stepClock = 0;
          seq.advance();
          const sv = seq.values();
          const colFrac = sv.steps > 1 ? sv.playhead / (sv.steps - 1) : 0;
          for (let lane = 0; lane < sv.active.length; lane++) {
            if (!sv.active[lane]) continue;
            triggered = true;
            const laneFrac = sv.laneRows > 1 ? lane / (sv.laneRows - 1) : 0;
            // lane + column shape the element (concept-adapted from v3's
            // row→param bindings): size from lane, base scaled by column.
            const size = minDim * lerp(0.04, 0.26, laneFrac) * (0.6 + colFrac * 0.8);
            spawnElement(cx, cy, minDim, laneFrac, colFrac, size, hueShift, jitter);
          }
        }

        // ── flickering lines (rate/length/weight from the firing column + axes) ──
        const sv = seq.values();
        const colFrac = sv.steps > 1 ? sv.playhead / (sv.steps - 1) : 0;
        const lineRate = lerp(0, 6, clamp01(sv.density * 0.7 + cur.density * 0.3));
        let numLines = Math.floor(lineRate);
        if (ctx.rng.random() < lineRate - numLines) numLines++;
        if (numLines > 0) {
          const lc = pickColor();
          const lineLen = minDim * lerp(0.08, 0.55, colFrac);
          p.strokeWeight(lerp(1, 8, cur.lineWeight));
          for (let i = 0; i < numLines; i++) {
            const x1 = ctx.rng.range(0, width);
            const y1 = ctx.rng.range(0, height);
            const x2 = x1 + ctx.rng.range(-lineLen, lineLen);
            const y2 = y1 + ctx.rng.range(-lineLen, lineLen);
            p.stroke(lc[0], lc[1], lc[2], ctx.rng.range(40, 140) * (0.5 + cur.contrast * 0.5));
            p.line(x1, y1, x2, y2);
          }
        }

        // ── update + draw drifting elements ──
        driftPhase += dt;
        const fadeRate = (3 + (1 - cur.feedback) * 3) / Math.max(0.1, lifespan);
        const drift = (0.5 + jitter * 0.5) * minDim * 0.0035;
        for (let i = elements.length - 1; i >= 0; i--) {
          const el = elements[i];
          if (!el) continue;
          el.x += (p.noise(el.noiseOffX, driftPhase * 0.2) - 0.5) * 2 * drift;
          el.y += (p.noise(el.noiseOffY, driftPhase * 0.2) - 0.5) * 2 * drift;
          el.noiseOffX += 0.01;
          el.noiseOffY += 0.01;
          el.alpha -= fadeRate;
          if (el.alpha <= 0) {
            elements.splice(i, 1);
            continue;
          }
          p.push();
          p.translate(el.x, el.y);
          p.noFill();
          p.stroke(el.color[0], el.color[1], el.color[2], el.alpha);
          p.strokeWeight(lerp(1.5, 4, cur.lineWeight));
          drawShape(p, el.size);
          p.pop();
        }

        // a faint centre pulse on a trigger frame so empty patterns still read
        if (triggered) {
          p.noStroke();
          p.fill(255, 255, 255, 26);
          p.ellipse(cx, cy, minDim * 0.04, minDim * 0.04);
        }

        // idiom LED feedback → ledOut (host mirrors to the twin + hardware)
        idioms.renderGrid(ctx.ledOut, profile);
        idioms.renderArc(ctx.ledOut, profile);
      },
    };
  },
};
