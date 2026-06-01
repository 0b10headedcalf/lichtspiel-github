/**
 * itoBox — adapted (NOT forked) from windchime-animation
 * packages/sketch-families/src/itoBoxV9/index.ts (itself a port of
 * processing_corpus_test1/Ito_Box_v9/Ito_Box_v9.pde), with its variant space
 * from itoBoxV9/params.ts. A central rotating "roulette" cube with per-face
 * colour pairs over a field of background tori/spheres.
 *
 * Lichtspiel rewiring (concept-adapted, not pixel-faithful):
 *   - The bespoke 4-panel × 4-param grid handler is replaced by the Part-2
 *     `faderBank` idiom: 8 lanes drive the background objects' opacity / move /
 *     random / scale (two groups A/B, so a Grid 64 reads one lane per column and
 *     a Grid 128 keeps cols 8–15 free). The per-sketch arc handler becomes
 *     `arcMacros`: each encoder's value is a TARGET angular velocity for
 *     yaw/pitch/roll/zoom (0.5 = stopped), integrated each frame with damping
 *     from the `damping` variant; pressing randomises an opposite-face colour
 *     pair (enc 0/1/2) or the background + bg-object colours (enc 3), all via
 *     ctx.rng. The arc rings show a velocity-trail read via the variant LED.
 *   - The original's per-pixel face textures (a 300×300 noise field per face,
 *     too heavy for the browser) stay dropped in favour of face-tinted solid
 *     shading; the heavy wireframe bg meshes become cheap solid tori/spheres,
 *     count-capped for 60fps. WEBGL, browser-only resilient, seeded via ctx.rng.
 */

import { type VisualParamVector, clamp01 } from '@lichtspiel/schemas';
import type p5 from 'p5';
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

type RGB = [number, number, number];

/** Structural variants the `v` key / arc re-roll, distinct from the live axes. */
const variants = makeVariantFactory({
  palette: { canonical: 'random', options: ['random', 'warm', 'cool', 'neon', 'monochrome'] },
  damping: { canonical: 'medium', options: ['none', 'light', 'medium', 'heavy'] },
  bgShapes: { canonical: 'all', options: ['all', 'tori', 'spheres'] },
  arcLed: { canonical: 'comet', options: ['comet', 'gauge', 'marker', 'segments'] },
});

const NUM_BG = 5; // capped for 60fps
const MAX_SPEED = 0.05; // rad/frame at a fully-turned encoder
const MAX_ZOOM_RATE = 0.012; // zoom units/frame at a fully-turned encoder

/** Per-frame velocity damping for the roulette feel (closer to 1 = more glide). */
function dampingValue(mode: string): number {
  switch (mode) {
    case 'none':
      return 1;
    case 'light':
      return 0.995;
    case 'heavy':
      return 0.9;
    case 'medium':
    default:
      return 0.97;
  }
}

/** A palette colour for the given mode, drawn from ctx.rng (seeded, reproducible). */
function paletteColor(mode: string, rng: SeededRng): RGB {
  switch (mode) {
    case 'warm':
      return hslToRgb(rng.range(0, 60), 0.85, 0.6);
    case 'cool':
      return hslToRgb(rng.range(180, 270), 0.85, 0.6);
    case 'neon':
      return hslToRgb(rng.range(0, 360), 1, 0.62);
    case 'monochrome':
      return hslToRgb(rng.range(0, 360), 0.15, rng.range(0.45, 0.85));
    case 'random':
    default: {
      const swatches: RGB[] = [
        [0, 255, 210],
        [110, 190, 255],
        [255, 110, 210],
        [170, 255, 110],
        [255, 180, 70],
        [230, 230, 255],
      ];
      return rng.pick(swatches);
    }
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

/** Background shape kinds allowed by the variant (0 = torus, 1 = sphere). */
function bgShapePool(mode: string): number[] {
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

interface BgObject {
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  angle: number;
  spin: number;
  type: number;
  color: RGB;
  group: 0 | 1; // which fader group (A even / B odd) drives this object
}

export const itoBox: VisualTemplate = {
  id: 'itoBox',
  name: 'Ito Box — Cube Roulette',
  family: 'roulette',
  description:
    'A central velocity-driven "roulette" cube with per-face colour pairs over a drifting field of tori/spheres. Arc encoders spin it; the grid faders shape the background. Grid 128 / Arc 4.',
  tags: ['cube', 'roulette', '3d', 'rotation', 'velocity', 'arc', 'fader', 'monome'],
  defaultParams: {
    motion: 0.5,
    turbulence: 0.5,
    density: 0.5,
    contrast: 0.6,
    cameraDepth: 0.5,
    palette: 0.4,
  },
  renderer: 'webgl',
  sourceLineage: 'windchime itoBoxV9 (Ito_Box_v9.pde)',
  hardwareTarget: { grid: '128', arc: '4' },
  idioms: ['faderBank', 'arcMacros'],
  variants,

  create(ctx: MountContext) {
    const paletteName = cfg<string>(ctx.config, 'palette', 'random');
    const dampingName = cfg<string>(ctx.config, 'damping', 'medium');
    const bgShapesName = cfg<string>(ctx.config, 'bgShapes', 'all');
    const arcLed = cfg<ArcLedPolicy>(ctx.config, 'arcLed', 'comet');

    const damping = dampingValue(dampingName);
    const shapePool = bgShapePool(bgShapesName);

    // ── idioms (the control map) ───────────────────────────────────
    let profile: IdiomProfile = profileFromSetup(ctx.setup);

    // 8 faders, one column each (spread:false) so a Grid 128 keeps cols 8–15
    // free; lanes are 4 params × 2 background groups (A drives even objects,
    // B drives odd). 4 arc encoders (extra two lie dormant on an Arc 2).
    const fb: FaderBank = createFaderBank({
      spread: false,
      lanes: [
        { name: 'opacityA', initial: 0.6 },
        { name: 'moveA', initial: 0.45 },
        { name: 'randomA', initial: 0.2 },
        { name: 'scaleA', initial: 0.5 },
        { name: 'opacityB', initial: 0.6 },
        { name: 'moveB', initial: 0.45 },
        { name: 'randomB', initial: 0.2 },
        { name: 'scaleB', initial: 0.5 },
      ],
    });
    const arc: ArcMacros = createArcMacros({
      encoders: [
        { name: 'yaw', initial: 0.5, led: arcLed, onPress: () => randomizeFacePair(0) },
        { name: 'pitch', initial: 0.5, led: arcLed, onPress: () => randomizeFacePair(1) },
        { name: 'roll', initial: 0.5, led: arcLed, onPress: () => randomizeFacePair(2) },
        { name: 'zoom', initial: 0.5, led: arcLed, onPress: () => randomizeBackground() },
      ],
    });
    const idioms: ComposedIdiom = composeIdioms([fb, arc]);
    idioms.setProfile(profile);

    // ── performance state ──────────────────────────────────────────
    // Cube orientation + zoom and their integrated velocities (the roulette).
    let yaw = 0;
    let pitch = 0;
    let roll = 0;
    let zoom = 1;
    let yawVel = 0;
    let pitchVel = 0;
    let rollVel = 0;
    let zoomVel = 0;

    let bgColor: RGB = [4, 5, 9];
    // Face tints as three opposite pairs: [front,back, left,right, top,bottom].
    const fp = paletteColor(paletteName, ctx.rng);
    const lp = paletteColor(paletteName, ctx.rng);
    const tp = paletteColor(paletteName, ctx.rng);
    const faceTints: RGB[] = [fp, fp, lp, lp, tp, tp];

    let cur: VisualParamVector = ctx.initialParams;

    const randomVec3 = (): { x: number; y: number; z: number } => {
      const u = ctx.rng.range(-1, 1);
      const theta = ctx.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(Math.max(0, 1 - u * u));
      return { x: r * Math.cos(theta), y: r * Math.sin(theta), z: u };
    };

    const spawnBg = (group: 0 | 1): BgObject => {
      const v = randomVec3();
      const mag = ctx.rng.range(0.2, 1);
      return {
        pos: { x: ctx.rng.range(-1, 1), y: ctx.rng.range(-1, 1), z: ctx.rng.range(-1, 1) },
        vel: { x: v.x * mag, y: v.y * mag, z: v.z * mag },
        angle: ctx.rng.range(0, Math.PI * 2),
        spin: ctx.rng.range(0.003, 0.02),
        type: shapePool[ctx.rng.int(shapePool.length)] ?? 0,
        color: paletteColor(paletteName, ctx.rng),
        group,
      };
    };

    const bgObjects: BgObject[] = Array.from({ length: NUM_BG }, (_, i) => spawnBg((i % 2) as 0 | 1));

    // ── arc-press actions (seeded via ctx.rng) ─────────────────────
    function randomizeFacePair(pair: number): void {
      const c = paletteColor(paletteName, ctx.rng);
      const a = pair * 2;
      faceTints[a] = c;
      faceTints[a + 1] = c;
    }
    function randomizeBackground(): void {
      bgColor = [ctx.rng.int(24), ctx.rng.int(24), ctx.rng.int(28)];
      for (const o of bgObjects) o.color = paletteColor(paletteName, ctx.rng);
    }

    /** Fold a fader value with a centred VisualParamVector axis (0.5 = no change). */
    const fold = (f: number, axis: number): number => clamp01(f + (axis - 0.5) * 0.4);

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
        const minDim = Math.min(width, height);
        const span = minDim * 0.5; // world half-extent for bg drift
        const frameScale = dt * 60; // normalise integration to 60fps
        const av = arc.values();
        const fv = fb.values();

        // Encoder value 0.5 = stopped; (v-0.5)*2 = signed target velocity.
        const turbo = 0.5 + cur.turbulence; // turbulence axis scales spin range
        const targetYaw = ((av.yaw ?? 0.5) - 0.5) * 2 * MAX_SPEED * turbo;
        const targetPitch = ((av.pitch ?? 0.5) - 0.5) * 2 * MAX_SPEED * turbo;
        const targetRoll = ((av.roll ?? 0.5) - 0.5) * 2 * MAX_SPEED * turbo;
        const targetZoom = ((av.zoom ?? 0.5) - 0.5) * 2 * MAX_ZOOM_RATE;

        // Roulette physics: ease velocity toward the target, then damp + integrate.
        const ease = 0.18;
        yawVel = (yawVel + (targetYaw - yawVel) * ease) * damping;
        pitchVel = (pitchVel + (targetPitch - pitchVel) * ease) * damping;
        rollVel = (rollVel + (targetRoll - rollVel) * ease) * damping;
        zoomVel = (zoomVel + (targetZoom - zoomVel) * ease) * damping;
        yaw += yawVel * frameScale;
        pitch += pitchVel * frameScale;
        roll += rollVel * frameScale;
        zoom = Math.max(0.45, Math.min(2.4, zoom + zoomVel * frameScale));

        p.background(bgColor[0], bgColor[1], bgColor[2]);
        p.ambientLight(70, 70, 78);
        p.directionalLight(210, 210, 220, -0.3, 0.4, -1);
        p.pointLight(150, 170, 255, 0, -span * 0.6, span * 0.8);

        // ── background field ───────────────────────────────────────
        // Per-group fader params folded with the live axes.
        const groupP = [
          {
            opacity: fold(fv.opacityA ?? 0.6, cur.density),
            move: fold(fv.moveA ?? 0.45, cur.motion),
            random: fv.randomA ?? 0.2,
            scale: fold(fv.scaleA ?? 0.5, cur.cameraDepth),
          },
          {
            opacity: fold(fv.opacityB ?? 0.6, cur.density),
            move: fold(fv.moveB ?? 0.45, cur.motion),
            random: fv.randomB ?? 0.2,
            scale: fold(fv.scaleB ?? 0.5, cur.cameraDepth),
          },
        ];

        p.noStroke();
        for (const o of bgObjects) {
          const gp = groupP[o.group] ?? groupP[0];
          if (!gp) continue;
          const moveAmt = gp.move * 1.6;
          const randProb = gp.random * 0.6 * dt; // per-second → per-frame
          const sizeBase = minDim * 0.05 * (0.5 + gp.scale * 1.6);
          const alpha = 18 + gp.opacity * 150;

          // drift in normalised space, scaled to the world; wrap at the edges
          o.pos.x += o.vel.x * moveAmt * frameScale * 0.01;
          o.pos.y += o.vel.y * moveAmt * frameScale * 0.01;
          o.pos.z += o.vel.z * moveAmt * frameScale * 0.01;
          if (o.pos.x < -1.4) o.pos.x = 1.4;
          if (o.pos.x > 1.4) o.pos.x = -1.4;
          if (o.pos.y < -1.4) o.pos.y = 1.4;
          if (o.pos.y > 1.4) o.pos.y = -1.4;
          if (o.pos.z < -1.4) o.pos.z = 1.4;
          if (o.pos.z > 1.4) o.pos.z = -1.4;

          if (ctx.rng.random() < randProb) {
            o.pos = { x: ctx.rng.range(-1, 1), y: ctx.rng.range(-1, 1), z: ctx.rng.range(-1, 1) };
            const v = randomVec3();
            const mag = ctx.rng.range(0.2, 1);
            o.vel = { x: v.x * mag, y: v.y * mag, z: v.z * mag };
            if (ctx.rng.random() < 0.35) o.type = shapePool[ctx.rng.int(shapePool.length)] ?? o.type;
          }
          o.angle += o.spin * (0.3 + moveAmt) * frameScale;

          p.push();
          p.translate(o.pos.x * span, o.pos.y * span, o.pos.z * span);
          p.rotateY(o.angle);
          p.rotateX(o.angle * 0.5);
          p.rotateZ(o.angle * 0.25);
          p.fill(o.color[0], o.color[1], o.color[2], alpha);
          if (o.type === 0) p.torus(sizeBase, sizeBase * 0.34, 16, 10);
          else p.sphere(sizeBase * 0.85, 14, 10);
          p.pop();
        }

        // ── central roulette cube ──────────────────────────────────
        const cubeSize = minDim * (0.26 + cur.cameraDepth * 0.1);
        const contrast = 0.55 + cur.contrast * 0.6;
        p.push();
        p.scale(zoom);
        p.rotateX(-Math.PI * 0.12);
        p.rotateY(yaw);
        p.rotateX(pitch);
        p.rotateZ(roll);
        drawCube(p, cubeSize, faceTints, contrast);
        p.pop();

        // idiom LED feedback → ledOut (the host mirrors it to the twin + hardware)
        idioms.renderGrid(ctx.ledOut, profile);
        idioms.renderArc(ctx.ledOut, profile);
      },
    };
  },
};

/**
 * Six tinted quad faces around the origin (WEBGL centre). Solid per-pair tints
 * stand in for the original's per-pixel noise textures; `contrast` scales the
 * tint brightness so the live contrast axis reads on the cube.
 */
function drawCube(p: p5, size: number, faceTints: RGB[], contrast: number): void {
  const h = size / 2;
  // [verts(4×xyz), tintIndex]
  const faces: Array<[number[], number]> = [
    [[-h, -h, h, h, -h, h, h, h, h, -h, h, h], 0], // front
    [[h, -h, -h, -h, -h, -h, -h, h, -h, h, h, -h], 1], // back
    [[-h, -h, -h, -h, -h, h, -h, h, h, -h, h, -h], 2], // left
    [[h, -h, h, h, -h, -h, h, h, -h, h, h, h], 3], // right
    [[-h, -h, -h, h, -h, -h, h, -h, h, -h, -h, h], 4], // top
    [[-h, h, h, h, h, h, h, h, -h, -h, h, -h], 5], // bottom
  ];
  p.noStroke();
  for (const [v, idx] of faces) {
    const tint = faceTints[idx] ?? [220, 220, 220];
    p.fill(
      Math.min(255, (tint[0] ?? 0) * contrast),
      Math.min(255, (tint[1] ?? 0) * contrast),
      Math.min(255, (tint[2] ?? 0) * contrast),
    );
    p.beginShape();
    p.vertex(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
    p.vertex(v[3] ?? 0, v[4] ?? 0, v[5] ?? 0);
    p.vertex(v[6] ?? 0, v[7] ?? 0, v[8] ?? 0);
    p.vertex(v[9] ?? 0, v[10] ?? 0, v[11] ?? 0);
    p.endShape(p.CLOSE);
  }
}
