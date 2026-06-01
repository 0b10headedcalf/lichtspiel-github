/**
 * lichtspielOpus — the Opus III hero. Hand-ported (concept-adapted) from
 * windchime-animation/processing_corpus_g64arc2/Lichtspiel_v3/Lichtspiel_v3.pde,
 * the grid64/arc2 "idiom master": a Walter Ruttmann *Opus III*-inspired
 * performable abstract-film instrument — a forward-travelling morphing tunnel
 * inside a 2D Ruttmann rectilinear film language, weathered by film grain.
 *
 * The original is Processing P3D (1083 lines). This is a fresh P2D port: the 3D
 * tunnel + interior morphs are rendered by manual perspective projection of the
 * undulating rings (the same projected-depth technique as topographicTunnel),
 * which keeps the 2D film/grain layers in their native screen space — no WEBGL
 * depth-overlay dance — and stays browser-only resilient at 60fps. The control
 * map + Ruttmann aesthetic are preserved; per-frame grain uses a seeded RNG.
 *
 * CONTROL MAP (via the idiom layer — faderBank + arcMacros):
 *   GRID col0 speed · col1 radius · col2 undulation · col3 lobes ·
 *        col4 inner-morph density · col5 rect-form density ·
 *        col6 palette select (press also bursts) · col7 grain/damage
 *        (bottom press cycles grain type).  On a Grid 128, cols 8–15 → scene-select.
 *   ARC  enc0 turn twist / press toggle 3D bulge field ·
 *        enc1 turn aperture / press advance palette + 2D burst.
 *        On an Arc 4, enc2 adds slow orbit, enc3 modulates grain density.
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
import { createRng } from '../seededRng.js';

const TWO_PI = Math.PI * 2;

/** The eight Ruttmann film palettes (background, ink, glow, shadow, paper) as RGB. */
const PALETTES: number[][][] = [
  [[12, 8, 4], [220, 116, 20], [255, 196, 80], [0, 0, 0], [255, 232, 178]],
  [[2, 2, 3], [190, 28, 44], [60, 220, 125], [0, 0, 0], [250, 244, 214]],
  [[4, 8, 18], [26, 96, 220], [120, 190, 255], [0, 0, 12], [230, 240, 255]],
  [[20, 12, 6], [170, 75, 26], [255, 72, 25], [0, 0, 0], [255, 210, 135]],
  [[8, 4, 16], [104, 56, 190], [15, 210, 230], [0, 0, 0], [220, 210, 255]],
  [[224, 220, 198], [55, 55, 50], [0, 0, 0], [0, 0, 0], [255, 250, 225]],
  [[7, 10, 16], [235, 54, 36], [255, 170, 40], [0, 0, 0], [250, 230, 190]],
  [[5, 16, 12], [30, 130, 100], [175, 255, 195], [0, 0, 0], [230, 255, 220]],
];

/** Structural variants the `v` key / arc re-roll, distinct from the live axes. */
const variants = makeVariantFactory({
  startPalette: { canonical: 0, options: [0, 1, 2, 3, 4, 5, 6, 7] },
  grain: { canonical: 0, options: [0, 1, 2, 3] },
  tunnel: { canonical: 'lush', options: ['lush', 'wire', 'sparse'] },
  forms: { canonical: 'ruttmann', options: ['ruttmann', 'minimal', 'busy'] },
});

interface Bulge {
  angle: number;
  depth: number;
  amp: number;
  aWidth: number;
  dWidth: number;
  phase: number;
  pulse: number;
  drift: number;
}
interface Burst {
  born: number;
  life: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  mode: number;
}

function angularDist(a: number, b: number): number {
  const d = Math.abs(a - b) % TWO_PI;
  return Math.min(d, TWO_PI - d);
}

export const lichtspielOpus: VisualTemplate = {
  id: 'lichtspielOpus',
  name: 'Lichtspiel — Opus III',
  family: 'lichtspiel',
  description:
    'Ruttmann Opus III film instrument: a morphing forward tunnel inside 2D rectilinear forms, weathered by film grain. The grid64/arc2 hero.',
  tags: ['film', 'tunnel', 'ruttmann', 'monome', 'hero', 'abstract', 'grain', 'slow'],
  defaultParams: {
    motion: 0.5,
    density: 0.5,
    turbulence: 0.5,
    cameraDepth: 0.55,
    contrast: 0.6,
    palette: 0.0,
    strobe: 0.2,
  },
  renderer: 'p2d',
  sourceLineage: 'Lichtspiel_v3.pde (hand-ported, concept-adapted P3D→P2D)',
  hardwareTarget: { grid: '64', arc: '2' },
  idioms: ['faderBank', 'arcMacros'],
  variants,

  create(ctx: MountContext) {
    const startPalette = cfg(ctx.config, 'startPalette', 0);
    const tunnelStyle = cfg<string>(ctx.config, 'tunnel', 'lush');
    const formStyle = cfg<string>(ctx.config, 'forms', 'ruttmann');

    let profile: IdiomProfile = profileFromSetup(ctx.setup);

    // ── idioms (the control map) ───────────────────────────────────
    // 8 grid faders, one column each (spread:false) so a Grid 128 keeps cols
    // 8–15 free for scene-select; 2 arc encoders (+2 dormant on an Arc 2).
    const fb: FaderBank = createFaderBank({
      spread: false,
      lanes: [
        { name: 'speed', initial: 3 / 7 },
        { name: 'radius', initial: 4 / 7 },
        { name: 'undulation', initial: 4 / 7 },
        { name: 'lobes', initial: 3 / 7 },
        { name: 'inner', initial: 3 / 7 },
        { name: 'rects', initial: 3 / 7 },
        { name: 'palette', mode: 'select', initial: 1 - startPalette / 7 },
        { name: 'damage', initial: 3 / 7 },
      ],
    });
    const arc: ArcMacros = createArcMacros({
      encoders: [
        { name: 'twist', initial: 24 / 63, led: 'comet', onPress: () => toggleBulges() },
        { name: 'aperture', initial: 32 / 63, led: 'comet', onPress: () => advancePalette() },
        { name: 'orbit', initial: 0, mode: 'relative', led: 'playhead' },
        { name: 'grainMod', initial: 0.5, led: 'gauge' },
      ],
    });
    const idioms: ComposedIdiom = composeIdioms([fb, arc]);
    idioms.setProfile(profile);

    // ── performance + structural state ─────────────────────────────
    let paletteIndex = startPalette;
    let grainType = cfg(ctx.config, 'grain', 0);
    let bulgeActive = false;
    const bulges: Bulge[] = [];
    const bursts: Burst[] = [];
    let timePhase = 0;
    let tunnelTravel = 0;
    let elapsed = 0; // seconds since mount (burst clock)
    let W = ctx.width;
    let H = ctx.height;
    let cur: VisualParamVector = ctx.initialParams;

    // derived (recomputed each frame from idiom values folded with the axes)
    let filmSpeed = 1;
    let radiusN = 0.5;
    let undulationN = 0.5;
    let lobeCount = 4;
    let innerDensity = 4;
    let rectDensity = 4;
    let damage = 0.35;
    let arcTwist = 0;
    let arcAperture = 0.5;
    let orbit = 0;
    let grainMod = 0.5;

    const rings = tunnelStyle === 'sparse' ? 22 : 30;
    const segments = tunnelStyle === 'wire' ? 40 : 54;

    function toggleBulges(): void {
      bulgeActive = !bulgeActive;
      bulges.length = 0;
      if (bulgeActive) {
        const n = 1 + ctx.rng.int(4);
        for (let i = 0; i < n; i++) {
          bulges.push({
            angle: (i / Math.max(1, n)) * TWO_PI + ctx.rng.range(-0.5, 0.5),
            depth: ctx.rng.range(0.1, 0.9),
            amp: ctx.rng.range(0.25, 0.7),
            aWidth: ctx.rng.range(0.36, 0.95),
            dWidth: ctx.rng.range(0.12, 0.4),
            phase: ctx.rng.range(0, TWO_PI),
            pulse: ctx.rng.range(0.55, 1.85),
            drift: ctx.rng.range(-0.1, 0.1),
          });
        }
      }
    }
    function spawnBurst(): void {
      const n = 2 + ctx.rng.int(3);
      for (let i = 0; i < n; i++) {
        bursts.push({
          born: elapsed,
          life: ctx.rng.range(1.3, 2.6),
          x: ctx.rng.range(W),
          y: ctx.rng.range(H),
          w: ctx.rng.range(80, W * 0.7),
          h: ctx.rng.range(20, H * 0.38),
          rot: ctx.rng.range(-0.55, 0.55),
          mode: ctx.rng.int(4),
        });
      }
      while (bursts.length > 20) bursts.shift();
    }
    function advancePalette(): void {
      paletteIndex = (paletteIndex + 1) % PALETTES.length;
      fb.set('palette', 1 - paletteIndex / 7); // keep the fader LED in sync
      spawnBurst();
    }

    function readControls(): void {
      const v = fb.values();
      const a = arc.values();
      // fold the fader (primary) with the matching VisualParamVector axis: a
      // centred axis (0.5) leaves the fader alone; Live/retrieval nudges it ±0.2.
      const fold = (f: number, p: number): number => clamp01(f + (p - 0.5) * 0.4);
      filmSpeed = lerp(0.15, 3.3, fold(v.speed ?? 0.5, cur.motion));
      radiusN = fold(v.radius ?? 0.5, cur.cameraDepth);
      undulationN = fold(v.undulation ?? 0.5, cur.turbulence);
      lobeCount = lerp(2, 10, v.lobes ?? 0.5);
      innerDensity = Math.round(lerp(1, 13, fold(v.inner ?? 0.5, cur.density)));
      rectDensity = Math.round(lerp(1, 18, v.rects ?? 0.5));
      damage = lerp(0.05, 1, fold(v.damage ?? 0.5, cur.strobe));
      paletteIndex = Math.round((1 - (v.palette ?? 1)) * 7);
      arcTwist = lerp(-Math.PI, Math.PI, a.twist ?? 0.5);
      arcAperture = lerp(0.05, 1, a.aperture ?? 0.5);
      orbit = a.orbit ?? 0;
      grainMod = a.grainMod ?? 0.5;
    }

    const pal = (i: number): number[] => PALETTES[paletteIndex]?.[i] ?? [0, 0, 0];

    return {
      setup(p): void {
        p.createCanvas(ctx.width, ctx.height, p.P2D);
        p.noiseSeed(ctx.seed);
        p.ellipseMode(p.CENTER);
        p.rectMode(p.CENTER);
      },

      update(params): void {
        cur = params;
      },

      setProfile(setup): void {
        profile = profileFromSetup(setup);
        idioms.setProfile(profile);
      },

      onGridKey(e): void {
        // Grid 128 extra columns → scene-select; the idioms own cols 0–7.
        if (e.x >= 8) {
          if (e.state === 1) ctx.controls.selectSceneIndex(e.x - 8);
          return;
        }
        idioms.onGridKey?.(e);
        if (e.state === 1) {
          if (e.x === 6) spawnBurst(); // palette press also bursts (v3)
          else if (e.x === 7 && e.y === profile.rows - 1) grainType = (grainType + 1) % 4;
        }
      },
      onArcDelta(e): void {
        idioms.onArcDelta?.(e);
      },
      onArcKey(e): void {
        idioms.onArcKey?.(e); // arcMacros fires enc0/enc1 onPress (bulge / palette)
      },

      draw({ p, width, height, dt }): void {
        W = width;
        H = height;
        elapsed += dt;
        readControls();
        timePhase += dt * filmSpeed;
        tunnelTravel += dt * filmSpeed * 0.9;

        const cx = width * 0.5;
        const cy = height * 0.52;
        const minDim = Math.min(width, height);

        drawBackplate(p, width, height);
        drawRectForms(p, width, height);
        drawTunnel(p, cx, cy, minDim);
        drawInteriorMorphs(p, cx, cy, minDim);
        drawBursts(p);
        drawFilmGate(p, width, height);

        // idiom LED feedback → ledOut (the host mirrors it to the twin + hardware)
        idioms.renderGrid(ctx.ledOut, profile);
        idioms.renderArc(ctx.ledOut, profile);
      },
    };

    // ── layers ─────────────────────────────────────────────────────
    function drawBackplate(p: p5, w: number, h: number): void {
      const bg = pal(0);
      p.background(bg[0] ?? 0, bg[1] ?? 0, bg[2] ?? 0);
      p.noStroke();
      p.rectMode(p.CORNER);
      const ink = pal(1);
      for (let i = 0; i < 16; i++) {
        const a = lerp(30, 0, i / 15);
        p.fill(ink[0] ?? 0, ink[1] ?? 0, ink[2] ?? 0, a);
        const pad = i * (w * 0.018);
        p.rect(pad, pad, w - pad * 2, h - pad * 2);
      }
      // aperture-driven side masks (arc enc1)
      const sh = pal(3);
      const apW = w * (1 - arcAperture) * 0.4;
      p.fill(sh[0] ?? 0, sh[1] ?? 0, sh[2] ?? 0, 150);
      p.rect(0, 0, apW, h);
      p.rect(w - apW, 0, apW, h);
      p.rectMode(p.CENTER);
    }

    function drawRectForms(p: p5, w: number, h: number): void {
      const count = formStyle === 'minimal' ? Math.min(4, rectDensity) : formStyle === 'busy' ? rectDensity + 6 : rectDensity;
      const t = timePhase;
      p.noStroke();
      for (let i = 0; i < count; i++) {
        const phase = t * (0.2 + i * 0.035) + i * 11.17;
        const x = w * p.noise(i * 13.1, phase * 0.11);
        const y = h * p.noise(i * 7.7, 100 + phase * 0.09);
        const rw = lerp(40, w * 0.45, p.noise(i * 3.2, phase));
        const rh = lerp(18, h * 0.35, p.noise(80 + i * 3.2, phase));
        const rot = i % 3 === 0 ? 0 : lerp(-0.18, 0.18, p.noise(i, t * 0.07));
        const c = pal(i % 4 === 0 ? 3 : i % 4 === 1 ? 4 : i % 4 === 2 ? 1 : 2);
        const a = i % 4 === 0 ? 150 : i % 4 === 1 ? 64 : 80;
        p.push();
        p.translate(x, y);
        p.rotate(rot);
        p.fill(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, a);
        p.rect(0, 0, rw, rh);
        p.pop();
      }
    }

    /** Per-ring on-screen radius: near rings large, far rings small (perspective). */
    function ringRadius(depth01: number, minDim: number): number {
      return (0.12 + 0.88 * Math.pow(1 - depth01, 1.6)) * (0.18 + radiusN * 0.34) * minDim;
    }
    function ringDepth(i: number): number {
      const span = rings;
      let raw = (i - (tunnelTravel % span)) % span;
      if (raw < 0) raw += span;
      return raw / span; // 0 near .. 1 far
    }
    function tunnelPoint(
      i: number,
      a: number,
      depth01: number,
      cx: number,
      cy: number,
      minDim: number,
      p: p5,
    ): { x: number; y: number } {
      const axial = i * 0.24;
      const w1 = Math.sin(a * lobeCount + axial + timePhase * 1.4);
      const w2 = Math.sin(a * (lobeCount * 0.5 + 1) - axial * 1.7 + timePhase * 0.9);
      const w3 = p.noise(Math.cos(a) * 1.2 + i * 0.06 + 10, Math.sin(a) * 1.2 + 10, timePhase * 0.12);
      let rMul = 1 + undulationN * (0.28 * w1 + 0.16 * w2 + 0.23 * (w3 - 0.5));
      if (bulgeActive) {
        for (const b of bulges) {
          const da = angularDist(a, b.angle + timePhase * b.drift);
          const dd = Math.abs(depth01 - b.depth);
          const env = Math.exp(-(da * da) / (b.aWidth * b.aWidth)) * Math.exp(-(dd * dd) / (b.dWidth * b.dWidth));
          const pulse = 0.45 + 0.55 * Math.sin(timePhase * b.pulse + b.phase);
          rMul += b.amp * env * pulse;
        }
      }
      const r = ringRadius(depth01, minDim) * Math.max(0.3, rMul);
      const twist = arcTwist + depth01 * 0.9 + orbit * TWO_PI + 0.2 * Math.sin(timePhase * 0.2);
      return { x: cx + r * Math.cos(a + twist), y: cy + r * Math.sin(a + twist) };
    }

    function drawTunnel(p: p5, cx: number, cy: number, minDim: number): void {
      p.noFill();
      const glow = pal(2);
      const paper = pal(4);
      const order = Array.from({ length: rings }, (_, i) => i).sort((a, b) => ringDepth(b) - ringDepth(a));
      for (const i of order) {
        const d = ringDepth(i);
        const alpha = lerp(12, 190, 1 - d);
        const c = i % 2 === 0 ? paper : glow;
        p.stroke(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, alpha * (cur.contrast * 0.6 + 0.5));
        p.strokeWeight(tunnelStyle === 'wire' ? 1 : 1.4 * (1 - d) + 0.4);
        p.beginShape();
        for (let j = 0; j <= segments; j++) {
          const a = (j / segments) * TWO_PI;
          const pt = tunnelPoint(i, a, d, cx, cy, minDim, p);
          p.vertex(pt.x, pt.y);
        }
        p.endShape(p.CLOSE);
      }
      // longitudinal strands
      if (tunnelStyle !== 'wire') {
        const strands = 12;
        const c = pal(2);
        p.stroke(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 70);
        p.strokeWeight(1);
        for (let s = 0; s < strands; s++) {
          const a = (s / strands) * TWO_PI + arcTwist * 0.4;
          p.beginShape();
          for (let i = 0; i < rings; i++) {
            const d = ringDepth(i);
            const pt = tunnelPoint(i, a + 0.22 * Math.sin(timePhase * 0.6 + i * 0.15), d, cx, cy, minDim, p);
            p.vertex(pt.x, pt.y);
          }
          p.endShape();
        }
      }
    }

    function drawInteriorMorphs(p: p5, cx: number, cy: number, minDim: number): void {
      const t = timePhase;
      const glow = pal(2);
      const paper = pal(4);
      for (let i = 0; i < innerDensity; i++) {
        const u = i / Math.max(1, innerDensity);
        const d = (u + (tunnelTravel * 0.04) % 1) % 1;
        const a = TWO_PI * p.noise(i * 0.42, t * 0.11);
        const orbitR = ringRadius(d, minDim) * lerp(0.05, 0.42, p.noise(i * 4.1, t * 0.04));
        const x = cx + orbitR * Math.cos(a + arcTwist * 0.7);
        const y = cy + orbitR * Math.sin(a * 1.3 - arcTwist * 0.5);
        const sz = lerp(8, 42, p.noise(20 + i, t * 0.2)) * (1 - d) * (1 + undulationN * 0.4);
        const pulse = 1 + 0.45 * Math.sin(t * (1.2 + i * 0.05) + i);
        p.noStroke();
        p.fill(glow[0] ?? 0, glow[1] ?? 0, glow[2] ?? 0, 40 + 34 * Math.sin(t + i));
        p.push();
        p.translate(x, y);
        const rr = sz * pulse;
        p.beginShape();
        const lobes = 8;
        for (let k = 0; k <= lobes; k++) {
          const ang = (k / lobes) * TWO_PI;
          const nr = rr * (0.7 + 0.5 * p.noise(i * 9 + Math.cos(ang) * 1.4, Math.sin(ang) * 1.4, t * 0.3));
          p.vertex(Math.cos(ang) * nr, Math.sin(ang) * nr);
        }
        p.endShape(p.CLOSE);
        p.noFill();
        p.stroke(paper[0] ?? 0, paper[1] ?? 0, paper[2] ?? 0, 65);
        p.ellipse(0, 0, rr * 1.7, rr * (1.0 + 0.5 * Math.sin(t + i)));
        p.pop();
      }
    }

    function drawBursts(p: p5): void {
      p.noStroke();
      for (let i = bursts.length - 1; i >= 0; i--) {
        const rb = bursts[i];
        if (!rb) continue;
        const age = clamp01((elapsed - rb.born) / rb.life);
        if (age >= 1) {
          bursts.splice(i, 1);
          continue;
        }
        const env = Math.sin(age * Math.PI);
        const alpha = 170 * env;
        const c = pal(rb.mode === 0 ? 3 : rb.mode === 1 ? 2 : rb.mode === 2 ? 4 : 1);
        const am = rb.mode === 1 ? 0.55 : rb.mode === 2 ? 0.75 : rb.mode === 3 ? 0.45 : 1;
        p.push();
        p.translate(rb.x, rb.y);
        p.rotate(rb.rot + 0.08 * Math.sin(timePhase + i));
        p.fill(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, alpha * am);
        p.rect(0, 0, rb.w * (0.4 + age * 1.2), rb.h);
        if (rb.mode === 3) {
          const sh = pal(3);
          p.fill(sh[0] ?? 0, sh[1] ?? 0, sh[2] ?? 0, alpha * 0.75);
          p.ellipse(0, 0, rb.h * 1.4, rb.h * 1.4);
        }
        p.pop();
      }
    }

    function drawFilmGate(p: p5, w: number, h: number): void {
      const sh = pal(3);
      const paper = pal(4);
      p.rectMode(p.CORNER);
      p.noStroke();
      for (let i = 0; i < 28; i++) {
        const pad = i * (w * 0.012);
        const a = lerp(0, 11 + damage * 22, i / 27);
        p.fill(sh[0] ?? 0, sh[1] ?? 0, sh[2] ?? 0, a);
        p.rect(pad, pad, w - pad * 2, h - pad * 2);
      }
      // film-gate border + sprocket holes
      p.noFill();
      p.stroke(sh[0] ?? 0, sh[1] ?? 0, sh[2] ?? 0, 135);
      p.strokeWeight(Math.max(8, w * 0.009));
      p.rect(10, 10, w - 20, h - 20);
      p.noStroke();
      p.fill(paper[0] ?? 0, paper[1] ?? 0, paper[2] ?? 0, 105);
      const holes = 10;
      for (let i = 0; i < holes; i++) {
        const y = lerp(70, h - 70, i / (holes - 1));
        p.rect(14, y - 11, 14, 22, 3);
        p.rect(w - 28, y - 11, 14, 22, 3);
      }
      drawGrain(p, w, h);
      p.rectMode(p.CENTER);
    }

    function drawGrain(p: p5, w: number, h: number): void {
      // Per-frame, deterministic: seeded by (mount seed, frame parity, grain type).
      const g = createRng((ctx.seed + Math.floor(elapsed * 600) * 7919 + grainType * 2003) | 0);
      const dens = damage * (0.4 + grainMod); // arc enc3 modulates density
      const paper = pal(4);
      const ink = pal(3);
      p.strokeWeight(1);
      if (grainType === 0) {
        const n = Math.round(lerp(60, 520, dens));
        for (let i = 0; i < n; i++) {
          const c = g.random() < 0.7 ? paper : ink;
          p.stroke(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, g.range(8, 55 + dens * 75));
          p.point(g.range(w), g.range(h));
        }
      } else if (grainType === 1) {
        const scratches = Math.round(lerp(1, 16, dens));
        p.noFill();
        for (let i = 0; i < scratches; i++) {
          const x = g.range(w);
          const y = g.range(h);
          const len = g.range(h * 0.08, h * 0.55);
          const drift = g.range(-22, 22);
          p.stroke(paper[0] ?? 0, paper[1] ?? 0, paper[2] ?? 0, g.range(22, 75 + dens * 70));
          p.beginShape();
          for (let k = 0; k < 6; k++) {
            const u = k / 5;
            p.vertex(x + drift * u + Math.sin(u * TWO_PI) * g.range(1, 8), y + len * u);
          }
          p.endShape();
        }
      } else if (grainType === 2) {
        const blooms = Math.round(lerp(1, 26, dens));
        p.noFill();
        for (let i = 0; i < blooms; i++) {
          const s = g.range(6, 70) * dens;
          p.stroke(paper[0] ?? 0, paper[1] ?? 0, paper[2] ?? 0, g.range(8, 32 + dens * 25));
          p.ellipse(g.range(w), g.range(h), s * g.range(0.6, 1.8), s * g.range(0.4, 1.4));
        }
      } else {
        const dashes = Math.round(lerp(60, 460, dens));
        for (let i = 0; i < dashes; i++) {
          const x = g.range(w);
          const y = g.range(h);
          const len = g.range(2, 18 + dens * 22);
          const c = g.random() < 0.55 ? paper : ink;
          p.stroke(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, g.range(8, 44 + dens * 50));
          p.line(x, y, x + len, y + g.range(-2, 2));
        }
      }
    }
  },
};
