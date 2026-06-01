/**
 * upfAvTest — faithful port (not forked) of windchime-animation
 * packages/sketch-families/src/upfAvTestv14 (itself a hand-port of
 * processing_corpus_test1/UPF_AV_Testv14/UPF_AV_Testv14.pde).
 *
 * Visual core (preserved verbatim): four noise-driven topographic PLANE meshes —
 * topographicSwirlPlane / topographicRadialWaveDisc / topographicLayeredRidgePlane
 * / topographicRipplePlane — floating inside drawTunnel, a forward-scrolling
 * infinite tunnel of noise-displaced rings. Each object tumbles on X/Y/Z at
 * independent fader-set frequencies (the exponential MIN_FREQ→MAX_FREQ map),
 * bobs in Z (osc amplitude 0..200), and is scaled by its arc encoder
 * (MIN_OBJECT_SIZE 50 .. MAX_OBJECT_SIZE 350). `p.millis()` drives the Perlin
 * time exactly as the source. The plane kinds in play come from the `planes`
 * variant; the tunnel ring count from the `tunnel` variant (normal 30 / sparse 20
 * / dense 60 / disabled 0). The crafted mesh resolutions (swirl/ripple res 18,
 * disc rings 16 × sectors 20, ridge layers 14 × segs 20) and the tunnel constants
 * (ringRes 18, ringSpacing 80, baseRadius 1000, noiseAmp 40, noiseScale 0.05) are
 * the windchime values; world-space geometry is scaled by minDim/768 (the
 * windchime vertical reference) so it is pixel-identical on a 768-tall canvas and
 * adapts proportionally on any other.
 *
 * Lichtspiel rewiring (control/LED → idioms): windchime's hardcoded 4-panel ×
 * 4-fader grid + per-encoder arc handling become a `faderBank` (16 lanes —
 * obj×{X,Y,Z,osc}, laid out exactly as the 4 panels on a Grid 128; the first 8
 * reach objects 0–1 on a Grid 64) + `arcMacros` (4 absolute size encoders, press →
 * regenerate that plane + flash bg). The idiom values() fold gently with the
 * VisualParamVector axes (a centred axis leaves the control alone). All randomness
 * is ctx.rng so a variant seed is reproducible. WEBGL.
 */

import type p5 from 'p5';
import { type VisualParamVector, lerp } from '@lichtspiel/schemas';
import type { MountContext, VisualTemplate } from '../visualTemplate.js';
import {
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
import { type Rgb, hslToRgb } from './lib/palettes.js';

const NUM_OBJECTS = 4;
const MIN_FREQ = 0.00005;
const MAX_FREQ = 0.007;
const MIN_OSC_AMP = 0;
const MAX_OSC_AMP = 200;
const OSC_SPEED = 0.1;
const MIN_OBJECT_SIZE = 50;
const MAX_OBJECT_SIZE = 350;
const REF_H = 768; // windchime authored its world geometry against a 1024×768 canvas

// Plane kinds (the regen pool entries) — match windchime drawPlaneShape's switch.
const KIND_SWIRL = 0;
const KIND_DISC = 1;
const KIND_RIDGE = 2;
const KIND_RIPPLE = 3;

type PaletteMode = 'random' | 'warm' | 'cool' | 'monochrome' | 'neon';

/** Structural variants the `v` key / arc-press re-roll. EXACT pools from
 * windchime upfAvTestv14/params.ts; canonical = random / all / normal. */
const variants = makeVariantFactory({
  palette: { canonical: 'random', options: ['random', 'warm', 'cool', 'monochrome', 'neon'] },
  planes: { canonical: 'all', options: ['all', 'swirl', 'disc', 'ridge', 'ripple'] },
  tunnel: { canonical: 'normal', options: ['normal', 'sparse', 'dense', 'disabled'] },
});

/** windchime paletteColors — `mode` → 4 RGB tuples (one per object), via ctx.rng. */
function paletteColors(mode: PaletteMode, rng: MountContext['rng']): Rgb[] {
  const colors: Rgb[] = [];
  switch (mode) {
    case 'warm':
      for (let i = 0; i < 4; i++) colors.push(hslToRgb(rng.range(0, 60), 0.85, 0.6));
      break;
    case 'cool':
      for (let i = 0; i < 4; i++) colors.push(hslToRgb(rng.range(180, 270), 0.85, 0.6));
      break;
    case 'monochrome': {
      const hue = rng.range(0, 360);
      for (let i = 0; i < 4; i++) colors.push(hslToRgb(hue, rng.range(0.5, 0.9), rng.range(0.4, 0.75)));
      break;
    }
    case 'neon': {
      const neonHues = [330, 280, 195, 60];
      for (let i = 0; i < 4; i++) colors.push(hslToRgb(neonHues[i] ?? 0, 1, 0.6));
      break;
    }
    case 'random':
    default:
      for (let i = 0; i < 4; i++) colors.push([rng.int(256), rng.int(256), rng.int(256)]);
  }
  return colors;
}

/** windchime allowedPlaneTypes — the `planes` axis → permitted plane kinds. */
function allowedPlaneTypes(mode: string): number[] {
  switch (mode) {
    case 'swirl':
      return [KIND_SWIRL];
    case 'disc':
      return [KIND_DISC];
    case 'ridge':
      return [KIND_RIDGE];
    case 'ripple':
      return [KIND_RIPPLE];
    case 'all':
    default:
      return [KIND_SWIRL, KIND_DISC, KIND_RIDGE, KIND_RIPPLE];
  }
}

/** windchime tunnelRingCount — the `tunnel` axis → ring count (0 = disabled). */
function tunnelRingCount(mode: string): number {
  switch (mode) {
    case 'sparse':
      return 20;
    case 'dense':
      return 60;
    case 'disabled':
      return 0;
    case 'normal':
    default:
      return 30;
  }
}

interface ObjectState {
  /** normalized position: x/y as fractions of width/height, z as a fraction of minDim. */
  position: { x: number; y: number; z: number };
  type: number;
  color: Rgb;
}

export const upfAvTest: VisualTemplate = {
  id: 'upfAvTest',
  name: 'UPF AV — Topographic Planes + Tunnel',
  family: 'topographic',
  description:
    'Four noise-driven topographic plane meshes (swirl / radial-wave disc / layered ridge / ripple) tumbling at fader-set frequencies inside a forward-scrolling infinite noise tunnel; arc scales each plane + regenerates it.',
  tags: ['topographic', 'tunnel', 'noise', 'mesh', '3d', 'planes', 'faders', 'arc', 'monome', 'flow'],
  defaultParams: { motion: 0.5, turbulence: 0.5, density: 0.5, contrast: 0.6, palette: 0.4 },
  renderer: 'webgl',
  sourceLineage: 'windchime upfAvTestv14 (UPF_AV_Testv14.pde, faithful port)',
  hardwareTarget: { grid: '128', arc: '4' },
  idioms: ['faderBank', 'arcMacros'],
  gestural: {
    name: 'Topographic Planes + Tunnel',
    summary:
      'Shares the fader-bank tactile layout with PAS but renders noise-driven topographic plane shapes — swirl, disc, ridge, ripple — over a scrolling infinite noise tunnel. Four control panels of four vertical faders set each plane\'s X/Y/Z rotation frequency + Z-oscillation. Arc encoders scale each plane; press regenerates it. On an Arc 2 each encoder press cycles through two of the four planes.',
    grid: [
      {
        area: 'grid cols 0–2 of each 4-col panel',
        action: 'press at (col, y)',
        effect: 'set X / Y / Z rotation-frequency fader for that object (higher row = faster)',
      },
      {
        area: 'grid col 3 of each panel',
        action: 'press at (col, y)',
        effect: 'set Z-oscillation-amplitude fader for that object',
      },
    ],
    arc: [
      { area: 'arc encoders 0–3', action: 'rotate', effect: 'scale that plane shape (size grows with the encoder)' },
      {
        area: 'arc encoders 0–3',
        action: 'press',
        effect: 'regenerate plane: new shape kind + new colour + new position; flashes bg colour',
      },
    ],
  },
  variants,

  create(ctx: MountContext) {
    const paletteMode = cfg<PaletteMode>(ctx.config, 'palette', 'random');
    const planesMode = cfg<string>(ctx.config, 'planes', 'all');
    const tunnelMode = cfg<string>(ctx.config, 'tunnel', 'normal');
    const planePool = allowedPlaneTypes(planesMode);
    const tunnelRings = tunnelRingCount(tunnelMode);
    const tunnelEnabled = tunnelRings > 0;

    let profile: IdiomProfile = profileFromSetup(ctx.setup);

    // 16 fader lanes laid out as 4 panels × {X, Y, Z, osc} — exactly the
    // windchime grid-128 layout; the first 8 reach objects 0–1 on a Grid 64.
    // initial 4/7 mirrors the windchime faderPositions default of row 4.
    const AXIS_LABEL: Record<string, string> = {
      x: 'X-rot freq',
      y: 'Y-rot freq',
      z: 'Z-rot freq',
      osc: 'oscillation amp',
    };
    const lanes = [0, 1, 2, 3].flatMap((o) =>
      ['x', 'y', 'z', 'osc'].map((axis) => ({
        name: `o${o}${axis}`,
        label: `plane ${o} ${AXIS_LABEL[axis]}`,
        initial: 4 / 7,
      })),
    );
    const fb: FaderBank = createFaderBank({ spread: false, lanes });
    // 4 absolute size encoders; initial 0.25 mirrors windchime arcPositions 16/64.
    // 'fillNotched' keeps dim orientation notches so the ring is never blank; turn
    // couples (enc0 scales planes 0 + 2 on an Arc 2), press cycles the regenerate.
    const arc: ArcMacros = createArcMacros({
      encoders: [0, 1, 2, 3].map((i) => ({
        name: `size${i}`,
        label: `plane ${i} size`,
        pressLabel: `regenerate plane ${i}`,
        initial: 0.25,
        led: 'fillNotched' as const,
        onPress: () => regen(i),
      })),
    });
    const idioms: ComposedIdiom = composeIdioms([fb, arc]);
    idioms.setProfile(profile);

    // ── scene state ────────────────────────────────────────────────
    // Positions normalized to the windchime envelope: x ∈ [-w/2+200, w/2-200] on a
    // 1024-wide canvas → ±(0.5 - 200/1024); y likewise on 768; z ±100 of minDim.
    const X_ENV = 0.5 - 200 / 1024;
    const Y_ENV = 0.5 - 200 / REF_H;
    const Z_ENV = 100 / REF_H;
    const newObject = (i: number, colors: Rgb[]): ObjectState => ({
      position: {
        x: ctx.rng.range(-X_ENV, X_ENV),
        y: ctx.rng.range(-Y_ENV, Y_ENV),
        z: ctx.rng.range(-Z_ENV, Z_ENV),
      },
      type: planePool[ctx.rng.int(planePool.length)] ?? KIND_SWIRL,
      color: colors[i] ?? [255, 255, 255],
    });
    const objects: ObjectState[] = (() => {
      const init = paletteColors(paletteMode, ctx.rng);
      return [0, 1, 2, 3].map((i) => newObject(i, init));
    })();

    let bgColor: Rgb = [0, 0, 0];
    let tunnelOffset = 0;
    let cur: VisualParamVector = ctx.initialParams;

    function regen(i: number): void {
      // windchime onArcKey: one regenerated object (single fresh palette draw) + bg flash.
      objects[i] = newObject(i, paletteColors(paletteMode, ctx.rng));
      bgColor = [ctx.rng.int(80), ctx.rng.int(80), ctx.rng.int(80)];
    }

    // windchime frequency map: fader 0..1 → MIN_FREQ·(MAX/MIN)^v (was fv/7; the
    // idiom already yields the normalized 0..1 the row-press encodes).
    const freq = (v: number): number => MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, v);

    // ── plane shape helpers (ported verbatim from windchime index.ts) ──
    // `scale` carries world geometry from the windchime 768-reference to this canvas.

    function topographicRipplePlane(p: p5, size: number): void {
      const res = 18;
      const half = size * 0.5;
      const step = size / res;
      const time = p.millis() * 0.0002;
      for (let z = 0; z < res; z++) {
        p.beginShape(p.TRIANGLE_STRIP);
        for (let x = 0; x <= res; x++) {
          const x1 = x * step - half;
          const z1 = z * step - half;
          const z2 = (z + 1) * step - half;
          const y1 = (p.noise(x1 * 0.01 + time, z1 * 0.01 - time) - 0.5) * size * 0.4;
          const y2 = (p.noise(x1 * 0.01 - time, z2 * 0.01 + time) - 0.5) * size * 0.4;
          p.vertex(x1, y1, z1);
          p.vertex(x1, y2, z2);
        }
        p.endShape();
      }
    }

    function topographicSwirlPlane(p: p5, size: number): void {
      const res = 18;
      const half = size * 0.5;
      const step = size / res;
      const time = p.millis() * 0.0003;
      const swirl = 0.002 * size;
      for (let z = 0; z < res; z++) {
        p.beginShape(p.TRIANGLE_STRIP);
        for (let x = 0; x <= res; x++) {
          const px1 = x * step - half;
          const pz1 = z * step - half;
          const pz2 = (z + 1) * step - half;
          const y1 = (p.noise(px1 * 0.01 + time, pz1 * 0.01 - time) - 0.5) * size * 0.4;
          const y2 = (p.noise(px1 * 0.01 - time, pz2 * 0.01 + time) - 0.5) * size * 0.4;
          const a1 = swirl * Math.sqrt(px1 * px1 + pz1 * pz1);
          const a2 = swirl * Math.sqrt(px1 * px1 + pz2 * pz2);
          const rx1 = px1 * Math.cos(a1) - pz1 * Math.sin(a1);
          const rz1 = px1 * Math.sin(a1) + pz1 * Math.cos(a1);
          const rx2 = px1 * Math.cos(a2) - pz2 * Math.sin(a2);
          const rz2 = px1 * Math.sin(a2) + pz2 * Math.cos(a2);
          p.vertex(rx1, y1, rz1);
          p.vertex(rx2, y2, rz2);
        }
        p.endShape();
      }
    }

    function topographicRadialWaveDisc(p: p5, size: number): void {
      const rings = 16;
      const sectors = 20;
      const radius = size * 0.5;
      const time = p.millis() * 0.0003;
      for (let r = 0; r < rings; r++) {
        const r1 = (r / rings) * radius;
        const r2 = ((r + 1) / rings) * radius;
        p.beginShape(p.TRIANGLE_STRIP);
        for (let s = 0; s <= sectors; s++) {
          const angle = (s / sectors) * Math.PI * 2;
          const x1 = r1 * Math.cos(angle);
          const z1 = r1 * Math.sin(angle);
          const y1 = (p.noise(x1 * 0.01 + time, z1 * 0.01 - time) - 0.5) * size * 0.4;
          const x2 = r2 * Math.cos(angle);
          const z2 = r2 * Math.sin(angle);
          const y2 = (p.noise(x2 * 0.01 - time, z2 * 0.01 + time) - 0.5) * size * 0.4;
          p.vertex(x1, y1, z1);
          p.vertex(x2, y2, z2);
        }
        p.endShape();
      }
    }

    function topographicLayeredRidgePlane(p: p5, size: number): void {
      const layers = 14;
      const half = size * 0.5;
      const time = p.millis() * 0.0002;
      const segs = 20;
      for (let i = 0; i < layers; i++) {
        const outer1 = (i / layers) * half;
        const outer2 = ((i + 1) / layers) * half;
        p.beginShape(p.TRIANGLE_STRIP);
        for (let s = 0; s <= segs; s++) {
          const angle = (s / segs) * Math.PI * 2;
          const x1 = outer1 * Math.cos(angle);
          const z1 = outer1 * Math.sin(angle);
          const y1 = (p.noise(x1 * 0.01 + time, z1 * 0.01 - time) - 0.5) * size * 0.4;
          const x2 = outer2 * Math.cos(angle);
          const z2 = outer2 * Math.sin(angle);
          const y2 = (p.noise(x2 * 0.01 - time, z2 * 0.01 + time) - 0.5) * size * 0.4;
          p.vertex(x1, y1, z1);
          p.vertex(x2, y2, z2);
        }
        p.endShape();
      }
    }

    function drawPlaneShape(p: p5, type: number, size: number, color: Rgb): void {
      // windchime: stroke + translucent fill, in the object's colour.
      p.stroke(color[0], color[1], color[2], 200 + cur.contrast * 55);
      p.fill(color[0], color[1], color[2], lerp(60, 140, cur.contrast));
      switch (type) {
        case KIND_SWIRL:
          topographicSwirlPlane(p, size);
          break;
        case KIND_DISC:
          topographicRadialWaveDisc(p, size);
          break;
        case KIND_RIDGE:
          topographicLayeredRidgePlane(p, size);
          break;
        case KIND_RIPPLE:
        default:
          topographicRipplePlane(p, size);
          break;
      }
    }

    /** Forward-scrolling infinite noise tunnel — windchime drawTunnel, verbatim
     * (its world constants scaled by `scale` from the 768 reference). */
    function drawTunnel(p: p5, scale: number): void {
      if (!tunnelEnabled) return;
      const ringRes = 18;
      const ringSpacing = 80 * scale;
      const baseRadius = 1000 * scale;
      const noiseAmp = 40 * scale;
      const noiseScale = 0.05;
      // motion axis rides the forward scroll; centred axis = the windchime +100/frame.
      tunnelOffset += 100 * scale * lerp(0.6, 1.6, cur.motion);

      p.stroke(150, 100);
      p.noFill();
      for (let i = 0; i < tunnelRings; i++) {
        const ringIdx = Math.floor(tunnelOffset / ringSpacing) + i;
        const z1 = -(ringIdx * ringSpacing - tunnelOffset);
        const z2 = -((ringIdx + 1) * ringSpacing - tunnelOffset);
        p.beginShape(p.TRIANGLE_STRIP);
        for (let r = 0; r <= ringRes; r++) {
          const angle = (r / ringRes) * Math.PI * 2;
          const r1 =
            baseRadius +
            p.noise(
              Math.cos(angle) * noiseScale + ringIdx * 0.1,
              Math.sin(angle) * noiseScale + ringIdx * 0.1,
            ) *
              noiseAmp;
          const r2 =
            baseRadius +
            p.noise(
              Math.cos(angle) * noiseScale + (ringIdx + 1) * 0.1,
              Math.sin(angle) * noiseScale + (ringIdx + 1) * 0.1,
            ) *
              noiseAmp;
          p.vertex(r1 * Math.cos(angle), r1 * Math.sin(angle), z1);
          p.vertex(r2 * Math.cos(angle), r2 * Math.sin(angle), z2);
        }
        p.endShape();
      }
    }

    return {
      setup(p): void {
        p.createCanvas(ctx.width, ctx.height, p.WEBGL);
      },

      update(params): void {
        cur = params;
      },

      setProfile(setup): void {
        profile = profileFromSetup(setup);
        idioms.setProfile(profile);
      },
      controlMap: (setup) => idioms.describe(profileFromSetup(setup)),

      onGridKey(e): void {
        idioms.onGridKey?.(e);
      },
      onArcDelta(e): void {
        idioms.onArcDelta?.(e);
      },
      onArcKey(e): void {
        idioms.onArcKey?.(e); // arcMacros fires per-encoder onPress (regenerate)
      },

      draw({ p, width, height }): void {
        const minDim = Math.min(width, height);
        const scale = minDim / REF_H; // windchime world units → this canvas
        // motion axis rides the rotation/oscillation clock (centred axis = ×1).
        const t = p.millis() * lerp(0.6, 1.6, cur.motion);

        p.background(bgColor[0], bgColor[1], bgColor[2]);
        drawTunnel(p, scale);

        const fv = fb.values();
        const av = arc.values();
        for (let i = 0; i < NUM_OBJECTS; i++) {
          const obj = objects[i];
          if (!obj) continue;
          // osc amplitude 0..200 from the panel's 4th fader (turbulence rides it).
          const oscFader = fold(fv[`o${i}osc`] ?? 0, cur.turbulence);
          const oscAmp = (MIN_OSC_AMP + oscFader * (MAX_OSC_AMP - MIN_OSC_AMP)) * scale;
          const oscillation = Math.sin(t * OSC_SPEED) * oscAmp;
          // arc 0..1 → object size 50..350 (density nudges it gently).
          const sizeFrac = fold(av[`size${i}`] ?? 0, cur.density);
          const size = (MIN_OBJECT_SIZE + sizeFrac * (MAX_OBJECT_SIZE - MIN_OBJECT_SIZE)) * scale;
          p.push();
          p.translate(
            obj.position.x * width,
            obj.position.y * height,
            obj.position.z * minDim + oscillation,
          );
          p.rotateX(Math.sin(t * freq(fv[`o${i}x`] ?? 0)) * Math.PI);
          p.rotateY(Math.cos(t * freq(fv[`o${i}y`] ?? 0)) * Math.PI);
          p.rotateZ(Math.sin(t * freq(fv[`o${i}z`] ?? 0)) * Math.PI);
          drawPlaneShape(p, obj.type, size, obj.color);
          p.pop();
        }

        idioms.renderGrid(ctx.ledOut, profile);
        idioms.renderArc(ctx.ledOut, profile);
      },
    };

    /** Fold a fader (primary) with a VisualParamVector axis: centred axis = no change. */
    function fold(f: number, axis: number): number {
      const v = f + (axis - 0.5) * 0.4;
      return v < 0 ? 0 : v > 1 ? 1 : v;
    }
  },
};
