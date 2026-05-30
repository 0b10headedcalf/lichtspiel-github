/**
 * gridWorld — adapted (not forked) from the PatternGridWorld lineage
 * (windchime-animation/.../PatternGridWorld_v11). Concept: a spatial field
 * of cells whose activation ripples across the grid, with connection lines
 * between active neighbors. Reads as "clip/session structure as a field".
 *
 * Param mapping:
 *   density    → grid resolution (cols × rows)
 *   motion     → wave propagation speed
 *   symmetry   → mirrored vs free-running activation field
 *   turbulence → noise jitter of cell positions
 *   cameraDepth→ cell size
 *   palette    → hue by activation; lineWeight → connection thickness
 */

import type { VisualTemplate } from '../visualTemplate.js';
import { paletteColor, useHsb } from './palette.js';

export const gridWorld: VisualTemplate = {
  id: 'gridWorld',
  name: 'Grid World',
  family: 'grid',
  description: 'A field of cells rippling with activation waves + neighbor connections.',
  tags: ['grid', 'structure', 'spatial', 'sequenced', 'rhythmic', 'pattern'],
  defaultParams: {
    density: 0.5,
    motion: 0.5,
    symmetry: 0.5,
    turbulence: 0.3,
    cameraDepth: 0.5,
    palette: 0.3,
    contrast: 0.6,
    lineWeight: 0.4,
  },
  renderer: 'p2d',
  sourceLineage: 'PatternGridWorld_v11.pde (concept-adapted)',
  create(ctx) {
    let cur = ctx.initialParams;
    let t = 0;
    const noiseSeed = ctx.rng.int(100000);

    return {
      setup(p) {
        p.createCanvas(ctx.width, ctx.height, p.P2D);
        useHsb(p);
        p.noiseSeed(noiseSeed);
      },
      update(params) {
        cur = params;
      },
      draw({ p, width, height, dt }) {
        t += dt * (0.2 + cur.motion * 2.0);

        p.noStroke();
        p.fill(0, 0, 7, 40 + (1 - cur.feedback) * 55);
        p.rect(0, 0, width, height);

        const cols = Math.round(5 + cur.density * 22);
        const rows = Math.max(3, Math.round(cols * (height / width)));
        const cw = width / cols;
        const ch = height / rows;
        const cell = Math.min(cw, ch);
        const jitter = cur.turbulence * cell * 0.45;
        const dotMax = cell * (0.18 + cur.cameraDepth * 0.5);

        // activation field — optionally mirrored for symmetry
        const act = (i: number, j: number): number => {
          const sx = cur.symmetry > 0.5 ? Math.min(i, cols - 1 - i) : i;
          const n = p.noise(sx * 0.35, j * 0.35, t * 0.5);
          const w = 0.5 + 0.5 * Math.sin(t * 1.5 - (sx + j) * 0.6);
          return p.constrain(n * 0.6 + w * 0.6, 0, 1);
        };

        const px = (i: number): number => cw * (i + 0.5);
        const py = (j: number): number => ch * (j + 0.5);
        const off = (i: number, j: number): number =>
          (p.noise(i * 0.5, j * 0.5, t * 0.3) - 0.5) * jitter;

        // connections
        p.strokeWeight(0.5 + cur.lineWeight * 3);
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows; j++) {
            const a = act(i, j);
            if (a < 0.45) continue;
            const x = px(i) + off(i, j);
            const y = py(j) + off(j, i);
            if (i + 1 < cols && act(i + 1, j) > 0.45) {
              const c = paletteColor(p, cur.palette, a, cur.contrast, 30 + a * 50);
              p.stroke(c);
              p.line(x, y, px(i + 1) + off(i + 1, j), y);
            }
            if (j + 1 < rows && act(i, j + 1) > 0.45) {
              const c = paletteColor(p, cur.palette, a, cur.contrast, 30 + a * 50);
              p.stroke(c);
              p.line(x, y, x, py(j + 1) + off(i, j + 1));
            }
          }
        }

        // nodes
        p.noStroke();
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows; j++) {
            const a = act(i, j);
            const x = px(i) + off(i, j);
            const y = py(j) + off(j, i);
            const c = paletteColor(p, cur.palette, a, cur.contrast, 40 + a * 60);
            p.fill(c);
            p.circle(x, y, dotMax * (0.25 + a * 0.95));
          }
        }

        if (cur.strobe > 0.02 && Math.sin(t * 30) > 1 - cur.strobe) {
          p.fill(0, 0, 100, 16 * cur.strobe);
          p.rect(0, 0, width, height);
        }
      },
    };
  },
};
