/**
 * patternGridWorld — adapted (not forked) from windchime-animation
 * packages/sketch-families/src/patternGridWorldV11 (a port of PatternGridWorld
 * v11). A 3D grid of cubes whose per-cell brightness picks the lit depth layer;
 * un-pressed cells flicker; random connection lines + an optional pulsing border.
 *
 * Lichtspiel rewiring: the per-sketch grid handling is replaced by the Part-2
 * `cellPaint` idiom (press cycles a cell 0→15 + freezes it; idle flicker via a
 * seeded RNG), and the arc by `arcMacros` (enc0 resting alpha, enc1 active alpha,
 * enc2 background, enc3 connection opacity; press randomises colours / toggles
 * the border). cellPaint reshapes on hot-swap, so the cube field is 8×16 on a
 * Grid 128 and clamps cleanly to 8×8 on a Grid 64 — the varibright/monobright
 * showcase. WEBGL, browser-resilient.
 */

import type p5 from 'p5';
import { type VisualParamVector, clamp01, lerp } from '@lichtspiel/schemas';
import type { MountContext, VisualTemplate } from '../visualTemplate.js';
import {
  type CellPaint,
  type ComposedIdiom,
  type IdiomProfile,
  type ArcMacros,
  composeIdioms,
  createArcMacros,
  createCellPaint,
  profileFromSetup,
} from '../idioms/index.js';
import { cfg, makeVariantFactory } from '../mutations/familyVariants.js';

interface ColorPair {
  resting: [number, number, number];
  active: [number, number, number];
}
const PALETTES: Record<string, ColorPair> = {
  electric: { resting: [20, 70, 170], active: [120, 220, 255] },
  biolume: { resting: [18, 120, 90], active: [150, 255, 205] },
  rainbow: { resting: [150, 60, 180], active: [255, 210, 90] },
  monochrome: { resting: [110, 110, 125], active: [240, 240, 250] },
  fire: { resting: [140, 40, 12], active: [255, 180, 60] },
  ice: { resting: [60, 110, 160], active: [205, 240, 255] },
};

const variants = makeVariantFactory({
  palette: { canonical: 'electric', options: ['electric', 'biolume', 'rainbow', 'monochrome', 'fire', 'ice'] },
  connections: { canonical: 'medium', options: ['sparse', 'medium', 'dense', 'swarm'] },
  depth: { canonical: 4, options: [4, 6, 8] },
  rotation: { canonical: 'isometric', options: ['isometric', 'rotating', 'top-down', 'flat'] },
  flicker: { canonical: 'fast', options: ['fast', 'medium', 'slow', 'static'] },
  cube: { canonical: 'solid', options: ['solid', 'wireframe', 'edge-only', 'shell'] },
});

function flickerMsFor(mode: string): number {
  return mode === 'fast' ? 60 : mode === 'medium' ? 160 : mode === 'slow' ? 500 : Infinity;
}
function connRateFor(mode: string): { samples: number; prob: number } {
  if (mode === 'sparse') return { samples: 1, prob: 0.02 };
  if (mode === 'dense') return { samples: 3, prob: 0.12 };
  if (mode === 'swarm') return { samples: 5, prob: 0.2 };
  return { samples: 2, prob: 0.06 }; // medium
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
    'A 3D cube field painted cell-by-cell, flickering and wired with connection lines. The varibright vs monobright showcase.',
  tags: ['grid', 'cubes', '3d', 'neural', 'flicker', 'paint', 'monome', 'cellular'],
  defaultParams: { density: 0.6, motion: 0.4, turbulence: 0.5, contrast: 0.6, palette: 0.2 },
  renderer: 'webgl',
  sourceLineage: 'windchime patternGridWorldV11 (PatternGridWorld_v11.pde)',
  hardwareTarget: { grid: '128', arc: '4' },
  idioms: ['cellPaint', 'arcMacros'],
  variants,

  create(ctx: MountContext) {
    const paletteName = cfg<string>(ctx.config, 'palette', 'electric');
    const depth = cfg<number>(ctx.config, 'depth', 4);
    const rotation = cfg<string>(ctx.config, 'rotation', 'isometric');
    const flickerMode = cfg<string>(ctx.config, 'flicker', 'fast');
    const cubeStyle = cfg<string>(ctx.config, 'cube', 'solid');
    const connRate = connRateFor(cfg<string>(ctx.config, 'connections', 'medium'));
    const flickMs = flickerMsFor(flickerMode);

    let profile: IdiomProfile = profileFromSetup(ctx.setup);
    const paint: CellPaint = createCellPaint({
      levels: 16,
      flicker: Number.isFinite(flickMs),
      flickerMs: Number.isFinite(flickMs) ? flickMs : 1000,
      flickerDensity: 0.4,
      rng: () => ctx.rng.random(),
    });
    const arc: ArcMacros = createArcMacros({
      encoders: [
        { name: 'restAlpha', initial: 0.5, led: 'fill', onPress: () => randomizeColor('resting') },
        { name: 'actAlpha', initial: 0.7, led: 'fill', onPress: () => randomizeColor('active') },
        { name: 'bg', initial: 0.5, led: 'fill', onPress: () => toggleBorder() },
        { name: 'conn', initial: 0.6, led: 'fill' },
      ],
    });
    const idioms: ComposedIdiom = composeIdioms([paint, arc]);
    idioms.setProfile(profile);

    const base = PALETTES[paletteName] ?? (PALETTES.electric as ColorPair);
    let resting: [number, number, number] = [...base.resting];
    let active: [number, number, number] = [...base.active];
    let bgBase: [number, number, number] = [0, 0, 0];
    let borderOn = false;
    let borderShape = 0;
    let borderWeight = 8;
    let borderProgress = 0;
    const connections: Connection[] = [];
    let elapsed = 0;
    let cur: VisualParamVector = ctx.initialParams;

    function randomizeColor(which: 'resting' | 'active'): void {
      const c: [number, number, number] = [60 + ctx.rng.int(196), 60 + ctx.rng.int(196), 60 + ctx.rng.int(196)];
      if (which === 'resting') resting = c;
      else active = c;
    }
    function toggleBorder(): void {
      bgBase = [ctx.rng.int(40), ctx.rng.int(40), ctx.rng.int(48)];
      borderOn = !borderOn;
      if (borderOn) {
        borderProgress = 0;
        borderShape = ctx.rng.int(4);
        borderWeight = ctx.rng.range(4, 28);
      }
    }

    const CUBE = 30;
    const GAP = 8;
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
        elapsed += dt;
        paint.tick(dt * 1000); // advance idle flicker

        const av = arc.values();
        const restA = Math.floor(lerp(20, 200, av.restAlpha ?? 0.5));
        const actA = Math.floor(lerp(120, 255, av.actAlpha ?? 0.7));
        const bgB = lerp(0.2, 1, av.bg ?? 0.5);
        const connOpacity = Math.floor(lerp(0, 255, av.conn ?? 0.6));

        p.background(bgBase[0] * bgB, bgBase[1] * bgB, bgBase[2] * bgB);
        p.ambientLight(60);
        p.directionalLight(255, 255, 255, 0.3, 0.5, -1);

        // fit the cube field to the viewport
        const cells = paint.values().cells;
        const rows = cells.length;
        const cols = cells[0]?.length ?? 0;
        const fieldW = cols * (CUBE + GAP);
        const scale = Math.min(width, height) / (fieldW * 1.6 || 1);

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

        // cube field — brightness picks the active depth layer
        for (let row = 0; row < rows; row++) {
          const rowCells = cells[row];
          if (!rowCells) continue;
          for (let col = 0; col < cols; col++) {
            const norm = clamp01(rowCells[col] ?? 0);
            const litLevel = Math.floor(norm * (depth - 1));
            for (let lvl = 0; lvl < depth; lvl++) {
              const isActive = lvl === litLevel && norm > 0;
              if (cubeStyle === 'shell' && !isActive && lvl !== 0 && lvl !== depth - 1) continue;
              if (cubeStyle === 'edge-only' && !isActive) continue;
              const [x, y, z] = cellPos(col, row, lvl, cols, rows);
              const c = isActive ? active : resting;
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

        // connection lines (born, fade after 5s)
        const want = connRate.samples;
        const total = rows * cols * depth;
        for (let s = 0; s < want; s++) {
          if (ctx.rng.random() < connRate.prob * (0.4 + cur.density)) {
            const pick = (): [number, number, number] => {
              const idx = ctx.rng.int(Math.max(1, total));
              const r = Math.floor(idx / (cols * depth));
              const rem = idx - r * cols * depth;
              const c = Math.floor(rem / depth);
              const l = rem % depth;
              return cellPos(c, Math.min(rows - 1, r), l, cols, rows);
            };
            connections.push({ a: pick(), b: pick(), born: elapsed });
          }
        }
        p.strokeWeight(2);
        for (let i = connections.length - 1; i >= 0; i--) {
          const conn = connections[i];
          if (!conn || elapsed - conn.born > 5) {
            connections.splice(i, 1);
            continue;
          }
          p.stroke(active[0], active[1], active[2], connOpacity);
          p.line(conn.a[0], conn.a[1], conn.a[2], conn.b[0], conn.b[1], conn.b[2]);
        }

        if (borderOn) drawBorder(p, cols, rows);
        p.pop();

        idioms.renderGrid(ctx.ledOut, profile);
        idioms.renderArc(ctx.ledOut, profile);
      },
    };

    function drawBorder(p: p5, cols: number, rows: number): void {
      borderProgress += 0.05;
      if (borderProgress > 1) borderProgress = 0;
      const iw = cols * (CUBE + GAP) - GAP;
      const ih = rows * (CUBE + GAP) - GAP;
      const id = depth * (CUBE + GAP) - GAP;
      const s = 1 + 0.8 * borderProgress;
      const maxDim = Math.max(iw, ih, id);
      const t = 0.5 * (1 + Math.sin(elapsed * 6));
      p.push();
      p.noFill();
      p.stroke(active[0] * t, active[1] * t, active[2] * t);
      p.strokeWeight(borderWeight);
      if (borderShape === 0) p.box(iw * s, ih * s, id * s);
      else if (borderShape === 1) p.sphere(maxDim * 0.6 * s);
      else if (borderShape === 2) {
        p.push();
        p.scale(s * 1.4, s, s * 0.7);
        p.sphere(maxDim * 0.5);
        p.pop();
      } else {
        p.box(iw * s, ih * s * 1.3, id * s); // stand-in pyramid prism
      }
      p.pop();
    }
  },
};
