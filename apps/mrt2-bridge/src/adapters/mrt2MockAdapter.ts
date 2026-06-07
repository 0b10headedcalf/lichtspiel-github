/**
 * Mock MRT2. Emits magenta.state (ready), periodic magenta.metrics, and accepts
 * prompt/param control (logs it). `scriptMetrics` schedules telemetry changes
 * over time; `simulateDisconnect` flips connected=false so the bridge holds the
 * last state and goes degraded. Audio never crosses — only control + telemetry.
 */
import type { Cancel } from '../core/clock.js';
import { clamp01 } from '../schemas/semantic.js';
import type { MagentaMetrics } from '../schemas/magenta.js';
import type { BridgeMessage } from '../schemas/wire.js';
import { MRT2_BASE_METRICS, type MetricPatch } from '../demo/fixtures.js';
import {
  emitFrom,
  shortId,
  type BridgeContext,
  type InboundAdapter,
  type MessageHandler,
  type OutboundAdapter,
} from './types.js';

export class Mrt2MockAdapter implements InboundAdapter, OutboundAdapter {
  readonly name = 'mrt2-mock';
  private readonly handlers: MessageHandler[] = [];
  private readonly instanceId = shortId('mrt2-mock');
  private cancels: Cancel[] = [];
  private connected = true;
  private current: MagentaMetrics = { ...MRT2_BASE_METRICS };

  constructor(
    private readonly ctx: BridgeContext,
    private readonly opts: { model: string; metricsTickMs?: number },
  ) {}

  on(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  start(): void {
    this.dispatch(
      emitFrom(this.ctx, 'mrt2', this.instanceId, 'magenta.state', {
        ready: true,
        model: this.opts.model,
        promptBlend: [],
      }),
    );
    const tick = this.opts.metricsTickMs ?? 1000;
    this.cancels.push(this.ctx.clock.setInterval(() => this.emitMetrics(), tick));
  }

  stop(): void {
    for (const c of this.cancels) c();
    this.cancels = [];
  }

  /** Control IN — log prompt/param changes (real adapter would call the runner). */
  send(m: BridgeMessage): void {
    if (m.type === 'magenta.prompt.update') {
      this.ctx.logger.info(
        { prompts: m.payload.promptBlend.map((p) => `${p.text} ${(p.weight * 100) | 0}%`) },
        'mrt2-mock: set prompt blend',
      );
    } else if (m.type === 'magenta.params.update') {
      this.ctx.logger.info({ params: m.payload }, 'mrt2-mock: set params');
    }
  }

  /** Schedule telemetry changes; the next periodic tick reflects them. */
  scriptMetrics(timeline: MetricPatch[]): void {
    for (const { atMs, patch } of timeline) {
      this.cancels.push(
        this.ctx.clock.setTimeout(() => {
          this.current = { ...this.current, ...patch };
          this.emitMetrics();
        }, atMs),
      );
    }
  }

  simulateDisconnect(): void {
    this.connected = false;
    this.emitMetrics();
  }

  private emitMetrics(): BridgeMessage {
    const metrics: MagentaMetrics = {
      ...this.current,
      connected: this.connected,
      bufferOccupancy: clamp01(this.current.bufferOccupancy),
    };
    const msg = emitFrom(this.ctx, 'mrt2', this.instanceId, 'magenta.metrics', metrics);
    this.dispatch(msg);
    return msg;
  }

  private dispatch(m: BridgeMessage): void {
    for (const h of this.handlers) h(m);
  }
}
