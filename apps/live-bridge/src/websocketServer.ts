/**
 * The bridge WebSocket hub. Clients announce a role (p5 / max / cli) via
 * `hello`. Control messages from max/cli are validated and fanned out to the
 * p5 runtime(s); LED frames from p5 are routed back toward Max/monome
 * (Phase 4). Invalid messages are logged and dropped, never forwarded.
 */

import { WebSocketServer, type WebSocket } from 'ws';
import {
  type StatusPayload,
  type WireMessage,
  type WireRole,
  isType,
  isWireMessage,
  wire,
} from '@lichtspiel/schemas';
import { logger } from './log.js';
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
}

export class BridgeServer {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Map<WebSocket, Client>();
  private nextId = 1;
  private lastError: string | undefined;
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
    const src = `${client.role}#${client.id}`;

    if (isType(m, 'hello')) {
      client.role = m.payload.role;
      logger.info('hello', { source: `${client.role}#${client.id}`, type: 'hello' });
      this.sendTo(client.ws, wire('status', this.status()));
      this.emitStatus();
      return;
    }

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

    if (isType(m, 'scene.select') || isType(m, 'params.update') || isType(m, 'retrieval.result')) {
      logger.info(m.type, { source: src, type: m.type, summary: summarize(m) });
      this.broadcast(['p5'], m);
      return;
    }

    if (isType(m, 'led.frame')) {
      this.broadcast(['max'], m);
      return;
    }

    // device.attached / device.detached / status: log + relay to p5.
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
      monomeConnected: false,
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
  return m.type;
}
