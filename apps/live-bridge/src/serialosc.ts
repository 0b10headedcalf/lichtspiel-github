/**
 * SerialOsc — discovers monome devices via the serialosc daemon and routes OSC
 * to/from each one over a single UDP socket. Phase 4 of the bridge.
 *
 * Adapted (NOT forked) from the windchime-animation `apps/bridge/src/serialosc.ts`,
 * retargeted to Lichtspiel's conventions:
 *   - pure-Node `dgram` + our own `oscCodec` (NO osc-js / native deps — the same
 *     decision as `oscRouter.ts`; higher-level OSC wrappers caused grid/arc
 *     routing conflicts in the source project);
 *   - a chosen device prefix (`/lichtspiel`) set via `/sys/prefix`, so inbound
 *     events arrive at `/lichtspiel/grid/key`, `/lichtspiel/enc/delta`, …;
 *   - profile- + capability-aware: resolves `profileFromAttached()` per device
 *     so dims/encoders/caps are known immediately from the serial, and LED
 *     output adapts (monobright grid → binary map + global dimmer; varibright
 *     grid → per-key levels; arc rings → always varibright);
 *   - per-device disambiguation by UDP source port (`rinfo.port`) rather than
 *     "guess by kind", so two grids / two arcs would route correctly;
 *   - rate-limited LED output and coalesced arc deltas (~30 Hz) so neither the
 *     hardware nor the browser can be flooded;
 *   - robust hot-plug: re-arm the one-shot `/serialosc/notify` after every
 *     add/remove, periodic `/serialosc/list` re-poll as a backup, and dedup by
 *     id (mirrors the windchime hot-plug fix).
 *
 * serialosc protocol reference: https://monome.org/docs/serialosc/osc/
 *
 * Discovery flow:
 *   1. → /serialosc/list <host> <appPort>     (to daemon :serialoscPort)
 *   2. ← /serialosc/device <id> <type> <port> (one per attached device)
 *   3. → /serialosc/notify <host> <appPort>   (one-shot future add/remove)
 *   4. per device (to daemon :devicePort):
 *        → /sys/port <appPort> ; /sys/host <host> ; /sys/prefix <prefix>
 *        → /sys/info                          (grids → device replies /sys/size)
 *   5. device input then flows to <host>:<appPort> under <prefix>.
 */

import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import {
  type ArcProfile,
  type DeviceAttached,
  type DeviceDetached,
  type GridProfile,
  type LedFramePayload,
  type MonomeEvent,
  ARC_RING_LEDS,
  KNOWN_ARCS,
  KNOWN_GRIDS,
  LED_LEVEL_MAX,
  clampLevel,
  profileFromAttached,
} from '@lichtspiel/schemas';
import { exec } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { logger } from './log.js';
import { decodeOscMessage, encodeOscMessage } from './oscCodec.js';

/** Serials of monome devices we know about — used to detect a device that's
 *  present at the OS/USB level but that serialosc has failed to enumerate. */
const KNOWN_MONOME_SERIALS: readonly string[] = [
  ...Object.keys(KNOWN_GRIDS),
  ...Object.keys(KNOWN_ARCS),
];

export interface SerialOscOptions {
  /** Loopback host to bind + advertise to devices. Default 127.0.0.1. */
  host?: string;
  /** serialosc daemon port (we send discovery here). Default 12002. */
  serialoscPort: number;
  /** Port we bind + tell every device to send to (via /sys/port). Default 13333. */
  appPort: number;
  /** Address prefix set on each device (via /sys/prefix). Default /lichtspiel. */
  prefix?: string;
  /** LED flush + arc-delta drain rate. Default 30 Hz. */
  ledHz?: number;
  /** Periodic re-list interval (hot-plug backup). Default 5000 ms. */
  relistMs?: number;
  /** Auto-restart the serialosc daemon when a known device is stuck. Default true. */
  autoRecover?: boolean;
  /** Command used to restart the serialosc daemon. Default Homebrew restart. */
  recoverCmd?: string;
  onDeviceAttached: (d: DeviceAttached) => void;
  onDeviceDetached: (d: DeviceDetached) => void;
  onMonomeEvent: (e: MonomeEvent) => void;
}

interface KnownDevice {
  id: string;
  kind: 'grid' | 'arc';
  /** The per-device serialosc port (target for /sys/* + LED writes). */
  port: number;
  profile: GridProfile | ArcProfile;
  /** Last global intensity sent to a grid (dedup; -1 = unset). */
  lastGridIntensity: number;
  /** Consecutive polls this device has been missing from /serialosc/list. */
  missCount: number;
  /** Last LED payload sent per channel (quad/ring) — to skip unchanged re-sends. */
  lastSent: Map<string, string>;
}

/**
 * Monobright grids can't show per-key brightness, so we binarize at the level
 * midpoint: a logical level at or above this is "on". (The arc carries the rich
 * 0–15 language — see docs/monome.md.)
 */
const MONOBRIGHT_ON_THRESHOLD = Math.ceil(LED_LEVEL_MAX / 2); // 8

/** How long to collect /serialosc/list replies before reconciling removals. */
const POLL_WINDOW_MS = 400;

/**
 * Consecutive missed polls before a device is detached. >1 debounces flaky
 * hardware that bounces on/off the USB bus (e.g. a loose clone) so the twin
 * doesn't thrash — at the cost of a slightly slower clean-unplug detect.
 */
const DETACH_MISSES = 2;

// ── stuck-device auto-recovery ─────────────────────────────────────
/** Reconcile cycles a known device must be present-at-USB-but-unlisted before recovering. */
const STUCK_CYCLES = 3;
/** Max serialosc-daemon restarts per stuck episode before asking for a manual replug. */
const MAX_RECOVERY_ATTEMPTS = 2;
/** Minimum gap between daemon restarts (ms). */
const RECOVERY_COOLDOWN_MS = 20_000;
/** Default command to restart the serialosc daemon (Homebrew on macOS). */
const DEFAULT_RECOVER_CMD = 'brew services restart serialosc';

export class SerialOsc {
  private sock: Socket | null = null;
  private readonly host: string;
  private readonly prefix: string;
  private readonly ledHz: number;
  private readonly relistMs: number;
  private readonly autoRecover: boolean;
  private readonly recoverCmd: string;
  private readonly opts: SerialOscOptions;

  /** id → device. */
  private readonly devices = new Map<string, KnownDevice>();
  /** per-device serialosc port → id, for routing inbound OSC by source port. */
  private readonly portToId = new Map<number, string>();

  // ── rate-limiting state ──────────────────────────────────────────
  private tick: ReturnType<typeof setInterval> | null = null;
  private relistTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Re-list reconciliation. serialosc's `/serialosc/remove` notifications are
   * unreliable (one-shot, easily missed), so the periodic `/serialosc/list` is
   * the source of truth: each poll collects the advertised ids in `pollSeen`,
   * then `reconcile()` detaches any known device that's no longer advertised.
   * `pollGen` ignores stale reconcile timers from overlapping polls.
   */
  private pollGen = 0;
  private pollSeen = new Set<string>();
  /** Debounce for re-listing after add/remove notifications (collapses floods). */
  private addDebounce: ReturnType<typeof setTimeout> | null = null;
  // stuck-device recovery state
  private readonly stuckCycles = new Map<string, number>();
  private recoveryAttempts = 0;
  private lastRecoveryMs = 0;
  private recoveryGaveUp = false;
  /** Latest LED frame awaiting flush (coalesces bursts). */
  private pendingLeds: LedFramePayload | null = null;
  /** Coalesced arc deltas, keyed `${deviceId}:${encoder}`. */
  private readonly pendingDelta = new Map<string, { deviceId: string; encoder: number; delta: number }>();

  constructor(opts: SerialOscOptions) {
    this.opts = opts;
    this.host = opts.host ?? '127.0.0.1';
    this.prefix = opts.prefix ?? '/lichtspiel';
    this.ledHz = opts.ledHz ?? 30;
    // Polls double as the detach mechanism + the steady-state discovery path, so
    // keep them brisk (~1.5s); loopback list replies settle well under POLL_WINDOW_MS.
    this.relistMs = opts.relistMs ?? 1500;
    this.autoRecover = opts.autoRecover ?? true;
    this.recoverCmd = opts.recoverCmd ?? DEFAULT_RECOVER_CMD;
  }

  start(): void {
    const sock = createSocket('udp4');
    sock.on('error', (err) => logger.warn('serialosc socket error', { error: String(err) }));
    sock.on('message', (buf, rinfo) => {
      const msg = decodeOscMessage(buf);
      if (msg) this.handleInbound(msg.address, msg.args, rinfo);
    });
    sock.on('listening', () => {
      logger.info(
        `serialosc listening udp ${this.host}:${this.opts.appPort} (prefix ${this.prefix}) · daemon :${this.opts.serialoscPort}`,
      );
      this.reconcileTick(); // first poll now; steady cadence below
    });
    try {
      sock.bind(this.opts.appPort, this.host);
    } catch (err) {
      logger.warn('serialosc bind failed (continuing without monome)', { error: String(err) });
      return;
    }
    this.sock = sock;

    // One shared ~30 Hz scheduler drives LED flush + arc-delta drain, so the
    // event loop is never blocked and neither stream can flood downstream.
    this.tick = setInterval(() => this.onTick(), Math.max(1, Math.round(1000 / this.ledHz)));
    // Steady reconcile cycle: re-list + detach anything no longer advertised.
    this.relistTimer = setInterval(() => this.reconcileTick(), this.relistMs);
  }

  stop(): void {
    if (this.tick) clearInterval(this.tick);
    if (this.relistTimer) clearInterval(this.relistTimer);
    if (this.addDebounce) clearTimeout(this.addDebounce);
    this.addDebounce = null;
    this.pollGen++; // invalidate any pending reconcile
    this.tick = null;
    this.relistTimer = null;
    // Best-effort: leave the hardware dark before closing.
    for (const dev of this.devices.values()) this.blank(dev);
    try {
      this.sock?.close();
    } catch {
      /* ignore */
    }
    this.sock = null;
    this.devices.clear();
    this.portToId.clear();
    this.pendingLeds = null;
    this.pendingDelta.clear();
  }

  deviceCount(): number {
    return this.devices.size;
  }

  /** Queue an LED frame for the next flush tick (called by the hub on led.frame). */
  flushLeds(frame: LedFramePayload): void {
    // Merge so a grid-only and an arc-only frame within the same tick both land
    // (and so gridIntensity isn't dropped when a frame omits grid/arc).
    const prev = this.pendingLeds ?? {};
    this.pendingLeds = {
      grid: frame.grid ?? prev.grid,
      arc: frame.arc ?? prev.arc,
      gridIntensity: frame.gridIntensity ?? prev.gridIntensity,
    };
  }

  // ── discovery ──────────────────────────────────────────────────────

  /**
   * Poll serialosc for the current device list + (re-)arm the one-shot notify so
   * we hear about future plug/unplug. Notify is safe now that LED output is
   * diffed (so a device no longer disconnects under a 30 Hz flush) and that we
   * react to add/remove with a DEBOUNCED single re-list (not the old 5× burst),
   * so even residual flicker can't storm. Detach is still owned by reconcileTick.
   */
  private discover(): void {
    this.send(this.opts.serialoscPort, '/serialosc/list', [this.host, this.opts.appPort]);
    this.send(this.opts.serialoscPort, '/serialosc/notify', [this.host, this.opts.appPort]);
  }

  /** Re-list soon, collapsing a burst of add/remove notifications into one poll. */
  private debouncedDiscover(): void {
    if (this.addDebounce) clearTimeout(this.addDebounce);
    this.addDebounce = setTimeout(() => {
      this.addDebounce = null;
      if (this.sock) this.discover();
    }, 200);
  }

  /**
   * One reconcile cycle (steady timer): open a fresh seen-window, re-list, then
   * detach any known device that didn't show up. Decoupled from the discovery
   * burst so rapid burst polls never delay a removal (the gen guard is only
   * bumped here, and relistMs > POLL_WINDOW_MS so windows never overlap).
   */
  private reconcileTick(): void {
    const gen = ++this.pollGen;
    this.pollSeen = new Set();
    this.discover();
    setTimeout(() => {
      if (this.sock && gen === this.pollGen) {
        this.reconcile();
        this.checkStuck();
      }
    }, POLL_WINDOW_MS);
  }

  /**
   * Recover a known monome that's present at the OS/USB level (its tty exists)
   * but that serialosc has failed to enumerate — a daemon-side glitch that hits
   * the user's Arc 4 FTDI clone on re-plug. Restarts the serialosc daemon
   * (bounded + rate-limited); if restarts don't resolve it, asks for a replug.
   */
  private checkStuck(): void {
    if (!this.autoRecover) return;
    let ttys: string[];
    try {
      ttys = readdirSync('/dev').filter((n) => n.startsWith('tty.usb'));
    } catch {
      return; // not macOS / can't read /dev → skip
    }
    const stuck = KNOWN_MONOME_SERIALS.filter(
      (serial) => ttys.some((t) => t.includes(serial)) && !this.devices.has(serial),
    );
    if (stuck.length === 0) {
      // episode over — every connected known device is enumerated again
      this.stuckCycles.clear();
      this.recoveryAttempts = 0;
      this.recoveryGaveUp = false;
      return;
    }
    for (const serial of KNOWN_MONOME_SERIALS) {
      if (stuck.includes(serial)) this.stuckCycles.set(serial, (this.stuckCycles.get(serial) ?? 0) + 1);
      else this.stuckCycles.delete(serial);
    }
    if (!stuck.some((s) => (this.stuckCycles.get(s) ?? 0) >= STUCK_CYCLES)) return;
    if (this.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      if (!this.recoveryGaveUp) {
        this.recoveryGaveUp = true;
        logger.warn(
          'monome present at USB but serialosc will not enumerate it — please physically replug',
          { summary: stuck.join(',') },
        );
      }
      return;
    }
    if (Date.now() - this.lastRecoveryMs < RECOVERY_COOLDOWN_MS) return;
    this.recoveryAttempts += 1;
    this.lastRecoveryMs = Date.now();
    logger.warn('monome stuck — restarting serialosc daemon to recover', {
      summary: `${stuck.join(',')} (attempt ${this.recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS})`,
    });
    exec(this.recoverCmd, (err) => {
      if (err) logger.warn('serialosc daemon restart failed', { error: String(err) });
    });
  }

  /**
   * Detach devices the latest /serialosc/list no longer advertises — but only
   * after DETACH_MISSES consecutive missed polls, so a flaky device that bounces
   * on/off the bus doesn't thrash the twin. A still-listed device resets its count.
   */
  private reconcile(): void {
    for (const id of [...this.devices.keys()]) {
      const dev = this.devices.get(id);
      if (!dev) continue;
      if (this.pollSeen.has(id)) dev.missCount = 0;
      else if (++dev.missCount >= DETACH_MISSES) this.onDeviceRemoved(id);
    }
  }

  private handleInbound(address: string, args: Array<string | number>, rinfo: RemoteInfo): void {
    if (process.env['LICHTSPIEL_DEBUG_OSC'] === '1') {
      logger.info('serialosc in', { source: `:${rinfo.port}`, type: address, summary: String(args) });
    }

    // ── serialosc daemon messages (routed by address, not port) ──
    if (address === '/serialosc/device') {
      // reply to /serialosc/list: <id> <type> <port>
      this.onDeviceAdvertised(String(args[0]), String(args[1]), Number(args[2]));
      return;
    }
    // A device was plugged/unplugged → re-list soon (debounced, so a flaky
    // device's add/remove flood collapses to a single poll, never a storm).
    // Detach is owned by the debounced reconcileTick; this is the fast-detect path.
    if (address === '/serialosc/add' || address === '/serialosc/remove') {
      this.debouncedDiscover();
      return;
    }

    // ── /sys replies (e.g. /sys/size) — identify the device by source port ──
    if (address === '/sys/size') {
      const id = this.portToId.get(rinfo.port);
      if (id) this.onGridSize(id, Number(args[0]), Number(args[1]));
      return;
    }
    if (address.startsWith('/sys/')) return; // other sys info: not needed

    // ── device input under our prefix — disambiguate by source port ──
    if (!address.startsWith(this.prefix)) return;
    const sub = address.slice(this.prefix.length);
    const deviceId = this.portToId.get(rinfo.port);
    if (!deviceId) return; // unknown source — ignore

    if (sub === '/grid/key') {
      const x = Number(args[0]);
      const y = Number(args[1]);
      const state = Number(args[2]) === 1 ? 1 : 0;
      this.opts.onMonomeEvent({ type: 'grid.key', deviceId, x, y, state });
    } else if (sub === '/enc/delta') {
      // Coalesce: a fast spin emits many deltas — sum per encoder, drain at ledHz.
      const encoder = Number(args[0]);
      const delta = Number(args[1]);
      const key = `${deviceId}:${encoder}`;
      const acc = this.pendingDelta.get(key);
      if (acc) acc.delta += delta;
      else this.pendingDelta.set(key, { deviceId, encoder, delta });
    } else if (sub === '/enc/key') {
      const encoder = Number(args[0]);
      const state = Number(args[1]) === 1 ? 1 : 0;
      this.opts.onMonomeEvent({ type: 'arc.key', deviceId, encoder, state });
    }
    // /tilt is deferred (no tilt event in the schema yet — see docs/monome.md).
  }

  private onDeviceAdvertised(id: string, type: string, port: number): void {
    if (!id || !Number.isFinite(port)) return;
    this.pollSeen.add(id); // mark seen for reconcile (BEFORE the dedup return)
    const kind: 'grid' | 'arc' = type.toLowerCase().includes('arc') ? 'arc' : 'grid';

    const existing = this.devices.get(id);
    if (existing && existing.port === port) {
      existing.missCount = 0; // re-advertised → reset the miss counter
      return; // dedup: already known (steady re-list)
    }

    // Resolve a full profile from the serial (falls back to dims/type for unknowns).
    const encodersFromType = kind === 'arc' ? parseTrailingInt(type) : undefined;
    const profile = profileFromAttached({
      type: 'device.attached',
      id,
      kind,
      ...(encodersFromType ? { encoders: encodersFromType } : {}),
    });

    if (existing) this.portToId.delete(existing.port); // port changed (daemon restart)
    const dev: KnownDevice = {
      id,
      kind,
      port,
      profile,
      lastGridIntensity: -1,
      missCount: 0,
      lastSent: new Map(),
    };
    this.devices.set(id, dev);
    this.portToId.set(port, id);

    // Point the device at us, set the prefix, then ask grids for their size.
    this.send(port, '/sys/port', [this.opts.appPort]);
    this.send(port, '/sys/host', [this.host]);
    this.send(port, '/sys/prefix', [this.prefix]);
    if (kind === 'grid') {
      this.send(port, '/sys/info', []);
      // Establish a known global brightness for monobright grids (full).
      if (profile.kind === 'grid' && profile.caps.globalIntensity) {
        this.send(port, `${this.prefix}/grid/led/intensity`, [LED_LEVEL_MAX]);
        dev.lastGridIntensity = LED_LEVEL_MAX;
      }
    }

    this.opts.onDeviceAttached(describe(dev));
    logger.info('monome attached', { source: id, type, summary: profile.label });
  }

  private onGridSize(id: string, cols: number, rows: number): void {
    const dev = this.devices.get(id);
    if (!dev || dev.profile.kind !== 'grid') return;
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
    if (dev.profile.cols === cols && dev.profile.rows === rows) return; // already correct
    // Re-resolve from the now-known dimensions (e.g. an unknown grid).
    dev.profile = profileFromAttached({ type: 'device.attached', id, kind: 'grid', rows, cols });
    this.opts.onDeviceAttached(describe(dev));
    logger.info('monome grid size', { source: id, summary: `${cols}×${rows}` });
  }

  private onDeviceRemoved(id: string): void {
    const dev = this.devices.get(id);
    if (!dev) return;
    this.devices.delete(id);
    this.portToId.delete(dev.port);
    // Drop any queued deltas for this device.
    for (const key of this.pendingDelta.keys()) {
      if (key.startsWith(`${id}:`)) this.pendingDelta.delete(key);
    }
    this.opts.onDeviceDetached({ type: 'device.detached', id });
    logger.info('monome detached', { source: id });
  }

  // ── scheduler ──────────────────────────────────────────────────────

  private onTick(): void {
    // 1. Drain coalesced arc deltas.
    if (this.pendingDelta.size) {
      for (const acc of this.pendingDelta.values()) {
        if (acc.delta !== 0) {
          this.opts.onMonomeEvent({
            type: 'arc.delta',
            deviceId: acc.deviceId,
            encoder: acc.encoder,
            delta: acc.delta,
          });
        }
      }
      this.pendingDelta.clear();
    }

    // 2. Flush the latest LED frame to hardware.
    if (this.pendingLeds) {
      const frame = this.pendingLeds;
      this.pendingLeds = null;
      this.flushFrame(frame);
    }
  }

  // ── LED output (caps-aware) ────────────────────────────────────────

  private flushFrame(frame: LedFramePayload): void {
    const grid = this.activeDevice('grid');
    if (grid && grid.profile.kind === 'grid') {
      // Global dimmer (monobright grids' only brightness control) — deduped.
      if (frame.gridIntensity != null && grid.profile.caps.globalIntensity) {
        const lvl = clampLevel(frame.gridIntensity);
        if (lvl !== grid.lastGridIntensity) {
          this.send(grid.port, `${this.prefix}/grid/led/intensity`, [lvl]);
          grid.lastGridIntensity = lvl;
        }
      }
      if (frame.grid) this.flushGrid(grid, frame.grid);
    }
    if (frame.arc) {
      const arc = this.activeDevice('arc');
      if (arc && arc.profile.kind === 'arc') this.flushArc(arc, frame.arc);
    }
  }

  private flushGrid(dev: KnownDevice, grid: number[][]): void {
    const p = dev.profile as GridProfile;
    const { rows, cols } = p;
    const qx = Math.ceil(cols / 8);
    const qy = Math.ceil(rows / 8);
    for (let bx = 0; bx < qx; bx++) {
      for (let by = 0; by < qy; by++) {
        const xOff = bx * 8;
        const yOff = by * 8;
        if (p.caps.varibright) {
          // 64 explicit levels, row-major within the quad.
          const levels: number[] = [];
          for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) levels.push(clampLevel(grid[yOff + r]?.[xOff + c] ?? 0));
          }
          this.sendIfChanged(dev, `g:${bx}:${by}`, `${this.prefix}/grid/led/level/map`, [xOff, yOff, ...levels]);
        } else {
          // Monobright: 8 row bitmasks (bit c = column xOff+c), binarized.
          const rowMasks: number[] = [];
          for (let r = 0; r < 8; r++) {
            let mask = 0;
            for (let c = 0; c < 8; c++) {
              if ((grid[yOff + r]?.[xOff + c] ?? 0) >= MONOBRIGHT_ON_THRESHOLD) mask |= 1 << c;
            }
            rowMasks.push(mask);
          }
          this.sendIfChanged(dev, `g:${bx}:${by}`, `${this.prefix}/grid/led/map`, [xOff, yOff, ...rowMasks]);
        }
      }
    }
  }

  private flushArc(dev: KnownDevice, arc: number[][]): void {
    const p = dev.profile as ArcProfile;
    const n = Math.min(arc.length, p.encoders);
    for (let e = 0; e < n; e++) {
      const ring = arc[e];
      if (!ring) continue;
      const levels: number[] = [];
      for (let i = 0; i < ARC_RING_LEDS; i++) levels.push(clampLevel(ring[i] ?? 0));
      this.sendIfChanged(dev, `r:${e}`, `${this.prefix}/ring/map`, [e, ...levels]);
    }
  }

  /**
   * Send an LED message only if it differs from the last one on this channel
   * (a grid quad or an arc ring). The twin emits a full frame at ~30 Hz, so
   * without this we'd hammer the device with identical frames — which is what
   * overwhelmed the Arc 4 clone's serial link (windchime only flushed on change).
   */
  private sendIfChanged(dev: KnownDevice, key: string, address: string, args: number[]): void {
    const sig = args.join(',');
    if (dev.lastSent.get(key) === sig) return;
    dev.lastSent.set(key, sig);
    this.send(dev.port, address, args);
  }

  /** Clear a device's LEDs (used on stop). */
  private blank(dev: KnownDevice): void {
    if (dev.profile.kind === 'grid') {
      this.send(dev.port, `${this.prefix}/grid/led/all`, [0]);
    } else {
      for (let e = 0; e < (dev.profile as ArcProfile).encoders; e++) {
        this.send(dev.port, `${this.prefix}/ring/all`, [e, 0]);
      }
    }
  }

  // ── helpers ────────────────────────────────────────────────────────

  /** The device of this kind to drive — the most recently attached (newest wins). */
  private activeDevice(kind: 'grid' | 'arc'): KnownDevice | null {
    let found: KnownDevice | null = null;
    for (const dev of this.devices.values()) if (dev.kind === kind) found = dev;
    return found;
  }

  private send(port: number, address: string, args: Array<string | number>): void {
    if (!this.sock) return;
    this.sock.send(encodeOscMessage(address, args), port, this.host);
  }
}

/** Build the wire DeviceAttached payload from a known device's profile. */
function describe(dev: KnownDevice): DeviceAttached {
  if (dev.profile.kind === 'grid') {
    return { type: 'device.attached', id: dev.id, kind: 'grid', rows: dev.profile.rows, cols: dev.profile.cols };
  }
  return { type: 'device.attached', id: dev.id, kind: 'arc', encoders: dev.profile.encoders };
}

/** Parse a trailing integer from a serialosc type string, e.g. "monome arc 4" → 4. */
function parseTrailingInt(s: string): number | undefined {
  const m = /(\d+)\s*$/.exec(s);
  return m ? Number(m[1]) : undefined;
}
