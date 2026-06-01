/**
 * upfAvTest — adapted (not forked) from windchime-animation
 * packages/sketch-families/src/upfAvTestv14/index.ts (itself a hand-port of
 * processing_corpus_test1/UPF_AV_Testv14/UPF_AV_Testv14.pde): four noise-
 * displaced topographic plane meshes — swirl / radial wave disc / layered ridge
 * / ripple — floating inside a forward-scrolling infinite noise-tunnel of rings.
 *
 * Lichtspiel rewiring (concept-adapted): the bespoke per-sketch 4×4 fader panels
 * + per-encoder arc handling are replaced by the Part-2 idioms — a `faderBank`
 * (8 lanes: mesh resolution / displacement / swirl / radial bias / scroll speed /
 * tunnel radius / tunnel wobble / spin) and `arcMacros` (4 encoders = the four
 * plane sizes; press = regenerate that plane's kind/colour/position). The idiom
 * values() are folded with the VisualParamVector axes (a centred 0.5 axis leaves
 * the fader alone). What changed vs the source: P5 WEBGL kept but recentred on
 * the canvas origin and scaled by min(w,h); per-frame `millis()` drift replaced
 * by an accumulated `time` so motion is dt-driven and seed-reproducible; mesh +
 * tunnel resolutions capped for a steady 60fps; palette space extended (+neon,
 * +blue-lime) and tunnel/plane structural axes broadened. Browser-only resilient.
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

const TWO_PI = Math.PI * 2;
const NUM_OBJECTS = 4; // one per arc encoder

/** Plane mesh kinds (index = arc-regen pool entry). */
const KIND_SWIRL = 0;
const KIND_DISC = 1;
const KIND_RIDGE = 2;
const KIND_RIPPLE = 3;

interface PlaneObject {
  pos: [number, number, number];
  kind: number;
  color: [number, number, number];
}

/** Structural variants the `v` key / arc-press re-roll, distinct from the live axes. */
const variants = makeVariantFactory({
  palette: {
    canonical: 'random',
    options: ['random', 'warm', 'cool', 'neon', 'monochrome', 'blue-lime'],
  },
  planes: { canonical: 'all', options: ['all', 'topographic', 'flat'] },
  tunnel: { canonical: 'sparse', options: ['none', 'sparse', 'dense', 'thick'] },
  arcLed: { canonical: 'comet', options: ['comet', 'gauge', 'segments', 'fill'] },
});

/** HSL→RGB (0..255), used by the palette generator. */
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

/** A single plane colour for a palette mode (drawn from ctx.rng for reproducibility). */
function paletteColor(mode: string, i: number, rng: SeededRng): [number, number, number] {
  switch (mode) {
    case 'warm':
      return hslToRgb(rng.range(0, 60), 0.85, 0.6);
    case 'cool':
      return hslToRgb(rng.range(180, 270), 0.85, 0.6);
    case 'neon': {
      const hues = [330, 280, 195, 60];
      return hslToRgb(hues[i % hues.length] ?? 0, 1, 0.6);
    }
    case 'monochrome':
      return hslToRgb(210, rng.range(0.05, 0.25), rng.range(0.45, 0.85));
    case 'blue-lime':
      return i % 2 === 0 ? hslToRgb(rng.range(200, 230), 0.9, 0.6) : hslToRgb(rng.range(80, 110), 0.9, 0.6);
    case 'random':
    default:
      return [80 + rng.int(176), 80 + rng.int(176), 80 + rng.int(176)];
  }
}

/** The plane kinds the `planes` structural axis permits. */
function planePool(mode: string): number[] {
  switch (mode) {
    case 'flat':
      return [KIND_DISC, KIND_RIPPLE]; // the gentler, near-flat meshes
    case 'topographic':
      return [KIND_SWIRL, KIND_RIDGE]; // the more dramatic relief meshes
    case 'all':
    default:
      return [KIND_SWIRL, KIND_DISC, KIND_RIDGE, KIND_RIPPLE];
  }
}

/** Tunnel ring count for the `tunnel` structural axis (0 = no tunnel). */
function tunnelRings(mode: string): number {
  switch (mode) {
    case 'none':
      return 0;
    case 'dense':
      return 26;
    case 'thick':
      return 18;
    case 'sparse':
    default:
      return 14;
  }
}

export const upfAvTest: VisualTemplate = {
  id: 'upfAvTest',
  name: 'UPF AV — Topographic Planes + Tunnel',
  family: 'topographic',
  description:
    'Four noise-displaced topographic plane meshes (swirl, disc, ridge, ripple) drifting through a forward noise-tunnel. The faderBank/arc idiom shared with PAS — faders sculpt the meshes + tunnel, arc encoders scale, arc-press regenerates.',
  tags: ['topographic', 'tunnel', 'noise', 'mesh', '3d', 'planes', 'arc', 'fader', 'monome', 'flow'],
  defaultParams: {
    density: 0.5,
    motion: 0.5,
    turbulence: 0.5,
    cameraDepth: 0.5,
    contrast: 0.6,
    palette: 0.4,
  },
  renderer: 'webgl',
  sourceLineage: 'windchime upfAvTestv14 (UPF_AV_Testv14.pde, concept-adapted)',
  hardwareTarget: { grid: '128', arc: '4' },
  idioms: ['faderBank', 'arcMacros'],
  variants,

  create(ctx: MountContext) {
    const paletteName = cfg<string>(ctx.config, 'palette', 'random');
    const planesMode = cfg<string>(ctx.config, 'planes', 'all');
    const tunnelMode = cfg<string>(ctx.config, 'tunnel', 'sparse');
    const arcLed = cfg<ArcLedPolicy>(ctx.config, 'arcLed', 'comet');

    let profile: IdiomProfile = profileFromSetup(ctx.setup);

    // ── idioms (the control map) ───────────────────────────────────
    // 8 grid faders, one column each (spread:false) so a Grid 128 keeps cols
    // 8–15 free; 4 arc encoders (extra 2 lie dormant on an Arc 2).
    const fb: FaderBank = createFaderBank({
      spread: false,
      lanes: [
        { name: 'meshRes', initial: 0.5 }, // mesh subdivision (capped)
        { name: 'displace', initial: 0.55 }, // noise displacement amount
        { name: 'swirl', initial: 0.4 }, // swirl twist of the relief meshes
        { name: 'radialBias', initial: 0.5 }, // round (disc/ridge) vs square (swirl/ripple) bias
        { name: 'scroll', initial: 0.5 }, // tunnel forward speed
        { name: 'tunRadius', initial: 0.5 }, // tunnel bore radius
        { name: 'tunWobble', initial: 0.45 }, // tunnel wall noise wobble
        { name: 'spin', initial: 0.5 }, // plane self-rotation rate
      ],
    });
    const arc: ArcMacros = createArcMacros({
      encoders: [0, 1, 2, 3].map((i) => ({
        name: `size${i}`,
        initial: 0.4,
        led: arcLed,
        onPress: () => regenerate(i), // press regenerates that plane
      })),
    });
    const idioms: ComposedIdiom = composeIdioms([fb, arc]);
    idioms.setProfile(profile);

    // ── scene state ────────────────────────────────────────────────
    const pool = planePool(planesMode);
    const rings = tunnelRings(tunnelMode);
    const objects: PlaneObject[] = [];
    let bgTint = 0; // 0..1 brightness flash on regen
    let bg: [number, number, number] = [6, 7, 10];
    let time = 0; // accumulated noise-field time (dt driven, seed-reproducible)
    let travel = 0; // tunnel forward travel
    let cur: VisualParamVector = ctx.initialParams;

    /** A fresh plane object i: random kind/colour/position via ctx.rng. */
    function makeObject(i: number): PlaneObject {
      return {
        pos: [ctx.rng.range(-0.32, 0.32), ctx.rng.range(-0.26, 0.26), ctx.rng.range(-0.2, 0.2)],
        kind: pool[ctx.rng.int(pool.length)] ?? KIND_RIPPLE,
        color: paletteColor(paletteName, i, ctx.rng),
      };
    }
    function regenerate(i: number): void {
      objects[i] = makeObject(i);
      bg = [ctx.rng.int(26), ctx.rng.int(26), ctx.rng.int(30)];
      bgTint = 1;
    }
    for (let i = 0; i < NUM_OBJECTS; i++) objects[i] = makeObject(i);

    // folded controls (recomputed each frame from idiom values × the axes)
    const av = (k: string): number => (arc.values()[k] ?? 0.4);
    /** Fold a fader (primary) with a VisualParamVector axis: centred axis = no change. */
    const fold = (f: number, axis: number): number => clamp01(f + (axis - 0.5) * 0.4);

    /** Displace y by layered Perlin noise; t is the time scroll for that mesh. */
    function nHeight(p: p5, x: number, z: number, t: number, amp: number): number {
      const n = p.noise(x * 0.9 + t, z * 0.9 - t);
      return (n - 0.5) * amp;
    }

    /** Swirl plane: a grid mesh twisted about its centre. */
    function drawSwirl(p: p5, size: number, res: number, amp: number, swirl: number, t: number): void {
      const half = size * 0.5;
      const step = size / res;
      for (let z = 0; z < res; z++) {
        p.beginShape(p.TRIANGLE_STRIP);
        for (let x = 0; x <= res; x++) {
          const px = x * step - half;
          const pz1 = z * step - half;
          const pz2 = (z + 1) * step - half;
          const y1 = nHeight(p, px / size, pz1 / size, t, amp);
          const y2 = nHeight(p, px / size, pz2 / size, t, amp);
          const a1 = swirl * Math.sqrt(px * px + pz1 * pz1) / size;
          const a2 = swirl * Math.sqrt(px * px + pz2 * pz2) / size;
          p.vertex(px * Math.cos(a1) - pz1 * Math.sin(a1), y1, px * Math.sin(a1) + pz1 * Math.cos(a1));
          p.vertex(px * Math.cos(a2) - pz2 * Math.sin(a2), y2, px * Math.sin(a2) + pz2 * Math.cos(a2));
        }
        p.endShape();
      }
    }

    /** Radial wave disc: concentric ring strips. */
    function drawDisc(p: p5, size: number, res: number, amp: number, t: number): void {
      const radius = size * 0.5;
      const sectors = res;
      const ringsN = Math.max(6, Math.floor(res * 0.7));
      for (let r = 0; r < ringsN; r++) {
        const r1 = (r / ringsN) * radius;
        const r2 = ((r + 1) / ringsN) * radius;
        p.beginShape(p.TRIANGLE_STRIP);
        for (let s = 0; s <= sectors; s++) {
          const a = (s / sectors) * TWO_PI;
          const x1 = r1 * Math.cos(a);
          const z1 = r1 * Math.sin(a);
          const x2 = r2 * Math.cos(a);
          const z2 = r2 * Math.sin(a);
          p.vertex(x1, nHeight(p, x1 / size, z1 / size, t, amp), z1);
          p.vertex(x2, nHeight(p, x2 / size, z2 / size, t, amp), z2);
        }
        p.endShape();
      }
    }

    /** Layered ridge: like the disc but fewer, wider layers (sharper relief). */
    function drawRidge(p: p5, size: number, res: number, amp: number, t: number): void {
      const half = size * 0.5;
      const layers = Math.max(5, Math.floor(res * 0.55));
      const segs = res;
      for (let i = 0; i < layers; i++) {
        const o1 = (i / layers) * half;
        const o2 = ((i + 1) / layers) * half;
        p.beginShape(p.TRIANGLE_STRIP);
        for (let s = 0; s <= segs; s++) {
          const a = (s / segs) * TWO_PI;
          const x1 = o1 * Math.cos(a);
          const z1 = o1 * Math.sin(a);
          const x2 = o2 * Math.cos(a);
          const z2 = o2 * Math.sin(a);
          p.vertex(x1, nHeight(p, x1 / size, z1 / size, t, amp * 1.3), z1);
          p.vertex(x2, nHeight(p, x2 / size, z2 / size, t, amp * 1.3), z2);
        }
        p.endShape();
      }
    }

    /** Ripple: a flat grid mesh rippled by noise (the gentlest). */
    function drawRipple(p: p5, size: number, res: number, amp: number, t: number): void {
      const half = size * 0.5;
      const step = size / res;
      for (let z = 0; z < res; z++) {
        p.beginShape(p.TRIANGLE_STRIP);
        for (let x = 0; x <= res; x++) {
          const px = x * step - half;
          const pz1 = z * step - half;
          const pz2 = (z + 1) * step - half;
          p.vertex(px, nHeight(p, px / size, pz1 / size, t, amp), pz1);
          p.vertex(px, nHeight(p, px / size, pz2 / size, t, amp), pz2);
        }
        p.endShape();
      }
    }

    function drawPlane(
      p: p5,
      kind: number,
      size: number,
      res: number,
      amp: number,
      swirl: number,
      t: number,
    ): void {
      switch (kind) {
        case KIND_SWIRL:
          drawSwirl(p, size, res, amp, swirl, t);
          return;
        case KIND_DISC:
          drawDisc(p, size, res, amp, t);
          return;
        case KIND_RIDGE:
          drawRidge(p, size, res, amp, t);
          return;
        case KIND_RIPPLE:
        default:
          drawRipple(p, size, res, amp, t);
          return;
      }
    }

    /** Forward noise-tunnel: a stack of wobbling rings receding from the camera. */
    function drawTunnel(p: p5, minDim: number, radius01: number, wobble: number): void {
      if (rings <= 0) return;
      const ringRes = 20;
      const spacing = minDim * 0.5;
      const baseR = minDim * lerp(0.5, 1.15, radius01);
      const amp = minDim * 0.28 * wobble;
      p.noFill();
      const cc = clamp01(cur.contrast);
      for (let i = 0; i < rings; i++) {
        const idx = Math.floor(travel) + i;
        const depth = i / rings; // 0 near .. 1 far
        const z = -((idx * spacing) - travel * spacing);
        const alpha = lerp(150, 18, depth) * (0.5 + cc * 0.6);
        p.stroke(120, 150, 200, alpha);
        p.strokeWeight(lerp(1.6, 0.5, depth));
        p.beginShape();
        for (let r = 0; r <= ringRes; r++) {
          const a = (r / ringRes) * TWO_PI;
          const rr = baseR + p.noise(Math.cos(a) + idx * 0.12, Math.sin(a) + idx * 0.12) * amp;
          p.vertex(rr * Math.cos(a), rr * Math.sin(a), z);
        }
        p.endShape(p.CLOSE);
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
        idioms.onArcKey?.(e); // arcMacros fires per-encoder onPress (regenerate)
      },

      draw({ p, width, height, dt }): void {
        const v = fb.values();
        const minDim = Math.min(width, height);

        // folded fader controls (centred axis leaves the fader alone)
        const displace = fold(v.displace ?? 0.5, cur.turbulence);
        const swirlAmt = lerp(0, 2.4, v.swirl ?? 0.4);
        const radialBias = v.radialBias ?? 0.5; // (reserved structural lean; kept readable)
        const scroll = fold(v.scroll ?? 0.5, cur.motion);
        const tunRadius = fold(v.tunRadius ?? 0.5, cur.cameraDepth);
        const tunWobble = v.tunWobble ?? 0.45;
        const spin = fold(v.spin ?? 0.5, cur.motion);
        // density axis nudges mesh resolution; hard cap keeps 60fps
        const res = Math.round(lerp(10, 22, fold(v.meshRes ?? 0.5, cur.density)));
        const meshAmp = minDim * lerp(0.05, 0.42, displace) * lerp(0.8, 1.2, radialBias);

        time += dt * lerp(0.04, 0.42, scroll);
        travel += dt * lerp(0.1, 2.4, scroll);
        bgTint *= 0.92;

        const flash = bgTint * 22;
        p.background((bg[0] ?? 6) + flash, (bg[1] ?? 7) + flash, (bg[2] ?? 10) + flash);
        p.ambientLight(54);
        p.directionalLight(255, 255, 255, 0.3, 0.5, -1);
        p.pointLight(150, 180, 255, 0, -minDim * 0.4, minDim * 0.6);

        drawTunnel(p, minDim, tunRadius, tunWobble);

        for (let i = 0; i < NUM_OBJECTS; i++) {
          const obj = objects[i];
          if (!obj) continue;
          const size = minDim * lerp(0.16, 0.66, av(`size${i}`));
          const t = time + i * 7.3; // de-phase each mesh
          const osc = Math.sin(time * 1.2 + i) * minDim * 0.04;
          const c = obj.color;
          p.push();
          p.translate((obj.pos[0] ?? 0) * width, (obj.pos[1] ?? 0) * height, (obj.pos[2] ?? 0) * minDim + osc);
          p.rotateX(Math.sin(time * 0.3 + i) * Math.PI * lerp(0.1, 0.6, spin));
          p.rotateY(time * lerp(0.05, 0.5, spin) + i);
          p.rotateZ(Math.cos(time * 0.2 + i) * 0.5 * spin);
          p.stroke(c[0] ?? 200, c[1] ?? 200, c[2] ?? 200, lerp(120, 230, clamp01(cur.contrast)));
          p.strokeWeight(1);
          p.fill(c[0] ?? 200, c[1] ?? 200, c[2] ?? 200, 90);
          drawPlane(p, obj.kind, size, res, meshAmp, swirlAmt, t);
          p.pop();
        }

        idioms.renderGrid(ctx.ledOut, profile);
        idioms.renderArc(ctx.ledOut, profile);
      },
    };
  },
};
