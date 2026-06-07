/**
 * A stand-in Lichtspiel bridge: a `ws` server that mirrors the REAL bridge
 * byte-for-byte — same minimal envelope, the same lax `isWireMessage` guard, and
 * a `status` reply to `hello`. It lets the SAME LichtspielWsClient talk to either
 * the mock or the real bridge unchanged, proving Mode-2 wire compatibility.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import type { Clock } from '../core/clock.js';
import type { Logger } from '../logging.js';
import {
  isLichtspielWireMessage,
  lichtspielWire,
  type LichtspielWireMessage,
  type MonomeEvent,
  type StatusPayload,
  type VisualParamVector,
} from '../schemas/lichtspiel.js';

export type ParamsUpdateHandler = (params: Partial<VisualParamVector>) => void;
export type SceneLaunchedHandler = (scene: { index: number; name: string }) => void;

export interface LichtspielWsServerMockOptions {
  host: string;
  port: number;
  clock: Clock;
  logger: Logger;
}

export class LichtspielWsServerMock {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();
  private readonly paramsHandlers: ParamsUpdateHandler[] = [];
  private readonly sceneHandlers: SceneLaunchedHandler[] = [];

  constructor(private readonly opts: LichtspielWsServerMockOptions) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: this.opts.host, port: this.opts.port });
      this.wss = wss;
      const onError = (err: Error): void => {
        this.opts.logger.error({ err: String(err) }, 'mock Lichtspiel WS server error');
        reject(err);
      };
      wss.once('error', onError);
      wss.on('listening', () => {
        wss.off('error', onError);
        wss.on('error', (err) => this.opts.logger.warn({ err: String(err) }, 'mock WS server error'));
        this.opts.logger.info(`mock Lichtspiel WS listening on ws://${this.opts.host}:${this.opts.port}`);
        resolve();
      });
      wss.on('connection', (ws) => {
        this.clients.add(ws);
        ws.on('message', (data) => this.handle(ws, data.toString()));
        ws.on('close', () => this.clients.delete(ws));
        ws.on('error', () => this.clients.delete(ws));
      });
    });
  }

  stop(): void {
    for (const c of this.clients) c.close();
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
  }

  /** The bound port (useful when started with port 0). */
  address(): number | null {
    const a = this.wss?.address();
    return a && typeof a === 'object' ? a.port : null;
  }

  onParamsUpdate(fn: ParamsUpdateHandler): void {
    this.paramsHandlers.push(fn);
  }
  onSceneLaunched(fn: SceneLaunchedHandler): void {
    this.sceneHandlers.push(fn);
  }

  /** Push a monome event to connected clients (the demo's scripted gesture). */
  injectMonome(ev: MonomeEvent): void {
    const json = JSON.stringify(lichtspielWire('monome.event', ev, this.opts.clock.now()));
    for (const c of this.clients) if (c.readyState === c.OPEN) c.send(json);
  }

  private handle(ws: WebSocket, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.opts.logger.warn('mock Lichtspiel: non-JSON message dropped');
      return;
    }
    if (!isLichtspielWireMessage(parsed)) {
      this.opts.logger.warn('mock Lichtspiel: not a wire message, dropped');
      return;
    }
    const m = parsed as LichtspielWireMessage;
    if (m.type === 'hello') {
      this.send(ws, lichtspielWire('status', this.status(), this.opts.clock.now()));
      return;
    }
    if (m.type === 'params.update') {
      for (const h of this.paramsHandlers) h(m.payload);
      return;
    }
    if (m.type === 'scene.launched') {
      for (const h of this.sceneHandlers) h(m.payload);
    }
  }

  private status(): StatusPayload {
    return {
      bridge: true,
      p5Clients: this.clients.size,
      maxConnected: false,
      monomeConnected: true,
      mlConnected: false,
    };
  }

  private send(ws: WebSocket, m: LichtspielWireMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  }
}
