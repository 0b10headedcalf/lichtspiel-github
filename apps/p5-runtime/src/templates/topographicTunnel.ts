/**
 * topographicTunnel — adapted (not forked) from the UPF_AV_Test lineage
 * (windchime-animation/processing_corpus_test1/UPF_AV_Testv14). Concept:
 * an infinite forward-scrolling tunnel of noise-displaced concentric rings
 * with a topographic/contour wobble. Good for rhythmic forward motion + depth.
 *
 * Param mapping:
 *   motion + cameraDepth → scroll speed / depth pull
 *   density              → ring count + vertices per ring
 *   turbulence           → topographic noise displacement
 *   symmetry             → radial regularity vs wobble
 *   rotationZ            → slow tunnel roll
 *   palette/contrast     → hue + tonal spread
 */

import type { VisualTemplate } from '../visualTemplate.js';
import { paletteColor, useHsb } from './palette.js';

export const topographicTunnel: VisualTemplate = {
  id: 'topographicTunnel',
  name: 'Topographic Tunnel',
  family: 'tunnel',
  description: 'Infinite forward tunnel of noise-displaced contour rings. Rhythmic, deep.',
  tags: ['tunnel', 'depth', 'forward', 'rhythmic', 'percussive', 'topographic', 'fast'],
  defaultParams: {
    density: 0.6,
    motion: 0.6,
    turbulence: 0.4,
    cameraDepth: 0.6,
    palette: 0.62,
    contrast: 0.55,
    lineWeight: 0.4,
  },
  renderer: 'p2d',
  sourceLineage: 'UPF_AV_Testv14.pde (concept-adapted)',
  create(ctx) {
    let cur = ctx.initialParams;
    let scroll = 0;
    let roll = 0;
    const noiseSeed = ctx.rng.int(100000);

    return {
      setup(p) {
        p.createCanvas(ctx.width, ctx.height, p.P2D);
        useHsb(p);
        p.noiseSeed(noiseSeed);
        p.noFill();
      },
      update(params) {
        cur = params;
      },
      draw({ p, width, height, dt }) {
        const speed = 0.06 + cur.motion * 0.9 + cur.cameraDepth * 0.4;
        scroll += dt * speed;
        roll += dt * (cur.rotationZ - 0.5) * 1.6;

        // gentle trail so the tunnel reads as continuous motion
        p.noStroke();
        p.fill(0, 0, 5, 20 + (1 - cur.feedback) * 55);
        p.rect(0, 0, width, height);

        const cx = width / 2;
        const cy = height / 2;
        const maxR = Math.hypot(width, height) * 0.62;
        const rings = Math.round(14 + cur.density * 22);
        const verts = Math.round(24 + cur.density * 64);
        const wobble = cur.turbulence * (1 - cur.symmetry * 0.7);
        const t = scroll;

        p.push();
        p.translate(cx, cy);
        p.rotate(roll);
        p.strokeWeight(0.6 + cur.lineWeight * 4);
        p.noFill(); // critical: rings are stroked outlines, never filled

        for (let i = 0; i < rings; i++) {
          // depth phase in (0,1]; near rings (→1) are large + bright
          const phase = ((i / rings + (t % 1)) % 1 + 1) % 1;
          const depth = Math.pow(phase, 1.45);
          const baseR = maxR * depth;
          if (baseR < 2) continue;

          const bright = 32 + depth * 68;
          const c = paletteColor(p, cur.palette, phase, cur.contrast, bright);
          p.stroke(c);
          p.beginShape();
          for (let v = 0; v <= verts; v++) {
            const a = (v / verts) * Math.PI * 2;
            const nz = p.noise(
              Math.cos(a) * 0.8 + 10,
              Math.sin(a) * 0.8 + 10,
              i * 0.18 + t * 0.5,
            );
            const disp = 1 + (nz - 0.5) * 2 * wobble * 0.6;
            const r = baseR * disp;
            p.vertex(Math.cos(a) * r, Math.sin(a) * r);
          }
          p.endShape(p.CLOSE);
        }
        p.pop();

        if (cur.strobe > 0.02 && Math.sin(t * 40) > 1 - cur.strobe) {
          p.noStroke();
          p.fill(0, 0, 100, 18 * cur.strobe);
          p.rect(0, 0, width, height);
        }
      },
    };
  },
};
