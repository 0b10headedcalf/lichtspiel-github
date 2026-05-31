/**
 * Authoritative monome device state. Separates two layers so a real device
 * always wins over the no-hardware simulation, and so the GUI can show what is
 * actually connected vs simulated:
 *
 *   - `connected` — set ONLY by real `device.attached` / `device.detached`
 *     (serialosc, via the bridge).
 *   - `simulated` — set ONLY by the digital twin's manual Grid/Arc switch
 *     (browser-only / no-hardware mode).
 *
 * `active()` resolves PER DEVICE, hardware wins: `grid = connected.grid ??
 * simulated.grid` (same for arc). So plugging in a Grid 128 instantly overrides
 * a simulated Grid 64; unplugging falls back to the simulation; and a mixed rig
 * (real arc + simulated grid) resolves correctly. Subscribers are notified only
 * when the *active* setup actually changes.
 */

import {
  type DeviceAttached,
  type DeviceDetached,
  type MonomeSetup,
  profileFromAttached,
} from '@lichtspiel/schemas';

const EMPTY_SETUP: MonomeSetup = { grid: null, arc: null };

export type DeviceKind = 'grid' | 'arc';
export type SetupChangeSource = 'attach' | 'detach' | 'sim';
export type SetupListener = (active: MonomeSetup, src: SetupChangeSource) => void;

export interface MonomeDevices {
  /** The resolved setup the runtime should use (hardware wins per device). */
  active(): MonomeSetup;
  /** Only the physically-connected devices (nulls where nothing is plugged in). */
  connected(): MonomeSetup;
  /** Only the manual/simulated selection. */
  simulated(): MonomeSetup;
  /** Is a real device of this kind currently connected? */
  isConnected(kind: DeviceKind): boolean;
  attach(d: DeviceAttached): void;
  detach(d: DeviceDetached): void;
  setSimulated(setup: MonomeSetup): void;
  /** Subscribe to active-setup changes. Returns an unsubscribe fn. */
  onChange(cb: SetupListener): () => void;
}

export function createMonomeDevices(initialSim: MonomeSetup = EMPTY_SETUP): MonomeDevices {
  let connected: MonomeSetup = { grid: null, arc: null };
  let simulated: MonomeSetup = initialSim;
  const listeners = new Set<SetupListener>();

  const active = (): MonomeSetup => {
    // Hardware mode: once ANY real device is connected, show only connected
    // devices — a missing kind reads as absent (greyed), not a phantom sim.
    // No hardware at all: fall back to the manual simulation (browser-only dev).
    if (connected.grid || connected.arc) {
      return { grid: connected.grid, arc: connected.arc };
    }
    return { grid: simulated.grid, arc: simulated.arc };
  };

  // Track the last active profiles by identity so we only notify on real change.
  let last = active();
  const emit = (src: SetupChangeSource): void => {
    const a = active();
    if (a.grid === last.grid && a.arc === last.arc) return;
    last = a;
    for (const cb of listeners) cb(a, src);
  };

  return {
    active,
    connected: () => connected,
    simulated: () => simulated,
    isConnected: (kind) => (kind === 'grid' ? connected.grid !== null : connected.arc !== null),
    attach(d) {
      const prof = profileFromAttached(d);
      connected =
        prof.kind === 'grid' ? { ...connected, grid: prof } : { ...connected, arc: prof };
      emit('attach');
    },
    detach(d) {
      if (connected.grid?.serial === d.id) connected = { ...connected, grid: null };
      if (connected.arc?.serial === d.id) connected = { ...connected, arc: null };
      emit('detach');
    },
    setSimulated(setup) {
      simulated = setup;
      emit('sim');
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
