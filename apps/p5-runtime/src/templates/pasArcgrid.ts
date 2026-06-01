/**
 * pasArcgrid — adapted (not forked) from windchime-animation
 * packages/sketch-families/src/pasArcgridv7/index.ts (itself a port of
 * processing_corpus_test1/PAS_arcgridv7/PAS_arcgridv7.pde). Four independent
 * rotating 3D wireframe objects (icosahedron / sphere / torus / helix / mobius),
 * each spinning on X/Y/Z at its own frequency and bobbing in Z.
 *
 * Lichtspiel rewiring (concept-adapted): the bespoke 4-panel grid + per-encoder
 * arc handling is replaced by the Part-2 idioms — a `faderBank` of 8 lanes
 * (spread across the grid: two lanes per object = rotation-frequency + Z-oscillation)
 * and `arcMacros` where each of the four encoders scales ONE object's size and a
 * press regenerates that object's shape / colour / position. The original's
 * 1024×768 fixed canvas + millis()-driven rotation become resolution-scaled,
 * dt-driven, 60fps-capped WEBGL with proper lighting; all randomness flows through
 * ctx.rng / p.noise() for seeded reproducibility. The five custom shape builders
 * (icosahedron / helix / mobius / custom torus) are ported faithfully but
 * vertex-budget-capped.
 */

import type p5 from 'p5';
import { type VisualParamVector, clamp01, lerp } from '@lichtspiel/schemas';
import type { MountContext, VisualTemplate } from '../visualTemplate.js';
import {
  type ArcLedPolicy,
  type ArcMacros,
  type ComposedIdiom,
  type FaderBank,
  type IdiomProfile,
  composeIdioms,
  createArcMacros,
  createFaderBank,
  profileFromSetup,
} from '../idioms/index.js';
import { cfg, makeVariantFactory } from '../mutations/familyVariants.js';
import type { SeededRng } from '../seededRng.js';

const NUM_OBJECTS = 4;
const TWO_PI = Math.PI * 2;

// Rotation-frequency band (rad/sec) and Z-oscillation amplitude band, expressed
// as fractions of the canvas min-dimension so the look is resolution-stable.
const MIN_FREQ = 0.06;
const MAX_FREQ = 2.6;
const MAX_OSC = 0.22; // of minDim
const OSC_SPEED = 0.9; // rad/sec bob rate
const MIN_SIZE = 0.06; // of minDim
const MAX_SIZE = 0.3; // of minDim

/** Shape kinds: 0 icosahedron, 1 sphere, 2 torus, 3 helix, 4 mobius. */
type ShapeKind = 0 | 1 | 2 | 3 | 4;

/** Resolve the `shapes` variant axis to its allowed shape-kind pool. */
function shapePool(mode: string): ShapeKind[] {
  switch (mode) {
    case 'platonic':
      return [0, 1]; // icosahedron + sphere
    case 'parametric':
      return [3, 4]; // helix + mobius
    case 'simple':
      return [1, 2]; // sphere + torus
    case 'all':
    default:
      return [0, 1, 2, 3, 4];
  }
}

/** HSL → RGB (h 0..360, s/l 0..1) → 0..255 triple. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** One object's colour for palette mode `mode`, object index `i`, via ctx.rng. */
function colorFor(mode: string, i: number, rng: SeededRng): [number, number, number] {
  switch (mode) {
    case 'warm':
      return hslToRgb(rng.range(0, 60), rng.range(0.7, 1), rng.range(0.5, 0.7));
    case 'cool':
      return hslToRgb(rng.range(180, 270), rng.range(0.6, 1), rng.range(0.5, 0.7));
    case 'monochrome':
      // A single hue derived from the object index keeps the four readably related.
      return hslToRgb((i * 37) % 360, rng.range(0.5, 0.9), rng.range(0.4, 0.75));
    case 'neon': {
      const neon = [330, 280, 195, 60];
      return hslToRgb(neon[i % neon.length] ?? 0, 1, 0.6);
    }
    case 'random':
    default:
      return [40 + rng.int(216), 40 + rng.int(216), 40 + rng.int(216)];
  }
}

const variants = makeVariantFactory({
  palette: { canonical: 'random', options: ['random', 'warm', 'cool', 'monochrome', 'neon'] },
  shapes: { canonical: 'all', options: ['all', 'platonic', 'parametric', 'simple'] },
  bg: { canonical: 'flash-press', options: ['flash-press', 'static', 'oscillating', 'gradient'] },
  arcLed: { canonical: 'fill', options: ['fill', 'gauge', 'marker', 'segments'] },
});

interface ObjState {
  kind: ShapeKind;
  color: [number, number, number];
  /** world position in fractions of minDim from the canvas centre. */
  px: number;
  py: number;
  pz: number;
  /** per-axis rotation phase (rad), advanced by the object's frequencies. */
  rx: number;
  ry: number;
  rz: number;
  oscPhase: number;
}

export const pasArcgrid: VisualTemplate = {
  id: 'pasArcgrid',
  name: 'PAS Arc + Grid',
  family: 'objects',
  description:
    'Four independent rotating 3D wireframe objects (platonic + parametric) whose X/Y/Z spin and Z-bob ride an 8-lane fader bank; each arc encoder scales one object and a press regenerates it. A Grid 128 / Arc 4 showcase.',
  tags: ['3d', 'wireframe', 'rotation', 'objects', 'faders', 'arc', 'monome', 'platonic'],
  defaultParams: { motion: 0.5, turbulence: 0.5, density: 0.5, contrast: 0.6, palette: 0.4 },
  renderer: 'webgl',
  sourceLineage: 'windchime pasArcgridv7 (PAS_arcgridv7.pde)',
  hardwareTarget: { grid: '128', arc: '4' },
  idioms: ['faderBank', 'arcMacros'],
  variants,

  create(ctx: MountContext) {
    const paletteMode = cfg<string>(ctx.config, 'palette', 'random');
    const shapesMode = cfg<string>(ctx.config, 'shapes', 'all');
    const bgMode = cfg<string>(ctx.config, 'bg', 'flash-press');
    const arcLed = cfg<ArcLedPolicy>(ctx.config, 'arcLed', 'fill');

    const pool = shapePool(shapesMode);

    let profile: IdiomProfile = profileFromSetup(ctx.setup);

    // ── performance state (declared before the regen/press helpers that read it) ──
    let cur: VisualParamVector = ctx.initialParams;
    let elapsed = 0; // seconds since mount
    let flash = 0; // press-flash background envelope 0..1
    // Background colour seeded per bg mode; mutated by flash-press / oscillating.
    const bgBase: [number, number, number] =
      bgMode === 'gradient'
        ? [ctx.rng.int(26), ctx.rng.int(26), ctx.rng.int(38)]
        : bgMode === 'oscillating'
          ? [10, 10, 14]
          : [4, 4, 6];
    let bgColor: [number, number, number] = [bgBase[0], bgBase[1], bgBase[2]];

    // ── object state (regenerated on encoder press) ────────────────
    const objects: ObjState[] = [];
    function regenerate(i: number): void {
      const obj = objects[i];
      const next: ObjState = {
        kind: ctx.rng.pick(pool),
        color: colorFor(paletteMode, i, ctx.rng),
        px: ctx.rng.range(-0.34, 0.34),
        py: ctx.rng.range(-0.24, 0.24),
        pz: ctx.rng.range(-0.18, 0.18),
        // keep the live rotation phase across a regen so the spin doesn't snap
        rx: obj?.rx ?? ctx.rng.range(0, TWO_PI),
        ry: obj?.ry ?? ctx.rng.range(0, TWO_PI),
        rz: obj?.rz ?? ctx.rng.range(0, TWO_PI),
        oscPhase: obj?.oscPhase ?? ctx.rng.range(0, TWO_PI),
      };
      objects[i] = next;
    }
    /** Arc-press action: regenerate object i, and flash/recolour the bg per mode. */
    function pressObject(i: number): void {
      regenerate(i);
      if (bgMode === 'flash-press') {
        bgColor = [4 + ctx.rng.int(58), 4 + ctx.rng.int(58), 6 + ctx.rng.int(58)];
        flash = 1; // brief brightening envelope, decays in draw()
      }
    }
    for (let i = 0; i < NUM_OBJECTS; i++) regenerate(i); // initial seed (no flash)

    // ── idioms (the control map) ───────────────────────────────────
    // 8 grid faders spread across the grid: two lanes per object — rotation
    // frequency (drives X/Y/Z spin rate) and Z-oscillation amplitude.
    const fb: FaderBank = createFaderBank({
      spread: true,
      lanes: [0, 1, 2, 3].flatMap((i) => [
        { name: `spin${i}`, initial: 0.5 },
        { name: `osc${i}`, initial: 0.3 },
      ]),
    });
    const arc: ArcMacros = createArcMacros({
      encoders: [0, 1, 2, 3].map((i) => ({
        name: `size${i}`,
        initial: 0.3,
        led: arcLed,
        onPress: () => pressObject(i), // press → new shape / colour / position (+ bg flash)
      })),
    });
    const idioms: ComposedIdiom = composeIdioms([fb, arc]);
    idioms.setProfile(profile);

    /** Fold a fader value with a centred VisualParamVector axis: 0.5 leaves the
     *  fader alone, Live/retrieval nudges it ±0.2. */
    const fold = (f: number, axis: number): number => clamp01(f + (axis - 0.5) * 0.4);

    // ── ported shape builders (vertex-budget-capped for 60fps) ─────
    function drawIcosahedron(p: p5, r: number): void {
      const t = (1 + Math.sqrt(5)) / 2;
      const v: ReadonlyArray<readonly [number, number, number]> = [
        [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
        [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
        [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
      ];
      const faces: ReadonlyArray<readonly [number, number, number]> = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
        [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
        [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
      ];
      p.push();
      p.scale(r);
      p.beginShape(p.TRIANGLES);
      for (const face of faces) {
        for (const vi of face) {
          const pt = v[vi];
          if (pt) p.vertex(pt[0], pt[1], pt[2]);
        }
      }
      p.endShape();
      p.pop();
    }

    function drawHelix(p: p5, radius: number, coils: number): void {
      const step = Math.PI / 12;
      const heightStep = radius / Math.max(1, coils);
      const maxAngle = TWO_PI * coils;
      p.beginShape();
      // cap iterations so a high coil count can never blow the frame budget
      const maxSteps = 480;
      let n = 0;
      for (let a = 0; a < maxAngle && n < maxSteps; a += step, n++) {
        p.vertex(radius * Math.cos(a), radius * Math.sin(a), a * heightStep - radius);
      }
      p.endShape();
    }

    function drawMobius(p: p5, size: number): void {
      const width = size / 5;
      p.beginShape(p.TRIANGLE_STRIP);
      for (let vv = -Math.PI; vv < Math.PI; vv += 0.08) {
        for (let side = -1; side <= 1; side += 2) {
          const u = vv * side;
          p.vertex(
            size * Math.cos(u) * (1 + 0.5 * Math.cos(vv)),
            size * Math.sin(u) * (1 + 0.5 * Math.cos(vv)),
            width * Math.sin(vv),
          );
        }
      }
      p.endShape();
    }

    function drawCustomTorus(p: p5, r: number, tube: number): void {
      const res = 18;
      for (let i = 0; i < res; i++) {
        const theta = (TWO_PI * i) / res;
        const nextTheta = (TWO_PI * (i + 1)) / res;
        p.beginShape(p.TRIANGLE_STRIP);
        for (let j = 0; j <= res; j++) {
          const phi = (TWO_PI * j) / res;
          const cosPhi = Math.cos(phi);
          const sinPhi = Math.sin(phi);
          const x1 = (r + tube * cosPhi) * Math.cos(theta);
          const y1 = (r + tube * cosPhi) * Math.sin(theta);
          const x2 = (r + tube * cosPhi) * Math.cos(nextTheta);
          const y2 = (r + tube * cosPhi) * Math.sin(nextTheta);
          p.vertex(x1, y1, tube * sinPhi);
          p.vertex(x2, y2, tube * sinPhi);
        }
        p.endShape();
      }
    }

    function drawObject(p: p5, kind: ShapeKind, size: number): void {
      switch (kind) {
        case 0:
          drawIcosahedron(p, size * 0.5);
          break;
        case 1:
          p.sphere(size * 0.5, 16, 12);
          break;
        case 2:
          drawCustomTorus(p, size * 0.32, size * 0.13);
          break;
        case 3:
          drawHelix(p, size * 0.45, 8);
          break;
        case 4:
          drawMobius(p, size * 0.34);
          break;
        default:
          p.sphere(size * 0.5, 16, 12);
          break;
      }
    }

    return {
      setup(p): void {
        p.createCanvas(ctx.width, ctx.height, p.WEBGL);
        p.noiseSeed(ctx.seed);
      },

      update(params): void {
        cur = params;
      },

      setProfile(setup): void {
        profile = profileFromSetup(setup);
        idioms.setProfile(profile);
      },

      onGridKey(e): void {
        idioms.onGridKey?.(e);
      },
      onArcDelta(e): void {
        idioms.onArcDelta?.(e);
      },
      onArcKey(e): void {
        idioms.onArcKey?.(e);
      },

      draw({ p, width, height, dt }): void {
        elapsed += dt;
        const minDim = Math.min(width, height);
        const fv = fb.values();
        const av = arc.values();

        // ── background ───────────────────────────────────────────
        flash *= Math.pow(0.04, dt); // ~exp decay toward 0
        if (bgMode === 'oscillating') {
          const t = elapsed * 0.3;
          bgColor = [
            Math.floor(10 + 18 * (1 + Math.sin(t))),
            Math.floor(10 + 18 * (1 + Math.sin(t + 2))),
            Math.floor(10 + 18 * (1 + Math.sin(t + 4))),
          ];
        }
        if (bgMode === 'gradient') {
          // gentle drift around the seeded base via seeded noise (no global RNG)
          const n = p.noise(elapsed * 0.05);
          bgColor = [
            Math.floor((bgBase[0] ?? 0) + n * 16),
            Math.floor((bgBase[1] ?? 0) + n * 16),
            Math.floor((bgBase[2] ?? 0) + n * 22),
          ];
        }
        const fl = flash * 40;
        p.background((bgColor[0] ?? 0) + fl, (bgColor[1] ?? 0) + fl, (bgColor[2] ?? 0) + fl);

        // ── lighting ─────────────────────────────────────────────
        p.ambientLight(46);
        p.directionalLight(255, 255, 255, 0.25, 0.45, -1);
        p.pointLight(170, 195, 255, 0, -minDim * 0.4, minDim * 0.5);

        // ── objects ──────────────────────────────────────────────
        const motion = 0.4 + cur.motion * 1.2; // global speed multiplier
        const turb = 0.6 + cur.turbulence * 0.8; // amplitude multiplier
        for (let i = 0; i < NUM_OBJECTS; i++) {
          const obj = objects[i];
          if (!obj) continue;

          // rotation frequency from the spin fader (folded with motion axis)
          const spin = fold(fv[`spin${i}`] ?? 0.5, cur.motion);
          const freq = lerp(MIN_FREQ, MAX_FREQ, spin) * motion;
          // give the three axes distinct-but-related rates for a lively tumble
          obj.rx += freq * dt;
          obj.ry += freq * 0.78 * dt;
          obj.rz += freq * 1.27 * dt;

          // Z-oscillation amplitude from the osc fader (folded with turbulence)
          const oscN = fold(fv[`osc${i}`] ?? 0.3, cur.turbulence);
          obj.oscPhase += OSC_SPEED * dt;
          const oscAmp = oscN * MAX_OSC * minDim * turb;
          const oscZ = Math.sin(obj.oscPhase) * oscAmp;

          // size from the arc encoder (folded with density axis)
          const sizeN = fold(av[`size${i}`] ?? 0.3, cur.density);
          const size = lerp(MIN_SIZE, MAX_SIZE, sizeN) * minDim;

          const c = obj.color;
          p.push();
          p.translate(obj.px * minDim, obj.py * minDim, obj.pz * minDim + oscZ);
          p.rotateX(obj.rx);
          p.rotateY(obj.ry);
          p.rotateZ(obj.rz);
          p.strokeWeight(lerp(0.6, 2.2, cur.lineWeight));
          p.stroke(c[0], c[1], c[2], 235 * (0.5 + cur.contrast * 0.6));
          p.noFill();
          drawObject(p, obj.kind, size);
          p.pop();
        }

        // ── idiom LED feedback → ledOut (host mirrors to twin + hardware) ──
        idioms.renderGrid(ctx.ledOut, profile);
        idioms.renderArc(ctx.ledOut, profile);
      },
    };
  },
};
