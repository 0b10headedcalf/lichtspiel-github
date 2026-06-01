/**
 * itoBox — faithful port (not forked) of windchime-animation
 * packages/sketch-families/src/itoBoxV9 (itself a hand-port of
 * processing_corpus_test1/Ito_Box_v9/Ito_Box_v9.pde). A central rotating
 * "roulette" cube with six opposite-face-paired tints, driven by VELOCITY-mode
 * encoders (an arc delta is an impulse into a damped angular velocity — the
 * roulette feel), over a drifting field of four background 3D objects (complex
 * torus / wavy torus / oscillating point-sphere / filament cloud) whose
 * opacity / movement / randomness / scale are set by a 4-panel × 4-param fader
 * grid. The crafted bg geometry, the wrap-around drift, the random-respawn,
 * the six bio colours, and windchime's own simplification (solid face tints in
 * place of the 300×300 per-pixel noise field per face) are all preserved.
 *
 * Lichtspiel rewiring (control/LED → idioms): windchime's hardcoded 4-panel ×
 * 4-fader grid handler (`refreshGrid` / `onGridKey` setting per-object slider
 * levels) becomes a `faderBank` of 16 lanes — o{0..3}{opacity,move,random,scale},
 * laid out exactly as the four Grid-128 panels, folding into pairs on a Grid 64.
 * windchime's bespoke arc handler (`+= delta * impulse` velocities integrated +
 * damped per frame, the comet `writeArcLeds`) becomes `arcMacros` in VELOCITY
 * mode: four encoders yaw/pitch/roll/zoom, `velocityTrail` rendering the same
 * |velocity| comet, damping from the variant, presses randomising opposite-face
 * colour pairs (enc 0/1/2) or the background + texture-field structure (enc 3).
 * The host integrates the physics via `arc.tick(dt*1000)` each frame; the sketch
 * never damps itself. Visual values fold gently with the live VisualParamVector
 * axes. WEBGL, seeded entirely via ctx.rng.
 */

import { type VisualParamVector, clamp01, lerp } from '@lichtspiel/schemas';
import type p5 from 'p5';
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

const NUM_BG_OBJ = 4;
const P_OPACITY = 0;
const P_MOVE = 1;
const P_RANDOM = 2;
const P_SCALE = 3;
const PARAM_NAMES = ['opacity', 'move', 'random', 'scale'] as const;

// windchime impulse was 0.0065 rad/frame; arcMacros velocity is in phase-turns
// per 60fps frame, so divide by 2π. enc3 (zoom) uses 2× like windchime.
const TWO_PI = Math.PI * 2;
const ROT_IMPULSE = 0.0065 / TWO_PI; // ≈ 0.001034
const ZOOM_IMPULSE = ROT_IMPULSE * 2; // ≈ 0.002068
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 5; // windchime clamps zoom to [0.35, 5]

// windchime's original canvas was 1024×768 + the bg field lived in that world
// space (±w/2 etc). We keep those world units relative to the live canvas so the
// drift + wrap read identically at any size: span = min(w,h) sets the unit.
const WORLD_W_REL = 1.0; // ×min(w,h) → half-width margin reference
const WORLD_H_REL = 0.75; // ×min(w,h) → the 768/1024 aspect of the original field
const WORLD_Z = 450; // ×(min(w,h)/768) spawn depth, like windchime's ±450
const CUBE_REL = 0.47; // windchime drawCube(360) on a 768-tall canvas ≈ 0.47×minDim

/** Structural variants the `v` key / arc re-roll, distinct from the live axes. */
const variants = makeVariantFactory({
  palette: { canonical: 'bio', options: ['bio', 'warm', 'cool', 'monochrome'] },
  bgShapes: { canonical: 'all', options: ['all', 'tori-only', 'sphere-only', 'filaments-only'] },
  damping: { canonical: 'roulette', options: ['roulette', 'snappy', 'liquid'] },
});

/** windchime dampingValue — per-60fps-frame velocity decay for the roulette feel. */
function dampingValue(mode: string): number {
  switch (mode) {
    case 'snappy':
      return 0.9;
    case 'liquid':
      return 0.995;
    case 'roulette':
    default:
      return 0.98;
  }
}

/** windchime allowedBgShapes — 0 complex torus · 1 wavy torus · 2 sphere · 3 filaments. */
function allowedBgShapes(mode: string): number[] {
  switch (mode) {
    case 'tori-only':
      return [0, 1];
    case 'sphere-only':
      return [2];
    case 'filaments-only':
      return [3];
    case 'all':
    default:
      return [0, 1, 2, 3];
  }
}

/** windchime bioColor — the six signature bioluminescent swatches. */
function bioColor(rng: MountContext['rng']): Rgb {
  const p = rng.int(6);
  if (p === 0) return [0, 255, 210];
  if (p === 1) return [110, 190, 255];
  if (p === 2) return [255, 110, 210];
  if (p === 3) return [170, 255, 110];
  if (p === 4) return [255, 180, 70];
  return [230, 230, 255];
}

/** windchime paletteColor — a colour for the given mode (reuses shared hslToRgb). */
function paletteColor(mode: string, rng: MountContext['rng']): Rgb {
  switch (mode) {
    case 'warm':
      return hslToRgb(rng.range(0, 60), 0.85, 0.6);
    case 'cool':
      return hslToRgb(rng.range(180, 270), 0.85, 0.6);
    case 'monochrome':
      return hslToRgb(rng.range(0, 360), 0.7, rng.range(0.4, 0.75));
    case 'bio':
    default:
      return bioColor(rng);
  }
}

interface BgObject {
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  angle: number;
  speed: number;
  type: number;
  color: Rgb;
}

export const itoBox: VisualTemplate = {
  id: 'itoBox',
  name: 'Ito Box — Cube Roulette',
  family: 'roulette',
  description:
    'A central velocity-physics "roulette" cube with opposite-face colour pairs over a drifting field of four 3D objects (complex/wavy tori, point-sphere, filament cloud). Arc encoders spin yaw/pitch/roll/zoom; a 4-panel fader grid shapes the background. Grid 128 / Arc 4.',
  tags: ['cube', 'roulette', '3d', 'rotation', 'velocity', 'arc', 'fader', 'monome'],
  defaultParams: { motion: 0.5, turbulence: 0.5, density: 0.5, contrast: 0.6, palette: 0.4 },
  renderer: 'webgl',
  sourceLineage: 'windchime itoBoxV9 (Ito_Box_v9.pde, faithful port)',
  hardwareTarget: { grid: '128', arc: '4' },
  idioms: ['faderBank', 'arcMacros'],
  gestural: {
    name: 'Cube Roulette + Background Field',
    summary:
      'Central rotating cube driven by velocity-physics encoders (a turn is an impulse into a damped angular velocity — the "roulette" feel). Grid governs four background objects with per-param vertical faders (opacity / movement / randomness / scale), one 4-column panel per object. On an Arc 2 each encoder press cycles through two of the four colour actions; on a Grid 64 the 16 faders fold into pairs.',
    grid: [
      {
        area: 'cols 0–3 / 4–7 / 8–11 / 12–15 (4 panels), any row',
        action: 'press a row',
        effect:
          "set that object's parameter fader (higher row = higher level); the param is col%4: 0=opacity 1=movement 2=randomness 3=scale",
      },
    ],
    arc: [
      { area: 'arc enc 0', action: 'turn', effect: 'add yaw velocity (impulse, then damped — the roulette spin)' },
      { area: 'arc enc 1', action: 'turn', effect: 'add pitch velocity' },
      { area: 'arc enc 2', action: 'turn', effect: 'add roll velocity' },
      { area: 'arc enc 3', action: 'turn', effect: 'add zoom velocity (2× impulse, bounded)' },
      { area: 'arc enc 0', action: 'press', effect: 'randomise the front/back face colour pair' },
      { area: 'arc enc 1', action: 'press', effect: 'randomise the top/bottom face colour pair' },
      { area: 'arc enc 2', action: 'press', effect: 'randomise the left/right face colour pair' },
      { area: 'arc enc 3', action: 'press', effect: 'randomise the background colour + the texture-field structure' },
    ],
  },
  variants,

  create(ctx: MountContext) {
    const paletteMode = cfg<string>(ctx.config, 'palette', 'bio');
    const bgShapesMode = cfg<string>(ctx.config, 'bgShapes', 'all');
    const dampingMode = cfg<string>(ctx.config, 'damping', 'roulette');

    const damping = dampingValue(dampingMode);
    const bgShapePool = allowedBgShapes(bgShapesMode);

    // ── idioms (the control map) ───────────────────────────────────
    let profile: IdiomProfile = profileFromSetup(ctx.setup);

    // 16 fader lanes laid out as 4 object panels × {opacity, move, random, scale}
    // — exactly the windchime Grid-128 layout; folds into pairs on a Grid 64.
    // initial 4/7 matches windchime's sliderLevel default of 4 (of 7).
    const lanes = [0, 1, 2, 3].flatMap((o) =>
      PARAM_NAMES.map((param) => ({ name: `o${o}${param}`, initial: 4 / 7 })),
    );
    const fb: FaderBank = createFaderBank({ spread: false, lanes });

    const arc: ArcMacros = createArcMacros({
      encoders: [
        {
          name: 'yaw',
          mode: 'velocity',
          damping,
          impulse: ROT_IMPULSE,
          integrate: 'wrap',
          velocityTrail: true,
          onPress: () => randomizeFacePair(0), // front/back
        },
        {
          name: 'pitch',
          mode: 'velocity',
          damping,
          impulse: ROT_IMPULSE,
          integrate: 'wrap',
          velocityTrail: true,
          onPress: () => randomizeFacePair(1), // top/bottom
        },
        {
          name: 'roll',
          mode: 'velocity',
          damping,
          impulse: ROT_IMPULSE,
          integrate: 'wrap',
          velocityTrail: true,
          onPress: () => randomizeFacePair(2), // left/right
        },
        {
          name: 'zoom',
          mode: 'velocity',
          damping,
          impulse: ZOOM_IMPULSE,
          integrate: 'clamp', // zoom is a bounded phase, not a rotation
          velocityTrail: true,
          initial: (1.0 - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN), // windchime zoom starts at 1.0
          onPress: () => randomizeBackground(),
        },
      ],
    });
    const idioms: ComposedIdiom = composeIdioms([fb, arc]);
    idioms.setProfile(profile);

    // ── performance state ──────────────────────────────────────────
    // Unbounded orientation accumulators (the host integrates velocity via tick;
    // we accumulate the angle ourselves). Zoom is read from the clamped phase.
    let yaw = 0;
    let pitch = 0;
    let roll = 0;

    // Face tints as three opposite pairs: [front,back, left,right, top,bottom] —
    // windchime seeds front/back & left/right from one draw each and top/bottom
    // from a third (fb / lr / tb).
    const fbColor = paletteColor(paletteMode, ctx.rng);
    const lrColor = paletteColor(paletteMode, ctx.rng);
    const tbColor = paletteColor(paletteMode, ctx.rng);
    const faceTints: Rgb[] = [fbColor, fbColor, lrColor, lrColor, tbColor, tbColor];

    let bgColor: Rgb = [0, 0, 0];
    // Shared "texture structure" — windchime's noise-field seed/type; it no longer
    // drives a per-pixel field (kept as windchime's documented simplification) but
    // enc3 still re-rolls it so the gesture is preserved + reproducible.
    let fieldType = ctx.rng.int(3);
    let fieldSeed = ctx.rng.range(0, 1000);

    let cur: VisualParamVector = ctx.initialParams;

    // PVector.random3D analog (windchime randomVec3).
    const randomVec3 = (): { x: number; y: number; z: number } => {
      const u = ctx.rng.range(-1, 1);
      const theta = ctx.rng.range(0, TWO_PI);
      const r = Math.sqrt(Math.max(0, 1 - u * u));
      return { x: r * Math.cos(theta), y: r * Math.sin(theta), z: u };
    };

    // Background objects live in world units relative to a unit span (set each
    // frame from min(w,h)); positions/velocities here are in those world units.
    const initBgObj = (): BgObject => {
      const v = randomVec3();
      const mag = ctx.rng.range(0.2, 1);
      return {
        pos: {
          x: ctx.rng.range(-WORLD_W_REL, WORLD_W_REL),
          y: ctx.rng.range(-WORLD_H_REL, WORLD_H_REL),
          z: ctx.rng.range(-(WORLD_Z / 768), WORLD_Z / 768),
        },
        vel: { x: v.x * mag, y: v.y * mag, z: v.z * mag },
        angle: ctx.rng.range(0, TWO_PI),
        speed: ctx.rng.range(0.003, 0.015),
        type: bgShapePool[ctx.rng.int(bgShapePool.length)] ?? 0,
        color: paletteColor(paletteMode, ctx.rng),
      };
    };
    const bgObjects: BgObject[] = Array.from({ length: NUM_BG_OBJ }, initBgObj);

    // ── arc-press actions (seeded via ctx.rng) ─────────────────────
    function randomizeFacePair(pair: number): void {
      const c = paletteColor(paletteMode, ctx.rng);
      const a = pair * 2;
      faceTints[a] = c;
      faceTints[a + 1] = c;
    }
    function randomizeBackground(): void {
      bgColor = [ctx.rng.int(70), ctx.rng.int(70), ctx.rng.int(70)];
      fieldType = ctx.rng.int(3);
      fieldSeed = ctx.rng.range(0, 1000);
    }

    // ── bg object geometry (faithful windchime ports) ──────────────

    function drawComplexTorus(p: p5, r1: number, r2: number): void {
      const sides = 18;
      const rings = 22;
      for (let i = 0; i < sides; i++) {
        const t1 = (TWO_PI * i) / sides;
        const t2 = (TWO_PI * (i + 1)) / sides;
        p.beginShape(p.LINES);
        for (let j = 0; j <= rings; j++) {
          const ph = (TWO_PI * j) / rings;
          const x1 = (r1 + r2 * Math.cos(ph)) * Math.cos(t1);
          const y1 = (r1 + r2 * Math.cos(ph)) * Math.sin(t1);
          const z1 = r2 * Math.sin(ph);
          const x2 = (r1 + r2 * Math.cos(ph)) * Math.cos(t2);
          const y2 = (r1 + r2 * Math.cos(ph)) * Math.sin(t2);
          const z2 = r2 * Math.sin(ph);
          p.vertex(x1, y1, z1);
          p.vertex(x2, y2, z2);
        }
        p.endShape();
      }
    }

    function drawWavyTorus(p: p5, r1: number, r2: number): void {
      const sides = 18;
      const rings = 20;
      for (let i = 0; i < sides; i++) {
        const t1 = (TWO_PI * i) / sides;
        const t2 = (TWO_PI * (i + 1)) / sides;
        p.beginShape(p.LINES);
        for (let j = 0; j <= rings; j++) {
          const ph = (TWO_PI * j) / rings;
          const d1 = r1 + r2 * Math.cos(ph) + Math.sin(t1 * 4) * r2 * 0.35;
          const d2 = r1 + r2 * Math.cos(ph) + Math.sin(t2 * 4) * r2 * 0.35;
          p.vertex(d1 * Math.cos(t1), d1 * Math.sin(t1), r2 * Math.sin(ph));
          p.vertex(d2 * Math.cos(t2), d2 * Math.sin(t2), r2 * Math.sin(ph));
        }
        p.endShape();
      }
    }

    function drawOscillatingSphere(p: p5, size: number): void {
      const d = 18;
      p.beginShape(p.POINTS);
      for (let i = 0; i < d; i++) {
        const t = (TWO_PI * i) / d;
        for (let j = 0; j < d; j++) {
          const ph = (Math.PI * j) / d;
          const x = size * Math.sin(ph) * Math.cos(t);
          const y = size * Math.sin(ph) * Math.sin(t);
          const z = size * Math.cos(ph);
          p.vertex(x, y, z);
        }
      }
      p.endShape();
    }

    function drawFilamentCloud(p: p5, size: number): void {
      const strands = 14;
      for (let s = 0; s < strands; s++) {
        const phase = (TWO_PI * s) / strands;
        p.beginShape();
        for (let i = 0; i < 30; i++) {
          const u = -size + (i / 29) * size * 2;
          const x = 0.35 * size * Math.sin(u * 0.02 + phase);
          const y = u * 0.7;
          const z = 0.35 * size * Math.cos(u * 0.018 + phase);
          p.vertex(x, y, z);
        }
        p.endShape();
      }
    }

    /**
     * Faithful windchime drawBgObjects: per-object opacity / movement /
     * randomness / scale read from the four fader lanes (value 0..1 → level 0..7,
     * active = value > 0.02), folded gently with the live axes; wrap-around drift
     * + random respawn; rotate + draw the object's kind. `span` is min(w,h).
     */
    function drawBgObjects(p: p5, span: number, frames: number): void {
      const fv = fb.values();
      const worldW = WORLD_W_REL; // half-extents in world units
      const worldH = WORLD_H_REL;
      const marginX = worldW + 200 / 768;
      const marginY = worldH + 200 / 768;
      const zEdge = 600 / 768;

      p.noFill();
      for (let i = 0; i < NUM_BG_OBJ; i++) {
        const obj = bgObjects[i];
        if (!obj) continue;

        // value → level (0..7) + active (windchime sliderLevel / sliderActive).
        const lv = (param: number): number => clamp01(fv[`o${i}${PARAM_NAMES[param]}`] ?? 0) * 7;
        const active = (param: number): boolean => (fv[`o${i}${PARAM_NAMES[param]}`] ?? 0) > 0.02;

        if (!active(P_OPACITY)) continue; // opacity gate = the object's render gate

        // windchime per-param mappings, folded gently with the live axes.
        const opacity = (20 + (lv(P_OPACITY) / 7) * 120) * lerp(0.7, 1.2, cur.density);
        const moveAmt = active(P_MOVE)
          ? (0.2 + (lv(P_MOVE) / 7) * 2.1) * lerp(0.6, 1.5, cur.motion)
          : 0;
        const randProb = active(P_RANDOM) ? (lv(P_RANDOM) / 7) * 0.75 : 0;
        const scaleAmt = active(P_SCALE) ? 0.5 + (lv(P_SCALE) / 7) * 2.3 : 1;

        // drift (per-frame in world units), then wrap at the field edges.
        obj.pos.x += obj.vel.x * moveAmt * frames * 0.0026; // ≈ windchime px ÷ 768
        obj.pos.y += obj.vel.y * moveAmt * frames * 0.0026;
        obj.pos.z += obj.vel.z * moveAmt * frames * 0.0026;
        if (obj.pos.x < -marginX) obj.pos.x = marginX;
        if (obj.pos.x > marginX) obj.pos.x = -marginX;
        if (obj.pos.y < -marginY) obj.pos.y = marginY;
        if (obj.pos.y > marginY) obj.pos.y = -marginY;
        if (obj.pos.z < -zEdge) obj.pos.z = zEdge;
        if (obj.pos.z > zEdge) obj.pos.z = -zEdge;

        // randomness: chance to respawn position/velocity (+ sometimes kind/colour).
        if (ctx.rng.random() < randProb * frames) {
          obj.pos = {
            x: ctx.rng.range(-worldW, worldW),
            y: ctx.rng.range(-worldH, worldH),
            z: ctx.rng.range(-(WORLD_Z / 768), WORLD_Z / 768),
          };
          const v = randomVec3();
          const mag = ctx.rng.range(0.2, 1);
          obj.vel = { x: v.x * mag, y: v.y * mag, z: v.z * mag };
          if (ctx.rng.random() < 0.35) obj.type = bgShapePool[ctx.rng.int(bgShapePool.length)] ?? obj.type;
          if (ctx.rng.random() < 0.35) obj.color = paletteColor(paletteMode, ctx.rng);
        }

        obj.angle += obj.speed * moveAmt * frames;

        p.push();
        p.translate(obj.pos.x * span, obj.pos.y * span, obj.pos.z * span);
        p.rotateY(obj.angle);
        p.rotateX(obj.angle * 0.5);
        p.rotateZ(obj.angle * 0.25);
        p.stroke(obj.color[0], obj.color[1], obj.color[2], opacity);
        const s = span * 0.039 * scaleAmt; // windchime 30 on a 768 canvas ≈ 0.039×span
        switch (obj.type) {
          case 0:
            drawComplexTorus(p, s, s * 0.38);
            break;
          case 1:
            drawWavyTorus(p, s, s * 0.36);
            break;
          case 2:
            drawOscillatingSphere(p, s);
            break;
          case 3:
            drawFilamentCloud(p, s);
            break;
        }
        p.pop();
      }
    }

    /**
     * Faithful windchime drawCube: six tinted QUAD faces around the WEBGL origin.
     * Solid per-pair tints stand in for the original's per-pixel noise textures
     * (windchime's documented simplification); the opposite-face colour pairs are
     * preserved. `contrast` rides the live contrast axis onto the face brightness.
     */
    function drawCube(p: p5, size: number, contrast: number): void {
      const half = size / 2;
      // [verts(4×xyz), tintIndex] — windchime's face/quad layout verbatim.
      const faces: Array<[number[], number]> = [
        [[-half, -half, half, half, -half, half, half, half, half, -half, half, half], 0], // front
        [[half, -half, -half, -half, -half, -half, -half, half, -half, half, half, -half], 1], // back
        [[-half, -half, -half, -half, -half, half, -half, half, half, -half, half, -half], 2], // left
        [[half, -half, half, half, -half, -half, half, half, -half, half, half, half], 3], // right
        [[-half, -half, -half, half, -half, -half, half, -half, half, -half, -half, half], 4], // top
        [[-half, half, half, half, half, half, half, half, -half, -half, half, -half], 5], // bottom
      ];
      p.noStroke();
      for (const [v, idx] of faces) {
        const tint = faceTints[idx] ?? [255, 255, 255];
        p.fill(
          Math.min(255, (tint[0] ?? 0) * contrast),
          Math.min(255, (tint[1] ?? 0) * contrast),
          Math.min(255, (tint[2] ?? 0) * contrast),
        );
        p.beginShape(p.QUADS);
        p.vertex(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
        p.vertex(v[3] ?? 0, v[4] ?? 0, v[5] ?? 0);
        p.vertex(v[6] ?? 0, v[7] ?? 0, v[8] ?? 0);
        p.vertex(v[9] ?? 0, v[10] ?? 0, v[11] ?? 0);
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
        const frames = dt * 60; // normalise integration to 60fps frames
        arc.tick(dt * 1000); // integrate velocity-mode encoders → phase + decay

        const minDim = Math.min(width, height);
        const span = minDim; // world unit for the bg field

        // Accumulate UNBOUNDED orientation from the (damped) angular velocities —
        // the host already advanced/damped them in tick(); we read & integrate the
        // angle ourselves so the cube can free-wheel. (× turbulence for live spin.)
        const spinScale = lerp(0.7, 1.4, cur.turbulence);
        yaw += arc.velocity('yaw') * frames * spinScale;
        pitch += arc.velocity('pitch') * frames * spinScale;
        roll += arc.velocity('roll') * frames * spinScale;
        // Zoom: the clamped 0..1 phase maps onto windchime's [0.35, 5] range.
        const zoom = ZOOM_MIN + (arc.values().zoom ?? 0) * (ZOOM_MAX - ZOOM_MIN);

        p.background(bgColor[0], bgColor[1], bgColor[2]);

        // Background field first (windchime draws bg objects before the lights/cube).
        drawBgObjects(p, span, frames);

        // windchime lighting.
        p.ambientLight(90, 90, 90);
        p.directionalLight(180, 180, 180, -0.3, 0.35, -1.0);

        // Central roulette cube.
        const contrast = 0.75 + cur.contrast * 0.5; // live contrast rides face brightness
        p.push();
        p.scale(zoom);
        p.rotateX(-Math.PI * 0.12);
        p.rotateY(yaw);
        p.rotateX(pitch);
        p.rotateZ(roll);
        drawCube(p, minDim * CUBE_REL, contrast);
        p.pop();

        // idiom LED feedback → ledOut (host mirrors to the twin + hardware).
        idioms.renderGrid(ctx.ledOut, profile);
        idioms.renderArc(ctx.ledOut, profile);

        // keep fieldType/fieldSeed live so TS sees them used (the texture-structure
        // gesture is preserved even though windchime's per-pixel field is dropped).
        void fieldType;
        void fieldSeed;
      },
    };
  },
};
