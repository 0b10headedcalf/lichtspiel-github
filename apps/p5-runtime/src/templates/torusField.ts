/**
 * torusField — adapted (not forked) from the arc-controlled 3D object lineage
 * (windchime-animation/.../monomearc4shapescontrolv12). Concept: a field of
 * rotating wireframe tori/spheres in WEBGL. Good for sustained, harmonic, or
 * slowly evolving material.
 *
 * Param mapping:
 *   rotationX/Y/Z → orientation (offset from 0.5 = spin direction/rate)
 *   motion        → global spin speed
 *   density       → orbiting object count + mesh detail
 *   cameraDepth   → camera distance
 *   turbulence    → per-object scale wobble
 *   palette/contrast/lineWeight → wireframe hue + weight
 *
 * Audio (ctx.getAudio): level → spin, beat → orbiter count, bass → wobble,
 * treble → stroke weight — a no-op when silent.
 */

import type p5 from 'p5';
import type { VisualTemplate } from '../visualTemplate.js';
import { paletteColor, useHsb } from './palette.js';

type ShapeKind = 'torus' | 'sphere' | 'wavy';

interface Orbiter {
  angle: number;
  radius: number;
  size: number;
  kind: ShapeKind;
  hueT: number;
  speed: number;
}

export const torusField: VisualTemplate = {
  id: 'torusField',
  name: 'Torus Field',
  family: 'objects3d',
  description: 'Rotating wireframe tori + spheres in 3D. Sustained, harmonic, evolving.',
  tags: ['3d', 'torus', 'harmonic', 'sustained', 'slow', 'evolving', 'pad', 'wireframe'],
  defaultParams: {
    density: 0.45,
    motion: 0.4,
    turbulence: 0.25,
    cameraDepth: 0.5,
    rotationX: 0.55,
    rotationY: 0.5,
    rotationZ: 0.5,
    palette: 0.7,
    contrast: 0.6,
    lineWeight: 0.35,
  },
  renderer: 'webgl',
  sourceLineage: 'monomearc4shapescontrolv12.pde (concept-adapted)',
  create(ctx) {
    let cur = ctx.initialParams;
    let rx = 0;
    let ry = 0;
    let rz = 0;
    const rng = ctx.rng;
    const orbiters: Orbiter[] = [];
    const kinds: ShapeKind[] = ['torus', 'sphere', 'wavy'];
    for (let i = 0; i < 20; i++) {
      orbiters.push({
        angle: rng.range(Math.PI * 2),
        radius: rng.range(0.4, 1),
        size: rng.range(0.5, 1),
        kind: rng.pick(kinds),
        hueT: rng.random(),
        speed: rng.range(-1, 1),
      });
    }

    const wavyTorus = (p: p5, r: number, tube: number, wob: number): void => {
      const segs = 36;
      const rings = 14;
      for (let i = 0; i < rings; i++) {
        // open polyline ring (p5 beginShape() with no kind = connected vertices)
        p.beginShape();
        const v = (i / rings) * Math.PI * 2;
        for (let j = 0; j <= segs; j++) {
          const u = (j / segs) * Math.PI * 2;
          const tw = tube * (1 + wob * Math.sin(u * 5 + v * 3));
          const x = (r + tw * Math.cos(v)) * Math.cos(u);
          const y = (r + tw * Math.cos(v)) * Math.sin(u);
          const z = tw * Math.sin(v);
          p.vertex(x, y, z);
        }
        p.endShape();
      }
    };

    return {
      setup(p) {
        p.createCanvas(ctx.width, ctx.height, p.WEBGL);
        useHsb(p);
        p.noFill();
        p.strokeWeight(1);
      },
      update(params) {
        cur = params;
      },
      draw({ p, dt }) {
        const au = ctx.getAudio();
        const spin = 0.1 + cur.motion * 1.4 + au.level * 1.2;
        rx += dt * (cur.rotationX - 0.5) * 2 * spin;
        ry += dt * (cur.rotationY - 0.5) * 2 * spin + dt * spin * 0.3;
        rz += dt * (cur.rotationZ - 0.5) * 2 * spin;

        p.background(0, 0, 6);
        const baseR = Math.min(p.width, p.height);
        // camera pull: smaller cameraDepth = closer
        const camZ = baseR * (0.2 + (1 - cur.cameraDepth) * 0.9);
        p.push();
        p.translate(0, 0, camZ - baseR * 0.6);
        p.rotateX(rx);
        p.rotateY(ry);
        p.rotateZ(rz);
        p.strokeWeight(0.5 + cur.lineWeight * 2.5 + au.treble * 1.5);

        // central object
        const c0 = paletteColor(p, cur.palette, 0.5, cur.contrast, 90);
        p.stroke(c0);
        const cr = baseR * 0.16;
        wavyTorus(p, cr, cr * 0.42, cur.turbulence * 0.8);

        // orbiting field
        const count = Math.min(orbiters.length, Math.round(4 + cur.density * 12 + au.beat * 4));
        const wob = 1 + cur.turbulence * 0.8 + au.bass * 0.6;
        for (let i = 0; i < count; i++) {
          const o = orbiters[i] as Orbiter;
          const a = o.angle + rz * o.speed * 0.5;
          const orbit = baseR * (0.28 + o.radius * 0.42);
          const x = Math.cos(a) * orbit;
          const y = Math.sin(a) * orbit;
          const z = Math.sin(a * 2 + o.hueT * 6.28) * orbit * 0.4;
          const s = baseR * 0.05 * o.size * wob;
          const c = paletteColor(p, cur.palette, o.hueT, cur.contrast, 70);
          p.stroke(c);
          p.push();
          p.translate(x, y, z);
          p.rotateY(rx * o.speed + o.angle);
          p.rotateX(ry * o.speed);
          if (o.kind === 'torus') p.torus(s, s * 0.4, 18, 8);
          else if (o.kind === 'sphere') p.sphere(s, 12, 8);
          else wavyTorus(p, s, s * 0.45, cur.turbulence);
          p.pop();
        }
        p.pop();

        if (cur.strobe > 0.02 && Math.sin(p.frameCount * cur.strobe) > 1 - cur.strobe) {
          p.push();
          p.resetMatrix();
          p.fill(0, 0, 100, 30 * cur.strobe);
          p.noStroke();
          p.translate(-p.width / 2, -p.height / 2);
          p.rect(0, 0, p.width, p.height);
          p.pop();
        }
      },
    };
  },
};
