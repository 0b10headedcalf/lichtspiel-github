/**
 * Parametric 3D shapes — faithful ports of the windchime sketch-family geometry
 * helpers (source: windchime-animation pasArcgridv7/index.ts, reused by
 * upfAvTest / monomeArc4Shapes / itoBox). Each emits geometry into the current
 * p5 WEBGL matrix; the caller sets stroke/fill + transforms. Fresh Lichtspiel
 * code, no windchime dependency.
 */

import type p5 from 'p5';

/** Icosahedron — 20 triangular faces from golden-ratio vertices. */
export function icosahedron(p: p5, r: number): void {
  const t = (1 + Math.sqrt(5)) / 2;
  const v: Array<[number, number, number]> = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const faces: number[][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  p.push();
  p.scale(r);
  p.beginShape(p.TRIANGLES);
  for (const face of faces) {
    for (const vi of face) {
      const vert = v[vi];
      if (vert) p.vertex(vert[0], vert[1], vert[2]);
    }
  }
  p.endShape();
  p.pop();
}

/** Helix — parametric spiral of `coils` turns. */
export function helix(p: p5, radius: number, coils: number): void {
  const angleStep = Math.PI / 15;
  const heightStep = radius / coils;
  p.beginShape();
  for (let angle = 0; angle < Math.PI * 2 * coils; angle += angleStep) {
    p.vertex(radius * Math.cos(angle), radius * Math.sin(angle), angle * heightStep);
  }
  p.endShape();
}

/** Möbius strip — parametric triangle strip. */
export function mobius(p: p5, size: number): void {
  const width = size / 5;
  p.beginShape(p.TRIANGLE_STRIP);
  for (let vv = -Math.PI; vv < Math.PI; vv += 0.05) {
    for (let side = -1; side <= 1; side += 2) {
      const u = vv * side;
      p.vertex(
        size * Math.cos(u) * (1 + 0.5 * Math.cos(vv)),
        size * Math.sin(u) * (1 + 0.5 * Math.cos(vv)),
        width * Math.sin(vv),
      );
    }
  }
  p.endShape();
}

/** Custom torus — TRIANGLE_STRIP rings (distinct topology from p5's built-in). */
export function customTorus(p: p5, r: number, tube: number): void {
  const res = 24;
  for (let i = 0; i < res; i++) {
    const theta = (Math.PI * 2 * i) / res;
    const nextTheta = (Math.PI * 2 * (i + 1)) / res;
    p.beginShape(p.TRIANGLE_STRIP);
    for (let j = 0; j <= res; j++) {
      const phi = (Math.PI * 2 * j) / res;
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      p.vertex((r + tube * cp) * Math.cos(theta), (r + tube * cp) * Math.sin(theta), tube * sp);
      p.vertex((r + tube * cp) * Math.cos(nextTheta), (r + tube * cp) * Math.sin(nextTheta), tube * sp);
    }
    p.endShape();
  }
}

/** The 5 shape types pasArcgrid/upfAvTest cycle through. */
export const SHAPE_TYPE_COUNT = 5;

/** Emit shape `type` (0 icosa · 1 sphere · 2 torus · 3 helix · 4 möbius) at `size`. */
export function shapeByType(p: p5, type: number, size: number): void {
  switch (type) {
    case 0:
      icosahedron(p, size / 2);
      break;
    case 1:
      p.sphere(size / 2);
      break;
    case 2:
      customTorus(p, size / 4, size / 8);
      break;
    case 3:
      helix(p, size / 2, 10);
      break;
    case 4:
      mobius(p, size / 3);
      break;
    default:
      p.sphere(size / 2);
  }
}
