/**
 * Mock monome input. Turns raw grid/arc events into bounded semantic.gesture
 * messages. In Mode 2 the same gestures arrive as real monome.event frames via
 * the Lichtspiel client; both normalize identically (normalizeMonomeEvent).
 */
import { normalizeMonomeEvent } from '../core/semanticState.js';
import type { MonomeEvent } from '../schemas/lichtspiel.js';
import type { BridgeMessage } from '../schemas/wire.js';
import { emitFrom, shortId, type BridgeContext, type InboundAdapter, type MessageHandler } from './types.js';

export class MonomeMockAdapter implements InboundAdapter {
  readonly name = 'monome-mock';
  private readonly handlers: MessageHandler[] = [];
  private readonly instanceId = shortId('monome-mock');

  constructor(private readonly ctx: BridgeContext) {}

  on(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  start(): void {
    /* nothing to start — gestures are emitted on demand */
  }
  stop(): void {
    /* nothing to stop */
  }

  emitEvent(ev: MonomeEvent): BridgeMessage {
    const gesture = normalizeMonomeEvent(ev);
    const msg = emitFrom(this.ctx, 'monome', this.instanceId, 'semantic.gesture', gesture);
    for (const h of this.handlers) h(msg);
    return msg;
  }

  emitArcDelta(encoder: number, delta: number): BridgeMessage {
    return this.emitEvent({ type: 'arc.delta', deviceId: 'arc-mock', encoder, delta });
  }

  emitGridKey(x: number, y: number, state: 0 | 1): BridgeMessage {
    return this.emitEvent({ type: 'grid.key', deviceId: 'grid-mock', x, y, state });
  }
}
