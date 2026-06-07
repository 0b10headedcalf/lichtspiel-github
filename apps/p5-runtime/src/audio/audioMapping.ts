/**
 * audioMapping — the creative core that turns AudioFeatures into distortion
 * uniforms. This is what makes audio a *different axis* from the monome: the
 * monome sets the VisualParamVector (a scene's content); these uniforms warp the
 * already-rendered pixels. Each style weights the audio bands toward different
 * effects, all scaled by a master `amount` (0 → clean passthrough).
 */

import type { AudioFeatures } from '@lichtspiel/schemas';

export interface DistortionUniforms {
  /** Radial bulge / pinch from overall level. */
  bulge: number;
  /** Large traveling sine-field displacement (bass). */
  warp: number;
  /** Fine turbulent ripple (mid). */
  ripple: number;
  /** Chromatic aberration / RGB split (treble). */
  chroma: number;
  /** Block / datamosh slice glitch (flux). */
  glitch: number;
  /** Horizontal RGB tear kick (beat). */
  shift: number;
  /** Per-band vertical slice desync (beat / bass). */
  desync: number;
  /** Feedback echo / trail amount (samples the previous output frame). */
  feedback: number;
  /** Scanline + vignette CRT veil. */
  scan: number;
  /** Hue rotation (centroid / brightness). */
  hue: number;
  /** Brightness lift on beats. */
  bloom: number;
  /** Kaleidoscope fold strength (0 → off). */
  kaleido: number;
}

export const ZERO_UNIFORMS: DistortionUniforms = Object.freeze({
  bulge: 0,
  warp: 0,
  ripple: 0,
  chroma: 0,
  glitch: 0,
  shift: 0,
  desync: 0,
  feedback: 0,
  scan: 0,
  hue: 0,
  bloom: 0,
  kaleido: 0,
});

export const DISTORTION_STYLES = ['liquid', 'glitch', 'chroma', 'kaleido', 'vhs', 'echo'] as const;
export type DistortionStyle = (typeof DISTORTION_STYLES)[number];

export const STYLE_LABELS: Record<DistortionStyle, string> = {
  liquid: 'Liquid warp',
  glitch: 'Datamosh glitch',
  chroma: 'Chroma bloom',
  kaleido: 'Kaleidoscope',
  vhs: 'VHS / CRT',
  echo: 'Feedback echo',
};

/**
 * Map the live audio features → distortion uniforms for a given style and master
 * amount. Pure function of its inputs (no internal state), so it's trivial to
 * test and reason about.
 */
export function mapFeaturesToUniforms(
  f: AudioFeatures,
  amount: number,
  style: DistortionStyle,
): DistortionUniforms {
  const a = Math.max(0, amount);
  const { level, bass, mid, treble, beat, flux, centroid: bright } = f;
  const u: DistortionUniforms = { ...ZERO_UNIFORMS };

  switch (style) {
    case 'liquid':
      u.bulge = a * (0.18 * level + 0.5 * bass);
      u.warp = a * (0.6 * bass + 0.2 * level);
      u.ripple = a * (0.5 * mid + 0.15);
      u.chroma = a * (0.25 * treble + 0.1 * beat);
      u.hue = a * 0.3 * bright;
      u.feedback = a * 0.25 * level;
      break;
    case 'glitch':
      u.glitch = a * (0.5 * flux + 0.7 * beat);
      u.shift = a * (0.6 * beat + 0.2 * treble);
      u.desync = a * (0.5 * beat + 0.3 * bass);
      u.chroma = a * (0.4 * treble + 0.3 * beat);
      u.warp = a * 0.2 * bass;
      u.scan = a * 0.15;
      break;
    case 'chroma':
      u.chroma = a * (0.7 * treble + 0.4 * level + 0.3 * beat);
      u.bloom = a * (0.6 * beat + 0.3 * level);
      u.hue = a * (0.5 * bright + 0.2 * level);
      u.ripple = a * 0.25 * mid;
      u.bulge = a * 0.15 * bass;
      break;
    case 'kaleido':
      u.kaleido = a * (0.4 + 0.6 * level);
      u.warp = a * 0.4 * bass;
      u.hue = a * (0.5 * bright + 0.3 * beat);
      u.ripple = a * 0.4 * mid;
      u.chroma = a * 0.2 * treble;
      u.bulge = a * 0.25 * bass;
      break;
    case 'vhs':
      u.scan = a * (0.5 + 0.4 * level);
      u.desync = a * (0.4 * beat + 0.5 * bass);
      u.shift = a * (0.4 * beat + 0.2 * mid);
      u.chroma = a * (0.4 + 0.3 * treble);
      u.warp = a * 0.2 * bass;
      u.hue = a * 0.1 * bright;
      break;
    case 'echo':
      u.feedback = a * (0.4 + 0.5 * level);
      u.warp = a * 0.5 * bass;
      u.bulge = a * (0.2 * beat + 0.2 * level);
      u.ripple = a * 0.3 * mid;
      u.chroma = a * 0.2 * treble;
      u.hue = a * 0.4 * bright;
      break;
  }
  return u;
}
