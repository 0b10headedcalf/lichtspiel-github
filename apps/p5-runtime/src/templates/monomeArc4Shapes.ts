/**
 * monomeArc4Shapes — faithful port (not forked) of windchime-animation
 * packages/sketch-families/src/monomeArc4Shapesv12 (itself a hand-port of
 * processing_corpus_test1/monomearc4shapescontrolv12/...v12.pde). FOUR 3D objects
 * (complex torus / wavy torus / oscillating sphere — LINES/POINTS topology) tumble
 * in WEBGL, their positions JUMPING with the movement-intensity probability; FOUR
 * fullscreen 2D strobe overlays (diagonal / spiral / hex / oval) are drawn LAST, on
 * top. Each strobe is driven by four params — opacity / gap / randomness / origin.
 * Encoders 1-3 each carry a self-walking "playhead" that re-rolls rotation speed at
 * every quarter; an encoder press regenerates that object + all strobe colours + bg.
 * The crafted geometry, the strobe band math, the per-strobe drift speeds, the
 * playhead quarter-markers, and the position-jump perf behaviour are all preserved.
 *
 * Lichtspiel rewiring (control/LED → idioms; the VISUALS are faithful):
 *   - windchime's hardcoded 4-strobe-panel × 4-param grid (with a bottom-row
 *     toggle + per-row level) becomes a `faderBank` of 16 lanes
 *     (s{0..3}{opacity,gap,random,origin}, laid out exactly as the four Grid-128
 *     panels; the first 8 reach strobes 0-1 on a Grid 64). Each fader value 0..1 is
 *     mapped back to the windchime level 1..7 (≈ value×7) + active = value>0.02.
 *   - the assorted per-encoder arc handlers become `arcMacros`: enc0 = movement
 *     intensity (ring 'comet'); enc1-3 = object size + self-walking playhead speed
 *     (ring 'playhead'). onPress(i) regenerates object i (new type + colour),
 *     re-rolls ALL four strobe colours, and re-rolls the background — exactly the
 *     windchime onArcKey. On an Arc 2 each encoder press cycles through its pair.
 *   - the canvas is the host's width×height (windchime's 1024×768 screen-space is
 *     scaled to min(width,height)); the 2D strobes draw inside a
 *     push()/translate(-width/2,-height/2) so the screen-space band math matches.
 *
 * The original sent OSC scene triggers to Sonic Pi on encoder-0 press; that remains
 * a no-op here (no OSC-out side channel yet). A future Windchime audio coupling
 * would publish a "scene change" on the control bus instead.
 */

import type p5 from 'p5';
import { type VisualParamVector, clamp01, lerp } from '@lichtspiel/schemas';
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

const NUM_STROBES = 4; // diagonal, spiral, hex, oval
const NUM_OBJECTS = 4; // 4 tumbling 3D objects (drawn from the allowed object pool)
const ARC_LEDS = 64; // logical ring resolution the playhead walks (1:1 with an Arc 4)

// Per-strobe scroll speed of the band offset (windchime STROBE_BASE_SPEED), scaled
// to the live canvas in drawStrobes so the look is gap-relative, not 1024-relative.
const STROBE_BASE_SPEED = [6, 4, 3, 3];

// Per-object self-walking playhead speeds (windchime slots[1..3].playheadSpeed). The
// encoder rides these live; these are the canonical defaults the playhead idles at.
const BASE_PLAYHEAD_SPEED = [1.0, 0.8, 0.5, 0.2];

// ── variant space (EXACT pools from windchime monomeArc4Shapesv12/params.ts) ──
type PaletteMode = 'random' | 'warm' | 'cool' | 'neon' | 'monochrome';

const variants = makeVariantFactory({
  palette: { canonical: 'random', options: ['random', 'warm', 'cool', 'neon', 'monochrome'] },
  strobes: { canonical: 'all', options: ['all', 'diagonal', 'spiral', 'hex', 'oval', 'off'] },
  objects: { canonical: 'all', options: ['all', 'tori-only', 'sphere-only'] },
});

/** 0=diagonal, 1=spiral, 2=hex, 3=oval — gated by the `strobes` variant axis. */
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

/** 0=complex torus, 1=wavy torus, 2=oscillating sphere — gated by `objects`. */
function allowedObjects(mode: string): number[] {
  switch (mode) {
    case 'tori-only':
      return [0, 1];
    case 'sphere-only':
      return [2];
    case 'all':
    default:
      return [0, 1, 2];
  }
}

/** One palette draw, seeded via ctx.rng (windchime paletteColor; never Math RNG). */
function paletteColor(mode: PaletteMode, rng: MountContext['rng']): Rgb {
  switch (mode) {
    case 'warm':
      return hslToRgb(rng.range(0, 60), 0.85, 0.6);
    case 'cool':
      return hslToRgb(rng.range(180, 270), 0.85, 0.6);
    case 'neon': {
      const hues = [330, 280, 195, 60];
      return hslToRgb(hues[rng.int(hues.length)] ?? 0, 1, 0.6);
    }
    case 'monochrome':
      return hslToRgb(rng.range(0, 360), 0.7, rng.range(0.4, 0.75));
    case 'random':
    default:
      return [rng.int(256), rng.int(256), rng.int(256)];
  }
}

interface SlotState {
  type: number;
  color: Rgb;
  /** object size in windchime screen units (×scale to fit the live canvas). */
  size: { x: number; y: number; z: number };
  /** object position in windchime screen units, recentred about the live canvas. */
  pos: { x: number; y: number; z: number };
  angle: number;
  rotationSpeed: number;
  playhead: number; // 0..ARC_LEDS, self-walks for enc 1-3
  playheadSpeed: number;
}

export const monomeArc4Shapes: VisualTemplate = {
  id: 'monomeArc4Shapes',
  name: 'Playhead Shapes + Strobe Overlays',
  family: 'overlay',
  description:
    'Four 3D objects (complex torus / wavy torus / oscillating sphere) tumbling and jumping under FOUR fullscreen 2D strobe overlays (diagonal / spiral / hex / oval). Grid faders set each strobe\'s opacity / gap / randomness / origin; arc encoders drive movement intensity + per-object playhead speed/size; an encoder press regenerates that object + all strobe colours.',
  tags: ['arc', 'strobe', 'overlay', '3d', 'torus', 'sphere', 'playhead', 'psychedelic', 'monome', 'faders'],
  defaultParams: { motion: 0.5, turbulence: 0.5, density: 0.5, contrast: 0.6, palette: 0.4 },
  renderer: 'webgl',
  sourceLineage: 'windchime monomeArc4Shapesv12 (monomearc4shapescontrolv12.pde, faithful port)',
  hardwareTarget: { grid: '128', arc: '4' },
  idioms: ['faderBank', 'arcMacros'],
  gestural: {
    name: 'Playhead Shapes + Strobe Overlays',
    summary:
      'Arc encoders rotate 3D objects with playhead-walked positions. Grid drives 4 fullscreen 2D strobe overlay patterns (diagonal/spiral/hex/oval) with opacity/gap/randomness/origin faders. Each encoder press regenerates that object + all strobe colours + the background. On an Arc 2 each encoder press cycles through two of the four objects.',
    grid: [
      {
        area: 'grid cols 0-3 / 4-7 / 8-11 / 12-15 (4 strobe panels), any row',
        action: 'press at (col, row)',
        effect:
          'set the strobe param fader to that row (top = max). param is col%4: 0=opacity 1=gap 2=randomness 3=origin/rotation',
      },
      {
        area: 'bottom row of any strobe panel',
        action: 'press',
        effect: 'set the strobe parameter to its minimum (a near-zero fader reads as off)',
      },
    ],
    arc: [
      { area: 'arc encoder 0', action: 'rotate', effect: 'set movement intensity (0..1 = none..max position jumping)' },
      {
        area: 'arc encoders 1-3',
        action: 'rotate',
        effect: 'set that object\'s size + self-walking playhead speed (the ring shows the playhead with quarter markers)',
      },
      {
        area: 'arc encoders 0-3',
        action: 'press',
        effect: 'regenerate that object — new shape kind + new colour + new strobe colours + new background',
      },
    ],
  },
  variants,

  create(ctx: MountContext) {
    const paletteMode = cfg<PaletteMode>(ctx.config, 'palette', 'random');
    const strobePool = allowedStrobes(cfg<string>(ctx.config, 'strobes', 'all'));
    const objectPool = allowedObjects(cfg<string>(ctx.config, 'objects', 'all'));

    let profile: IdiomProfile = profileFromSetup(ctx.setup);

    // 16 fader lanes laid out as 4 strobe panels × {opacity, gap, random, origin} —
    // exactly the windchime Grid-128 layout; the first 8 reach strobes 0-1 on a
    // Grid 64. Initial 4/7 mirrors the windchime sliderLevel default of 4.
    const lanes = [0, 1, 2, 3].flatMap((s) =>
      ['opacity', 'gap', 'random', 'origin'].map((p) => ({ name: `s${s}${p}`, label: `strobe ${s} ${p}`, initial: 4 / 7 })),
    );
    const fb: FaderBank = createFaderBank({ spread: false, lanes });

    // enc0 = movement intensity (comet); enc1-3 = object size + playhead speed
    // (playhead). A press regenerates that object + all strobe colours + bg.
    // turn couples on an Arc 2 (enc1 then drives objects 1 + 3's size, the rest
    // reachable in pairs); rings already keep notches (comet ticks / playhead markers).
    const arc: ArcMacros = createArcMacros({
      encoders: [
        { name: 'movement', label: 'movement intensity', pressLabel: 'regenerate obj 0 + strobes', initial: 1.0, led: 'comet', onPress: () => regen(0) },
        ...[1, 2, 3].map((i) => ({
          name: `shape${i}`,
          label: `object ${i} size / speed`,
          pressLabel: `regenerate object ${i} + strobes`,
          initial: 0.5,
          led: 'playhead' as const,
          onPress: () => regen(i),
        })),
      ],
    });

    const idioms: ComposedIdiom = composeIdioms([fb, arc]);
    idioms.setProfile(profile);

    // --- visual state (all randomness via ctx.rng) ---
    // windchime screen-space the geometry was authored in (positions/sizes live in
    // these units, then scale to the live canvas in draw()).
    const W = 1024;
    const H = 768;

    const newSlot = (i: number): SlotState => ({
      type: objectPool[ctx.rng.int(objectPool.length)] ?? 0,
      color: paletteColor(paletteMode, ctx.rng),
      size: { x: 100 + ctx.rng.range(0, 50), y: 50 + ctx.rng.range(0, 50), z: 50 + ctx.rng.range(0, 50) },
      pos: {
        x: ctx.rng.range(-W / 2 + 100, W / 2 - 100),
        y: ctx.rng.range(-H / 2 + 100, H / 2 - 100),
        z: ctx.rng.range(-200, 200),
      },
      angle: 0,
      rotationSpeed: ctx.rng.range(0.01, 0.05),
      playhead: 0,
      playheadSpeed: BASE_PLAYHEAD_SPEED[i] ?? 1,
    });

    const slots: SlotState[] = [0, 1, 2, 3].map((i) => newSlot(i));

    const strobeColor: Rgb[] = [
      paletteColor(paletteMode, ctx.rng),
      paletteColor(paletteMode, ctx.rng),
      paletteColor(paletteMode, ctx.rng),
      paletteColor(paletteMode, ctx.rng),
    ];
    let bgColor: Rgb = [0, 0, 0];
    const strobeOffset = [0, 0, 0, 0];
    const gapJitter = [0, 0, 0, 0];
    let cur: VisualParamVector = ctx.initialParams;

    /** windchime onArcKey: regenerate object i + re-roll all strobe colours + bg. */
    function regen(i: number): void {
      const slot = slots[i];
      if (slot) {
        slot.type = objectPool[ctx.rng.int(objectPool.length)] ?? slot.type;
        slot.color = paletteColor(paletteMode, ctx.rng);
        slot.rotationSpeed = ctx.rng.range(0.01, 0.05);
        slot.angle = 0;
      }
      bgColor = paletteColor(paletteMode, ctx.rng);
      for (let s = 0; s < NUM_STROBES; s++) strobeColor[s] = paletteColor(paletteMode, ctx.rng);
    }

    // ── faithful object geometry (windchime index.ts — LINES / POINTS topology) ──

    function drawComplexTorus(p: p5, r1: number, r2: number): void {
      const sides = 24;
      const rings = 24;
      for (let i = 0; i < sides; i++) {
        const t1 = (Math.PI * 2 * i) / sides;
        const t2 = (Math.PI * 2 * (i + 1)) / sides;
        p.beginShape(p.LINES);
        for (let j = 0; j <= rings; j++) {
          const ph = (Math.PI * 2 * j) / rings;
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
      const sides = 20;
      const rings = 20;
      for (let i = 0; i < sides; i++) {
        const t1 = (Math.PI * 2 * i) / sides;
        const t2 = (Math.PI * 2 * (i + 1)) / sides;
        p.beginShape(p.LINES);
        for (let j = 0; j <= rings; j++) {
          const ph = (Math.PI * 2 * j) / rings;
          const d1 = r1 + r2 * Math.cos(ph) + Math.sin(t1 * 5) * 20;
          const d2 = r1 + r2 * Math.cos(ph) + Math.sin(t2 * 5) * 20;
          p.vertex(d1 * Math.cos(t1), d1 * Math.sin(t1), r2 * Math.sin(ph));
          p.vertex(d2 * Math.cos(t2), d2 * Math.sin(t2), r2 * Math.sin(ph));
        }
        p.endShape();
      }
    }

    function drawOscillatingSphere(p: p5, size: number): void {
      const d = 22;
      p.beginShape(p.POINTS);
      for (let i = 0; i < d; i++) {
        const t = (Math.PI * 2 * i) / d;
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

    function drawObject(p: p5, slot: SlotState, sizeMul: number): void {
      switch (slot.type) {
        case 0:
          drawComplexTorus(p, slot.size.x * sizeMul, slot.size.y * sizeMul);
          break;
        case 1:
          drawWavyTorus(p, slot.size.x * sizeMul, slot.size.y * sizeMul);
          break;
        case 2:
          drawOscillatingSphere(p, slot.size.x * sizeMul);
          break;
      }
    }

    // ── faithful 2D strobe overlays (windchime index.ts) ─────────────────────
    // Drawn in WEBGL inside a translate(-width/2,-height/2) so the screen-space
    // band math (authored for Processing top-left origin) matches the live canvas.

    function drawStrobeDiagonal(
      p: p5,
      width: number,
      height: number,
      alpha: number,
      gap: number,
      c1: Rgb,
      c2: Rgb,
      origin: number,
      offset: number,
    ): void {
      p.push();
      p.noStroke();
      p.rotate((origin * Math.PI) / 4);
      const maxRange = Math.max(width, height) * 1.5;
      for (let i = -maxRange; i < maxRange; i += gap) {
        const moved = i + offset;
        const bandIndex = Math.floor(moved / gap);
        const choice = bandIndex % 2 === 0 ? c1 : c2;
        p.fill(choice[0], choice[1], choice[2], alpha);
        p.rect(moved, -maxRange, gap * 1.4, maxRange * 2);
      }
      p.pop();
    }

    function drawStrobeSpiral(
      p: p5,
      width: number,
      height: number,
      alpha: number,
      gap: number,
      c1: Rgb,
      c2: Rgb,
      origin: number,
      offset: number,
    ): void {
      p.push();
      p.noStroke();
      const maxR = Math.sqrt(width * width + height * height);
      const oa = (origin * Math.PI) / 4;
      for (let r = 0; r < maxR; r += gap) {
        const theta = r * 0.05 + oa;
        const bandIndex = Math.floor((r + offset) / gap);
        const choice = bandIndex % 2 === 0 ? c1 : c2;
        p.fill(choice[0], choice[1], choice[2], alpha);
        p.ellipse(r * Math.cos(theta), r * Math.sin(theta), gap * 4, gap * 4);
      }
      p.pop();
    }

    function drawStrobeHex(
      p: p5,
      width: number,
      height: number,
      alpha: number,
      gap: number,
      c1: Rgb,
      c2: Rgb,
      origin: number,
      offset: number,
    ): void {
      p.push();
      p.noStroke();
      const maxR = Math.max(width, height);
      const oa = (origin * Math.PI) / 4;
      for (let r = gap; r < maxR; r += gap) {
        const bandIndex = Math.floor((r + offset) / gap);
        const choice = bandIndex % 2 === 0 ? c1 : c2;
        p.fill(choice[0], choice[1], choice[2], alpha);
        p.push();
        p.rotate(oa);
        p.beginShape();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI * 2 * i) / 6;
          p.vertex(Math.cos(a) * r, Math.sin(a) * r);
        }
        p.endShape(p.CLOSE);
        p.pop();
      }
      p.pop();
    }

    function drawStrobeOval(
      p: p5,
      width: number,
      height: number,
      alpha: number,
      gap: number,
      c1: Rgb,
      c2: Rgb,
      origin: number,
      offset: number,
    ): void {
      p.push();
      p.noStroke();
      const maxR = Math.max(width, height);
      const oa = (origin * Math.PI) / 4;
      for (let r = gap; r < maxR; r += gap) {
        const bandIndex = Math.floor((r + offset) / gap);
        const choice = bandIndex % 2 === 0 ? c1 : c2;
        p.fill(choice[0], choice[1], choice[2], alpha);
        p.push();
        p.rotate(oa);
        p.ellipse(0, 0, r * 2, r * 1.2);
        p.pop();
      }
      p.pop();
    }

    /**
     * The strobe pass — windchime drawStrobes. Reads each strobe's four faders,
     * maps each 0..1 fader back to the windchime level 1..7 (+ active>0.02), then
     * derives alpha / gap / randomness / origin exactly as the original.
     */
    function drawStrobes(p: p5, width: number, height: number): void {
      // Strobe band sizes were authored for a 1024-wide canvas; scale the gap +
      // scroll speed to the live canvas so the look holds at any size.
      const scale = Math.max(width, height) / W;
      const fv = fb.values();
      for (let s = 0; s < NUM_STROBES; s++) {
        // Only draw strobes in the allowed pool for this variant.
        if (!strobePool.includes(s)) continue;

        // Fader 0..1 → windchime active flag + level 1..7.
        const vOp = clamp01(fv[`s${s}opacity`] ?? 0);
        const actOp = vOp > 0.02;
        const levOp = Math.max(0, Math.round(vOp * 7));
        if (!actOp || levOp === 0) continue;
        const alpha = 40 + ((levOp - 1) / 6) * 215;

        const vGap = clamp01(fv[`s${s}gap`] ?? 0);
        const actGap = vGap > 0.02;
        const levGap = Math.max(1, Math.round(vGap * 7));
        const baseGap = (actGap ? 20 + ((levGap - 1) / 6) * 180 : 80) * scale;

        const vRand = clamp01(fv[`s${s}random`] ?? 0);
        const actRand = vRand > 0.02;
        const levRand = Math.max(0, Math.round(vRand * 7));
        const randProb = actRand ? (levRand - 1) / 6 : 0;

        const vOrigin = clamp01(fv[`s${s}origin`] ?? 0);
        const actOrigin = vOrigin > 0.02;
        const levOrigin = Math.max(0, Math.round(vOrigin * 7));
        const origin = actOrigin ? Math.max(0, Math.min(7, levOrigin - 1)) : 0;

        strobeOffset[s] = (strobeOffset[s] ?? 0) + (STROBE_BASE_SPEED[s] ?? 3) * scale;
        if (ctx.rng.random() < randProb) {
          gapJitter[s] = ctx.rng.range(-baseGap * 0.4, baseGap * 0.4);
        }
        const gap = Math.max(5 * scale, baseGap + (gapJitter[s] ?? 0));
        const c1 = bgColor;
        const c2 = strobeColor[s] ?? [255, 255, 255];
        const offset = strobeOffset[s] ?? 0;

        if (s === 0) drawStrobeDiagonal(p, width, height, alpha, gap, c1, c2, origin, offset);
        else if (s === 1) drawStrobeSpiral(p, width, height, alpha, gap, c1, c2, origin, offset);
        else if (s === 2) drawStrobeHex(p, width, height, alpha, gap, c1, c2, origin, offset);
        else if (s === 3) drawStrobeOval(p, width, height, alpha, gap, c1, c2, origin, offset);
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
        idioms.onArcKey?.(e);
      },

      draw({ p, width, height, dt }): void {
        // windchime authored at 1024×768; scale that screen-space to the live canvas.
        const scale = Math.min(width / W, height / H);
        const advance = dt * 60; // windchime ran at frameRate(60); keep it dt-stable.

        const av = arc.values();
        // enc0 → movement intensity 0..1 (position-jump probability).
        const movementIntensity = clamp01(av.movement ?? 1);
        // motion axis rides the spin; density folds object size (0.5-neutral).
        const motionMul = lerp(0.6, 1.6, cur.motion);
        const sizeFold = 0.7 + cur.density * 0.6;

        p.background(bgColor[0], bgColor[1], bgColor[2]);

        // ── 4 tumbling 3D objects (faithful) ────────────────────────────────
        for (let i = 0; i < NUM_OBJECTS; i++) {
          const slot = slots[i];
          if (!slot) continue;

          // enc 1-3 ride object size + playhead speed (windchime: position 0-64 →
          // size.x = position×2, and the encoder rides the playhead speed). size.y
          // / size.z keep their per-slot randomised initial (the tube radius etc.).
          if (i > 0) {
            const ev = clamp01(av[`shape${i}`] ?? 0.5);
            slot.playheadSpeed = lerp(0.15, 2.2, ev);
            slot.size.x = lerp(40, 200, ev);
          }
          const sizeMul = scale * sizeFold;

          // angle advance: enc0 spins straight, enc 1-3 by their playhead speed.
          if (i === 0) slot.angle += slot.rotationSpeed * motionMul * advance;
          else slot.angle += slot.rotationSpeed * slot.playheadSpeed * motionMul * advance;

          // movement intensity → the object JUMPS to a new position (windchime).
          if (ctx.rng.random() < movementIntensity) {
            slot.pos = {
              x: ctx.rng.range(-W / 2 + 100, W / 2 - 100),
              y: ctx.rng.range(-H / 2 + 100, H / 2 - 100),
              z: ctx.rng.range(-200, 200),
            };
          }

          p.push();
          p.translate(slot.pos.x * scale, slot.pos.y * scale, slot.pos.z * scale);
          p.stroke(slot.color[0], slot.color[1], slot.color[2], 120 + cur.contrast * 80);
          p.strokeWeight(1);
          p.noFill();
          p.rotateY(slot.angle);
          p.rotateX(slot.angle * 0.5);
          drawObject(p, slot, sizeMul);
          p.pop();

          // self-walking playhead: advance, wrap, re-roll rotation every quarter
          // (windchime perf/gestural behaviour — drives the rotation re-roll). The
          // ring LED is owned by arcMacros' 'playhead' policy on the encoder value
          // (size/speed), so we do NOT write the walk back into the encoder (that
          // would clobber the performer's turn). Quarter re-roll is preserved.
          if (i > 0) {
            slot.playhead += slot.playheadSpeed * advance;
            if (slot.playhead >= ARC_LEDS) slot.playhead -= ARC_LEDS;
            if (Math.floor(slot.playhead) % (ARC_LEDS / 4) === 0) {
              slot.rotationSpeed = ctx.rng.range(0.01, 0.05);
            }
          }
        }

        // ── 4 fullscreen 2D strobe overlays — drawn LAST, on top ────────────
        // Wrap in a translate to the canvas top-left so the screen-space band
        // math (authored for Processing's top-left origin) works in WEBGL.
        p.push();
        p.translate(-width / 2, -height / 2);
        drawStrobes(p, width, height);
        p.pop();

        idioms.renderGrid(ctx.ledOut, profile);
        idioms.renderArc(ctx.ledOut, profile);
      },
    };
  },
};
