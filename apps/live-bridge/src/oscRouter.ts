/**
 * OSC routing (Phase 3). Bridges Max for Live ⇄ the WebSocket hub over UDP,
 * using Node's built-in `dgram` + a tiny OSC codec (no native deps).
 *
 * Inbound (Max → bridge), prefix-scoped (default `/lichtspiel`):
 *   /lichtspiel/state         <jsonString>   → live.state  (the M4L device's LiveSessionState)
 *   /lichtspiel/scene         <id>           → scene.select
 *   /lichtspiel/param         <name> <float> → params.update
 *   /lichtspiel/scene/launch  <index> <name> → scene.launched  (Phase 5a auto-retrieval)
 *   /lichtspiel/locator       <index> <name> → locator.crossed (Phase 5a auto-retrieval)
 * Decoded messages are validated downstream by the hub (a malformed state is
 * dropped, never forwarded to p5).
 *
 * Outbound (bridge → Max) on `bridgeToMaxPort` is available via send() for
 * future status/LED return. serialosc (monome) is a separate transport with its
 * own socket — see `serialosc.ts`.
 */

import { createSocket, type Socket } from 'node:dgram';
import {
  type LiveSessionState,
  type VisualParamVector,
  type WireMessage,
  wire,
} from '@lichtspiel/schemas';
import { logger } from './log.js';
import { decodeOscMessage, encodeOscMessage } from './oscCodec.js';

export interface OscRouterOptions {
  host: string;
  /** OSC port Max sends to (bridge listens). */
  maxToBridgePort: number;
  /** OSC port the bridge sends to Max. */
  bridgeToMaxPort: number;
  /** Address prefix the M4L device uses (set via /sys/prefix). */
  prefix?: string;
  /** Push a decoded wire message into the hub. */
  onMessage: (m: WireMessage) => void;
}

export class OscRouter {
  private sock: Socket | null = null;
  private readonly opts: OscRouterOptions;
  private readonly prefix: string;

  constructor(opts: OscRouterOptions) {
    this.opts = opts;
    this.prefix = opts.prefix ?? '/lichtspiel';
  }

  start(): void {
    const sock = createSocket('udp4');
    sock.on('error', (err) => logger.warn('OSC socket error', { error: String(err) }));
    sock.on('message', (buf) => {
      const msg = decodeOscMessage(buf);
      if (msg) this.decode(msg.address, msg.args);
    });
    sock.on('listening', () =>
      logger.info(
        `OSC (Max) listening udp ${this.opts.host}:${this.opts.maxToBridgePort} (prefix ${this.prefix})`,
      ),
    );
    try {
      sock.bind(this.opts.maxToBridgePort, this.opts.host);
    } catch (err) {
      logger.warn('OSC bind failed (continuing WS-only)', { error: String(err) });
      return;
    }
    this.sock = sock;
  }

  private decode(address: string, args: Array<string | number>): void {
    if (!address.startsWith(this.prefix)) return;
    const sub = address.slice(this.prefix.length);

    if (sub === '/state') {
      const raw = String(args[0] ?? '');
      try {
        const payload = JSON.parse(raw) as LiveSessionState;
        this.opts.onMessage(wire('live.state', payload));
      } catch (err) {
        logger.warn('OSC /state: bad JSON', { error: String(err) });
      }
    } else if (sub === '/scene') {
      this.opts.onMessage(wire('scene.select', { sceneId: String(args[0] ?? '') }));
    } else if (sub === '/param') {
      const name = String(args[0] ?? '');
      const value = Number(args[1] ?? 0);
      if (name) {
        this.opts.onMessage(wire('params.update', { [name]: value } as Partial<VisualParamVector>));
      }
    } else if (sub === '/scene/launch') {
      this.opts.onMessage(wire('scene.launched', oscIndexName(args)));
    } else if (sub === '/locator') {
      this.opts.onMessage(wire('locator.crossed', oscIndexName(args)));
    } else {
      logger.info('OSC (unhandled)', { type: address });
    }
  }

  /** Send a wire message out toward Max as OSC (Phase 4 status/LED return). */
  send(m: WireMessage): void {
    if (!this.sock) return;
    const buf = encodeOscMessage(`${this.prefix}/${m.type}`, [JSON.stringify(m.payload)]);
    this.sock.send(buf, this.opts.bridgeToMaxPort, this.opts.host);
  }

  stop(): void {
    try {
      this.sock?.close();
    } catch {
      /* ignore */
    }
    this.sock = null;
  }
}

/**
 * Parse `<index> <name…>` OSC args into `{ index, name }`. The name is rejoined
 * from every trailing arg so a Max symbol with spaces (e.g. the "hats back"
 * locator) survives whether the device sends it as one atom or several.
 */
function oscIndexName(args: Array<string | number>): { index: number; name: string } {
  const raw = Number(args[0]);
  const index = Number.isFinite(raw) ? Math.trunc(raw) : 0;
  const name = args.slice(1).map(String).join(' ').trim();
  return { index, name };
}
