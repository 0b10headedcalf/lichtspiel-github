/**
 * monomeArcgridcombo — adapted (not forked) from windchime-animation
 * packages/sketch-families/src/monomeArcgridcombo (itself a port of
 * processing_corpus_test1/Monome_arcgridcombo). A 16-step grid sequencer whose
 * active steps trigger four arc-driven rotating 3D objects.
 *
 * Lichtspiel rewiring: the bespoke per-sketch grid/arc handling is replaced by
 * the Part-2 idioms — a `stepSequencer` (toggle steps + playhead + loop/cut
 * latch, 16 steps on a Grid 128, 8 on a Grid 64) and `arcMacros` (each encoder
 * a rotation-speed knob, press = stop; rings show the speed via the variant's
 * LED policy). The visual core (rotating box/sphere/torus, arrangement, palette)
 * is ported and parameterised by a structural variant. WEBGL, browser-resilient.
 */

import { type VisualParamVector, lerp } from '@lichtspiel/schemas';
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

/** Four-object colour sets per palette variant. */
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
  mono: [
    [235, 235, 240],
    [150, 150, 160],
    [200, 200, 210],
    [120, 120, 135],
  ],
  acid: [
    [180, 250, 40],
    [250, 80, 200],
    [60, 250, 160],
    [250, 230, 40],
  ],
};

const variants = makeVariantFactory({
  palette: { canonical: 'warm', options: ['warm', 'cool', 'mono', 'acid'] },
  objects: { canonical: 'mixed', options: ['mixed', 'boxes', 'spheres', 'tori'] },
  arrangement: { canonical: 'row', options: ['row', 'arc', 'depth', 'cluster'] },
  arcLed: { canonical: 'comet', options: ['comet', 'marker', 'segments', 'gauge'] },
  tempo: { canonical: 'steady', options: ['steady', 'fast', 'slow'] },
});

const MAX_SPEED = 0.06; // rad/frame at a fully-turned encoder

export const monomeArcgridcombo: VisualTemplate = {
  id: 'monomeArcgridcombo',
  name: 'Arc + Grid Combo',
  family: 'sequencer',
  description:
    '16-step grid sequencer triggering four arc-driven rotating 3D objects. The Grid 128 / Arc 4 idiom showcase.',
  tags: ['sequencer', 'step', 'arc', 'rotation', '3d', 'rhythmic', 'percussive', 'monome'],
  defaultParams: { motion: 0.5, turbulence: 0.5, density: 0.5, contrast: 0.6, palette: 0.3 },
  renderer: 'webgl',
  sourceLineage: 'windchime monomeArcgridcombo (Monome_arcgridcombo.pde)',
  hardwareTarget: { grid: '128', arc: '4' },
  idioms: ['stepSequencer', 'arcMacros'],
  variants,

  create(ctx: MountContext) {
    const paletteName = cfg<string>(ctx.config, 'palette', 'warm');
    const objectsMode = cfg<string>(ctx.config, 'objects', 'mixed');
    const arrangement = cfg<string>(ctx.config, 'arrangement', 'row');
    const arcLed = cfg<ArcLedPolicy>(ctx.config, 'arcLed', 'comet');
    const tempo = cfg<string>(ctx.config, 'tempo', 'steady');

    let profile: IdiomProfile = profileFromSetup(ctx.setup);
    const seq: StepSequencer = createStepSequencer();
    const arc: ArcMacros = createArcMacros({
      encoders: [0, 1, 2, 3].map((i) => ({
        name: `spin${i}`,
        initial: 0.56,
        led: arcLed,
        onPress: () => arc.set(`spin${i}`, 0.5), // press = stop
      })),
    });
    const idioms: ComposedIdiom = composeIdioms([seq, arc]);
    idioms.setProfile(profile);

    const palette = PALETTES[paletteName] ?? (PALETTES.warm as number[][]);
    const kinds = [0, 1, 2, 3].map(() => {
      if (objectsMode === 'boxes') return 0;
      if (objectsMode === 'spheres') return 1;
      if (objectsMode === 'tori') return 2;
      return ctx.rng.int(3); // mixed
    });

    const phase = [0, 0, 0, 0];
    const pulse = [0, 0, 0, 0];
    let stepClock = 0;
    let userEdited = false;
    let cur: VisualParamVector = ctx.initialParams;

    /** A sparse default pattern, scaled to the current step count, so the scene
     *  plays on mount and re-seeds across a hot-swap until the performer edits. */
    function seedPattern(): void {
      seq.reset?.();
      const steps = seq.values().steps;
      for (let s = 0; s < steps; s += 4) seq.toggle(0, s, true);
      seq.toggle(2, Math.min(2, steps - 1), true);
      seq.toggle(4, Math.min(6, steps - 1), true);
    }
    seedPattern();

    const baseInterval = (): number => (tempo === 'fast' ? 0.09 : tempo === 'slow' ? 0.26 : 0.15);

    /** Object world position for the arrangement variant (object i of 4). */
    function position(i: number, spread: number): [number, number, number] {
      switch (arrangement) {
        case 'arc': {
          const a = lerp(-Math.PI * 0.5, Math.PI * 0.5, i / 3);
          return [Math.sin(a) * spread, -Math.cos(a) * spread * 0.4, Math.cos(a) * spread * 0.3];
        }
        case 'depth':
          return [(i - 1.5) * spread * 0.4, 0, (i - 1.5) * spread];
        case 'cluster':
          return [(i % 2 === 0 ? -1 : 1) * spread * 0.4, (i < 2 ? -1 : 1) * spread * 0.4, 0];
        case 'row':
        default:
          return [(i - 1.5) * spread, 0, 0];
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
        const spread = minDim * 0.26;
        const size = minDim * 0.12;

        // step clock — motion rides the tempo (faster when motion is high)
        stepClock += dt;
        const interval = baseInterval() * lerp(1.7, 0.45, cur.motion);
        let triggered = false;
        if (stepClock >= interval) {
          stepClock = 0;
          seq.advance();
          const active = seq.values().active;
          for (let lane = 0; lane < active.length; lane++) {
            if (active[lane]) {
              const obj = lane % 4;
              pulse[obj] = 1;
              triggered = true;
            }
          }
        }

        const flash = triggered ? 18 : 0;
        p.background(6 + flash, 6 + flash, 9 + flash);
        p.ambientLight(48);
        p.directionalLight(255, 255, 255, 0.2, 0.4, -1);
        p.pointLight(180, 200, 255, 0, -spread, spread);

        const av = arc.values();
        for (let i = 0; i < 4; i++) {
          const speed = ((av[`spin${i}`] ?? 0.5) - 0.5) * 2 * MAX_SPEED * (0.5 + cur.turbulence);
          phase[i] = (phase[i] ?? 0) + speed * dt * 60;
          pulse[i] = (pulse[i] ?? 0) * 0.9;
          const [px, py, pz] = position(i, spread);
          const c = palette[i] ?? [220, 220, 220];
          const boost = 1 + (pulse[i] ?? 0) * 0.6;
          const s = size * (1 + (pulse[i] ?? 0) * 0.35);
          p.push();
          p.translate(px, py, pz);
          p.rotateY(phase[i] ?? 0);
          p.rotateX((phase[i] ?? 0) * 0.6);
          p.noStroke();
          p.fill(
            Math.min(255, (c[0] ?? 0) * boost),
            Math.min(255, (c[1] ?? 0) * boost),
            Math.min(255, (c[2] ?? 0) * boost),
          );
          const kind = kinds[i] ?? 0;
          if (kind === 0) p.box(s);
          else if (kind === 1) p.sphere(s * 0.6);
          else p.torus(s * 0.6, s * 0.22);
          p.pop();
        }

        idioms.renderGrid(ctx.ledOut, profile);
        idioms.renderArc(ctx.ledOut, profile);
      },
    };
  },
};
