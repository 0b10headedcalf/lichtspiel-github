/**
 * Lichtspiel WebSocket client (Mode 2). Connects to the real bridge (or the
 * bundled mock) at a ws:// URL, announces role 'bridge', and:
 *   - inbound:  monome.event  -> semantic.gesture (a lineage root)
 *   - outbound: lichtspiel.visual.update -> minimal `params.update`
 * Audio never crosses here. Reconnects with capped backoff via the Clock.
 */
import WebSocket from 'ws';
import type { Cancel } from '../core/clock.js';
import { normalizeMonomeEvent } from '../core/semanticState.js';
import { clusterToSceneId, vectorToLichtspielParams } from '../core/promptMapper.js';
import {
  isLichtspielWireMessage,
  lichtspielWire,
  PROTOCOL_VERSION,
  type LichtspielWireMessage,
} from '../schemas/lichtspiel.js';
import type { BridgeMessage } from '../schemas/wire.js';
import { emitFrom, shortId, type BridgeContext, type InboundAdapter, type MessageHandler, type OutboundAdapter } from './types.js';

export interface LichtspielWsClientOptions {
  url: string;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

export class LichtspielWsClient implements InboundAdapter, OutboundAdapter {
  readonly name = 'lichtspiel-client';
  private ws: WebSocket | null = null;
  private readonly handlers: MessageHandler[] = [];
  private readonly instanceId = shortId('lichtspiel-client');
  private closed = false;
  private reconnectCancel: Cancel | null = null;
  private backoffMs: number;

  constructor(
    private readonly ctx: BridgeContext,
    private readonly opts: LichtspielWsClientOptions,
  ) {
    this.backoffMs = opts.initialBackoffMs ?? 500;
  }

  on(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  isReady(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  start(): void {
    this.closed = false;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    this.reconnectCancel?.();
    this.reconnectCancel = null;
    this.ws?.close();
    this.ws = null;
  }

  /** Only visual updates are sent to Lichtspiel, as a minimal params.update. */
  send(m: BridgeMessage): void {
    if (m.type !== 'lichtspiel.visual.update') return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const sceneId = clusterToSceneId(m.payload.visualCluster);
    const params = vectorToLichtspielParams(m.payload.visualParamVector, sceneId);
    this.ws.send(JSON.stringify(lichtspielWire('params.update', params, this.ctx.clock.now())));
  }

  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    ws.on('open', () => {
      this.backoffMs = this.opts.initialBackoffMs ?? 500;
      ws.send(
        JSON.stringify(
          lichtspielWire('hello', { protocolVersion: PROTOCOL_VERSION, role: 'bridge' }, this.ctx.clock.now()),
        ),
      );
      this.ctx.logger.info({ url: this.opts.url }, 'lichtspiel client connected');
    });
    ws.on('message', (data) => this.onMessage(data.toString()));
    ws.on('close', () => {
      this.ws = null;
      this.scheduleReconnect();
    });
    ws.on('error', (err) => this.ctx.logger.warn({ err: String(err) }, 'lichtspiel client socket error'));
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.opts.maxBackoffMs ?? 8000);
    this.reconnectCancel = this.ctx.clock.setTimeout(() => this.connect(), delay);
  }

  private onMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isLichtspielWireMessage(parsed)) return;
    const m = parsed as LichtspielWireMessage;
    if (m.type === 'status') {
      this.ctx.logger.debug({ status: m.payload }, 'lichtspiel status');
      return;
    }
    if (m.type === 'monome.event') {
      const gesture = normalizeMonomeEvent(m.payload);
      const msg = emitFrom(this.ctx, 'monome', this.instanceId, 'semantic.gesture', gesture);
      for (const h of this.handlers) h(msg);
    }
  }
}
