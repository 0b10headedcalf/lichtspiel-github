/**
 * parquetGlitch — adapted (not forked) from the Parquet_Deformation /
 * Parquet_v3_glitch lineage. Concept: a Hofstadter-style parquet deformation
 * (a grid of square tiles whose rotation + scale drift smoothly across space
 * and time) fractured by horizontal glitch slices. Good for dense/fragmented
 * clips.
 *
 * Param mapping:
 *   density    → tile resolution
 *   motion     → deformation drift speed
 *   turbulence → glitch slice intensity
 *   strobe     → channel-offset glitch bursts
 *   symmetry   → coherent vs chaotic rotation gradient
 *   palette/contrast/lineWeight → stroke color + weight
 *
 * Audio (ctx.getAudio): level → drift speed, beat → extra glitch slices, flux →
 * slice displacement — a no-op when silent.
 */

import type { VisualTemplate } from '../visualTemplate.js';
import { paletteColor, useHsb } from './palette.js';

export const parquetGlitch: VisualTemplate = {
  id: 'parquetGlitch',
  name: 'Parquet Glitch',
  family: 'parquet',
  description: 'Parquet deformation of rotating tiles, fractured by glitch slices.',
  tags: ['glitch', 'dense', 'fragmented', 'geometric', 'tiles', 'broken', 'digital'],
  defaultParams: {
    density: 0.55,
    motion: 0.45,
    turbulence: 0.4,
    strobe: 0.15,
    symmetry: 0.5,
    palette: 0.08,
    contrast: 0.7,
    lineWeight: 0.45,
  },
  renderer: 'p2d',
  sourceLineage: 'Parquet_v3_glitch.pde (concept-adapted)',
  create(ctx) {
    let cur = ctx.initialParams;
    let t = 0;
    const rng = ctx.rng;

    return {
      setup(p) {
        p.createCanvas(ctx.width, ctx.height, p.P2D);
        useHsb(p);
        p.rectMode(p.CENTER);
        p.noFill();
      },
      update(params) {
        cur = params;
      },
      draw({ p, width, height, dt }) {
        const au = ctx.getAudio();
        t += dt * (0.15 + cur.motion * 1.4 + au.level * 0.8);

        p.noStroke();
        p.fill(0, 0, 6, 55 + (1 - cur.feedback) * 45);
        p.rectMode(p.CORNER);
        p.rect(0, 0, width, height);
        p.rectMode(p.CENTER);

        const cols = Math.round(6 + cur.density * 22);
        const tile = width / cols;
        const rows = Math.ceil(height / tile) + 1;
        const chaos = (1 - cur.symmetry) * 1.2;

        p.strokeWeight(0.5 + cur.lineWeight * 3);
        p.noFill();

        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const u = i / cols;
            const v = j / rows;
            // rotation gradient: smooth across space, drifting in time
            const ang =
              u * Math.PI * (0.5 + chaos * 2) +
              v * Math.PI * (0.3 + chaos) +
              t * (0.4 + chaos) +
              Math.sin((u + v) * 6.28 + t) * chaos;
            const scl = 0.55 + 0.4 * Math.sin(t * 0.7 + (u - v) * 6.28);
            const c = paletteColor(p, cur.palette, (u + v) * 0.5, cur.contrast, 55 + scl * 45);
            p.stroke(c);
            p.push();
            p.translate(tile * (i + 0.5), tile * (j + 0.5));
            p.rotate(ang);
            const s = tile * scl;
            p.rect(0, 0, s, s);
            if (cur.density > 0.5) p.rect(0, 0, s * 0.5, s * 0.5);
            p.pop();
          }
        }

        // horizontal glitch slices
        const slices = Math.round(cur.turbulence * 14 + au.beat * 10);
        for (let s = 0; s < slices; s++) {
          if (rng.random() > 0.5) continue;
          const sy = rng.int(height);
          const sh = 2 + rng.int(Math.max(3, Math.round(height * 0.06)));
          const dx = (rng.random() * 2 - 1) * width * 0.08 * (0.4 + cur.turbulence + au.flux * 0.5);
          const region = p.get(0, sy, width, sh);
          p.image(region, dx, sy);
        }

        // strobe channel-offset burst
        if (cur.strobe > 0.02 && Math.sin(t * 33) > 1 - cur.strobe) {
          const region = p.get();
          p.tint(0, 100, 100, 40);
          p.image(region, 6 * cur.strobe, 0);
          p.tint(160, 100, 100, 40);
          p.image(region, -6 * cur.strobe, 0);
          p.noTint();
        }
      },
    };
  },
};
