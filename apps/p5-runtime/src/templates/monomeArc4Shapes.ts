/**
 * monomeArc4Shapes — adapted (not forked) from windchime-animation
 * packages/sketch-families/src/monomeArc4Shapesv12 (itself a hand-port of
 * processing_corpus_test1/monomearc4shapescontrolv12). 3D tori/spheres orbit in
 * WEBGL, overlaid by animated 2D strobe motifs (diagonal / spiral / hex / oval).
 *
 * Lichtspiel rewiring (concept-adapted, not pixel-faithful):
 *   - The bespoke per-sketch grid handling (4 strobe panels × 4 params with a
 *     bottom-row toggle) is replaced by the Part-2 `faderBank` idiom: 8 lanes =
 *     4 motifs × {opacity, gap}. randomness + origin are folded from the
 *     VisualParamVector (turbulence / symmetry) so the surface stays ~8 lanes.
 *   - The assorted per-encoder arc handlers become `arcMacros`: enc0 = movement
 *     intensity (ring 'fill'); enc1-3 = playhead speed / size / rotation (ring
 *     'playhead'); a press regenerates the orbiting objects and re-rolls the
 *     strobe colours via the seeded RNG.
 *   - The original's screen-space 2D strobe overlay is concept-adapted to WEBGL:
 *     each motif is drawn on a quad translated toward the camera (z near +depth),
 *     facing the camera — NO separate 2D graphics buffer. Object/loop counts are
 *     capped and all sizes scale by min(width,height) for 60fps + browser
 *     resilience. The original's OSC scene-trigger on enc0 press is a no-op here.
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

type RGB = [number, number, number];

const NUM_MOTIFS = 4; // diagonal, spiral, hex, oval
const NUM_OBJECTS = 4; // orbiting tori / spheres
const STROBE_BASE_SPEED = [0.9, 0.6, 0.45, 0.45]; // ring offset drift per motif

/** Strobe motif kinds 0..3, gated by the `strobes` variant axis. */
function allowedStrobes(mode: string): number[] {
  switch (mode) {
    case 'diagonal':
      return [0];
    case 'spiral':
      return [1];
    case 'hex':
      return [2];
    case 'oval':
      return [3];
    case 'off':
      return [];
    case 'all':
    default:
      return [0, 1, 2, 3];
  }
}

/** Object shape kinds: 0 = torus, 1 = sphere — gated by the `objects` axis. */
function allowedObjects(mode: string): number[] {
  switch (mode) {
    case 'tori':
      return [0];
    case 'spheres':
      return [1];
    case 'all':
    default:
      return [0, 1];
  }
}

function hslToRgb(h: number, s: number, l: number): RGB {
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
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

/** One palette draw, seeded via ctx.rng (never the global Math RNG). */
function paletteColor(mode: string, rng: MountContext['rng']): RGB {
  switch (mode) {
    case 'warm':
      return hslToRgb(rng.range(0, 60), 0.85, 0.6);
    case 'cool':
      return hslToRgb(rng.range(180, 270), 0.85, 0.6);
    case 'neon': {
      const hues = [330, 280, 195, 60];
      return hslToRgb(rng.pick(hues), 1, 0.6);
    }
    case 'monochrome':
      return hslToRgb(rng.range(0, 360), 0.7, rng.range(0.4, 0.75));
    case 'random':
    default:
      return [rng.int(256), rng.int(256), rng.int(256)];
  }
}

const variants = makeVariantFactory({
  palette: { canonical: 'random', options: ['random', 'warm', 'cool', 'neon', 'monochrome'] },
  strobes: { canonical: 'all', options: ['all', 'diagonal', 'spiral', 'hex', 'oval', 'off'] },
  objects: { canonical: 'all', options: ['all', 'tori', 'spheres'] },
  arcLed: { canonical: 'playhead', options: ['playhead', 'comet', 'marker', 'segments'] },
});

interface Orbiter {
  kind: number; // 0 torus, 1 sphere
  color: RGB;
  radius: number; // orbit radius factor 0..1 of spread
  axis: number; // orbit tilt phase
  spin: number; // own rotation phase
  spinRate: number; // own rotation speed factor
}

export const monomeArc4Shapes: VisualTemplate = {
  id: 'monomeArc4Shapes',
  name: 'Arc 4 Shapes + Strobes',
  family: 'overlay',
  description:
    '3D tori and spheres orbiting under animated 2D strobe motifs (diagonal/spiral/hex/oval). Faders set per-motif opacity/gap; the arc drives movement and playhead speed/size/rotation.',
  tags: ['arc', 'strobe', 'overlay', '3d', 'tori', 'spheres', 'psychedelic', 'monome', 'orbit'],
  defaultParams: { motion: 0.5, turbulence: 0.5, density: 0.55, contrast: 0.6, strobe: 0.4, palette: 0.4 },
  renderer: 'webgl',
  sourceLineage: 'windchime monomeArc4Shapesv12 (monomearc4shapescontrolv12.pde)',
  hardwareTarget: { grid: '128', arc: '4' },
  idioms: ['faderBank', 'arcMacros'],
  variants,

  create(ctx: MountContext) {
    const paletteName = cfg<string>(ctx.config, 'palette', 'random');
    const strobePool = allowedStrobes(cfg<string>(ctx.config, 'strobes', 'all'));
    const objectPool = allowedObjects(cfg<string>(ctx.config, 'objects', 'all'));
    const arcLed = cfg<ArcLedPolicy>(ctx.config, 'arcLed', 'playhead');

    let profile: IdiomProfile = profileFromSetup(ctx.setup);

    // 8 lanes = 4 motifs × {opacity, gap}. spread = panels-vs-columns on a 128.
    const MOTIF_NAMES = ['diag', 'spiral', 'hex', 'oval'];
    const faders: FaderBank = createFaderBank({
      lanes: MOTIF_NAMES.flatMap((m) => [
        { name: `${m}Opacity`, initial: 0.6 },
        { name: `${m}Gap`, initial: 0.5 },
      ]),
    });

    // enc0 movement intensity (fill); enc1-3 playhead speed/size/rotation. A
    // press on any encoder regenerates objects + re-rolls strobe colours; that
    // action is routed through the sketch's onArcKey below (it needs the visual
    // closure), so no per-encoder onPress is wired here.
    const arc: ArcMacros = createArcMacros({
      encoders: [
        { name: 'movement', initial: 0.45, led: 'fill' },
        { name: 'speed', initial: 0.5, led: arcLed, mode: 'relative' },
        { name: 'size', initial: 0.5, led: arcLed, mode: 'relative' },
        { name: 'rotation', initial: 0.5, led: arcLed, mode: 'relative' },
      ],
    });

    const idioms: ComposedIdiom = composeIdioms([faders, arc]);
    idioms.setProfile(profile);

    // --- visual state (all randomness via ctx.rng) ---
    const orbiters: Orbiter[] = [];
    const strobeColor: RGB[] = [];
    let bgColor: RGB = [4, 4, 8];
    const strobeOffset = [0, 0, 0, 0];
    const gapJitter = [0, 0, 0, 0];
    let cur: VisualParamVector = ctx.initialParams;

    function regenerate(): void {
      orbiters.length = 0;
      for (let i = 0; i < NUM_OBJECTS; i++) {
        orbiters.push({
          kind: ctx.rng.pick(objectPool.length > 0 ? objectPool : [0]),
          color: paletteColor(paletteName, ctx.rng),
          radius: ctx.rng.range(0.35, 1),
          axis: ctx.rng.range(0, Math.PI * 2),
          spin: ctx.rng.range(0, Math.PI * 2),
          spinRate: ctx.rng.range(0.4, 1.6),
        });
      }
      strobeColor.length = 0;
      for (let s = 0; s < NUM_MOTIFS; s++) strobeColor.push(paletteColor(paletteName, ctx.rng));
      bgColor = [ctx.rng.int(14), ctx.rng.int(14), ctx.rng.int(18)];
    }
    regenerate();

    /** Draw one orbiting object (capped vertex counts for 60fps). */
    function drawOrbiter(p: p5, o: Orbiter, baseSize: number): void {
      p.push();
      p.rotateY(o.axis);
      p.rotateX(o.axis * 0.6);
      p.translate(o.radius * baseSize * 2.2, 0, 0);
      p.rotateY(o.spin);
      p.rotateX(o.spin * 0.5);
      p.noStroke();
      p.fill(o.color[0], o.color[1], o.color[2]);
      if (o.kind === 1) {
        p.sphere(baseSize * 0.55, 16, 12);
      } else {
        p.torus(baseSize * 0.6, baseSize * 0.22, 20, 12);
      }
      p.pop();
    }

    /** Draw a 2D strobe motif on a camera-facing quad at z near the camera. */
    function drawStrobe(p: p5, motif: number, span: number, near: number): void {
      if (!strobePool.includes(motif)) return;
      const fv = faders.values();
      const name = MOTIF_NAMES[motif] ?? 'diag';
      const op = clamp01(fv[`${name}Opacity`] ?? 0);
      if (op <= 0.001) return;

      const alpha = lerp(20, 210, op) * lerp(0.4, 1, cur.strobe);
      const gapLane = clamp01(fv[`${name}Gap`] ?? 0.5);
      const baseGap = lerp(span * 0.04, span * 0.22, gapLane);
      // randomness folded from turbulence; origin folded from symmetry.
      const randProb = clamp01(cur.turbulence) * 0.3;
      if (ctx.rng.random() < randProb) gapJitter[motif] = ctx.rng.range(-baseGap * 0.4, baseGap * 0.4);
      const gap = Math.max(span * 0.02, baseGap + (gapJitter[motif] ?? 0));
      const origin = lerp(-Math.PI, Math.PI, clamp01(cur.symmetry));
      strobeOffset[motif] = (strobeOffset[motif] ?? 0) + (STROBE_BASE_SPEED[motif] ?? 0.5) * (0.4 + cur.motion);
      const offset = strobeOffset[motif] ?? 0;
      const c1 = bgColor;
      const c2 = strobeColor[motif] ?? [255, 255, 255];

      p.push();
      p.translate(0, 0, near); // toward the camera, facing it (no separate 2D buffer)
      p.noStroke();
      p.rotateZ(origin);

      const half = span * 0.55;
      // Cap band iterations so a tiny gap can't stall the frame.
      const maxBands = 200;
      if (motif === 0) {
        // diagonal
        let drawn = 0;
        for (let x = -half; x < half && drawn < maxBands; x += gap, drawn++) {
          const band = Math.floor((x + offset) / gap);
          const c = band % 2 === 0 ? c1 : c2;
          p.fill(c[0], c[1], c[2], alpha);
          p.rect(x, -half, gap * 1.4, half * 2);
        }
      } else if (motif === 1) {
        // spiral
        let drawn = 0;
        for (let r = gap; r < half && drawn < maxBands; r += gap, drawn++) {
          const theta = r * 0.05 + offset * 0.02;
          const band = Math.floor((r + offset) / gap);
          const c = band % 2 === 0 ? c1 : c2;
          p.fill(c[0], c[1], c[2], alpha);
          p.ellipse(Math.cos(theta) * r, Math.sin(theta) * r, gap * 3, gap * 3);
        }
      } else if (motif === 2) {
        // concentric hexagons
        let drawn = 0;
        for (let r = gap; r < half && drawn < maxBands; r += gap, drawn++) {
          const band = Math.floor((r + offset) / gap);
          const c = band % 2 === 0 ? c1 : c2;
          p.fill(c[0], c[1], c[2], alpha);
          p.beginShape();
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI * 2 * i) / 6;
            p.vertex(Math.cos(a) * r, Math.sin(a) * r);
          }
          p.endShape(p.CLOSE);
        }
      } else {
        // concentric ovals
        let drawn = 0;
        for (let r = gap; r < half && drawn < maxBands; r += gap, drawn++) {
          const band = Math.floor((r + offset) / gap);
          const c = band % 2 === 0 ? c1 : c2;
          p.fill(c[0], c[1], c[2], alpha);
          p.ellipse(0, 0, r * 2, r * 1.2);
        }
      }
      p.pop();
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
        // press on any encoder regenerates objects + re-rolls strobe colours.
        if (e.state === 1) regenerate();
        idioms.onArcKey?.(e);
      },

      draw({ p, width, height, dt }): void {
        const minDim = Math.min(width, height);
        const spread = minDim * 0.28;
        const baseSize = minDim * 0.1;

        const av = arc.values();
        const movement = av.movement ?? 0.45;
        // relative encoders wrap 0..1 → centre 0.5 leaves motion alone.
        const speedMul = lerp(0.3, 2.2, av.speed ?? 0.5);
        const sizeMul = lerp(0.6, 1.6, av.size ?? 0.5);
        const rotMul = lerp(0.3, 2.0, av.rotation ?? 0.5);

        p.background(bgColor[0], bgColor[1], bgColor[2]);
        p.ambientLight(50);
        p.directionalLight(255, 255, 255, 0.3, 0.5, -1);
        p.pointLight(160, 190, 255, 0, -spread, spread);

        // 3D orbiters — capped to NUM_OBJECTS. density folds 0.5-neutral.
        const objSize = baseSize * sizeMul * (0.7 + cur.density * 0.6);
        for (let i = 0; i < orbiters.length; i++) {
          const o = orbiters[i];
          if (!o) continue;
          const advance = dt * 60;
          // movement intensity (enc0) jitters the orbit tilt; motion rides it
          // (0.5-neutral, so a centred motion param leaves the speed alone).
          o.axis += (0.004 + 0.03 * movement) * speedMul * advance * (0.5 + cur.motion);
          o.spin += 0.02 * o.spinRate * rotMul * advance;
          drawOrbiter(p, o, objSize * o.radius + objSize * 0.5);
        }

        // 2D strobe overlays — drawn last (on top), camera-facing quads.
        const near = minDim * 0.45; // toward the camera from centre
        const span = minDim * 1.6;
        for (let s = 0; s < NUM_MOTIFS; s++) drawStrobe(p, s, span, near);

        idioms.renderGrid(ctx.ledOut, profile);
        idioms.renderArc(ctx.ledOut, profile);
      },
    };
  },
};
