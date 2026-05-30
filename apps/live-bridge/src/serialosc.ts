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
  LED_LEVEL_MAX,
  clampLevel,
  profileFromAttached,
} from '@lichtspiel/schemas';
import { logger } from './log.js';
import { decodeOscMessage, encodeOscMessage } from './oscCodec.js';

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
}

/**
 * Monobright grids can't show per-key brightness, so we binarize at the level
 * midpoint: a logical level at or above this is "on". (The arc carries the rich
 * 0–15 language — see docs/monome.md.)
 */
const MONOBRIGHT_ON_THRESHOLD = Math.ceil(LED_LEVEL_MAX / 2); // 8

export class SerialOsc {
  private sock: Socket | null = null;
  private readonly host: string;
  private readonly prefix: string;
  private readonly ledHz: number;
  private readonly relistMs: number;
  private readonly opts: SerialOscOptions;

  /** id → device. */
  private readonly devices = new Map<string, KnownDevice>();
  /** per-device serialosc port → id, for routing inbound OSC by source port. */
  private readonly portToId = new Map<number, string>();

  // ── rate-limiting state ──────────────────────────────────────────
  private tick: ReturnType<typeof setInterval> | null = null;
  private relistTimer: ReturnType<typeof setInterval> | null = null;
  /** Latest LED frame awaiting flush (coalesces bursts). */
  private pendingLeds: LedFramePayload | null = null;
  /** Coalesced arc deltas, keyed `${deviceId}:${encoder}`. */
  private readonly pendingDelta = new Map<string, { deviceId: string; encoder: number; delta: number }>();

  constructor(opts: SerialOscOptions) {
    this.opts = opts;
    this.host = opts.host ?? '127.0.0.1';
    this.prefix = opts.prefix ?? '/lichtspiel';
    this.ledHz = opts.ledHz ?? 30;
    this.relistMs = opts.relistMs ?? 5000;
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
      this.discover();
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
    // Periodic re-list as a hot-plug backup (notify is one-shot per arm).
    this.relistTimer = setInterval(() => this.discover(), this.relistMs);
  }

  stop(): void {
    if (this.tick) clearInterval(this.tick);
    if (this.relistTimer) clearInterval(this.relistTimer);
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

  private discover(): void {
    this.send(this.opts.serialoscPort, '/serialosc/list', [this.host, this.opts.appPort]);
    this.send(this.opts.serialoscPort, '/serialosc/notify', [this.host, this.opts.appPort]);
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
    if (address === '/serialosc/add') {
      // one-shot notify fired (id only). Re-arm + re-list to learn type/port.
      this.discover();
      return;
    }
    if (address === '/serialosc/remove') {
      this.onDeviceRemoved(String(args[0]));
      this.discover(); // re-arm the one-shot notify
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
    const kind: 'grid' | 'arc' = type.toLowerCase().includes('arc') ? 'arc' : 'grid';

    const existing = this.devices.get(id);
    if (existing && existing.port === port) return; // dedup: already known (periodic re-list)

    // Resolve a full profile from the serial (falls back to dims/type for unknowns).
    const encodersFromType = kind === 'arc' ? parseTrailingInt(type) : undefined;
    const profile = profileFromAttached({
      type: 'device.attached',
      id,
      kind,
      ...(encodersFromType ? { encoders: encodersFromType } : {}),
    });

    if (existing) this.portToId.delete(existing.port); // port changed (daemon restart)
    const dev: KnownDevice = { id, kind, port, profile, lastGridIntensity: -1 };
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
    const grid = this.firstDevice('grid');
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
      const arc = this.firstDevice('arc');
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
          this.send(dev.port, `${this.prefix}/grid/led/level/map`, [xOff, yOff, ...levels]);
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
          this.send(dev.port, `${this.prefix}/grid/led/map`, [xOff, yOff, ...rowMasks]);
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
      this.send(dev.port, `${this.prefix}/ring/map`, [e, ...levels]);
    }
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

  private firstDevice(kind: 'grid' | 'arc'): KnownDevice | null {
    for (const dev of this.devices.values()) if (dev.kind === kind) return dev;
    return null;
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
