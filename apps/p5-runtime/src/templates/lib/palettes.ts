/**
 * HSL→RGB + palette-mode builders — faithful ports of the windchime
 * sketch-family palette helpers (source: pasArcgridv7/params.ts etc.). Shared
 * across the fader-bank templates. Fresh Lichtspiel code; uses Lichtspiel's
 * SeededRng so palettes are reproducible per variant seed.
 */

import type { SeededRng } from '../../seededRng.js';

export type Rgb = [number, number, number];

/** HSL (h 0..360, s/l 0..1) → 0..255 RGB. */
export function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export type FaderPaletteMode = 'random' | 'warm' | 'cool' | 'monochrome' | 'neon';

/** The windchime fader-family palette: `mode` → 4 RGB tuples (one per object). */
export function palette4(mode: FaderPaletteMode, rng: SeededRng): Rgb[] {
  const out: Rgb[] = [];
  switch (mode) {
    case 'warm':
      for (let i = 0; i < 4; i++) out.push(hslToRgb(rng.range(0, 60), rng.range(0.7, 1), rng.range(0.5, 0.7)));
      break;
    case 'cool':
      for (let i = 0; i < 4; i++) out.push(hslToRgb(rng.range(180, 270), rng.range(0.6, 1), rng.range(0.5, 0.7)));
      break;
    case 'monochrome': {
      const hue = rng.range(0, 360);
      for (let i = 0; i < 4; i++) out.push(hslToRgb(hue, rng.range(0.5, 0.9), rng.range(0.4, 0.75)));
      break;
    }
    case 'neon': {
      const hues = [330, 280, 195, 60]; // hot pink / purple / cyan / yellow
      for (let i = 0; i < 4; i++) out.push(hslToRgb(hues[i] ?? 0, 1, 0.6));
      break;
    }
    case 'random':
    default:
      for (let i = 0; i < 4; i++) out.push([rng.int(256), rng.int(256), rng.int(256)]);
  }
  return out;
}
