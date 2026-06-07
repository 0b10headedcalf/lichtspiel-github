/**
 * Shared adapter contracts + a small helper for building BridgeMessages from an
 * adapter's context. Inbound adapters emit messages (usually lineage roots);
 * outbound adapters consume them.
 */
import type { Clock } from '../core/clock.js';
import type { Logger } from '../logging.js';
import type { LineageTracker } from '../core/lineageTracker.js';
import {
  makeMessage,
  SeqCounter,
  type BridgeMessage,
  type BridgeMessageType,
  type CauseRef,
  type MessageFor,
  type PayloadFor,
  type Source,
} from '../schemas/wire.js';

export type MessageHandler = (m: BridgeMessage) => void;
export type AdapterStatus = 'up' | 'down' | 'mock' | 'disabled';

export interface InboundAdapter {
  readonly name: string;
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  on(handler: MessageHandler): void;
}

export interface OutboundAdapter {
  readonly name: string;
  send(m: BridgeMessage): void;
}

export interface BridgeContext {
  sessionId: string;
  clock: Clock;
  seq: SeqCounter;
  lineage: LineageTracker;
  logger: Logger;
}

/** Build a message from an adapter; defaults the cause to a fresh lineage root. */
export function emitFrom<T extends BridgeMessageType>(
  ctx: BridgeContext,
  source: Source,
  instanceId: string,
  type: T,
  payload: PayloadFor<T>,
  cause?: CauseRef,
): MessageFor<T> {
  return makeMessage({
    type,
    source,
    payload,
    sessionId: ctx.sessionId,
    sourceInstanceId: instanceId,
    clock: ctx.clock,
    seq: ctx.seq,
    cause: cause ?? ctx.lineage.newRoot(source),
  });
}

let _idCounter = 0;
export function shortId(prefix = 'id'): string {
  _idCounter += 1;
  return `${prefix}-${_idCounter}`;
}
