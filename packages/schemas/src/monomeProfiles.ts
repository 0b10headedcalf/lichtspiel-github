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

export interface GridProfile {
  kind: 'grid';
  serial: string | null;
  rows: number;
  cols: number;
  size: GridSize;
  label: string;
}

export interface ArcProfile {
  kind: 'arc';
  serial: string | null;
  encoders: number;
  ringLeds: number;
  size: ArcSize;
  label: string;
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
});

export const GRID_128: GridProfile = Object.freeze({
  kind: 'grid',
  serial: 'm29496721',
  rows: 8,
  cols: 16,
  size: '128',
  label: 'Grid 128',
});

export const ARC_2: ArcProfile = Object.freeze({
  kind: 'arc',
  serial: 'm0000174',
  encoders: 2,
  ringLeds: 64,
  size: '2',
  label: 'Arc 2',
});

export const ARC_4: ArcProfile = Object.freeze({
  kind: 'arc',
  serial: 'm0000007',
  encoders: 4,
  ringLeds: 64,
  size: '4',
  label: 'Arc 4',
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
  };
}

/** Human-readable one-liner for status UIs. */
export function describeSetup(setup: MonomeSetup): string {
  const g = setup.grid ? setup.grid.label : 'no grid';
  const a = setup.arc ? setup.arc.label : 'no arc';
  return `${g} · ${a}`;
}
