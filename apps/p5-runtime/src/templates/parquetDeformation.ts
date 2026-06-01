/**
 * parquetDeformation — faithful port (not forked) of windchime-animation
 * packages/sketch-families/src/parquetDeformation (itself a hand-port of
 * processing_corupus_full/Parquet_Deformation/Parquet_v3_glitch/Parquet_v3_glitch.pde).
 *
 * The visual core is preserved verbatim: TWO stacked deforming meshes (a blue
 * background mesh tilted by bgTilt + a step-coloured foreground mesh tilted by
 * fgTilt), each a grid of QUAD cells whose per-cell Z heights advance every frame
 * (z += deformSpeed*0.5, wrapping >1 → -1) — the windchime "parquet deformation"
 * shimmer; plus 10 small rotating 3D objects (cube / pyramid / octahedron per the
 * `shape` variant) overlaid near top-centre, their vertical position arc-driven.
 * windchime's perf guard (cell count derived from the `density` variant: fine 25 /
 * medium 40 / coarse 60 px cells over a 900² logical field) is kept, and the whole
 * field is scaled to the live canvas so nothing is hardcoded to 900.
 *
 * Lichtspiel rewiring (control/LED → idioms): windchime's hardcoded 16-col grid +
 * raw 4-encoder arc state machine become a `stepSequencer({ steps: 16 })` (16 steps
 * fixed + paging, so on a Grid 64 the 8-wide view pages to keep ALL FOUR parameter-
 * category column-blocks reachable) + `arcMacros` (4 absolute encoders, `fill` rings:
 * enc0 zoom · enc1 bgTilt · enc2 fgTilt · enc3 overlay-Y; press resets that channel to
 * its canonical mid). The family-defining TRIGGER MODEL is faithful — a step fires on
 * BOTH press AND playback, and the COLUMN (absolute step 0..15) selects the parameter
 * category while the ROW multiplies: col 0-3 → randomise stepColors[col]; 4-7 →
 * deformSpeed; 8-11 → brightness; 12-15 → scale. The audio in the original (Minim +
 * Vaporwave loop) is stripped per the migration plan. WEBGL.
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

// ── windchime constants (Parquet_v3_glitch.pde) ────────────────────
const SEQ_STEPS = 16; // family-defining: the COLUMN carries parameter-category meaning
const LOGICAL_FIELD = 900; // windchime's 900×900 mesh field (scaled to the live canvas)
const STEP_FRAMES = 5; // windchime STEP_TIME — a fast clock (5 frames @ 60fps)
const NUM_OBJECTS = 10; // 10 small rotating 3D objects overlaid near top centre

type PaletteMode = 'random' | 'sunset' | 'arctic' | 'forest' | 'neon';
type MeshDensity = 'fine' | 'medium' | 'coarse';
type ObjectShape = 'cube' | 'pyramid' | 'octahedron';

// ── full variant space (EXACT pools from windchime params.ts) ──────
const variants = makeVariantFactory({
  palette: { canonical: 'random', options: ['random', 'sunset', 'arctic', 'forest', 'neon'] },
  density: { canonical: 'medium', options: ['fine', 'medium', 'coarse'] },
  shape: { canonical: 'cube', options: ['cube', 'pyramid', 'octahedron'] },
});

/** windchime cellSize — coarser = fewer cells = faster (the perf guard). */
function cellSize(d: MeshDensity): number {
  switch (d) {
    case 'fine':
      return 25;
    case 'coarse':
      return 60;
    case 'medium':
    default:
      return 40;
  }
}

/**
 * windchime paletteColor — one RGB per step, conditioned on the palette mode.
 * `random` replicates the original's "reroll if too bright" guard.
 */
function paletteColor(mode: PaletteMode, rng: MountContext['rng']): Rgb {
  switch (mode) {
    case 'sunset':
      return hslToRgb(rng.range(0, 40), rng.range(0.7, 1), 0.55);
    case 'arctic':
      return hslToRgb(rng.range(180, 230), rng.range(0.4, 0.7), 0.6);
    case 'forest':
      return hslToRgb(rng.range(80, 160), rng.range(0.5, 0.9), 0.45);
    case 'neon': {
      const hues = [330, 280, 195, 60];
      return hslToRgb(hues[rng.int(hues.length)] ?? 0, 1, 0.6);
    }
    case 'random':
    default: {
      // Avoid near-white (replicates the original's brightness > 200 reroll).
      for (let attempt = 0; attempt < 5; attempt++) {
        const c: Rgb = [rng.int(256), rng.int(256), rng.int(256)];
        const brightness = (c[0] + c[1] + c[2]) / 3;
        if (brightness <= 200) return c;
      }
      return [120, 120, 120];
    }
  }
}

/** windchime stepColors — 16 step colours (one per absolute step). */
function stepColors16(mode: PaletteMode, rng: MountContext['rng']): Rgb[] {
  const out: Rgb[] = [];
  for (let i = 0; i < SEQ_STEPS; i++) out.push(paletteColor(mode, rng));
  return out;
}

export const parquetDeformation: VisualTemplate = {
  id: 'parquetDeformation',
  name: 'Parquet Deformation',
  family: 'sequencer',
  description:
    'Two stacked Perlin-deformed meshes shimmer while 10 small 3D solids rotate above. A 16-step grid sequencer where the COLUMN selects a parameter category (colour / deform-speed / brightness / scale) and the ROW multiplies it — steps fire on both press and playback. The Grid 128 / Arc 4 parameter-trigger mesh.',
  tags: ['sequencer', 'step', 'arc', 'mesh', 'noise', '3d', 'deformation', 'parquet', 'monome'],
  defaultParams: { motion: 0.5, turbulence: 0.5, density: 0.5, contrast: 0.6, palette: 0.3 },
  renderer: 'webgl',
  sourceLineage: 'windchime parquetDeformation (Parquet_v3_glitch.pde, faithful port)',
  hardwareTarget: { grid: '128', arc: '4' },
  idioms: ['stepSequencer', 'arcMacros'],
  gestural: {
    name: 'Step Sequencer + Deforming Noise Mesh',
    summary:
      'Steps toggle on press AND fire on playback — both events trigger column-block parameter changes. Two layered noise meshes deform continuously while the play-head colours the foreground. Arc adds camera + tilt control to the originally grid-only sketch.',
    grid: [
      {
        area: 'grid rows 0-5, any column',
        action: 'press',
        effect: 'toggle step AND trigger that (row, col) parameter change',
      },
      {
        area: 'grid rows 0-5 during playback',
        action: 'step fires',
        effect:
          "col 0-3 = randomise that step's colour; col 4-7 = deform speed × row+1; col 8-11 = brightness × row+1; col 12-15 = scale × row+1",
      },
      {
        area: 'grid row 7, any column',
        action: 'press (first then second)',
        effect: 'set loop_start on first held press, loop_end on second (auto-swap if reversed)',
      },
    ],
    arc: [
      { area: 'arc encoder 0', action: 'rotate', effect: 'global zoom / camera distance' },
      { area: 'arc encoder 1', action: 'rotate', effect: 'background-mesh tilt angle (canonical = π/4)' },
      { area: 'arc encoder 2', action: 'rotate', effect: 'foreground-mesh tilt angle (canonical = π/3)' },
      { area: 'arc encoder 3', action: 'rotate', effect: 'vertical position of the 10-object overlay (top..bottom)' },
      { area: 'arc encoders 0-3', action: 'press', effect: 'reset that channel to mid-range' },
    ],
  },
  variants,

  create(ctx: MountContext) {
    const paletteMode = cfg<PaletteMode>(ctx.config, 'palette', 'random');
    const density = cfg<MeshDensity>(ctx.config, 'density', 'medium');
    const shape = cfg<ObjectShape>(ctx.config, 'shape', 'cube');

    // ── logical mesh field (windchime's perf guard, kept exactly) ──
    const scl = cellSize(density); // px per cell over the 900² logical field
    const cols = Math.floor(LOGICAL_FIELD / scl);
    const rows = Math.floor(LOGICAL_FIELD / scl);

    // ── arc encoder frac ↔ windchime value mappings ────────────────
    // zoom   = 0.5 + frac*1.5   (0.5..2)   → canonical 1   ⇒ frac 1/3
    // bgTilt = (frac-0.5)*π                → canonical π/4 ⇒ frac 0.75
    // fgTilt = (frac-0.5)*π                → canonical π/3 ⇒ frac 1/3 + 0.5
    // overlayY uses a logical -h/2..h/2 sweep → canonical -h/8 ⇒ frac 3/8
    const ZOOM_MID = 1 / 3;
    const BGTILT_MID = 0.75;
    const FGTILT_MID = 0.5 + 1 / 3;
    const OVERLAY_MID = 3 / 8;
    const zoomFromFrac = (f: number): number => 0.5 + f * 1.5;
    const tiltFromFrac = (f: number): number => (f - 0.5) * Math.PI;

    // ── idioms (the control map) ───────────────────────────────────
    let profile: IdiomProfile = profileFromSetup(ctx.setup);
    // 16 steps fixed + paging: on a Grid 64 (8 cols) the view pages so all four
    // column-block parameter categories (cols 0-3 / 4-7 / 8-11 / 12-15) stay reachable.
    const seq: StepSequencer = createStepSequencer({ steps: SEQ_STEPS });
    const arc: ArcMacros = createArcMacros({
      encoders: [
        { name: 'zoom', label: 'camera zoom', pressLabel: 'reset zoom', mode: 'absolute', led: 'fillNotched', initial: ZOOM_MID, onPress: () => arc.set('zoom', ZOOM_MID) },
        { name: 'bgTilt', label: 'bg-mesh tilt', pressLabel: 'reset bg tilt', mode: 'absolute', led: 'fillNotched', initial: BGTILT_MID, onPress: () => arc.set('bgTilt', BGTILT_MID) },
        { name: 'fgTilt', label: 'fg-mesh tilt', pressLabel: 'reset fg tilt', mode: 'absolute', led: 'fillNotched', initial: FGTILT_MID, onPress: () => arc.set('fgTilt', FGTILT_MID) },
        { name: 'overlayY', label: 'object overlay Y', pressLabel: 'reset overlay', mode: 'absolute', led: 'fillNotched', initial: OVERLAY_MID, onPress: () => arc.set('overlayY', OVERLAY_MID) },
      ],
    });
    const idioms: ComposedIdiom = composeIdioms([seq, arc]);
    idioms.setProfile(profile);

    // ── structural state (windchime PortableState, idiom-driven) ───
    // Per-cell Z heights — windchime seeds them random in [-1,1], then advances +
    // wraps each frame (the "noiseDetail" call in setup is vestigial but kept faithful).
    const initField = (): number[][] => {
      const grid: number[][] = [];
      for (let i = 0; i < cols; i++) {
        const col: number[] = [];
        for (let j = 0; j < rows; j++) col.push(ctx.rng.range(-1, 1));
        grid.push(col);
      }
      return grid;
    };
    const zBg = initField();
    const zFg = initField();
    const stepColors: Rgb[] = stepColors16(paletteMode, ctx.rng);
    let deformSpeed = 0.04;
    let brightness = 1.0;
    let scaleParam = 1.0;
    // 10 objects scattered near top-centre (windchime ranges, in logical 900² units).
    const objectPositions: Array<[number, number]> = Array.from(
      { length: NUM_OBJECTS },
      () => [ctx.rng.range(-300, 300), ctx.rng.range(-100, 100)] as [number, number],
    );

    let stepTimer = 0; // accumulated frames since the last advance
    let userEdited = false;
    let frameCount = 0; // monotonic — drives the object rotation (windchime frameCount*0.01)
    let cur: VisualParamVector = ctx.initialParams;

    /**
     * windchime trigger() — the family-defining model. `col` is the ABSOLUTE step
     * index 0..15 (so the parameter-category column-blocks are honoured regardless
     * of the connected grid width); `row` multiplies. Fires on press AND playback.
     */
    function trigger(row: number, col: number): void {
      if (col < 4) {
        stepColors[col] = paletteColor(paletteMode, ctx.rng);
      } else if (col < 8) {
        deformSpeed = (0.01 + ((col - 4) / 3) * 0.09) * (row + 1);
      } else if (col < 12) {
        brightness = (0.5 + ((col - 8) / 3) * 1.0) * (row + 1);
      } else {
        scaleParam = (0.5 + ((col - 12) / 3) * 1.5) * (row + 1);
      }
    }

    /** A sparse default pattern so the sequencer plays + triggers on mount. */
    function seedPattern(): void {
      seq.reset?.();
      // one trigger per category block + a row multiplier, so all four params move.
      seq.toggle(0, 0, true); // col 0  → colour
      seq.toggle(1, 5, true); // col 5  → deform speed
      seq.toggle(2, 9, true); // col 9  → brightness
      seq.toggle(3, 13, true); // col 13 → scale
    }
    seedPattern();

    /** windchime drawMesh — a field of deforming QUAD cells (z scaled by zRange). */
    function drawMesh(p: p5, z: number[][], scaleFactor: number, zRange: number): void {
      for (let y = 0; y < rows - 1; y++) {
        for (let x = 0; x < cols - 1; x++) {
          const r0 = z[x]?.[y] ?? 0;
          const r1 = z[x + 1]?.[y] ?? 0;
          const r2 = z[x + 1]?.[y + 1] ?? 0;
          const r3 = z[x]?.[y + 1] ?? 0;
          p.beginShape(p.QUADS);
          p.vertex(x * scl * scaleFactor, y * scl * scaleFactor, r0 * zRange * scaleFactor);
          p.vertex((x + 1) * scl * scaleFactor, y * scl * scaleFactor, r1 * zRange * scaleFactor);
          p.vertex((x + 1) * scl * scaleFactor, (y + 1) * scl * scaleFactor, r2 * zRange * scaleFactor);
          p.vertex(x * scl * scaleFactor, (y + 1) * scl * scaleFactor, r3 * zRange * scaleFactor);
          p.endShape();
        }
      }
    }

    /** Advance + wrap a noise field in place (z += deformSpeed*0.5, wrap >1 → -1). */
    function advanceField(z: number[][]): void {
      for (let i = 0; i < cols; i++) {
        const col = z[i];
        if (!col) continue;
        for (let j = 0; j < rows; j++) {
          const next = (col[j] ?? 0) + deformSpeed * 0.5;
          col[j] = next > 1 ? -1 : next;
        }
      }
    }

    /** windchime drawComplexObject — a small rotating cube / pyramid / octahedron. */
    function drawComplexObject(p: p5, color: Rgb): void {
      p.push();
      p.rotateX(frameCount * 0.01);
      p.rotateY(frameCount * 0.01);
      p.fill(color[0], color[1], color[2], 150);

      if (shape === 'pyramid') {
        p.stroke(255 * brightness * 0.4);
        const s = 30;
        p.beginShape(p.TRIANGLES);
        for (let i = 0; i < 4; i++) {
          const a1 = (i / 4) * Math.PI * 2;
          const a2 = ((i + 1) / 4) * Math.PI * 2;
          p.vertex(Math.cos(a1) * s, Math.sin(a1) * s, -s);
          p.vertex(Math.cos(a2) * s, Math.sin(a2) * s, -s);
          p.vertex(0, 0, s);
        }
        p.endShape();
      } else if (shape === 'octahedron') {
        const s = 35;
        p.stroke(0, 200, 200);
        p.beginShape(p.TRIANGLES);
        const v: number[][] = [
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
        for (const f of faces) {
          for (const vi of f) {
            const vv = v[vi];
            if (vv) p.vertex(vv[0] ?? 0, vv[1] ?? 0, vv[2] ?? 0);
          }
        }
        p.endShape();
      } else {
        // cube (canonical)
        p.stroke(255, 0, 0);
        const s = 30;
        p.beginShape(p.QUADS);
        const faces = [
          [[-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s]],
          [[-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s]],
          [[-s, -s, -s], [-s, -s, s], [-s, s, s], [-s, s, -s]],
          [[s, -s, -s], [s, -s, s], [s, s, s], [s, s, -s]],
          [[-s, -s, -s], [s, -s, -s], [s, -s, s], [-s, -s, s]],
          [[-s, s, -s], [s, s, -s], [s, s, s], [-s, s, s]],
        ];
        for (const face of faces) {
          for (const vv of face) p.vertex(vv[0] ?? 0, vv[1] ?? 0, vv[2] ?? 0);
        }
        p.endShape();
      }
      p.pop();
    }

    return {
      setup(p): void {
        p.createCanvas(ctx.width, ctx.height, p.WEBGL);
        p.noiseDetail(8, 0.65); // faithful (vestigial — meshes advance, don't sample noise)
      },

      update(params): void {
        cur = params;
      },

      setProfile(setup): void {
        profile = profileFromSetup(setup);
        idioms.setProfile(profile);
        if (!userEdited) seedPattern(); // re-fit the default pattern across a hot-swap
      },
      controlMap: (setup) => idioms.describe(profileFromSetup(setup)),

      onGridKey(e): void {
        userEdited = true;
        idioms.onGridKey?.(e); // the idiom owns the toggle + loop/cut latch
        // windchime fires the trigger on PRESS too. A lane press at physical column
        // e.x maps to the absolute step on the current page; the column-block then
        // selects the parameter category. Honour it (the idiom already toggled).
        const sv = seq.values();
        if (e.state === 1 && e.y >= 0 && e.y < sv.laneRows && e.x >= 0 && e.x < profile.cols) {
          const step = sv.page * profile.cols + e.x;
          if (step >= 0 && step < SEQ_STEPS) trigger(e.y, step);
        }
      },
      onArcDelta(e): void {
        idioms.onArcDelta?.(e);
      },
      onArcKey(e): void {
        idioms.onArcKey?.(e);
      },

      draw({ p, width, height, dt }): void {
        const frames = dt * 60;
        frameCount += frames;
        const minDim = Math.min(width, height);
        const fit = minDim / LOGICAL_FIELD; // scale the 900² logical field to the canvas

        // ── fold the arc macros with the param-vector axes (centred frac = no nudge) ──
        const a = arc.values();
        const zoom = zoomFromFrac(a.zoom ?? ZOOM_MID) * lerp(0.8, 1.2, cur.density);
        const bgTilt = tiltFromFrac(a.bgTilt ?? BGTILT_MID) + (cur.turbulence - 0.5) * 0.6;
        const fgTilt = tiltFromFrac(a.fgTilt ?? FGTILT_MID) + (cur.turbulence - 0.5) * 0.6;
        const overlayY = ((a.overlayY ?? OVERLAY_MID) - 0.5) * height; // -h/2..h/2 sweep
        const bright = brightness * lerp(0.7, 1.15, cur.contrast); // contrast rides brightness
        const fgScale = scaleParam * lerp(0.85, 1.15, cur.turbulence);

        // ── step clock — windchime STEP_TIME=5 frames; motion nudges the rate ──
        stepTimer += frames * lerp(1.4, 0.7, cur.motion);
        if (stepTimer >= STEP_FRAMES) {
          stepTimer = 0;
          seq.advance();
          const adv = seq.values();
          // windchime: every firing lane triggers its (lane, playhead) parameter change.
          for (let lane = 0; lane < adv.active.length; lane++) {
            if (adv.active[lane]) trigger(lane, adv.playhead);
          }
        }
        const sv = seq.values();
        const fgColor = stepColors[sv.playhead] ?? [255, 255, 255];

        // ── render ──
        p.background(0);
        p.scale(zoom * fit); // global zoom + canvas fit (the 900² field → live canvas)

        // background mesh — tilted by bgTilt.
        p.push();
        p.rotateX(bgTilt);
        p.translate(-(cols * scl) / 2, -(rows * scl) / 2);
        p.stroke(100, 100, 255 * bright, 150);
        p.fill(100, 100, 255 * bright, 50);
        drawMesh(p, zBg, 1, 50);
        p.pop();
        advanceField(zBg);

        // foreground mesh — tilted by fgTilt, coloured by the current step.
        p.push();
        p.rotateX(fgTilt);
        p.translate(-(cols * scl) / 2, -(rows * scl) / 2);
        p.stroke(255 * bright);
        p.fill(fgColor[0], fgColor[1], fgColor[2]);
        drawMesh(p, zFg, fgScale, 100);
        p.pop();
        advanceField(zFg);

        // 10 small rotating 3D objects overlaid — vertical position arc-driven.
        p.push();
        p.translate(0, overlayY, 0);
        const objColor = stepColors[sv.playhead] ?? [200, 200, 200];
        for (let i = 0; i < objectPositions.length; i++) {
          const pos = objectPositions[i];
          if (!pos) continue;
          const zi = (zFg[i % cols]?.[i % rows] ?? 0) * 100 * fgScale;
          p.push();
          p.translate(pos[0] * fgScale, pos[1] * fgScale, zi);
          drawComplexObject(p, objColor);
          p.pop();
        }
        p.pop();

        // idiom LED feedback → ledOut (host mirrors to the twin + hardware)
        idioms.renderGrid(ctx.ledOut, profile);
        idioms.renderArc(ctx.ledOut, profile);
      },
    };
  },
};
