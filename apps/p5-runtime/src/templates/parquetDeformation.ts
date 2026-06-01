/**
 * parquetDeformation — adapted (not forked) from windchime-animation
 * packages/sketch-families/src/parquetDeformation (itself a hand-port of
 * processing_corpus_full/Parquet_Deformation/Parquet_v3_glitch.pde). A
 * continuously deforming parquet of two stacked Perlin-noise meshes (background
 * + foreground) with a row of small rotating 3D shapes overlaid on top.
 *
 * Lichtspiel rewiring (concept-adapted, not pixel-faithful): the bespoke
 * per-sketch grid + arc handling is replaced by the Part-2 idioms — a
 * `stepSequencer` (toggle steps + playhead + loop/cut latch; 16 steps on a
 * Grid 128, 8 on a Grid 64) whose active steps at the playhead retrigger
 * deformation bursts / colour changes (each lane maps to a deform parameter:
 * colour-shuffle / deform-speed / mesh-tilt / scale), and `arcMacros` (enc0
 * camera zoom, enc1 bg tilt, enc2 fg tilt, enc3 overlay vertical position; all
 * 'fill' rings; press resets that encoder to centre). The audio-reactive source
 * (Minim) is dropped entirely. The RNG-seeded z-array of the original is
 * replaced by a deterministic p.noise() field (seeded via ctx.seed) — robust,
 * allocation-free, 60fps. WEBGL, browser-only resilient.
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

/** Per-palette colour pools (foreground tint + overlay-shape tints). */
const PALETTES: Record<string, number[][]> = {
  warm: [
    [240, 120, 40],
    [230, 60, 60],
    [250, 200, 80],
    [205, 90, 140],
  ],
  cool: [
    [60, 160, 230],
    [80, 220, 200],
    [120, 120, 240],
    [60, 230, 150],
  ],
  neon: [
    [255, 60, 200],
    [60, 255, 220],
    [200, 255, 40],
    [255, 230, 40],
  ],
  monochrome: [
    [235, 235, 240],
    [150, 150, 160],
    [200, 200, 210],
    [120, 120, 135],
  ],
};

/** Background mesh wash per palette (kept dim — it sits behind the fg). */
const BG_TINT: Record<string, number[]> = {
  warm: [90, 60, 70],
  cool: [70, 90, 130],
  neon: [80, 50, 110],
  monochrome: [70, 70, 80],
};

const variants = makeVariantFactory({
  palette: { canonical: 'random', options: ['random', 'warm', 'cool', 'neon', 'monochrome'] },
  density: { canonical: 8, options: [4, 8, 16] },
  shape: { canonical: 'cube', options: ['pyramid', 'octahedron', 'cube'] },
  arcLed: { canonical: 'fill', options: ['fill', 'gauge', 'segments', 'comet'] },
});

/** How many lanes map onto deform-parameter categories (rest cycle round). */
const DEFORM_CATEGORIES = 4;

export const parquetDeformation: VisualTemplate = {
  id: 'parquetDeformation',
  name: 'Parquet Deformation',
  family: 'mesh',
  description:
    'Two stacked deforming Perlin meshes with a row of rotating 3D shapes; a step sequencer retriggers deformation bursts and colour changes while the arc steers camera + tilt.',
  tags: ['mesh', 'tessellation', 'deformation', 'noise', 'step', 'sequencer', '3d', 'arc', 'monome'],
  defaultParams: { density: 0.5, motion: 0.5, turbulence: 0.5, contrast: 0.6, palette: 0.4 },
  renderer: 'webgl',
  sourceLineage: 'windchime parquetDeformation (Parquet_v3_glitch.pde)',
  hardwareTarget: { grid: '128', arc: '4' },
  idioms: ['stepSequencer', 'arcMacros'],
  variants,

  create(ctx: MountContext) {
    const paletteName = cfg<string>(ctx.config, 'palette', 'random');
    const meshDensity = cfg<number>(ctx.config, 'density', 8);
    const shape = cfg<string>(ctx.config, 'shape', 'cube');
    const arcLed = cfg<ArcLedPolicy>(ctx.config, 'arcLed', 'fill');

    let profile: IdiomProfile = profileFromSetup(ctx.setup);
    const seq: StepSequencer = createStepSequencer();
    const arc: ArcMacros = createArcMacros({
      encoders: [
        { name: 'zoom', initial: 0.5, led: arcLed, onPress: () => arc.set('zoom', 0.5) },
        { name: 'bgTilt', initial: 0.5, led: arcLed, onPress: () => arc.set('bgTilt', 0.5) },
        { name: 'fgTilt', initial: 0.5, led: arcLed, onPress: () => arc.set('fgTilt', 0.5) },
        { name: 'overlayY', initial: 0.5, led: arcLed, onPress: () => arc.set('overlayY', 0.5) },
      ],
    });
    const idioms: ComposedIdiom = composeIdioms([seq, arc]);
    idioms.setProfile(profile);

    // ── palette / overlay-shape colours, derived reproducibly from the rng ──
    const palette = PALETTES[paletteName];
    const bgTint = BG_TINT[paletteName] ?? [70, 70, 80];
    /** A reproducible colour, either from the named pool or random (avoid white). */
    const pickColor = (): number[] => {
      if (palette) return palette[ctx.rng.int(palette.length)] ?? [220, 220, 220];
      for (let attempt = 0; attempt < 5; attempt++) {
        const c = [ctx.rng.int(256), ctx.rng.int(256), ctx.rng.int(256)];
        if (((c[0] ?? 0) + (c[1] ?? 0) + (c[2] ?? 0)) / 3 <= 200) return c;
      }
      return [120, 120, 130];
    };
    // One colour slot per step (the playhead's slot tints the fg mesh + overlay).
    const STEP_SLOTS = 16;
    const stepColors: number[][] = Array.from({ length: STEP_SLOTS }, () => pickColor());

    // ── overlay shapes (a small, capped row) ──
    const OVERLAY_COUNT = 7;
    const overlayOffsets = Array.from({ length: OVERLAY_COUNT }, (_, i) => ({
      x: (i - (OVERLAY_COUNT - 1) / 2) / OVERLAY_COUNT, // -0.5..0.5 of min-dim
      z: ctx.rng.range(-0.12, 0.12),
      spin: ctx.rng.range(0.4, 1.2),
    }));

    // ── deform state (mutated per-lane retrigger) ──
    const RES = Math.max(4, Math.min(16, Math.round(meshDensity))); // grid resolution cap
    let deformSpeed = 0.35; // noise-field scroll speed (units/sec)
    let tiltBias = 0; // extra mesh tilt from a lane trigger
    let meshScale = 1; // fg mesh height scale
    let colorShuffleAt = -1; // step slot to re-roll on next trigger
    let burst = 0; // 0..1 visual flash on a fresh trigger
    let zPhase = 0; // scrolling noise offset (drives the deformation)

    let stepClock = 0;
    let userEdited = false;
    let cur: VisualParamVector = ctx.initialParams;

    /** A sparse default pattern, re-fit to the current step count until edited. */
    function seedPattern(): void {
      seq.reset?.();
      const steps = seq.values().steps;
      for (let s = 0; s < steps; s += 4) seq.toggle(0, s, true);
      seq.toggle(1, Math.min(2, steps - 1), true);
      seq.toggle(2, Math.min(6, steps - 1), true);
      seq.toggle(3, Math.min(5, steps - 1), true);
    }
    seedPattern();

    /** Map a firing lane → a deform-parameter change (the column-block concept). */
    function applyLaneTrigger(lane: number): void {
      const cat = lane % DEFORM_CATEGORIES;
      const intensity = 0.5 + cur.turbulence; // 0.5..1.5
      switch (cat) {
        case 0: // colour shuffle: re-roll the playhead's colour slot
          colorShuffleAt = seq.values().playhead % STEP_SLOTS;
          break;
        case 1: // deform speed
          deformSpeed = lerp(0.18, 0.9, ctx.rng.random()) * intensity;
          break;
        case 2: // mesh tilt bias
          tiltBias = ctx.rng.range(-0.35, 0.35) * intensity;
          break;
        case 3: // fg height scale
          meshScale = lerp(0.7, 1.7, ctx.rng.random());
          break;
        default:
          break;
      }
    }

    /** Per-vertex deform height from the scrolling noise field, in [-1, 1]. */
    function deform(p: p5, gx: number, gy: number, layer: number): number {
      // distinct fields per layer; gentle frequency keeps it smooth + fast
      const n = p.noise(gx * 0.45 + layer * 11.3, gy * 0.45 + layer * 7.1, zPhase);
      return n * 2 - 1;
    }

    /** Draw one deforming mesh as a quad grid centred on the origin. */
    function drawMesh(
      p: p5,
      extent: number,
      heightAmp: number,
      layer: number,
      fillCol: number[],
      strokeAlpha: number,
    ): void {
      const cell = (extent * 2) / RES;
      p.noStroke();
      if (strokeAlpha > 0) {
        p.stroke(255, 255, 255, strokeAlpha);
        p.strokeWeight(1);
      }
      p.fill(fillCol[0] ?? 200, fillCol[1] ?? 200, fillCol[2] ?? 200);
      for (let gy = 0; gy < RES; gy++) {
        p.beginShape(p.TRIANGLE_STRIP);
        for (let gx = 0; gx <= RES; gx++) {
          const x = -extent + gx * cell;
          const y0 = -extent + gy * cell;
          const y1 = y0 + cell;
          p.vertex(x, y0, deform(p, gx, gy, layer) * heightAmp);
          p.vertex(x, y1, deform(p, gx, gy + 1, layer) * heightAmp);
        }
        p.endShape();
      }
    }

    /** Draw one small overlay shape (pyramid / octahedron / cube) at the origin. */
    function drawShape(p: p5, s: number): void {
      switch (shape) {
        case 'pyramid':
          p.beginShape(p.TRIANGLES);
          for (let i = 0; i < 4; i++) {
            const a1 = (i / 4) * Math.PI * 2;
            const a2 = ((i + 1) / 4) * Math.PI * 2;
            p.vertex(Math.cos(a1) * s, Math.sin(a1) * s, -s);
            p.vertex(Math.cos(a2) * s, Math.sin(a2) * s, -s);
            p.vertex(0, 0, s);
          }
          p.endShape();
          break;
        case 'octahedron':
          p.beginShape(p.TRIANGLES);
          {
            const v = [
              [0, 0, s],
              [0, 0, -s],
              [s, 0, 0],
              [-s, 0, 0],
              [0, s, 0],
              [0, -s, 0],
            ];
            const faces = [
              [0, 2, 4],
              [0, 4, 3],
              [0, 3, 5],
              [0, 5, 2],
              [1, 4, 2],
              [1, 3, 4],
              [1, 5, 3],
              [1, 2, 5],
            ];
            for (const f of faces)
              for (const vi of f) {
                const vv = v[vi];
                if (vv) p.vertex(vv[0] ?? 0, vv[1] ?? 0, vv[2] ?? 0);
              }
          }
          p.endShape();
          break;
        case 'cube':
        default:
          p.box(s * 1.4);
          break;
      }
    }

    return {
      setup(p): void {
        p.createCanvas(ctx.width, ctx.height, p.WEBGL);
        p.noiseSeed(ctx.seed);
        p.noiseDetail(4, 0.55);
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
        const minDim = Math.min(width, height);
        const extent = minDim * 0.32;
        const av = arc.values();

        // ── step clock — tempo rides `motion` (faster when motion is high) ──
        stepClock += dt;
        const interval = lerp(0.34, 0.09, clamp01(cur.motion));
        if (stepClock >= interval) {
          stepClock = 0;
          seq.advance();
          const active = seq.values().active;
          for (let lane = 0; lane < active.length; lane++) {
            if (active[lane]) {
              applyLaneTrigger(lane);
              burst = 1;
            }
          }
          if (colorShuffleAt >= 0) {
            stepColors[colorShuffleAt] = pickColor();
            colorShuffleAt = -1;
          }
        }

        // ── scroll the deformation field (turbulence boosts the speed) ──
        zPhase += deformSpeed * (0.6 + cur.turbulence) * dt;
        burst *= 0.9;

        // ── arc-driven camera + tilts (centred axis 0.5 = neutral) ──
        const zoom = lerp(0.55, 1.7, av.zoom ?? 0.5);
        const bgTilt = ((av.bgTilt ?? 0.5) - 0.5) * Math.PI + Math.PI * 0.28;
        const fgTilt = ((av.fgTilt ?? 0.5) - 0.5) * Math.PI + Math.PI * 0.22 + tiltBias;
        const overlayY = lerp(-extent * 1.1, extent * 1.1, av.overlayY ?? 0.5);

        // gentle fold of contrast → brightness; density nudges fg amplitude
        const bright = lerp(0.7, 1.25, clamp01(cur.contrast));
        const ampScale = lerp(0.8, 1.25, clamp01(cur.density));

        const flash = burst * 14;
        p.background(5 + flash, 5 + flash, 8 + flash);
        p.ambientLight(50 + flash);
        p.directionalLight(255, 255, 255, 0.2, 0.5, -1);
        p.pointLight(160, 190, 255, 0, -extent, extent);

        p.scale(zoom);

        const fgColor = stepColors[seq.values().playhead % STEP_SLOTS] ?? [220, 220, 220];

        // ── background mesh (dim wash, its own tilt) ──
        p.push();
        p.rotateX(bgTilt);
        p.translate(0, 0, -extent * 0.35);
        drawMesh(
          p,
          extent,
          extent * 0.22 * (0.6 + cur.turbulence),
          0,
          [bgTint[0] ?? 70, bgTint[1] ?? 70, bgTint[2] ?? 80],
          40,
        );
        p.pop();

        // ── foreground mesh (step-tinted, scaled by triggers + density) ──
        p.push();
        p.rotateX(fgTilt);
        drawMesh(
          p,
          extent,
          extent * 0.34 * meshScale * ampScale * (0.6 + cur.turbulence),
          1,
          [
            Math.min(255, (fgColor[0] ?? 200) * bright),
            Math.min(255, (fgColor[1] ?? 200) * bright),
            Math.min(255, (fgColor[2] ?? 200) * bright),
          ],
          70,
        );
        p.pop();

        // ── overlay row of small rotating shapes, facing the camera ──
        const shapeSize = minDim * 0.035 * (1 + burst * 0.4);
        const spinBase = zPhase * 1.4;
        p.push();
        p.translate(0, overlayY, extent * 0.5);
        p.noStroke();
        for (let i = 0; i < overlayOffsets.length; i++) {
          const o = overlayOffsets[i];
          if (!o) continue;
          const c = stepColors[(seq.values().playhead + i) % STEP_SLOTS] ?? [200, 200, 200];
          p.push();
          p.translate(o.x * minDim, 0, o.z * minDim);
          p.rotateY(spinBase * o.spin);
          p.rotateX(spinBase * o.spin * 0.6);
          p.fill(
            Math.min(255, (c[0] ?? 200) * bright),
            Math.min(255, (c[1] ?? 200) * bright),
            Math.min(255, (c[2] ?? 200) * bright),
          );
          drawShape(p, shapeSize);
          p.pop();
        }
        p.pop();

        idioms.renderGrid(ctx.ledOut, profile);
        idioms.renderArc(ctx.ledOut, profile);
      },
    };
  },
};
