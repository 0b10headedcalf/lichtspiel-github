/**
 * Shared color helpers. Templates run in HSB so the `palette` param maps
 * cleanly to hue and `contrast` to saturation/brightness spread.
 */

import type p5 from 'p5';

/** Put a p5 instance into the standard Lichtspiel HSB mode (360/100/100/100). */
export function useHsb(p: p5): void {
  p.colorMode(p.HSB, 360, 100, 100, 100);
}

/** Base hue 0..360 for a normalized palette param. */
export function baseHue(palette: number): number {
  return (palette * 360) % 360;
}

/**
 * A color along the active palette. `t` (0..1) walks the scheme; `palette`
 * picks the scheme's hue center; `contrast` widens the hue spread + lifts
 * brightness contrast. Returns a p5.Color in the instance's HSB space.
 */
export function paletteColor(
  p: p5,
  palette: number,
  t: number,
  contrast: number,
  alpha = 100,
): p5.Color {
  const center = baseHue(palette);
  const spread = 40 + contrast * 200; // analogous → wide split
  const hue = (center + (t - 0.5) * spread + 360) % 360;
  const sat = 55 + contrast * 45;
  const bri = 60 + contrast * 40;
  return p.color(hue, sat, bri, alpha);
}
