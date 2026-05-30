/**
 * Wire protocol for the live-bridge ↔ {p5, Max, CLI} channels. Every
 * message carries a version `v`, a `ts` (epoch ms), a `type`, and a typed
 * `payload`. This is the runtime source of truth for the WebSocket channel.
 */

import type { LiveSessionState } from './liveSession.js';
import type { DeviceAttached, DeviceDetached, MonomeEvent } from './monome.js';
import type { MutationRequest, VisualRetrievalResult } from './retrieval.js';
import type { VisualParamVector } from './visualParams.js';

export const PROTOCOL_VERSION = 1 as const;

export type WireRole = 'p5' | 'max' | 'cli' | 'bridge';

export interface HelloPayload {
  protocolVersion: typeof PROTOCOL_VERSION;
  role: WireRole;
}

export interface SceneSelectPayload {
  sceneId: string;
}

export interface StatusPayload {
  bridge: boolean;
  p5Clients: number;
  maxConnected: boolean;
  monomeConnected: boolean;
  mlConnected: boolean;
  lastError?: string;
}

export interface LedFramePayload {
  grid?: number[][];
  arc?: number[][];
}

export type WireMessage =
  | { v: 1; ts: number; type: 'hello'; payload: HelloPayload }
  | { v: 1; ts: number; type: 'scene.select'; payload: SceneSelectPayload }
  | { v: 1; ts: number; type: 'params.update'; payload: Partial<VisualParamVector> }
  | { v: 1; ts: number; type: 'live.state'; payload: LiveSessionState }
  | { v: 1; ts: number; type: 'retrieval.result'; payload: VisualRetrievalResult }
  | { v: 1; ts: number; type: 'mutation.request'; payload: MutationRequest }
  | { v: 1; ts: number; type: 'monome.event'; payload: MonomeEvent }
  | { v: 1; ts: number; type: 'device.attached'; payload: DeviceAttached }
  | { v: 1; ts: number; type: 'device.detached'; payload: DeviceDetached }
  | { v: 1; ts: number; type: 'led.frame'; payload: LedFramePayload }
  | { v: 1; ts: number; type: 'status'; payload: StatusPayload };

export type WireType = WireMessage['type'];

export type WirePayload<T extends WireType> = Extract<WireMessage, { type: T }>['payload'];

/** Construct a stamped wire message. `now` defaults to Date.now(). */
export function wire<T extends WireType>(
  type: T,
  payload: WirePayload<T>,
  now: number = Date.now(),
): Extract<WireMessage, { type: T }> {
  return { v: PROTOCOL_VERSION, ts: now, type, payload } as Extract<
    WireMessage,
    { type: T }
  >;
}

export function isWireMessage(x: unknown): x is WireMessage {
  if (typeof x !== 'object' || x === null) return false;
  const m = x as Record<string, unknown>;
  return m['v'] === PROTOCOL_VERSION && typeof m['ts'] === 'number' && typeof m['type'] === 'string';
}

export function isType<T extends WireType>(
  m: WireMessage,
  type: T,
): m is Extract<WireMessage, { type: T }> {
  return m.type === type;
}
