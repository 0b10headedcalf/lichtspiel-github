/**
 * Mock Ableton input. Simulates scene launches and is the CANONICAL transport
 * source (bar/beat derived from the clock) that drives prompt quantization.
 */
import type { Cancel } from '../core/clock.js';
import type { BridgeMessage } from '../schemas/wire.js';
import { emitFrom, shortId, type BridgeContext, type InboundAdapter, type MessageHandler } from './types.js';

export interface AbletonTransportPos {
  bar: number;
  beat: number;
}

export class AbletonMockAdapter implements InboundAdapter {
  readonly name = 'ableton-mock';
  private readonly handlers: MessageHandler[] = [];
  private readonly instanceId = shortId('ableton-mock');
  private startMs = 0;
  private cancels: Cancel[] = [];

  constructor(
    private readonly ctx: BridgeContext,
    private readonly opts: { bpm: number; beatsPerBar: number; transportTickMs?: number },
  ) {}

  on(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  start(): void {
    this.startMs = this.ctx.clock.now();
    const tick = this.opts.transportTickMs ?? 250;
    this.cancels.push(this.ctx.clock.setInterval(() => this.emitTransport(), tick));
  }

  stop(): void {
    for (const c of this.cancels) c();
    this.cancels = [];
  }

  /** Bars are 1-based; beat is 0-based within the bar. */
  transport(): AbletonTransportPos {
    const elapsedSec = Math.max(0, this.ctx.clock.now() - this.startMs) / 1000;
    const beatsTotal = elapsedSec * (this.opts.bpm / 60);
    const bar = Math.floor(beatsTotal / this.opts.beatsPerBar) + 1;
    const beat = beatsTotal % this.opts.beatsPerBar;
    return { bar, beat };
  }

  launchScene(sceneIndex: number, sceneName: string): BridgeMessage {
    const t = this.transport();
    const msg = emitFrom(this.ctx, 'ableton', this.instanceId, 'ableton.scene.launched', {
      sceneName,
      sceneIndex,
      bar: t.bar,
      beat: t.beat,
    });
    this.dispatch(msg);
    return msg;
  }

  emitTransport(): BridgeMessage {
    const t = this.transport();
    const msg = emitFrom(this.ctx, 'ableton', this.instanceId, 'ableton.transport', {
      bar: t.bar,
      beat: t.beat,
      bpm: this.opts.bpm,
      playing: true,
    });
    this.dispatch(msg);
    return msg;
  }

  private dispatch(m: BridgeMessage): void {
    for (const h of this.handlers) h(m);
  }
}
