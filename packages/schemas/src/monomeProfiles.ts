/**
 * Monome device profiles + detection. The app supports two device classes and
 * adapts to whichever is connected: it reads the connected device from a
 * `device.attached` event (serial first, then advertised dimensions) and
 * resolves a profile that the runtime uses to size the grid fader bank, arc
 * encoder count, and LED layout.
 *
 * Known devices (the user's hardware):
 *   Grid 64  (8×8)   m64_0175    — primary Lichtspiel target
 *   Grid 128 (8×16)  m29496721   — built most of the windchime-animation corpus
 *   Arc 2    (2 enc) m0000174    — primary Lichtspiel target
 *   Arc 4    (4 enc) m0000007    — built most of the windchime-animation corpus
 */

import type { DeviceAttached } from './monome.js';

export type GridSize = '64' | '128' | 'other';
export type ArcSize = '2' | '4' | 'other';

/**
 * Grid capabilities/limitations. Differ across editions/classes — sketches +
 * mappings + LED-flush must adapt rather than assume.
 *
 * `varibright` = the HARDWARE shows per-LED 0..15 (/grid/led/level/*). The
 * user's Grid 64 (m64_0175, ~2007–2010 "series") is MONOBRIGHT: per-key LEDs
 * are on/off only, so varibright = false and the 0..15 levels are LOGICAL —
 * the digital twin still shows them, but the bridge collapses to on/off + a
 * global dimmer when flushing to that hardware. Grid 128 brightness is
 * edition-dependent → default conservatively to monobright until a sys query
 * proves otherwise.
 * `globalIntensity` = one shared brightness for all on-LEDs
 * (/grid/led/intensity 0..15) — true even on monobright grids.
 * `tilt` = has an accelerometer (/tilt enable + incoming /tilt n x y z).
 * `quads` = number of 8×8 LED-map blocks (64 → 1, 128 → 2).
 */
export interface GridCaps {
  cells: number;
  quads: number;
  ledLevels: number;
  varibright: boolean;
  globalIntensity: boolean;
  tilt: boolean;
}

/**
 * Arc capabilities. `push` = encoders send key/click events (/enc/key). Some
 * Arc editions have no keypress, so treat `push` as best-effort: use rotation
 * for required controls and a keyboard fallback for any critical click.
 * Ring LEDs are genuinely varibright (0..15) on all arcs.
 */
export interface ArcCaps {
  encoders: number;
  ringLeds: number;
  ledLevels: number;
  push: boolean;
}

export interface GridProfile {
  kind: 'grid';
  serial: string | null;
  rows: number;
  cols: number;
  size: GridSize;
  label: string;
  caps: GridCaps;
}

export interface ArcProfile {
  kind: 'arc';
  serial: string | null;
  encoders: number;
  ringLeds: number;
  size: ArcSize;
  label: string;
  caps: ArcCaps;
}

export interface MonomeSetup {
  grid: GridProfile | null;
  arc: ArcProfile | null;
}

export const GRID_64: GridProfile = Object.freeze({
  kind: 'grid',
  serial: 'm64_0175',
  rows: 8,
  cols: 8,
  size: '64',
  label: 'Grid 64',
  // m64_0175 is a monobright "series" grid: per-key on/off + global dimmer.
  caps: { cells: 64, quads: 1, ledLevels: 16, varibright: false, globalIntensity: true, tilt: true },
});

export const GRID_128: GridProfile = Object.freeze({
  kind: 'grid',
  serial: 'm29496721',
  rows: 8,
  cols: 16,
  size: '128',
  label: 'Grid 128',
  // brightness is edition-dependent — assume monobright until a sys query proves varibright.
  caps: { cells: 128, quads: 2, ledLevels: 16, varibright: false, globalIntensity: true, tilt: true },
});

export const ARC_2: ArcProfile = Object.freeze({
  kind: 'arc',
  serial: 'm0000174',
  encoders: 2,
  ringLeds: 64,
  size: '2',
  label: 'Arc 2',
  caps: { encoders: 2, ringLeds: 64, ledLevels: 16, push: true },
});

export const ARC_4: ArcProfile = Object.freeze({
  kind: 'arc',
  serial: 'm0000007',
  encoders: 4,
  ringLeds: 64,
  size: '4',
  label: 'Arc 4',
  caps: { encoders: 4, ringLeds: 64, ledLevels: 16, push: true },
});

export const KNOWN_GRIDS: Record<string, GridProfile> = {
  m64_0175: GRID_64,
  m29496721: GRID_128,
};

export const KNOWN_ARCS: Record<string, ArcProfile> = {
  m0000174: ARC_2,
  m0000007: ARC_4,
};

/** Primary target setup: the newer grid 64 + arc 2. */
export const DEFAULT_SETUP: MonomeSetup = Object.freeze({ grid: GRID_64, arc: ARC_2 });

export function gridProfileForSerial(serial: string): GridProfile | null {
  return KNOWN_GRIDS[serial] ?? null;
}

export function arcProfileForSerial(serial: string): ArcProfile | null {
  return KNOWN_ARCS[serial] ?? null;
}

/** Resolve a profile from a device.attached event: serial first, then dims. */
export function profileFromAttached(d: DeviceAttached): GridProfile | ArcProfile {
  if (d.kind === 'grid') {
    const known = gridProfileForSerial(d.id);
    if (known) return { ...known, serial: d.id };
    const rows = d.rows ?? 8;
    const cols = d.cols ?? 8;
    return {
      kind: 'grid',
      serial: d.id,
      rows,
      cols,
      size: cols > 8 ? '128' : cols === 8 && rows === 8 ? '64' : 'other',
      label: `Grid ${rows * cols}`,
      // varibright/tilt can't be known from device.attached alone — default
      // conservatively to monobright; the bridge can refine from a sys query.
      caps: {
        cells: rows * cols,
        quads: Math.ceil(cols / 8) * Math.ceil(rows / 8),
        ledLevels: 16,
        varibright: false,
        globalIntensity: true,
        tilt: true,
      },
    };
  }
  const known = arcProfileForSerial(d.id);
  if (known) return { ...known, serial: d.id };
  const encoders = d.encoders ?? 2;
  return {
    kind: 'arc',
    serial: d.id,
    encoders,
    ringLeds: 64,
    size: encoders >= 4 ? '4' : encoders === 2 ? '2' : 'other',
    label: `Arc ${encoders}`,
    caps: { encoders, ringLeds: 64, ledLevels: 16, push: true },
  };
}

/** Human-readable one-liner for status UIs. */
export function describeSetup(setup: MonomeSetup): string {
  const g = setup.grid ? setup.grid.label : 'no grid';
  const a = setup.arc ? setup.arc.label : 'no arc';
  return `${g} · ${a}`;
}
