/**
 * Monome event + LED contracts. Adapted (not forked) from the Windchime
 * animation protocol; trimmed to Lichtspiel's hardware: a grid 64 (8×8,
 * serial m64_0175) and an arc 2 (2 encoders, serial m0000174). The LED
 * frame keeps capacity for larger devices so a grid 128 / arc 4 still
 * works if plugged in.
 *
 * Grid is row-major: grid[y][x] = level 0..15.
 * Arc: arc[encoder][led] = level 0..15, 64 LEDs per ring.
 */

export type DeviceKind = 'grid' | 'arc';

export interface GridKeyEvent {
  type: 'grid.key';
  deviceId: string;
  x: number;
  y: number;
  state: 0 | 1;
}

export interface ArcDeltaEvent {
  type: 'arc.delta';
  deviceId: string;
  encoder: number;
  delta: number;
}

export interface ArcKeyEvent {
  type: 'arc.key';
  deviceId: string;
  encoder: number;
  state: 0 | 1;
}

export type MonomeEvent = GridKeyEvent | ArcDeltaEvent | ArcKeyEvent;

export interface DeviceAttached {
  type: 'device.attached';
  id: string;
  kind: DeviceKind;
  rows?: number;
  cols?: number;
  encoders?: number;
}

export interface DeviceDetached {
  type: 'device.detached';
  id: string;
}

// ── LED frame ────────────────────────────────────────────────────────
export const GRID_ROWS = 8;
export const GRID_COLS = 8;
export const ARC_MAX_ENCODERS = 4;
export const ARC_RING_LEDS = 64;
export const LED_LEVEL_MAX = 15;

export interface LedFrame {
  grid: number[][]; // [rows][cols], 0..15
  arc: number[][]; // [encoder][0..63], 0..15
  gridDirty: boolean;
  arcDirty: boolean[];
  gridDeviceId?: string;
  arcDeviceId?: string;
}

export function createLedFrame(rows = GRID_ROWS, cols = GRID_COLS): LedFrame {
  return {
    grid: Array.from({ length: rows }, () => new Array<number>(cols).fill(0)),
    arc: Array.from({ length: ARC_MAX_ENCODERS }, () => new Array<number>(ARC_RING_LEDS).fill(0)),
    gridDirty: false,
    arcDirty: new Array<boolean>(ARC_MAX_ENCODERS).fill(false),
  };
}

export function clearGrid(frame: LedFrame): void {
  for (const row of frame.grid) row.fill(0);
  frame.gridDirty = true;
}

export function clearArcRing(frame: LedFrame, encoder: number): void {
  const ring = frame.arc[encoder];
  if (ring === undefined) return;
  ring.fill(0);
  frame.arcDirty[encoder] = true;
}

export function clampLevel(level: number): number {
  if (level < 0) return 0;
  if (level > LED_LEVEL_MAX) return LED_LEVEL_MAX;
  return Math.floor(level);
}

export function isMonomeEvent(x: { type?: string }): x is MonomeEvent {
  return x.type === 'grid.key' || x.type === 'arc.delta' || x.type === 'arc.key';
}
