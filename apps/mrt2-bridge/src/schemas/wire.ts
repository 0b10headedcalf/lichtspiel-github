/**
 * The bridge's OWN message protocol — a rich, versioned, Zod-validated envelope
 * that every internal component speaks. Distinct from the minimal Lichtspiel
 * wire format (see ./lichtspiel.ts); the Lichtspiel adapter down-converts.
 *
 * Envelope: type, schemaVersion, seq (monotonic per source), timestamp, source,
 * sourceInstanceId, sessionId, causeId, parentCauseId?, transport?, payload.
 * causeId/parentCauseId are the substrate for causal-loop prevention.
 */
import { z } from 'zod';
import type { Clock } from '../core/clock.js';
import { SemanticStateSchema, NormalizedGestureSchema } from './semantic.js';
import {
  AudioFeaturesSchema,
  MagentaMetricsSchema,
  MagentaParamsSchema,
  MagentaPromptUpdateSchema,
  MagentaStateSchema,
  MagentaTransportSchema,
} from './magenta.js';
import { AbletonSceneLaunchedSchema, AbletonTransportSchema } from './ableton.js';

export const BRIDGE_SCHEMA_VERSION = 1 as const;

export const SOURCES = ['ableton', 'mrt2', 'lichtspiel', 'monome', 'core', 'demo'] as const;
export const SourceSchema = z.enum(SOURCES);
export type Source = z.infer<typeof SourceSchema>;

// --- payload schemas unique to the bridge protocol ---

export const VisualUpdateSchema = z.object({
  visualCluster: z.string(),
  sceneLock: z.boolean(),
  manualOverride: z.boolean(),
  transitionMs: z.number().min(0),
  visualParamVector: z.array(z.number().min(0).max(1)).length(16),
});
export type VisualUpdate = z.infer<typeof VisualUpdateSchema>;

export const AvStateTransitionSchema = z.object({
  from: z.string(),
  to: z.string(),
  reason: z.string(),
});

export const SystemHealthSchema = z.object({
  ok: z.boolean(),
  degraded: z.boolean(),
  adapters: z.record(z.string(), z.enum(['up', 'down', 'mock', 'disabled'])),
  detail: z.string().optional(),
});
export type SystemHealth = z.infer<typeof SystemHealthSchema>;

// --- the envelope, shared by every message ---

const envelopeBase = {
  schemaVersion: z.literal(BRIDGE_SCHEMA_VERSION),
  seq: z.number().int().min(0),
  timestamp: z.number(),
  source: SourceSchema,
  sourceInstanceId: z.string(),
  sessionId: z.string(),
  causeId: z.string(),
  parentCauseId: z.string().optional(),
  transport: z.object({ bar: z.number(), beat: z.number() }).optional(),
};

export const BridgeMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('magenta.state'), ...envelopeBase, payload: MagentaStateSchema }),
  z.object({ type: z.literal('magenta.prompt.update'), ...envelopeBase, payload: MagentaPromptUpdateSchema }),
  z.object({ type: z.literal('magenta.params.update'), ...envelopeBase, payload: MagentaParamsSchema }),
  z.object({ type: z.literal('magenta.metrics'), ...envelopeBase, payload: MagentaMetricsSchema }),
  z.object({ type: z.literal('magenta.transport'), ...envelopeBase, payload: MagentaTransportSchema }),
  z.object({ type: z.literal('magenta.audio.features'), ...envelopeBase, payload: AudioFeaturesSchema }),
  z.object({ type: z.literal('av.state.transition'), ...envelopeBase, payload: AvStateTransitionSchema }),
  z.object({ type: z.literal('semantic.state'), ...envelopeBase, payload: SemanticStateSchema }),
  z.object({ type: z.literal('semantic.gesture'), ...envelopeBase, payload: NormalizedGestureSchema }),
  z.object({ type: z.literal('ableton.scene.launched'), ...envelopeBase, payload: AbletonSceneLaunchedSchema }),
  z.object({ type: z.literal('ableton.transport'), ...envelopeBase, payload: AbletonTransportSchema }),
  z.object({ type: z.literal('lichtspiel.visual.update'), ...envelopeBase, payload: VisualUpdateSchema }),
  z.object({ type: z.literal('system.health'), ...envelopeBase, payload: SystemHealthSchema }),
]);
export type BridgeMessage = z.infer<typeof BridgeMessageSchema>;

export type BridgeMessageType = BridgeMessage['type'];
export type PayloadFor<T extends BridgeMessageType> = Extract<BridgeMessage, { type: T }>['payload'];
export type MessageFor<T extends BridgeMessageType> = Extract<BridgeMessage, { type: T }>;

/** Monotonic sequence numbers, one counter per source (starts at 0). */
export class SeqCounter {
  private readonly counters = new Map<Source, number>();
  next(source: Source): number {
    const n = this.counters.get(source) ?? 0;
    this.counters.set(source, n + 1);
    return n;
  }
}

export interface CauseRef {
  causeId: string;
  parentCauseId?: string;
}

export interface MakeMessageArgs<T extends BridgeMessageType> {
  type: T;
  source: Source;
  payload: PayloadFor<T>;
  sessionId: string;
  sourceInstanceId: string;
  clock: Clock;
  seq: SeqCounter;
  cause: CauseRef;
  transport?: { bar: number; beat: number };
}

/** Stamp a fully-formed BridgeMessage, bumping the per-source seq counter. */
export function makeMessage<T extends BridgeMessageType>(args: MakeMessageArgs<T>): MessageFor<T> {
  const base = {
    type: args.type,
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    seq: args.seq.next(args.source),
    timestamp: args.clock.now(),
    source: args.source,
    sourceInstanceId: args.sourceInstanceId,
    sessionId: args.sessionId,
    causeId: args.cause.causeId,
    payload: args.payload,
  } as Record<string, unknown>;
  if (args.cause.parentCauseId !== undefined) base['parentCauseId'] = args.cause.parentCauseId;
  if (args.transport !== undefined) base['transport'] = args.transport;
  return base as MessageFor<T>;
}

/** Validate-or-throw. Use at boundaries (sockets, sidecar). */
export function parseMessage(x: unknown): BridgeMessage {
  return BridgeMessageSchema.parse(x);
}

export function safeParseMessage(x: unknown): z.SafeParseReturnType<unknown, BridgeMessage> {
  return BridgeMessageSchema.safeParse(x);
}
