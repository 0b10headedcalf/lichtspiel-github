/**
 * minimalPulse — new, simple, low-CPU fallback scene. Concentric rings
 * breathing from the center. Reliable for demos when everything else is
 * uncertain. No external lineage; this is the safe default scene.
 */

import type { VisualTemplate } from '../visualTemplate.js';
import { paletteColor, useHsb } from './palette.js';

export const minimalPulse: VisualTemplate = {
  id: 'minimalPulse',
  name: 'Minimal Pulse',
  family: 'pulse',
  description: 'Concentric rings breathing from the center. Low-CPU demo fallback.',
  tags: ['minimal', 'calm', 'fallback', 'ambient', 'sparse'],
  defaultParams: { density: 0.45, motion: 0.4, contrast: 0.5, lineWeight: 0.45, palette: 0.55 },
  renderer: 'p2d',
  sourceLineage: 'original',
  create(ctx) {
    let cur = ctx.initialParams;
    let phase = 0;

    return {
      setup(p) {
        p.createCanvas(ctx.width, ctx.height, p.P2D);
        useHsb(p);
        p.noFill();
      },
      update(params) {
        cur = params;
      },
      draw({ p, width, height, dt }) {
        phase += dt * (0.2 + cur.motion * 2.2);

        // feedback → trailing; otherwise clean wipe
        const fade = 12 + (1 - cur.feedback) * 88;
        p.noStroke();
        p.fill(0, 0, 6, fade);
        p.rect(0, 0, width, height);

        const cx = width / 2;
        const cy = height / 2;
        const maxR = Math.hypot(width, height) / 2;
        const rings = Math.round(3 + cur.density * 13);
        p.strokeWeight(0.5 + cur.lineWeight * 6);
        p.noFill();

        for (let i = 0; i < rings; i++) {
          const f = i / rings;
          const pulse = 0.5 + 0.5 * Math.sin(phase - f * 6.28 * (0.5 + cur.symmetry));
          const r = maxR * (0.06 + f * 0.95) * (0.85 + 0.15 * pulse);
          const c = paletteColor(p, cur.palette, f, cur.contrast, 35 + pulse * 65);
          p.stroke(c);
          p.circle(cx, cy, r * 2);
        }

        // strobe flash
        if (cur.strobe > 0.02 && Math.sin(phase * 9) > 1 - cur.strobe) {
          p.noStroke();
          p.fill(0, 0, 100, 22 * cur.strobe);
          p.rect(0, 0, width, height);
        }
      },
    };
  },
};
