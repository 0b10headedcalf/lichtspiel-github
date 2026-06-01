/**
 * patternGridWorld — faithful port (not forked) of windchime-animation
 * packages/sketch-families/src/patternGridWorldV11 (a port of
 * PatternGridWorld_v11.pde). A 3D grid of cubes (rows × cols × depth) where each
 * cell's brightness picks its lit depth layer; un-pressed cells flicker; random
 * connection lines fade across the field; a pulsing hypnotic border (box /
 * sphere / ellipsoid / pyramid) can surround it. The full variant space is
 * preserved: 6 palettes (resting/active pairs) · 4 connection densities · depth
 * 4/8/12 · 4 rotations · 5 flicker speeds · 4 cube styles.
 *
 * Lichtspiel rewiring: windchime's per-cell grid handling → the `cellPaint`
 * idiom (press cycles 0→15 + freezes; seeded idle flicker), so the field
 * reshapes 8×16 → 8×8 across a hot-swap; the arc → `arcMacros` (resting/active
 * alpha, bg brightness, connection opacity; press randomises colours / toggles
 * the border). WEBGL.
 */

import { type VisualParamVector, clamp01, lerp } from '@lichtspiel/schemas';
import type { MountContext, VisualTemplate } from '../visualTemplate.js';
import {
  type ArcMacros,
  type CellPaint,
  type ComposedIdiom,
  type IdiomProfile,
  composeIdioms,
  createArcMacros,
  createCellPaint,
  profileFromSetup,
} from '../idioms/index.js';
import { cfg, makeVariantFactory } from '../mutations/familyVariants.js';
import { type Rgb, hslToRgb } from './lib/palettes.js';

const CUBE = 30;
const GAP = 8;

const variants = makeVariantFactory({
  palette: { canonical: 'electric', options: ['electric', 'biolume', 'rainbow', 'monochrome', 'fire', 'ice'] },
  connections: { canonical: 'medium', options: ['sparse', 'medium', 'dense', 'swarm'] },
  depth: { canonical: '4', options: ['4', '8', '12'] },
  rotation: { canonical: 'isometric', options: ['isometric', 'rotating', 'top-down', 'flat'] },
  flicker: { canonical: 'fast', options: ['fast', 'medium', 'slow', 'rare', 'static'] },
  cube: { canonical: 'solid', options: ['solid', 'wireframe', 'edge-only', 'shell'] },
});

const depthFor = (d: string): number => (d === '8' ? 8 : d === '12' ? 12 : 4);
const flickerMsFor = (m: string): number =>
  m === 'medium' ? 80 : m === 'slow' ? 250 : m === 'rare' ? 800 : m === 'static' ? Infinity : 25;
const connRateFor = (m: string): { samples: number; prob: number } =>
  m === 'sparse'
    ? { samples: 50, prob: 0.01 }
    : m === 'dense'
      ? { samples: 150, prob: 0.04 }
      : m === 'swarm'
        ? { samples: 250, prob: 0.08 }
        : { samples: 100, prob: 0.02 };

/** windchime resting/active colour pairs (RGB only — alpha comes from the arc). */
function gridPalette(mode: string, rng: { random(): number; range(a: number, b?: number): number }): {
  resting: Rgb;
  active: Rgb;
} {
  switch (mode) {
    case 'biolume':
      return { resting: [40, 120, 160], active: [180, 255, 220] };
    case 'fire':
      return { resting: [80, 20, 0], active: [255, 160, 40] };
    case 'ice':
      return { resting: [50, 90, 130], active: [180, 240, 255] };
    case 'rainbow': {
      const h = rng.range(0, 360);
      return { resting: hslToRgb(h, 0.6, 0.5), active: hslToRgb((h + 180) % 360, 0.9, 0.6) };
    }
    case 'monochrome': {
      const h = rng.range(0, 360);
      return { resting: hslToRgb(h, 0.4, 0.3), active: hslToRgb(h, 0.9, 0.7) };
    }
    case 'electric':
    default:
      return { resting: [100, 150, 255], active: [255, 255, 0] };
  }
}

interface Connection {
  a: [number, number, number];
  b: [number, number, number];
  born: number;
}

export const patternGridWorld: VisualTemplate = {
  id: 'patternGridWorld',
  name: 'Pattern Grid World',
  family: 'grid',
  description:
    'A 3D cube field painted cell-by-cell — brightness picks the lit depth layer — flickering, wired with connection lines, and ringed by an optional pulsing border.',
  tags: ['grid', 'cubes', '3d', 'neural', 'flicker', 'paint', 'monome', 'cellular'],
  defaultParams: { density: 0.6, motion: 0.4, turbulence: 0.5, contrast: 0.6, palette: 0.2 },
  renderer: 'webgl',
  sourceLineage: 'windchime patternGridWorldV11 (PatternGridWorld_v11.pde, faithful port)',
  hardwareTarget: { grid: '128', arc: '4' },
  idioms: ['cellPaint', 'arcMacros'],
  gestural: {
    name: 'Neural Grid + Hypnotic Border',
    summary:
      'A 3D cube grid — un-pressed cells flicker; pressing a cell cycles its brightness 0→15 (and picks its lit depth layer). The arc carries 8 controls across 4 PAGES (on an Arc 2, press both encoders together to advance a page): p1 neuron alpha, p2 background + border, p3 connections, p4 motion + life. Each encoder has a turn (a value) + a press (an action).',
    grid: [
      { area: 'any cell', action: 'press', effect: 'cycle that cell\'s brightness 0→15 + stop its flicker' },
      { area: 'un-pressed cells', action: 'idle', effect: 'random brightness flicker (speed = flicker variant)' },
    ],
    arc: [
      { area: 'page 1 · enc 0', action: 'turn / press', effect: 'resting-cube alpha · re-roll the resting colour' },
      { area: 'page 1 · enc 1', action: 'turn / press', effect: 'active-cube alpha · re-roll the active colour' },
      { area: 'page 2 · enc 0', action: 'turn / press', effect: 'background brightness · randomise the bg colour' },
      { area: 'page 2 · enc 1', action: 'turn / press', effect: 'border thickness · cycle the border shape' },
      { area: 'page 3 · enc 0', action: 'turn / press', effect: 'connection opacity · re-roll the connection colour' },
      { area: 'page 3 · enc 1', action: 'turn / press', effect: 'connection density · clear all connections' },
      { area: 'page 4 · enc 0', action: 'turn / press', effect: 'field rotation speed · reset the rotation' },
      { area: 'page 4 · enc 1', action: 'turn / press', effect: 'connection lifetime · spawn a connection burst' },
    ],
  },
  variants,

  create(ctx: MountContext) {
    const paletteMode = cfg<string>(ctx.config, 'palette', 'electric');
    const depth = depthFor(cfg<string>(ctx.config, 'depth', '4'));
    const rotation = cfg<string>(ctx.config, 'rotation', 'isometric');
    const cubeStyle = cfg<string>(ctx.config, 'cube', 'solid');
    const connRate = connRateFor(cfg<string>(ctx.config, 'connections', 'medium'));
    const flickMs = flickerMsFor(cfg<string>(ctx.config, 'flicker', 'fast'));

    let profile: IdiomProfile = profileFromSetup(ctx.setup);
    const paint: CellPaint = createCellPaint({
      levels: 16,
      flicker: Number.isFinite(flickMs),
      flickerMs: Number.isFinite(flickMs) ? flickMs : 1000,
      flickerDensity: 0.4,
      rng: () => ctx.rng.random(),
    });
    // 8 controls across 4 PAGES (on an Arc 2, chord both encoders to advance). Each
    // page gives the two encoders a distinct TURN + PRESS, mined from the original v11
    // parameter space: p1 neuron alpha · p2 background + border · p3 connections ·
    // p4 motion + life. (On an Arc 4 → 2 pages of 4 encoders.)
    const arc: ArcMacros = createArcMacros({
      fold: 'page',
      encoders: [
        // ── page 1 — neuron alpha ──
        { name: 'restAlpha', label: 'resting-cube alpha', pressLabel: 're-roll the resting colour', initial: 0.5, led: 'fillNotched', onPress: () => (restingRgb = gridPalette(paletteMode, ctx.rng).resting) },
        { name: 'actAlpha', label: 'active-cube alpha', pressLabel: 're-roll the active colour', initial: 0.7, led: 'fillNotched', onPress: () => (activeRgb = gridPalette(paletteMode, ctx.rng).active) },
        // ── page 2 — background + border ──
        { name: 'bg', label: 'background brightness', pressLabel: 'randomise the background colour', initial: 0.5, led: 'fillNotched', onPress: () => randomiseBg() },
        { name: 'border', label: 'border thickness', pressLabel: 'cycle border shape (off→box→sphere→ellipsoid→pyramid)', initial: 0.3, led: 'fillNotched', onPress: () => cycleBorder() },
        // ── page 3 — connections ──
        { name: 'conn', label: 'connection opacity', pressLabel: 're-roll the connection colour', initial: 0.6, led: 'fillNotched', onPress: () => (connRgb = gridPalette(paletteMode, ctx.rng).active) },
        { name: 'connDensity', label: 'connection density', pressLabel: 'clear all connections', initial: 0.5, led: 'fillNotched', onPress: () => (connections.length = 0) },
        // ── page 4 — motion + life ──
        { name: 'spin', label: 'field rotation speed', pressLabel: 'reset the rotation', initial: 0.5, led: 'fillNotched', onPress: () => (spinAngle = 0) },
        { name: 'life', label: 'connection lifetime', pressLabel: 'spawn a connection burst', initial: 0.5, led: 'fillNotched', onPress: () => spawnConnectionBurst() },
      ],
    });
    const idioms: ComposedIdiom = composeIdioms([paint, arc]);
    idioms.setProfile(profile);

    const base = gridPalette(paletteMode, ctx.rng);
    let restingRgb: Rgb = base.resting;
    let activeRgb: Rgb = base.active;
    let connRgb: Rgb = base.active; // connection-line colour (enc 'conn' press re-rolls)
    let bgBase: Rgb = [0, 0, 0];
    let borderState = 0; // 0 = off, 1..4 = box / sphere / ellipsoid / pyramid (page 4 cycles it)
    let borderProgress = 0;
    let spinAngle = 0; // arc-driven field rotation (page 4 'spin')
    const connections: Connection[] = [];
    let elapsed = 0;
    let cur: VisualParamVector = ctx.initialParams;
    const MAX_SPIN = 1.6; // rad/s at a fully-turned 'spin' encoder

    function randomiseBg(): void {
      bgBase = [ctx.rng.int(40), ctx.rng.int(40), ctx.rng.int(48)];
    }
    function cycleBorder(): void {
      borderState = (borderState + 1) % 5; // off → box → sphere → ellipsoid → pyramid → off
      if (borderState === 1) borderProgress = 0;
    }

    const cellPos = (col: number, row: number, lvl: number, cols: number, rows: number): [number, number, number] => {
      const gw = cols * (CUBE + GAP) - GAP;
      const gh = rows * (CUBE + GAP) - GAP;
      const gd = depth * (CUBE + GAP) - GAP;
      return [
        col * (CUBE + GAP) - gw / 2 + CUBE / 2,
        row * (CUBE + GAP) - gh / 2 + CUBE / 2,
        lvl * (CUBE + GAP) - gd / 2 + CUBE / 2,
      ];
    };

    /** A random neuron's world position — the per-frame spawn + the press burst share it. */
    function pickNeuron(cols: number, rows: number): [number, number, number] {
      const totalN = rows * cols * depth;
      const idx = ctx.rng.int(Math.max(1, totalN));
      const r = Math.floor(idx / (cols * depth));
      const rem = idx - r * cols * depth;
      return cellPos(Math.floor(rem / depth), Math.min(rows - 1, r), rem % depth, cols, rows);
    }
    function spawnConnectionBurst(): void {
      const cells = paint.values().cells;
      const rows = cells.length;
      const cols = cells[0]?.length ?? 0;
      if (rows === 0 || cols === 0) return;
      for (let i = 0; i < 24; i++) connections.push({ a: pickNeuron(cols, rows), b: pickNeuron(cols, rows), born: elapsed });
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
        elapsed += dt;
        paint.tick(dt * 1000);

        const av = arc.values();
        const restA = Math.floor(lerp(20, 200, av.restAlpha ?? 0.5));
        const actA = Math.floor(lerp(120, 255, av.actAlpha ?? 0.7));
        const bgB = lerp(0.2, 1, av.bg ?? 0.5);
        const borderWeight = lerp(2, 40, av.border ?? 0.3); // page 2 'border' turn
        const connOpacity = Math.floor(lerp(0, 255, av.conn ?? 0.6));
        const connDensityMul = lerp(0, 2.5, av.connDensity ?? 0.5); // page 3 'connDensity' turn
        const connLifeSec = lerp(1, 10, av.life ?? 0.5); // page 4 'life' turn
        const borderOn = borderState > 0;
        const borderShape = borderState - 1;
        // page 4 'spin' — a signed rotation-speed knob (0.5 = still); accumulate the angle.
        spinAngle += ((av.spin ?? 0.5) - 0.5) * 2 * MAX_SPIN * dt;

        p.background(bgBase[0] * bgB, bgBase[1] * bgB, bgBase[2] * bgB);

        const cells = paint.values().cells;
        const rows = cells.length;
        const cols = cells[0]?.length ?? 0;
        if (rows === 0 || cols === 0) return;
        const gw = cols * (CUBE + GAP);
        const gh = rows * (CUBE + GAP);
        const gd = depth * (CUBE + GAP);
        const scale = Math.min(width, height) / (Math.max(gw, gh, gd) * 1.7);

        p.push();
        p.scale(scale);
        switch (rotation) {
          case 'rotating':
            p.rotateX(Math.PI / 6);
            p.rotateY(elapsed * 0.25 * (0.4 + cur.motion));
            break;
          case 'top-down':
            p.rotateX(Math.PI / 2.1);
            break;
          case 'flat':
            break;
          case 'isometric':
          default:
            p.rotateX(Math.PI / 6);
            p.rotateY(Math.PI / 4);
        }
        p.rotateY(spinAngle); // arc 'spin' — manual field rotation on top of the variant

        // cube field — brightness picks the lit depth layer
        for (let row = 0; row < rows; row++) {
          const rowCells = cells[row];
          if (!rowCells) continue;
          for (let col = 0; col < cols; col++) {
            const norm = clamp01(rowCells[col] ?? 0);
            const lit = Math.floor(norm * (depth - 1));
            for (let lvl = 0; lvl < depth; lvl++) {
              const isActive = lvl === lit && norm > 0;
              if (cubeStyle === 'shell' && !isActive && lvl !== 0 && lvl !== depth - 1) continue;
              if (cubeStyle === 'edge-only' && !isActive) continue;
              const [x, y, z] = cellPos(col, row, lvl, cols, rows);
              const c = isActive ? activeRgb : restingRgb;
              const a = isActive ? actA : restA;
              p.push();
              p.translate(x, y, z);
              if (cubeStyle === 'wireframe' || cubeStyle === 'edge-only') {
                p.noFill();
                p.stroke(c[0], c[1], c[2], isActive ? 230 : a);
                p.strokeWeight(isActive ? 1.5 : 0.6);
              } else {
                p.fill(c[0], c[1], c[2], a);
                p.stroke(0, 50);
                p.strokeWeight(0.5);
              }
              p.box(CUBE);
              p.pop();
            }
          }
        }

        // connection lines — sample pairs (page-3 'connDensity' scales the spawn rate),
        // fade over the page-4 'life' time.
        for (let s = 0; s < connRate.samples; s++) {
          if (ctx.rng.random() < connRate.prob * (0.4 + cur.density) * connDensityMul) {
            connections.push({ a: pickNeuron(cols, rows), b: pickNeuron(cols, rows), born: elapsed });
          }
        }
        p.strokeWeight(2);
        for (let i = connections.length - 1; i >= 0; i--) {
          const conn = connections[i];
          if (!conn || elapsed - conn.born > connLifeSec) {
            connections.splice(i, 1);
            continue;
          }
          p.stroke(connRgb[0], connRgb[1], connRgb[2], connOpacity);
          p.line(conn.a[0], conn.a[1], conn.a[2], conn.b[0], conn.b[1], conn.b[2]);
        }

        if (borderOn) {
          borderProgress = (borderProgress + 0.05) % 1;
          const iw = gw - GAP;
          const ih = gh - GAP;
          const id = gd - GAP;
          const sc = 1 + 0.8 * borderProgress;
          const maxDim = Math.max(iw, ih, id);
          const t = 0.5 * (1 + Math.sin(elapsed * 6));
          p.push();
          p.noFill();
          p.stroke(activeRgb[0] * t, activeRgb[1] * t, activeRgb[2] * t);
          p.strokeWeight(borderWeight);
          if (borderShape === 0) {
            p.box(iw * sc, ih * sc, id * sc);
          } else if (borderShape === 1) {
            p.sphere(maxDim * 0.6 * sc);
          } else if (borderShape === 2) {
            p.push();
            p.scale(sc * 1.4, sc, sc * 0.7);
            p.sphere(maxDim * 0.5);
            p.pop();
          } else {
            // pyramid — base rectangle + 4 edges to an apex
            const hw = iw * sc * 0.5;
            const hh = ih * sc * 0.5;
            const hd = id * sc * 0.5;
            p.beginShape(p.LINES);
            p.vertex(-hw, hh, -hd); p.vertex(hw, hh, -hd);
            p.vertex(hw, hh, -hd); p.vertex(hw, hh, hd);
            p.vertex(hw, hh, hd); p.vertex(-hw, hh, hd);
            p.vertex(-hw, hh, hd); p.vertex(-hw, hh, -hd);
            p.vertex(0, -hh, 0); p.vertex(-hw, hh, -hd);
            p.vertex(0, -hh, 0); p.vertex(hw, hh, -hd);
            p.vertex(0, -hh, 0); p.vertex(hw, hh, hd);
            p.vertex(0, -hh, 0); p.vertex(-hw, hh, hd);
            p.endShape();
          }
          p.pop();
        }
        p.pop();

        idioms.renderGrid(ctx.ledOut, profile);
        idioms.renderArc(ctx.ledOut, profile);
      },
    };
  },
};
