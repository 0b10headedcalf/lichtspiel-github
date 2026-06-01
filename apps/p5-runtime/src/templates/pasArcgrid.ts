/**
 * pasArcgrid — faithful port (not forked) of windchime-animation
 * packages/sketch-families/src/pasArcgridv7 (itself a port of PAS_arcgridv7.pde).
 * Four 3D objects (icosahedron / sphere / torus / helix / möbius) rotating on
 * X/Y/Z at independent fader-set frequencies, each bobbing in Z; arc encoders
 * scale them; arc press regenerates one. The crafted geometry, the exponential
 * frequency mapping, the Z-oscillation, the four background modes, and the FIVE
 * arc LED policies (fill/gauge/marker/segments/inverse) are all preserved.
 *
 * Lichtspiel rewiring: windchime's hardcoded 4-panel × 4-fader grid + 4 arc
 * encoders become a `faderBank` (16 lanes — obj×{X,Y,Z,osc}, laid out exactly as
 * the 4 panels on a Grid 128; the first 8 reachable on a Grid 64) + `arcMacros`
 * (size per encoder, press → regenerate), so the control surface adapts to the
 * connected device. Visual values fold gently with the motion axis. WEBGL.
 */

import { type VisualParamVector, lerp } from '@lichtspiel/schemas';
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
import { type FaderPaletteMode, type Rgb, palette4 } from './lib/palettes.js';
import { shapeByType } from './lib/shapes3d.js';

const MIN_FREQ = 0.00005;
const MAX_FREQ = 0.007;
const OSC_SPEED = 0.1;
const MIN_SIZE_REL = 0.06; // × min(w,h)
const MAX_SIZE_REL = 0.4;
const MAX_OSC_REL = 0.26;

const variants = makeVariantFactory({
  palette: { canonical: 'random', options: ['random', 'warm', 'cool', 'monochrome', 'neon'] },
  shapes: { canonical: 'all', options: ['all', 'wireframe-platonic', 'parametric-only', 'simple'] },
  bg: { canonical: 'flash-press', options: ['flash-press', 'static-black', 'oscillating', 'gradient'] },
  arcLed: { canonical: 'fillNotched', options: ['fillNotched', 'gauge', 'marker', 'segments', 'inverse'] },
});

function allowedShapes(mode: string): number[] {
  if (mode === 'wireframe-platonic') return [0, 1];
  if (mode === 'parametric-only') return [3, 4];
  if (mode === 'simple') return [1, 2];
  return [0, 1, 2, 3, 4];
}

interface ObjState {
  x: number;
  y: number;
  z: number; // normalized fractions of min(w,h)
  type: number;
  color: Rgb;
}

export const pasArcgrid: VisualTemplate = {
  id: 'pasArcgrid',
  name: 'PAS Arc + Grid',
  family: 'objects',
  description:
    'Four 3D objects (icosahedron/sphere/torus/helix/möbius) tumbling on X/Y/Z at fader-set frequencies; arc scales + regenerates them.',
  tags: ['3d', 'wireframe', 'rotation', 'objects', 'faders', 'arc', 'monome', 'platonic'],
  defaultParams: { motion: 0.5, turbulence: 0.5, density: 0.5, contrast: 0.6, palette: 0.4 },
  renderer: 'webgl',
  sourceLineage: 'windchime pasArcgridv7 (PAS_arcgridv7.pde, faithful port)',
  hardwareTarget: { grid: '128', arc: '4' },
  idioms: ['faderBank', 'arcMacros'],
  gestural: {
    name: 'Fader-Bank 3D Control',
    summary:
      'Four control panels of four vertical faders — each drives one 3D object\'s X/Y/Z rotation frequency + Z-oscillation. Arc encoders scale each object; press regenerates it. On an Arc 2 each encoder press cycles through two of the four objects.',
    grid: [
      { area: 'cols 0–2 of each 4-col panel', action: 'press a row', effect: 'set X / Y / Z rotation-frequency fader (higher row = faster)' },
      { area: 'col 3 of each panel', action: 'press a row', effect: 'set Z-oscillation amplitude fader' },
    ],
    arc: [
      { area: 'enc 0–3', action: 'turn', effect: "scale that object's size" },
      { area: 'enc 0–3', action: 'press', effect: 'regenerate that object — new shape, colour, position (+ bg flash)' },
    ],
  },
  variants,

  create(ctx: MountContext) {
    const paletteMode = cfg<FaderPaletteMode>(ctx.config, 'palette', 'random');
    const shapesMode = cfg<string>(ctx.config, 'shapes', 'all');
    const bgMode = cfg<string>(ctx.config, 'bg', 'flash-press');
    const arcLed = cfg<ArcLedPolicy>(ctx.config, 'arcLed', 'fill');
    const shapePool = allowedShapes(shapesMode);

    let profile: IdiomProfile = profileFromSetup(ctx.setup);

    // 16 fader lanes laid out as 4 panels × {X, Y, Z, osc} — exactly the windchime
    // grid-128 layout; on a Grid 64 they grid-FOLD (col x → objects x & x+4), so all
    // 4 objects stay controllable.
    const AXIS_LABEL: Record<string, string> = {
      x: 'X-rot freq',
      y: 'Y-rot freq',
      z: 'Z-rot freq',
      osc: 'Z-oscillation',
    };
    const lanes = [0, 1, 2, 3].flatMap((o) =>
      ['x', 'y', 'z', 'osc'].map((axis) => ({
        name: `o${o}${axis}`,
        label: `obj ${o} ${AXIS_LABEL[axis]}`,
        initial: 4 / 7,
      })),
    );
    const fb: FaderBank = createFaderBank({ spread: false, lanes });
    const arc: ArcMacros = createArcMacros({
      // turn couples (enc0 scales obj0 + obj2 on an Arc 2); press cycles the regen.
      encoders: [0, 1, 2, 3].map((i) => ({
        name: `size${i}`,
        label: `object ${i} size`,
        pressLabel: `regenerate object ${i}`,
        initial: 0.25,
        led: arcLed,
        onPress: () => regen(i),
      })),
    });
    const idioms: ComposedIdiom = composeIdioms([fb, arc]);
    idioms.setProfile(profile);

    const newObject = (i: number, colors: Rgb[]): ObjState => ({
      x: ctx.rng.range(-0.32, 0.32),
      y: ctx.rng.range(-0.24, 0.24),
      z: ctx.rng.range(-0.1, 0.1),
      type: shapePool[ctx.rng.int(shapePool.length)] ?? 1,
      color: colors[i] ?? [255, 255, 255],
    });
    const initColors = palette4(paletteMode, ctx.rng);
    const objects: ObjState[] = [0, 1, 2, 3].map((i) => newObject(i, initColors));

    let bgColor: Rgb =
      bgMode === 'gradient'
        ? [ctx.rng.int(30), ctx.rng.int(30), ctx.rng.int(40)]
        : bgMode === 'oscillating'
          ? [10, 10, 10]
          : [0, 0, 0];
    let elapsed = 0; // ms, scaled by the motion axis
    let cur: VisualParamVector = ctx.initialParams;

    function regen(i: number): void {
      objects[i] = newObject(i, palette4(paletteMode, ctx.rng));
      if (bgMode === 'flash-press') bgColor = [ctx.rng.int(60), ctx.rng.int(60), ctx.rng.int(60)];
    }
    const freq = (v: number): number => MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, v);

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
        idioms.onArcKey?.(e);
      },

      draw({ p, width, height, dt }): void {
        const minDim = Math.min(width, height);
        elapsed += dt * 1000 * lerp(0.6, 1.6, cur.motion); // motion rides the spin
        if (bgMode === 'oscillating') {
          const t = elapsed * 0.0003;
          bgColor = [
            Math.floor(10 + 20 * (1 + Math.sin(t))),
            Math.floor(10 + 20 * (1 + Math.sin(t + 2))),
            Math.floor(10 + 20 * (1 + Math.sin(t + 4))),
          ];
        }
        p.background(bgColor[0], bgColor[1], bgColor[2]);

        const fv = fb.values();
        const av = arc.values();
        for (let i = 0; i < 4; i++) {
          const o = objects[i];
          if (!o) continue;
          const oscAmp = (fv[`o${i}osc`] ?? 0) * MAX_OSC_REL * minDim;
          const osc = Math.sin(elapsed * OSC_SPEED) * oscAmp;
          const size = (MIN_SIZE_REL + (av[`size${i}`] ?? 0) * (MAX_SIZE_REL - MIN_SIZE_REL)) * minDim;
          p.push();
          p.translate(o.x * minDim, o.y * minDim, o.z * minDim + osc);
          p.rotateX(Math.sin(elapsed * freq(fv[`o${i}x`] ?? 0)) * Math.PI);
          p.rotateY(Math.cos(elapsed * freq(fv[`o${i}y`] ?? 0)) * Math.PI);
          p.rotateZ(Math.sin(elapsed * freq(fv[`o${i}z`] ?? 0)) * Math.PI);
          p.noFill();
          p.stroke(o.color[0], o.color[1], o.color[2], 200 + cur.contrast * 55);
          p.strokeWeight(1);
          shapeByType(p, o.type, size);
          p.pop();
        }

        idioms.renderGrid(ctx.ledOut, profile);
        idioms.renderArc(ctx.ledOut, profile);
      },
    };
  },
};
