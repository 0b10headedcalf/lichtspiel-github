/**
 * monomeArcgridcombo — faithful port (not forked) of windchime-animation
 * packages/sketch-families/src/monomeArcgridcombo (itself a port of
 * Monome_arcgridcombo.pde). Four solid 3D objects (box / sphere / torus) spin on
 * a black field, arranged per the variant; a 16-step grid sequencer flashes a
 * white scanline for every lane firing under the play-head. The full variant
 * space is preserved: 5 palettes · 4 object-kind sets · 4 arrangements · 4 step
 * timings (incl. half-half) · the FIVE arc LED policies (comet/spot/sweep/bar/
 * opposing). The objects start gently spinning (windchime's 0.01 rad/frame seed).
 *
 * Lichtspiel rewiring: windchime's hardcoded 16-col grid + 4 arc encoders become
 * a `stepSequencer` (6 lanes + play-head + cut/loop latch; 16 steps on a Grid 128,
 * 8 on a Grid 64) + `arcMacros` in VELOCITY mode (turn = spin-up impulse, press =
 * stop, free-wheel damping — the windchime "+= delta" rotation-speed feel), so the
 * surface adapts to the connected device. The arc rings show each object's rotation
 * phase via the chosen policy; the objects' rotation is locked to it. WEBGL.
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
import { type Rgb, hslToRgb } from './lib/palettes.js';

const TWO_PI = Math.PI * 2;
const SPIN_IMPULSE = 0.0008; // arc delta → phase-turns/frame (windchime feel)
const SEED_SPIN = 0.0016; // ≈ windchime's 0.01 rad/frame mount spin

/** windchime stepTime (frames @60fps) per timing mode. half-half alternates 25/75. */
const stepFramesFor = (mode: string): number =>
  mode === 'fast-25' ? 25 : mode === 'slow-100' ? 100 : 50;

const variants = makeVariantFactory({
  palette: { canonical: 'random', options: ['random', 'warm', 'cool', 'monochrome', 'complement'] },
  objectKinds: { canonical: 'mixed', options: ['mixed', 'boxes', 'spheres', 'mixed-3d'] },
  arrangement: { canonical: 'horizontal', options: ['horizontal', 'stacked', 'circle', 'scattered'] },
  stepTiming: { canonical: 'steady-50', options: ['steady-50', 'fast-25', 'slow-100', 'half-half'] },
  arcLed: { canonical: 'comet', options: ['comet', 'spot', 'sweep', 'bar', 'opposing'] },
});

/** windchime monomeArcgridcombo paletteColors — 4 RGB tuples per mode. */
function paletteColors4(mode: string, rng: MountContext['rng']): Rgb[] {
  const out: Rgb[] = [];
  switch (mode) {
    case 'warm':
      for (let i = 0; i < 4; i++) out.push(hslToRgb(rng.range(0, 60), rng.range(0.7, 1), rng.range(0.45, 0.65)));
      break;
    case 'cool':
      for (let i = 0; i < 4; i++) out.push(hslToRgb(rng.range(180, 270), rng.range(0.6, 1), rng.range(0.45, 0.7)));
      break;
    case 'monochrome': {
      const hue = rng.range(0, 360);
      for (let i = 0; i < 4; i++) out.push(hslToRgb(hue, rng.range(0.6, 0.9), rng.range(0.35, 0.75)));
      break;
    }
    case 'complement': {
      const base = rng.range(0, 360);
      const comp = (base + 180) % 360;
      for (let i = 0; i < 4; i++) out.push(hslToRgb(i % 2 === 0 ? base : comp, rng.range(0.65, 1), rng.range(0.45, 0.65)));
      break;
    }
    case 'random':
    default:
      for (let i = 0; i < 4; i++) out.push([rng.int(256), rng.int(256), rng.int(256)]);
  }
  return out;
}

/** windchime objectKinds — 4 values in {0 box, 1 sphere, 2 torus}. */
function objectKinds4(mode: string, rng: MountContext['rng']): number[] {
  switch (mode) {
    case 'boxes':
      return [0, 0, 0, 0];
    case 'spheres':
      return [1, 1, 1, 1];
    case 'mixed-3d':
      return [0, 1, 2, rng.int(3)];
    case 'mixed':
    default:
      return [rng.int(2), rng.int(2), rng.int(2), rng.int(2)];
  }
}

/** windchime arrangementOffsets — per-object [x,y,z] as fractions of min(w,h). */
function arrangementOffsets(mode: string): Array<[number, number, number]> {
  switch (mode) {
    case 'stacked':
      return [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
    case 'circle':
      return [0, 1, 2, 3].map((i) => {
        const a = (i / 4) * TWO_PI;
        return [Math.cos(a) * 0.28, Math.sin(a) * 0.28, 0] as [number, number, number];
      });
    case 'scattered':
      return [
        [-0.25, -0.18, 0],
        [0.22, -0.22, 0.08],
        [-0.2, 0.24, -0.05],
        [0.26, 0.16, 0.04],
      ];
    case 'horizontal':
    default:
      return [0, 1, 2, 3].map((i) => [(i - 1.5) * 0.24, 0, 0] as [number, number, number]);
  }
}

export const monomeArcgridcombo: VisualTemplate = {
  id: 'monomeArcgridcombo',
  name: 'Arc + Grid Combo',
  family: 'sequencer',
  description:
    '16-step grid sequencer flashing scanlines under the play-head while four arc-driven 3D objects spin. The Grid 128 / Arc 4 step-sequencer idiom showcase.',
  tags: ['sequencer', 'step', 'arc', 'rotation', '3d', 'rhythmic', 'percussive', 'monome'],
  defaultParams: { motion: 0.5, turbulence: 0.5, density: 0.5, contrast: 0.6, palette: 0.3 },
  renderer: 'webgl',
  sourceLineage: 'windchime monomeArcgridcombo (Monome_arcgridcombo.pde, faithful port)',
  hardwareTarget: { grid: '128', arc: '4' },
  idioms: ['stepSequencer', 'arcMacros'],
  gestural: {
    name: 'Step Sequencer + Arc Rotation',
    summary:
      'A 16-step grid sequencer (8 on a Grid 64): rows 0–5 toggle steps, row 7 cuts the play position / latches a loop. Each lane firing under the play-head flashes a scanline. Arc encoders spin one 3D object each (turn = spin up, press = stop); the rings show rotation phase. On an Arc 2 each encoder covers two objects.',
    grid: [
      { area: 'grid rows 0–5, any column', action: 'press', effect: 'toggle a step on/off at (col, row)' },
      { area: 'grid row 7, any column', action: 'single press', effect: 'cut the play position to that column' },
      { area: 'grid row 7, two columns held', action: 'press second while first held', effect: 'set loop start + end' },
    ],
    arc: [
      { area: 'arc enc 0–3', action: 'turn', effect: "spin up that object's rotation (impulse → free-wheeling velocity)" },
      { area: 'arc enc 0–3', action: 'press', effect: "stop that object's rotation" },
    ],
  },
  variants,

  create(ctx: MountContext) {
    const paletteMode = cfg<string>(ctx.config, 'palette', 'random');
    const kindsMode = cfg<string>(ctx.config, 'objectKinds', 'mixed');
    const arrangeMode = cfg<string>(ctx.config, 'arrangement', 'horizontal');
    const timing = cfg<string>(ctx.config, 'stepTiming', 'steady-50');
    const arcLed = cfg<ArcLedPolicy>(ctx.config, 'arcLed', 'comet');

    let profile: IdiomProfile = profileFromSetup(ctx.setup);
    const seq: StepSequencer = createStepSequencer(); // 6 lanes, steps == cols
    const arc: ArcMacros = createArcMacros({
      encoders: [0, 1, 2, 3].map((i) => ({
        name: `spin${i}`,
        mode: 'velocity',
        damping: 1, // free wheel — a press stops it (windchime resets rotationSpeed)
        impulse: SPIN_IMPULSE,
        led: arcLed,
        velocityTrail: false, // honor the arcLed phase policy
        onPress: () => arc.setVelocity(`spin${i}`, 0),
      })),
    });
    const idioms: ComposedIdiom = composeIdioms([seq, arc]);
    idioms.setProfile(profile);
    for (let i = 0; i < 4; i++) arc.setVelocity(`spin${i}`, SEED_SPIN); // gentle mount spin

    const colors = paletteColors4(paletteMode, ctx.rng);
    const kinds = objectKinds4(kindsMode, ctx.rng);
    const offsets = arrangementOffsets(arrangeMode);

    const angle = [0, 0, 0, 0]; // unbounded rotation accumulator (turns)
    const laneFlash: number[] = []; // per-lane scanline brightness 0..1
    let stepTimer = 0; // frames since the last advance
    let stepsThisCycle = 0;
    let useAlt = false; // half-half toggles the step time every 16 steps
    let userEdited = false;
    let cur: VisualParamVector = ctx.initialParams;

    /** A sparse default pattern so the sequencer plays on mount (clearable). */
    function seedPattern(): void {
      seq.reset?.();
      const steps = seq.values().steps;
      for (let s = 0; s < steps; s += 4) seq.toggle(0, s, true);
      seq.toggle(2, Math.min(2, steps - 1), true);
      seq.toggle(4, Math.min(6, steps - 1), true);
    }
    seedPattern();

    const currentStepFrames = (): number => {
      if (timing === 'half-half') return useAlt ? 75 : 25;
      return stepFramesFor(timing);
    };

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
        const frames = dt * 60;
        arc.tick(dt * 1000); // integrate the spin velocities → ring phase
        const minDim = Math.min(width, height);
        const size = minDim * 0.1;
        const spinScale = lerp(0.6, 1.5, cur.turbulence); // turbulence rides the spin

        // step clock — frame-count timing, motion nudges the rate (faster when high)
        stepTimer += frames * lerp(1.4, 0.7, cur.motion);
        if (stepTimer >= currentStepFrames()) {
          stepTimer = 0;
          seq.advance();
          const active = seq.values().active;
          for (let lane = 0; lane < active.length; lane++) {
            if (active[lane]) laneFlash[lane] = 1;
          }
          stepsThisCycle++;
          if (timing === 'half-half' && stepsThisCycle >= 16) {
            useAlt = !useAlt;
            stepsThisCycle = 0;
          }
        }

        p.background(0);
        p.ambientLight(50);
        p.directionalLight(255, 255, 255, 0, 0, -1);

        // four spinning solid objects — rotation locked to each arc ring's phase
        for (let i = 0; i < 4; i++) {
          angle[i] = (angle[i] ?? 0) + arc.velocity(`spin${i}`) * frames * spinScale;
          const off = offsets[i] ?? [0, 0, 0];
          const c = colors[i] ?? [255, 255, 255];
          const a = angle[i] ?? 0;
          p.push();
          p.translate(off[0] * minDim, off[1] * minDim, off[2] * minDim);
          p.rotateY(a * TWO_PI);
          p.rotateX(a * TWO_PI * 0.6);
          p.noStroke();
          p.fill(c[0], c[1], c[2]);
          const kind = kinds[i] ?? 0;
          if (kind === 0) p.box(size);
          else if (kind === 1) p.sphere(size * 0.6);
          else p.torus(size * 0.55, size * 0.2);
          p.pop();
        }

        // step-trigger scanlines — a white line per lane firing under the play-head
        const laneCount = seq.values().laneRows;
        p.push();
        p.translate(-width / 2, -height / 2, 0);
        for (let lane = 0; lane < laneCount; lane++) {
          const f = laneFlash[lane] ?? 0;
          if (f <= 0.02) {
            laneFlash[lane] = 0;
            continue;
          }
          const y = height * (0.12 + 0.76 * (laneCount > 1 ? lane / (laneCount - 1) : 0.5));
          p.stroke(255, 255 * f * (0.6 + cur.contrast * 0.4));
          p.strokeWeight(2);
          p.line(width * 0.04, y, width * 0.96, y);
          laneFlash[lane] = f * 0.82; // decay
        }
        p.pop();

        idioms.renderGrid(ctx.ledOut, profile);
        idioms.renderArc(ctx.ledOut, profile);
      },
    };
  },
};
