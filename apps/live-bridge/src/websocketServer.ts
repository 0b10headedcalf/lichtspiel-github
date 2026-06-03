/**
 * The bridge WebSocket hub. Clients announce a role (p5 / max / cli) via
 * `hello`. Control messages from max/cli are validated and fanned out to the
 * p5 runtime(s); LED frames from p5 are routed back toward Max/monome
 * (Phase 4). Invalid messages are logged and dropped, never forwarded.
 */

import { WebSocketServer, type WebSocket } from 'ws';
import {
  type AbletonSnapshot,
  type LedFramePayload,
  type MappingRequestPayload,
  type StatusPayload,
  type WireMessage,
  type WireRole,
  isType,
  isWireMessage,
  wire,
} from '@lichtspiel/schemas';
import { logger } from './log.js';
import type { MappingStore } from './mappingStore.js';
import { validate } from './validate.js';

interface Client {
  ws: WebSocket;
  role: WireRole;
  id: number;
}

export interface BridgeServerOptions {
  host: string;
  port: number;
  /** Notified whenever client roster changes (for the HTTP status route). */
  onStatusChange?: (status: StatusPayload) => void;
  /** Sink for outbound LED frames (Phase 4: the serialosc layer flushes them). */
  onLedFrame?: (frame: LedFramePayload) => void;
  /** Provide a fresh Ableton snapshot on request (Phase 5b). */
  snapshot?: () => Promise<AbletonSnapshot>;
  /** Persist / list scene-locator mappings as JSON (Phase 5b). */
  mappingStore?: MappingStore;
}

export class BridgeServer {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Map<WebSocket, Client>();
  private nextId = 1;
  private lastError: string | undefined;
  private monomeConnected = false;
  /** Current attached monome devices, keyed by id — replayed to new p5 clients. */
  private readonly attachedDevices = new Map<string, WireMessage>();
  /** Last Ableton snapshot, replayed to a freshly-connected p5 (Phase 5b). */
  private lastSnapshot: WireMessage | null = null;
  private readonly opts: BridgeServerOptions;

  constructor(opts: BridgeServerOptions) {
    this.opts = opts;
  }

  start(): void {
    const wss = new WebSocketServer({ host: this.opts.host, port: this.opts.port });
    this.wss = wss;

    wss.on('listening', () => {
      logger.info(`bridge WS listening on ws://${this.opts.host}:${this.opts.port}`);
    });

    wss.on('connection', (ws) => {
      const client: Client = { ws, role: 'bridge', id: this.nextId++ };
      this.clients.set(ws, client);
      ws.on('message', (data) => this.handle(client, data.toString()));
      ws.on('close', () => {
        this.clients.delete(ws);
        logger.info('client disconnected', { source: `${client.role}#${client.id}` });
        this.emitStatus();
      });
      ws.on('error', (err) => logger.warn('client socket error', { error: String(err) }));
    });

    wss.on('error', (err) => {
      this.lastError = String(err);
      logger.error('WS server error', { error: this.lastError });
    });
  }

  private handle(client: Client, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn('non-JSON message dropped', { source: `${client.role}#${client.id}` });
      return;
    }
    if (!isWireMessage(parsed)) {
      logger.warn('not a wire message', { source: `${client.role}#${client.id}` });
      return;
    }
    this.route(client, parsed);
  }

  private route(client: Client, m: WireMessage): void {
    if (isType(m, 'hello')) {
      client.role = m.payload.role;
      logger.info('hello', { source: `${client.role}#${client.id}`, type: 'hello' });
      this.sendTo(client.ws, wire('status', this.status()));
      // Replay current device state so a freshly-(re)connected p5 snaps to the
      // hardware that's actually plugged in — device.attached is otherwise a
      // one-shot event at discovery, missed by clients that connect later.
      if (client.role === 'p5') {
        for (const dev of this.attachedDevices.values()) this.sendTo(client.ws, dev);
        if (this.lastSnapshot) this.sendTo(client.ws, this.lastSnapshot);
      }
      this.emitStatus();
      return;
    }
    if (isType(m, 'ableton.snapshotRequest')) {
      void this.handleSnapshotRequest();
      return;
    }
    if (isType(m, 'mapping.request')) {
      this.handleMappingRequest(client, m.payload);
      return;
    }
    this.routeMessage(m, `${client.role}#${client.id}`);
  }

  /** Snapshot the Live set (or fixture) and broadcast it to p5 (Phase 5b). */
  private async handleSnapshotRequest(): Promise<void> {
    if (!this.opts.snapshot) {
      logger.warn('snapshot requested but no provider configured');
      return;
    }
    try {
      const snap = await this.opts.snapshot();
      const msg = wire('ableton.snapshot', snap);
      this.lastSnapshot = msg;
      this.broadcast(['p5'], msg);
    } catch (err) {
      logger.warn('snapshot failed', { error: String(err) });
    }
  }

  /** Persist / load / list mappings via the JSON store; reply to the requester. */
  private handleMappingRequest(client: Client, p: MappingRequestPayload): void {
    const store = this.opts.mappingStore;
    if (!store) {
      this.sendTo(client.ws, wire('mapping.result', { op: p.op, ok: false, error: 'no mapping store' }));
      return;
    }
    if (p.op === 'list') {
      this.sendTo(client.ws, wire('mapping.result', { op: 'list', ok: true, names: store.list() }));
      return;
    }
    const name = p.name ?? '';
    if (p.op === 'load') {
      const r = store.load(name);
      this.sendTo(
        client.ws,
        r.ok
          ? wire('mapping.result', { op: 'load', ok: true, name, mapping: r.mapping })
          : wire('mapping.result', { op: 'load', ok: false, name, error: r.error }),
      );
      return;
    }
    // save
    if (!p.mapping) {
      this.sendTo(client.ws, wire('mapping.result', { op: 'save', ok: false, name, error: 'no mapping in request' }));
      return;
    }
    const r = store.save(name, p.mapping);
    this.sendTo(
      client.ws,
      r.ok
        ? wire('mapping.result', { op: 'save', ok: true, name, names: store.list() })
        : wire('mapping.result', { op: 'save', ok: false, name, error: r.error }),
    );
  }

  /** Route a wire message from a non-WebSocket source (e.g. OSC from Max, monome). */
  ingest(m: WireMessage): void {
    this.routeMessage(m, 'osc');
  }

  /** Reflect monome hardware presence in /status (set by the serialosc layer). */
  setMonomeConnected(connected: boolean): void {
    if (this.monomeConnected === connected) return;
    this.monomeConnected = connected;
    this.emitStatus();
  }

  private routeMessage(m: WireMessage, src: string): void {
    if (isType(m, 'live.state')) {
      const v = validate('LiveSessionState', m.payload);
      logger.info('live.state', {
        source: src,
        type: m.type,
        summary: `${m.payload.selection?.clipName || '∅'} @ ${m.payload.transport?.tempo}bpm`,
        valid: v.valid,
        error: v.error,
      });
      if (v.valid) this.broadcast(['p5'], m);
      return;
    }

    if (isType(m, 'monome.event')) {
      const v = validate('MonomeEvent', m.payload);
      if (v.valid) this.broadcast(['p5', 'max'], m);
      else logger.warn('monome.event', { source: src, valid: false, error: v.error });
      return;
    }

    if (isType(m, 'mutation.request')) {
      const v = validate('MutationRequest', m.payload);
      if (v.valid) this.broadcast(['p5'], m);
      else logger.warn('mutation.request', { source: src, valid: false, error: v.error });
      return;
    }

    if (
      isType(m, 'scene.select') ||
      isType(m, 'params.update') ||
      isType(m, 'retrieval.result') ||
      isType(m, 'scene.launched') ||
      isType(m, 'locator.crossed')
    ) {
      logger.info(m.type, { source: src, type: m.type, summary: summarize(m) });
      this.broadcast(['p5'], m);
      return;
    }

    if (isType(m, 'led.frame')) {
      // p5 (templates + digital twin) → hardware via the serialosc layer, and
      // on to any Max client that wants to mirror it.
      this.opts.onLedFrame?.(m.payload);
      this.broadcast(['max'], m);
      return;
    }

    if (isType(m, 'visual.activated')) {
      // p5 confirms it activated a visual (latency-metric groundwork, Phase 5b).
      const p = m.payload;
      logger.info('visual.activated', {
        source: src,
        summary: `${p.kind} ${p.index} "${p.name}" → ${p.templateId} (${p.variantMode})`,
      });
      return;
    }

    // Cache device state (for replay to new p5 clients) + relay to p5.
    if (isType(m, 'device.attached')) {
      this.attachedDevices.set(m.payload.id, m);
      this.broadcast(['p5'], m);
      return;
    }
    if (isType(m, 'device.detached')) {
      this.attachedDevices.delete(m.payload.id);
      this.broadcast(['p5'], m);
      return;
    }

    // status + anything else: relay to p5.
    this.broadcast(['p5'], m);
  }

  private broadcast(roles: readonly WireRole[], m: WireMessage): void {
    const json = JSON.stringify(m);
    for (const c of this.clients.values()) {
      if (roles.includes(c.role) && c.ws.readyState === c.ws.OPEN) c.ws.send(json);
    }
  }

  private sendTo(ws: WebSocket, m: WireMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  }

  status(): StatusPayload {
    let p5Clients = 0;
    let maxConnected = false;
    for (const c of this.clients.values()) {
      if (c.role === 'p5') p5Clients++;
      if (c.role === 'max') maxConnected = true;
    }
    return {
      bridge: true,
      p5Clients,
      maxConnected,
      monomeConnected: this.monomeConnected,
      mlConnected: false,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  private emitStatus(): void {
    const s = this.status();
    this.opts.onStatusChange?.(s);
    this.broadcast(['p5', 'max', 'cli'], wire('status', s));
  }

  stop(): void {
    this.wss?.close();
    this.wss = null;
  }
}

function summarize(m: WireMessage): string {
  if (isType(m, 'scene.select')) return m.payload.sceneId;
  if (isType(m, 'retrieval.result')) return `${m.payload.sceneId} (conf ${m.payload.confidence})`;
  if (isType(m, 'params.update')) return Object.keys(m.payload).join(',');
  if (isType(m, 'scene.launched')) return `scene ${m.payload.index} "${m.payload.name}"`;
  if (isType(m, 'locator.crossed')) return `locator ${m.payload.index} "${m.payload.name}"`;
  return m.type;
}
