/**
 * lichtspielOpus — the Opus III hero. Faithful WEBGL re-port (not forked) of
 * windchime-animation/processing_corpus_g64arc2/Lichtspiel_v3/Lichtspiel_v3.pde,
 * the grid64/arc2 "idiom master": a Walter Ruttmann *Opus III*-inspired performable
 * abstract-film instrument — a forward-travelling 3D morphing tunnel inside a 2D
 * Ruttmann rectilinear film language, weathered by film grain.
 *
 * The original is Processing P3D. This port restores the TRUE 3D the earlier P2D
 * version flattened: the morphing tube (filled QUAD_STRIP shells receding in depth +
 * bright contour rings + twisting longitudinal strands, with lobe undulation, a noise
 * field, and the continuous bulge field), the interior noisy-sphere morphs, and the
 * volumetric 3D grain — all in p5 WEBGL, with the 2D film language (tinted backplate,
 * Ruttmann rect forms, rect bursts, film gate + sprocket holes + 4 grain types) drawn
 * as screen-space overlays (depth-test toggled like the original's hint() calls). The
 * exact control map (8 grid faders + arc twist/aperture, palette/grain columns, arc
 * presses) + the 8 palettes are preserved. Native Grid 64 / Arc 2; variants on top.
 *
 * CONTROL MAP (via the idiom layer — faderBank + arcMacros):
 *   GRID col0 speed · col1 radius · col2 undulation · col3 lobes ·
 *        col4 inner-morph density · col5 rect-form density ·
 *        col6 palette select (press also bursts) · col7 grain/damage
 *        (bottom press cycles grain type).  On a Grid 128, cols 8–15 = 8 EXTENDED faders
 *        (contrast · sway · strands · morph · vignette · bursts · flicker · glow).
 *   ARC  enc0 turn twist / press toggle 3D bulge field ·
 *        enc1 turn aperture / press advance palette + 2D burst.
 *        On an Arc 4, enc2 = slow orbit (press recenters), enc3 = grain density (press cycles type).
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
const HALF_PI = Math.PI / 2;

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

/** A continuous-bulge event deforming the tube (toggled by arc enc0 press). */
interface Bulge {
  angle: number;
  depth: number; // 0 near .. 1 far
  amp: number; // × tubeRadius
  aWidth: number;
  dWidth: number;
  phase: number;
  pulse: number;
  breath: number;
  drift: number;
}
/** A 2D rect burst (spawned by the palette press + arc enc1 press). */
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
    'Ruttmann Opus III film instrument: a 3D morphing forward tunnel inside 2D rectilinear forms, weathered by film grain. The grid64/arc2 hero.',
  tags: ['film', 'tunnel', 'ruttmann', 'monome', 'hero', 'abstract', 'grain', 'slow', '3d'],
  defaultParams: {
    motion: 0.5,
    density: 0.5,
    turbulence: 0.5,
    cameraDepth: 0.55,
    contrast: 0.6,
    palette: 0.0,
    strobe: 0.2,
  },
  renderer: 'webgl',
  sourceLineage: 'Lichtspiel_v3.pde (faithful WEBGL re-port of the P3D original)',
  hardwareTarget: { grid: '64', arc: '2' },
  idioms: ['faderBank', 'arcMacros'],
  gestural: {
    name: 'Ruttmann Film Faders + Arc',
    summary:
      'Eight grid column-faders sculpt the 3D morphing tunnel; the arc twists the camera + drives the aperture. The palette column and the arc presses burst + advance. Native Grid 64 / Arc 2 — a Grid 128 / Arc 4 lights up 8 more faders + 2 more knobs of the SAME sketch.',
    grid: [
      { area: 'cols 0–5', action: 'press a row', effect: 'fader: speed · radius · undulation · lobes · inner-morph density · rect-form density' },
      { area: 'col 6', action: 'press a row', effect: 'select palette (one row each) + spawn a 2D rect burst' },
      { area: 'col 7', action: 'press a row', effect: 'grain / vignette damage; bottom row cycles the grain type' },
      { area: 'cols 8–15 (Grid 128)', action: 'press a row', effect: 'extended faders: contrast · camera sway · strands · morph size · vignette · ambient bursts · flicker · ring glow' },
    ],
    arc: [
      { area: 'enc 0', action: 'turn', effect: 'global tunnel twist / camera orbit' },
      { area: 'enc 0', action: 'press', effect: 'toggle the continuous 3D bulge field (1–4 bulges)' },
      { area: 'enc 1', action: 'turn', effect: 'aperture / iris pressure' },
      { area: 'enc 1', action: 'press', effect: 'advance palette + spawn a geometric burst' },
      { area: 'enc 2 (Arc 4)', action: 'turn / press', effect: 'slow camera orbit / recenter the orbit' },
      { area: 'enc 3 (Arc 4)', action: 'turn / press', effect: 'grain density / cycle grain type' },
    ],
  },
  variants,

  create(ctx: MountContext) {
    const startPalette = cfg(ctx.config, 'startPalette', 0);
    const tunnelStyle = cfg<string>(ctx.config, 'tunnel', 'lush');
    const formStyle = cfg<string>(ctx.config, 'forms', 'ruttmann');

    let profile: IdiomProfile = profileFromSetup(ctx.setup);

    // ── idioms (the control map) ───────────────────────────────────
    // NATIVE to Grid 64 / Arc 2: 8 grid faders (one column each, spread:false) + 2 arc
    // encoders. On a BIGGER device the idiom layer auto-extends — the 8 EXTENDED faders
    // light up on a Grid 128's cols 8–15 and the 2 EXTENDED encoders on an Arc 4's enc
    // 2–3 — all MORE manipulation of this sketch, never scene-switching. All extended
    // controls default to a NEUTRAL value, so a Grid 64 / Arc 2 stays exactly as authored.
    const fb: FaderBank = createFaderBank({
      spread: false,
      lanes: [
        { name: 'speed', label: 'film / tunnel speed', initial: 3 / 7 },
        { name: 'radius', label: 'tunnel radius', initial: 4 / 7 },
        { name: 'undulation', label: 'tube undulation', initial: 4 / 7 },
        { name: 'lobes', label: 'lobe frequency', initial: 3 / 7 },
        { name: 'inner', label: 'interior-morph density', initial: 3 / 7 },
        { name: 'rects', label: 'Ruttmann rect-form density', initial: 3 / 7 },
        { name: 'palette', label: 'palette select', mode: 'select', initial: 1 - startPalette / 7 },
        { name: 'damage', label: 'grain / vignette damage', initial: 3 / 7 },
      ],
      // Grid 128 cols 8–15 — bonus expression; every initial = the Grid 64 base look.
      extendedLanes: [
        { name: 'contrast', label: 'tube line contrast', initial: 0.5 },
        { name: 'sway', label: 'handheld camera sway', initial: 0.5 },
        { name: 'strands', label: 'longitudinal strand density', initial: 0.5 },
        { name: 'morph', label: 'interior-morph size', initial: 0.5 },
        { name: 'vignette', label: 'film-gate vignette depth', initial: 0.5 },
        { name: 'bursts', label: 'ambient Ruttmann burst rate', initial: 0 },
        { name: 'flicker', label: 'film-flash flicker', initial: 0.5 },
        { name: 'glow', label: 'accent-ring glow', initial: 0.5 },
      ],
    });
    const arc: ArcMacros = createArcMacros({
      encoders: [
        { name: 'twist', label: 'tunnel twist / camera orbit', pressLabel: 'toggle the 3D bulge field', initial: 24 / 63, led: 'comet', onPress: () => toggleBulges() },
        { name: 'aperture', label: 'aperture / iris', pressLabel: 'advance palette + burst', initial: 32 / 63, led: 'comet', onPress: () => advancePalette() },
      ],
      // Arc 4 enc 2–3 — dormant on an Arc 2 (NOT coupled into twist/aperture).
      extendedEncoders: [
        { name: 'orbit', label: 'slow camera orbit', pressLabel: 'recenter the orbit', mode: 'relative', initial: 0, led: 'playhead', onPress: () => recenterOrbit() },
        { name: 'grainMod', label: 'grain density', pressLabel: 'cycle grain type', initial: 0.5, led: 'gauge', onPress: () => cycleGrain() },
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
    let tunnelTravel = 0; // 0..1 sub-ring scroll offset
    let elapsed = 0; // seconds since mount (burst clock)
    let burstClock = 0; // ambient-burst timer (extended 'bursts' fader)
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
    // extended-fader values (Grid 128 cols 8–15) — neutral on a Grid 64, so no effect there.
    let exContrast = 0.5;
    let exSway = 0.5;
    let exStrands = 0.5;
    let exMorph = 0.5;
    let exVignette = 0.5;
    let exBursts = 0;
    let exFlicker = 0.5;
    let exGlow = 0.5;

    // orig 52/72. p5 WEBGL strokes cost per CPU-built line-segment, so this is the
    // density/60fps balance (every ring is a stroked loop, no stroked fill shells):
    // 44 rings still reads deep, 46 segments ≈ 8 per lobe (smooth).
    const RINGS = tunnelStyle === 'sparse' ? 30 : 44;
    const SEGMENTS = tunnelStyle === 'wire' ? 34 : 46;

    function toggleBulges(): void {
      bulgeActive = !bulgeActive;
      bulges.length = 0;
      if (bulgeActive) {
        const n = 1 + ctx.rng.int(4); // 1..4 bulges (orig random(1,5))
        for (let i = 0; i < n; i++) {
          bulges.push({
            angle: (i / Math.max(1, n)) * TWO_PI + ctx.rng.range(-0.5, 0.5),
            depth: ctx.rng.range(0.1, 0.9),
            amp: ctx.rng.range(0.39, 1.0), // × tubeRadius (orig 120..310 px / radius ≈ 0.39..1.0)
            aWidth: ctx.rng.range(0.36, 0.95),
            dWidth: ctx.rng.range(0.06, 0.16), // orig zWidth 240..620 / tunnelDepth ≈ 0.06..0.16
            phase: ctx.rng.range(0, TWO_PI),
            pulse: ctx.rng.range(0.55, 1.85),
            breath: ctx.rng.range(0.18, 0.72),
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
    // extended arc enc 2–3 press actions (Arc 4 only)
    function recenterOrbit(): void {
      orbit = 0;
      arc.set('orbit', 0); // reset the relative-phase encoder so the spin stops
    }
    function cycleGrain(): void {
      grainType = (grainType + 1) % 4;
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
      // extended faders (Grid 128 cols 8–15) — each defaults neutral so a Grid 64 is unchanged.
      exContrast = v.contrast ?? 0.5;
      exSway = v.sway ?? 0.5;
      exStrands = v.strands ?? 0.5;
      exMorph = v.morph ?? 0.5;
      exVignette = v.vignette ?? 0.5;
      exBursts = v.bursts ?? 0;
      exFlicker = v.flicker ?? 0.5;
      exGlow = v.glow ?? 0.5;
    }

    const pal = (i: number): number[] => PALETTES[paletteIndex]?.[i] ?? [0, 0, 0];

    // ── 3D tunnel geometry (HEIGHT-relative units, true depth) ──────
    // Everything scales to canvas HEIGHT. The WEBGL camera's FOV is vertical (fovy 60°,
    // eye at 0.866·H), so height-scaling reproduces the original's vertical framing at
    // ANY aspect (the original is 2056×1260; the runtime window may be portrait). The
    // ratios match Lichtspiel_v3.pde's pixel constants taken over its 1260 frame height.
    // (H + W are declared above and refreshed each frame in draw().)
    const ringSpacing = (): number => H * 0.0595; // 75 / 1260
    const tubeRadius = (): number => lerp(0.127, 0.333, radiusN) * H; // 160..420 / 1260
    const undulationAmp = (): number => undulationN * tubeRadius() * 0.62; // ≈ 10..190 / 1260
    // The tube's NEAR end sits in FRONT of the origin toward the camera (+z), exactly as
    // the original (near ring at world +0.286·H, ~0.58·H clear of the camera) — big and
    // immersive, yet never close enough for the camera to enter the near rings. It
    // recedes into −z. (520−160)/1260 ≈ 0.286.
    const NEAR_Z = (): number => H * 0.286;
    /** z of ring i (0 near .. RINGS-1 far); the sub-ring travel drifts it toward the camera. */
    function ringZ(i: number): number {
      return NEAR_Z() - (i - (tunnelTravel % 1)) * ringSpacing();
    }
    /** A 3D point on the tube at ring i, angle a, normalized depth d (0 near..1 far). */
    function tubePoint(i: number, a: number, d: number, p: p5, out: [number, number, number]): void {
      const base = tubeRadius();
      const amp = undulationAmp();
      const axial = i * 0.24;
      const w1 = Math.sin(a * lobeCount + axial + timePhase * 1.4);
      const w2 = Math.sin(a * (lobeCount * 0.5 + 1) - axial * 1.7 + timePhase * 0.9);
      const w3 = p.noise(Math.cos(a) * 1.2 + i * 0.06 + 10, Math.sin(a) * 1.2 + 10, timePhase * 0.12);
      let r = base + amp * 0.55 * w1 + amp * 0.32 * w2 + amp * 0.46 * (w3 - 0.5);
      if (bulgeActive) {
        for (const b of bulges) {
          // the bulge swims through depth + angle and breathes, like the original's zAt/angleAt.
          const cd = clamp01(b.depth + 0.22 * Math.sin(timePhase * 0.28 + b.phase));
          const ca = b.angle + 0.55 * Math.sin(timePhase * 0.42 + b.phase) + timePhase * b.drift;
          const da = angularDist(a, ca);
          const dd = Math.abs(d - cd);
          const env = Math.exp(-(da * da) / (b.aWidth * b.aWidth)) * Math.exp(-(dd * dd) / (b.dWidth * b.dWidth));
          const pulse = 0.45 + 0.55 * Math.sin(timePhase * b.pulse + b.phase);
          const breathing = 0.72 + 0.28 * Math.sin(timePhase * b.breath + b.phase * 1.7);
          r += base * b.amp * env * pulse * breathing;
        }
      }
      r = Math.max(base * 0.18, r);
      const z = ringZ(i);
      // Helical twist grows with depth — the original's z*0.0011 over its z-range is
      // ~4.2 rad across the tube; expressed over normalized depth d it's resolution-free.
      const twist = arcTwist + (0.55 - 4.2 * d) + orbit * TWO_PI + 0.2 * Math.sin(timePhase * 0.2);
      out[0] = r * Math.cos(a + twist);
      out[1] = r * Math.sin(a + twist);
      out[2] = z;
    }

    // Scratch vectors + the index→depth map (consts must live BEFORE `return` — code
    // after a return is unreachable, so consts there never initialize).
    const va: [number, number, number] = [0, 0, 0];
    const vb: [number, number, number] = [0, 0, 0];
    const dN = (i: number): number => i / (RINGS - 1); // ring index → normalized depth (0 near .. 1 far)
    // Reused per-frame tube point grid: tubeGrid[(i*(SEGMENTS+1)+j)*3 + {0,1,2}] = x,y,z.
    const tubeGrid = new Float64Array(RINGS * (SEGMENTS + 1) * 3);

    return {
      setup(p): void {
        p.createCanvas(ctx.width, ctx.height, p.WEBGL);
        p.noiseSeed(ctx.seed);
        p.ellipseMode(p.CENTER);
        p.rectMode(p.CORNER);
        p.setAttributes('antialias', true);
      },

      update(params): void {
        cur = params;
      },

      setProfile(setup): void {
        profile = profileFromSetup(setup);
        idioms.setProfile(profile);
      },

      // Live, hardware-accurate control map for the gestural panel — shows the ACTUAL
      // per-column / per-encoder mapping for the connected device (native cols 0–7 +
      // the extended cols 8–15 on a Grid 128; the extended enc 2–3 on an Arc 4).
      controlMap: (setup) => idioms.describe(profileFromSetup(setup)),

      onGridKey(e): void {
        // The idioms own the WHOLE grid: cols 0–7 = the 8 native faders, cols 8–15 (Grid
        // 128) = the 8 extended faders. No scene-select here — the extra real estate is
        // MORE manipulation of this sketch (scene nav lives on the keyboard / Ableton).
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
        // ~9.6 rings/s per filmSpeed unit — the original's 12 px/frame ÷ 75 px ring × 60fps.
        tunnelTravel = (tunnelTravel + dt * filmSpeed * 9.6) % RINGS;
        // extended fader 'bursts': ambient Ruttmann bursts (silent at 0; faster as it rises).
        if (exBursts > 0.02) {
          burstClock += dt;
          if (burstClock >= lerp(6, 0.4, exBursts)) {
            spawnBurst();
            burstClock = 0;
          }
        }

        const gl = p.drawingContext as WebGLRenderingContext;
        const bg = pal(0);
        p.background(bg[0] ?? 0, bg[1] ?? 0, bg[2] ?? 0);

        // ── back 2D film language (depth off → painted behind the tunnel) ──
        gl.disable(gl.DEPTH_TEST);
        screen2D(p, width, height, () => {
          drawBackplate(p, width, height);
          drawRectForms(p, width, height);
        });

        // ── 3D tunnel + interior morphs + volumetric grain (depth on) ──
        gl.enable(gl.DEPTH_TEST);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        const swayAmt = exSway * 2; // extended fader 'sway': handheld camera wobble (1 at neutral)
        p.push();
        p.translate(0, height * 0.02, 0);
        p.rotateX(0.08 * swayAmt * Math.sin(timePhase * 0.7));
        p.rotateY(arcTwist * 0.9 + 0.12 * swayAmt * Math.sin(timePhase * 0.31));
        p.rotateZ(0.04 * swayAmt * Math.sin(timePhase * 0.17));
        drawTunnel3D(p);
        drawInteriorMorphs3D(p);
        drawVolumetricGrain3D(p);
        p.pop();

        // ── front 2D film language (depth off → painted on top) ──
        gl.disable(gl.DEPTH_TEST);
        screen2D(p, width, height, () => {
          drawBursts(p);
          drawFilmGate(p, width, height);
        });

        // idiom LED feedback → ledOut (the host mirrors it to the twin + hardware)
        idioms.renderGrid(ctx.ledOut, profile);
        idioms.renderArc(ctx.ledOut, profile);
      },
    };

    // ── helpers ────────────────────────────────────────────────────

    /** Run `body` in screen space (origin top-left, +y down) for 2D overlays in WEBGL.
     *  Layering is by depth-test toggling at the call sites, so these draw flat at z≈0. */
    function screen2D(p: p5, w: number, h: number, body: () => void): void {
      p.push();
      p.translate(-w / 2, -h / 2, 0);
      body();
      p.pop();
    }

    // ── 2D layers (screen space) ──────────────────────────────────
    function drawBackplate(p: p5, w: number, h: number): void {
      const t = timePhase;
      p.noStroke();
      const ink = pal(1);
      const sh = pal(3);
      const paper = pal(4);
      // inset vignette frames (orig 18 frames, alpha 34→0)
      for (let i = 0; i < 18; i++) {
        const a = lerp(34, 0, i / 17);
        p.fill(ink[0] ?? 0, ink[1] ?? 0, ink[2] ?? 0, a);
        const pad = i * (w * 0.0175);
        p.rect(pad, pad, w - pad * 2, h - pad * 2);
      }
      // two slow vertical Ruttmann bars sliding at the edges
      p.fill(sh[0] ?? 0, sh[1] ?? 0, sh[2] ?? 0, 110 + 45 * Math.sin(t * 0.9));
      p.rect(-40, 0, w * (0.08 + 0.08 * Math.sin(t * 0.21)), h);
      p.fill(sh[0] ?? 0, sh[1] ?? 0, sh[2] ?? 0, 80);
      p.rect(w * (0.82 + 0.06 * Math.sin(t * 0.16)), 0, w * 0.25, h);
      // two large rectilinear panels (paper + ink)
      p.fill(paper[0] ?? 0, paper[1] ?? 0, paper[2] ?? 0, 28);
      p.rect(w * 0.16, h * 0.12, w * 0.38, h * 0.76);
      p.fill(ink[0] ?? 0, ink[1] ?? 0, ink[2] ?? 0, 22);
      p.rect(w * 0.48, h * 0.05, w * 0.24, h * 0.88);
    }

    function drawRectForms(p: p5, w: number, h: number): void {
      const count = formStyle === 'minimal' ? Math.min(4, rectDensity) : formStyle === 'busy' ? rectDensity + 6 : rectDensity;
      const t = timePhase;
      p.noStroke();
      p.rectMode(p.CENTER);
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
      // iris aperture masks (arc enc1) — two big shadow blocks irising toward centre;
      // the open gap in the middle = w·arcAperture (orig geometry).
      const sh = pal(3);
      const apertureW = w * arcAperture;
      p.fill(sh[0] ?? 0, sh[1] ?? 0, sh[2] ?? 0, 120);
      p.rect(w * 0.5 - apertureW * 0.5 - w * 0.25, h * 0.5, w * 0.5, h * 1.4);
      p.rect(w * 0.5 + apertureW * 0.5 + w * 0.25, h * 0.5, w * 0.5, h * 1.4);
      // slow rotating diagonal sweep bar
      p.push();
      p.translate(w * 0.5, h * 0.5);
      p.rotate(-0.38 + 0.12 * Math.sin(t * 0.13));
      p.fill(sh[0] ?? 0, sh[1] ?? 0, sh[2] ?? 0, 55);
      p.rect(0, 0, w * 1.6, h * 0.18);
      p.pop();
      p.rectMode(p.CORNER);
    }

    function drawBursts(p: p5): void {
      p.noStroke();
      p.rectMode(p.CENTER);
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
      p.rectMode(p.CORNER);
    }

    function drawFilmGate(p: p5, w: number, h: number): void {
      const sh = pal(3);
      const paper = pal(4);
      const vigScale = exVignette * 2; // 'vignette' extended fader (1 at neutral)
      p.noStroke();
      for (let i = 0; i < 36; i++) {
        const pad = i * (w * 0.0088);
        const a = lerp(0, (11 + damage * 22) * vigScale, i / 35);
        p.fill(sh[0] ?? 0, sh[1] ?? 0, sh[2] ?? 0, a);
        p.rect(pad, pad, w - pad * 2, h - pad * 2);
      }
      // film-gate double border + sprocket holes
      p.noFill();
      p.stroke(sh[0] ?? 0, sh[1] ?? 0, sh[2] ?? 0, 135);
      p.strokeWeight(Math.max(8, w * 0.009));
      p.rect(10, 10, w - 20, h - 20);
      p.stroke(paper[0] ?? 0, paper[1] ?? 0, paper[2] ?? 0, 38);
      p.strokeWeight(2);
      p.rect(26, 26, w - 52, h - 52);
      p.noStroke();
      p.fill(paper[0] ?? 0, paper[1] ?? 0, paper[2] ?? 0, 105);
      const holes = 10;
      for (let i = 0; i < holes; i++) {
        const y = lerp(70, h - 70, i / (holes - 1));
        p.rect(14, y - 11, 14, 22, 3);
        p.rect(w - 28, y - 11, 14, 22, 3);
      }
      drawGrain(p, w, h);
      // overall film-flash flicker (orig final pal(4) wash)
      p.noStroke();
      p.fill(paper[0] ?? 0, paper[1] ?? 0, paper[2] ?? 0, (8 + 12 * damage * p.noise(timePhase * 2)) * (exFlicker * 2)); // 'flicker' fader
      p.rect(0, 0, w, h);
    }

    function drawGrain(p: p5, w: number, h: number): void {
      // Per-frame, deterministic: seeded by (mount seed, frame parity, grain type).
      const g = createRng((ctx.seed + Math.floor(elapsed * 600) * 7919 + grainType * 2003) | 0);
      const dens = clamp01(damage * (0.4 + grainMod)); // arc enc3 modulates density
      const paper = pal(4);
      const ink = pal(3);
      p.strokeWeight(1);
      // Batched random speckle: ONE GL_POINTS draw call per (colour, alpha) bucket.
      // p5's WEBGL point() builds a fresh geometry per call (hundreds/frame = death);
      // a single POINTS shape is ~100× cheaper and reads identically as film grain.
      const dust = (count: number, c: number[], alpha: number): void => {
        if (count <= 0) return;
        p.stroke(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, alpha);
        p.beginShape(p.POINTS);
        for (let i = 0; i < count; i++) p.vertex(g.range(w), g.range(h));
        p.endShape();
      };
      if (grainType === 0) {
        // silver-halide speckle (orig 80..1800, 70% paper / 30% ink)
        const n = Math.round(lerp(80, 1800, dens));
        dust(Math.round(n * 0.5), paper, 22 + dens * 28);
        dust(Math.round(n * 0.2), paper, 50 + dens * 55);
        dust(Math.round(n * 0.3), ink, 16 + dens * 24);
      } else if (grainType === 1) {
        // hairline scratches over a fine speckle bed
        const bed = Math.round(lerp(60, 900, dens));
        dust(Math.round(bed * 0.7), paper, 16 + dens * 30);
        dust(Math.round(bed * 0.3), paper, 34 + dens * 55);
        const scratches = Math.round(lerp(1, 18, dens));
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
          if (g.random() < 0.45) {
            p.stroke(ink[0] ?? 0, ink[1] ?? 0, ink[2] ?? 0, g.range(20, 80));
            const yy = y + g.range(20, len);
            p.line(x + g.range(-4, 4), yy, x + g.range(-8, 8), yy);
          }
        }
      } else if (grainType === 2) {
        // dust + bloom over a dust bed
        dust(Math.round(lerp(40, 700, dens)), paper, 24);
        const blooms = Math.round(lerp(1, 30, dens));
        p.noFill();
        for (let i = 0; i < blooms; i++) {
          const x = g.range(w);
          const y = g.range(h);
          const s = g.range(6, 70) * dens;
          p.stroke(paper[0] ?? 0, paper[1] ?? 0, paper[2] ?? 0, g.range(8, 32 + dens * 25));
          p.ellipse(x, y, s * g.range(0.6, 1.8), s * g.range(0.4, 1.4));
          if (g.random() < 0.35) {
            p.noStroke();
            p.fill(ink[0] ?? 0, ink[1] ?? 0, ink[2] ?? 0, g.range(8, 24));
            p.ellipse(x + g.range(-5, 5), y + g.range(-5, 5), s * 0.4, s * 0.25);
            p.noFill();
          }
        }
      } else {
        // weave dashes (ONE GL_LINES batch per colour) + a few horizontal bands
        const dashes = Math.round(lerp(80, 1200, dens));
        const dashBatch = (count: number, c: number[], alpha: number): void => {
          p.stroke(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, alpha);
          p.beginShape(p.LINES);
          for (let i = 0; i < count; i++) {
            const x = g.range(w);
            const y = g.range(h);
            const len = g.range(2, 18 + dens * 22);
            p.vertex(x, y);
            p.vertex(x + len, y + g.range(-2, 2));
          }
          p.endShape();
        };
        dashBatch(Math.round(dashes * 0.55), paper, 26 + dens * 40);
        dashBatch(Math.round(dashes * 0.45), ink, 26 + dens * 30);
        const bands = Math.round(lerp(1, 10, dens));
        p.noStroke();
        for (let i = 0; i < bands; i++) {
          const y = g.range(h);
          p.fill(paper[0] ?? 0, paper[1] ?? 0, paper[2] ?? 0, g.range(4, 16 + dens * 20));
          p.rect(0, y, w, g.range(1, 4));
        }
        p.noFill();
      }
    }

    // ── 3D layers ─────────────────────────────────────────────────
    function drawTunnel3D(p: p5): void {
      const glow = pal(2);
      const paper = pal(4);
      // extended faders: 'contrast' boosts every tube stroke; 'glow' pops the accent rings.
      const contrast = Math.max(0, cur.contrast * 0.6 + 0.5 + (exContrast - 0.5) * 0.8);
      const glowAmt = 0.5 + exGlow; // 1 at neutral
      const SP1 = SEGMENTS + 1;

      // Compute the tube point-grid ONCE per frame; fill shells, the mesh and the contour
      // rings all index into it. The mesh then draws as a few batched GL_LINES calls rather
      // than ~50 stroked shells — p5 WEBGL rebuilds stroke geometry per shape, so the SHELL
      // COUNT (not the vertex count) was the 16→60fps cliff. This restores the original's
      // dense QUAD_STRIP mesh look at 60fps.
      for (let i = 0; i < RINGS; i++) {
        const d = dN(i);
        for (let j = 0; j <= SEGMENTS; j++) {
          const a = (j / SEGMENTS) * TWO_PI;
          tubePoint(i, a, d, p, va);
          const k = (i * SP1 + j) * 3;
          tubeGrid[k] = va[0];
          tubeGrid[k + 1] = va[1];
          tubeGrid[k + 2] = va[2];
        }
      }
      const vtx = (i: number, j: number): void => {
        const k = (i * SP1 + j) * 3;
        p.vertex(tubeGrid[k] ?? 0, tubeGrid[k + 1] ?? 0, tubeGrid[k + 2] ?? 0);
      };

      // (No stroked fill shells: in p5 WEBGL the per-frame stroke-geometry build is the cost,
      // and a filled+stroked TRIANGLE_STRIP is the worst case. The rings self-occlude via the
      // depth test, and the original's fill is near-invisible (alpha ~1–20), so dropping it
      // costs ~nothing visually and buys the faithful 52-ring density at 60fps.)

      // 1) tube rings — EVERY ring (the dense look the original's shell stroke gave); every
      //    4th is a bright glow contour accent, the rest a dimmer paper mesh ring. p5 WEBGL
      //    stroke cost is per CPU-built line-segment, so dense rings + a handful of strands
      //    is the ~60fps density budget (the full ring×axial grid blew it at 25fps).
      p.noFill();
      for (let i = RINGS - 1; i >= 0; i--) {
        if (tunnelStyle === 'wire' && i % 2 !== 0) continue;
        const d = dN(i);
        const accent = i % 4 === 0;
        const c = accent ? glow : paper;
        const alpha = (accent ? lerp(205, 14, d) * glowAmt : lerp(95, 6, d)) * contrast;
        p.stroke(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, alpha);
        p.strokeWeight(accent ? 1.4 : 1);
        p.beginShape();
        for (let j = 0; j <= SEGMENTS; j++) vtx(i, j);
        p.endShape(p.CLOSE);
      }

      // 2) twisting longitudinal strands — the axial mesh structure (their own twist angle).
      {
        const strands = tunnelStyle === 'wire' ? 10 : Math.round(8 + exStrands * 16); // 16 at neutral
        p.stroke(glow[0] ?? 0, glow[1] ?? 0, glow[2] ?? 0, 40 + exStrands * 60); // 70 at neutral
        p.strokeWeight(1);
        for (let s = 0; s < strands; s++) {
          const a = (s / strands) * TWO_PI + arcTwist * 0.4;
          p.beginShape();
          for (let i = 0; i < RINGS; i++) {
            tubePoint(i, a + 0.22 * Math.sin(timePhase * 0.6 + i * 0.15), dN(i), p, va);
            p.vertex(va[0], va[1], va[2]);
          }
          p.endShape();
        }
      }
    }

    function drawInteriorMorphs3D(p: p5): void {
      const t = timePhase;
      const glow = pal(2);
      const paper = pal(4);
      const base = tubeRadius();
      p.noStroke();
      for (let i = 0; i < innerDensity; i++) {
        const u = i / Math.max(1, innerDensity);
        const d = (u + ((tunnelTravel / RINGS) * 1.75) % 1) % 1;
        const z = NEAR_Z() - d * RINGS * ringSpacing();
        const a = TWO_PI * p.noise(i * 0.42, t * 0.11);
        const orbitR = base * lerp(0.05, 0.42, p.noise(i * 4.1, t * 0.04));
        const x = orbitR * Math.cos(a + arcTwist * 0.7);
        const y = orbitR * Math.sin(a * 1.3 - arcTwist * 0.5);
        const sz = lerp(base * 0.06, base * 0.26, p.noise(20 + i, t * 0.2)) * (1 + undulationN * 0.3) * (0.5 + exMorph); // 'morph' fader
        const pulse = 1 + 0.45 * Math.sin(t * (1.2 + i * 0.05) + i);
        p.push();
        p.translate(x, y, z);
        p.rotateY(t * 0.5 + i);
        p.rotateX(t * 0.31 + i * 2.1);
        p.fill(glow[0] ?? 0, glow[1] ?? 0, glow[2] ?? 0, 40 + 34 * Math.sin(t + i));
        noisySphere(p, sz * pulse, i * 99.0, t);
        p.noFill();
        p.stroke(paper[0] ?? 0, paper[1] ?? 0, paper[2] ?? 0, 60);
        p.strokeWeight(1);
        p.push();
        p.scale(1.16, 0.72 + 0.24 * Math.sin(t + i), 1.0);
        p.sphere(sz * 0.86, 10, 8);
        p.pop();
        p.noStroke();
        p.pop();
      }
    }

    /** A noise-displaced sphere (lat/lon TRIANGLE_STRIP), like the original drawNoisySphere. */
    function noisySphere(p: p5, radius: number, seed: number, t: number): void {
      const lat = 9;
      const lon = 14;
      for (let i = 0; i < lat; i++) {
        const th1 = lerp(-HALF_PI, HALF_PI, i / lat);
        const th2 = lerp(-HALF_PI, HALF_PI, (i + 1) / lat);
        p.beginShape(p.TRIANGLE_STRIP);
        for (let j = 0; j <= lon; j++) {
          const phi = (j / lon) * TWO_PI;
          noisySpherePoint(p, radius, th1, phi, seed, t, va);
          noisySpherePoint(p, radius, th2, phi, seed, t, vb);
          p.vertex(va[0], va[1], va[2]);
          p.vertex(vb[0], vb[1], vb[2]);
        }
        p.endShape();
      }
    }
    function noisySpherePoint(p: p5, radius: number, th: number, phi: number, seed: number, t: number, out: [number, number, number]): void {
      const n = p.noise(seed + Math.cos(phi) * 1.7 + 10, seed + Math.sin(phi) * 1.7 + 20, Math.sin(th) * 1.7 + t * 0.22);
      const r = radius * (0.82 + 0.42 * n);
      out[0] = r * Math.cos(th) * Math.cos(phi);
      out[1] = r * Math.sin(th);
      out[2] = r * Math.cos(th) * Math.sin(phi);
    }

    function drawVolumetricGrain3D(p: p5): void {
      if (damage < 0.08) return;
      const count = Math.round(lerp(20, 260, damage) * (0.5 + grainMod)); // orig 20..260
      const g = createRng((ctx.seed + Math.floor(elapsed * 60) * 997 + grainType * 811) | 0);
      const base = tubeRadius();
      const paper = pal(4);
      const glow = pal(2);
      p.strokeWeight(1);
      for (let i = 0; i < count; i++) {
        const d = g.random();
        const z = NEAR_Z() - d * RINGS * ringSpacing();
        const a = g.range(TWO_PI);
        const r = base * g.range(0.22, 1.05);
        const x = r * Math.cos(a + arcTwist * 0.4);
        const y = r * Math.sin(a + arcTwist * 0.4);
        const alpha = lerp(60, 0, d) * damage;
        if (grainType === 0) {
          p.stroke(paper[0] ?? 0, paper[1] ?? 0, paper[2] ?? 0, alpha);
          p.point(x, y, z);
        } else if (grainType === 1) {
          p.stroke(paper[0] ?? 0, paper[1] ?? 0, paper[2] ?? 0, alpha * 0.75);
          const len = g.range(base * 0.05, base * 0.25) * damage;
          p.line(x, y, z, x + g.range(-12, 12), y + g.range(-12, 12), z + len);
        } else if (grainType === 2) {
          p.push();
          p.translate(x, y, z);
          p.rotateX(g.range(TWO_PI));
          p.rotateY(g.range(TWO_PI));
          p.noFill();
          p.stroke(paper[0] ?? 0, paper[1] ?? 0, paper[2] ?? 0, alpha * 0.45);
          p.ellipse(0, 0, g.range(8, 40) * damage, g.range(5, 28) * damage);
          p.pop();
          p.strokeWeight(1);
        } else {
          p.stroke(glow[0] ?? 0, glow[1] ?? 0, glow[2] ?? 0, alpha * 0.5);
          const len = g.range(8, 42) * damage;
          p.line(x - len, y, z, x + len, y + g.range(-5, 5), z + g.range(-10, 10));
        }
      }
    }
  },
};
