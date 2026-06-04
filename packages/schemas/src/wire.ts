/**
 * Wire protocol for the live-bridge ↔ {p5, Max, CLI} channels. Every
 * message carries a version `v`, a `ts` (epoch ms), a `type`, and a typed
 * `payload`. This is the runtime source of truth for the WebSocket channel.
 */

import type { AbletonMapping, AbletonSnapshot } from './abletonMapping.js';
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

/** A Session scene was launched in Live (M4L → bridge, Phase 5a). */
export interface SceneLaunchedPayload {
  /** 0-based Session scene index. */
  index: number;
  /** Scene name (may be empty if unnamed). */
  name: string;
}

/** The Arrangement playhead crossed a locator / cue point (M4L → bridge, Phase 5a). */
export interface LocatorCrossedPayload {
  /** 0-based cue-point index, in song-time order. */
  index: number;
  /** Locator name (may be empty if unnamed). */
  name: string;
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
  /**
   * Global grid brightness 0..15 (`/grid/led/intensity`). On a monobright grid
   * (e.g. Grid 64) this is the only brightness control, so the performance
   * feedback + the diagnostic dimmer sweep drive it here. Omitted ⇒ unchanged.
   */
  gridIntensity?: number;
}

/** p5 → bridge: request a fresh snapshot of the Live set's scenes/locators (Phase 5b). */
export type AbletonSnapshotRequestPayload = Record<string, never>;

/** Set-aware preset metadata (bridge → p5) — feeds the panel's Load list. */
export interface MappingPresetInfo {
  name: string;
  /** The set this preset was built for (so the panel can flag matches). */
  setSignature?: string;
  setName?: string;
}

/** p5 → bridge: a mapping-persistence op against the bridge's JSON store (Phase 5b). */
export interface MappingRequestPayload {
  op: 'load' | 'save' | 'list' | 'rename' | 'delete';
  /** Mapping name (load/save/rename/delete — the source name for rename). */
  name?: string;
  /** New name (rename only). */
  newName?: string;
  /** The mapping to persist (save). */
  mapping?: AbletonMapping;
}

/** bridge → p5: the result of a mapping op. */
export interface MappingResultPayload {
  op: 'load' | 'save' | 'list' | 'rename' | 'delete';
  ok: boolean;
  name?: string;
  mapping?: AbletonMapping;
  /** Set-aware preset list (list/save/rename/delete replies). */
  presets?: MappingPresetInfo[];
  error?: string;
}

/** p5 → bridge: confirms a visual was activated (latency-metric groundwork, Phase 5b). */
export interface VisualActivatedPayload {
  kind: 'scene' | 'locator';
  index: number;
  name: string;
  templateId: string;
  variantMode: 'canonical' | 'random';
  /** epoch ms when p5 activated the visual. */
  activatedAt: number;
}

export type WireMessage =
  | { v: 1; ts: number; type: 'hello'; payload: HelloPayload }
  | { v: 1; ts: number; type: 'scene.select'; payload: SceneSelectPayload }
  | { v: 1; ts: number; type: 'scene.launched'; payload: SceneLaunchedPayload }
  | { v: 1; ts: number; type: 'locator.crossed'; payload: LocatorCrossedPayload }
  | { v: 1; ts: number; type: 'params.update'; payload: Partial<VisualParamVector> }
  | { v: 1; ts: number; type: 'live.state'; payload: LiveSessionState }
  | { v: 1; ts: number; type: 'retrieval.result'; payload: VisualRetrievalResult }
  | { v: 1; ts: number; type: 'mutation.request'; payload: MutationRequest }
  | { v: 1; ts: number; type: 'monome.event'; payload: MonomeEvent }
  | { v: 1; ts: number; type: 'device.attached'; payload: DeviceAttached }
  | { v: 1; ts: number; type: 'device.detached'; payload: DeviceDetached }
  | { v: 1; ts: number; type: 'led.frame'; payload: LedFramePayload }
  | { v: 1; ts: number; type: 'ableton.snapshotRequest'; payload: AbletonSnapshotRequestPayload }
  | { v: 1; ts: number; type: 'ableton.snapshot'; payload: AbletonSnapshot }
  | { v: 1; ts: number; type: 'mapping.request'; payload: MappingRequestPayload }
  | { v: 1; ts: number; type: 'mapping.result'; payload: MappingResultPayload }
  | { v: 1; ts: number; type: 'visual.activated'; payload: VisualActivatedPayload }
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
