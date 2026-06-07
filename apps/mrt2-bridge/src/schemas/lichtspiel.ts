/**
 * A faithful, STANDALONE re-declaration of the subset of Lichtspiel's wire
 * protocol this bridge speaks. Lichtspiel's `@lichtspiel/schemas` is private /
 * workspace-only / plain-TS, so we cannot import it — and re-declaring keeps us
 * portable. These shapes mirror `lichtspiel/packages/schemas/src/wire.ts` and
 * `.../visualParams.ts` EXACTLY (envelope `{v,ts,type,payload}`, the same guard,
 * the same 15 numeric param keys, role `'bridge'`).
 */

export const PROTOCOL_VERSION = 1 as const;

export type WireRole = 'p5' | 'max' | 'cli' | 'bridge';

/** The 15 numeric visual params, in Lichtspiel's exact order. */
export const NUMERIC_PARAM_KEYS = [
  'density',
  'motion',
  'turbulence',
  'symmetry',
  'strobe',
  'cameraDepth',
  'rotationX',
  'rotationY',
  'rotationZ',
  'palette',
  'contrast',
  'lineWeight',
  'feedback',
  'mutationAmount',
  'semanticDistance',
] as const;
export type NumericParamKey = (typeof NUMERIC_PARAM_KEYS)[number];

export interface VisualParamVector {
  /** Names the p5 template (NOT the Ableton scene). Default 'minimalPulse'. */
  sceneId: string;
  density: number;
  motion: number;
  turbulence: number;
  symmetry: number;
  strobe: number;
  cameraDepth: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  palette: number;
  contrast: number;
  lineWeight: number;
  feedback: number;
  mutationAmount: number;
  semanticDistance: number;
}

export const DEFAULT_LICHTSPIEL_SCENE_ID = 'minimalPulse';

export interface HelloPayload {
  protocolVersion: typeof PROTOCOL_VERSION;
  role: WireRole;
}

export interface SceneLaunchedPayload {
  index: number;
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

export interface GridKeyEvent {
  type: 'grid.key';
  deviceId: string;
  x: number;
  y: number;
  state: 0 | 1;
}
export interface ArcDeltaEvent {
  type: 'arc.delta';
  deviceId: string;
  encoder: number;
  delta: number;
}
export interface ArcKeyEvent {
  type: 'arc.key';
  deviceId: string;
  encoder: number;
  state: 0 | 1;
}
export type MonomeEvent = GridKeyEvent | ArcDeltaEvent | ArcKeyEvent;

export type LichtspielWireMessage =
  | { v: 1; ts: number; type: 'hello'; payload: HelloPayload }
  | { v: 1; ts: number; type: 'scene.launched'; payload: SceneLaunchedPayload }
  | { v: 1; ts: number; type: 'params.update'; payload: Partial<VisualParamVector> }
  | { v: 1; ts: number; type: 'monome.event'; payload: MonomeEvent }
  | { v: 1; ts: number; type: 'status'; payload: StatusPayload };

export type LichtspielWireType = LichtspielWireMessage['type'];
export type LichtspielWirePayload<T extends LichtspielWireType> = Extract<
  LichtspielWireMessage,
  { type: T }
>['payload'];

/** Construct a stamped Lichtspiel wire message. `now` is passed in (clock-driven). */
export function lichtspielWire<T extends LichtspielWireType>(
  type: T,
  payload: LichtspielWirePayload<T>,
  now: number,
): Extract<LichtspielWireMessage, { type: T }> {
  return { v: PROTOCOL_VERSION, ts: now, type, payload } as Extract<
    LichtspielWireMessage,
    { type: T }
  >;
}

/** EXACT replica of Lichtspiel's `isWireMessage` guard — intentionally lax. */
export function isLichtspielWireMessage(x: unknown): x is LichtspielWireMessage {
  if (typeof x !== 'object' || x === null) return false;
  const m = x as Record<string, unknown>;
  return m['v'] === PROTOCOL_VERSION && typeof m['ts'] === 'number' && typeof m['type'] === 'string';
}

/** Mirror of Lichtspiel's clamp01 (NaN -> 0). */
export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
