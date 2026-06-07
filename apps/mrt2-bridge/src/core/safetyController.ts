/**
 * SafetyController — the ONLY path by which a candidate change becomes an
 * emitted message. Enforces, in strict order:
 *
 *   1. stale-reject   (never act on data older than staleMessageMs)
 *   2. causal-loop    (LineageTracker.wouldLoop)
 *   3. override/lock  (manualOverride pauses automatic; sceneLock blocks visual->audio)
 *   4. rate-limit     (prompt 4/s, param 10/s)
 *   5. deadband       (drop per-vector change < deadband)
 *   6. smoothing      (EMA toward target over smoothingMs)
 *   7. mod-depth      (clampModulation: visual->audio influence <= maxVisualToAudioModDepth)
 *   8. quantization   (prompt + next_bar -> defer to the next downbeat)
 *
 * `emergencyBypass` skips everything and returns the deterministic fallback.
 */
import type { Clock } from './clock.js';
import { LineageTracker, type TargetKind } from './lineageTracker.js';
import type { SafetyConfig } from '../config.js';
import { defaultSemanticState, lerp, type SemanticState } from '../schemas/semantic.js';
import type { BridgeMessage, CauseRef } from '../schemas/wire.js';

export type SafetyAction = 'emit' | 'drop' | 'defer';

export interface SafetyDecision {
  action: SafetyAction;
  reason?: string;
  /** Present when action === 'emit' — possibly smoothed/clamped. */
  message?: BridgeMessage;
  /** Present when action === 'defer'. */
  deferUntilBar?: number;
}

const BAR_EPSILON = 0.05;

const AUTOMATIC_SEMANTIC_TYPES = new Set<BridgeMessage['type']>(['semantic.state', 'magenta.prompt.update']);

function targetKindFor(type: BridgeMessage['type']): TargetKind | null {
  if (type === 'magenta.prompt.update') return 'audio-prompt';
  if (type === 'magenta.params.update') return 'audio-param';
  if (type === 'lichtspiel.visual.update') return 'visual';
  return null;
}

function maxAbsDelta(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let m = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return m;
}

export class SafetyController {
  private sceneLocked = false;
  private manualOverride = false;
  private transport = { bar: 0, beat: 0 };

  private readonly windowHits = new Map<string, number[]>();
  private lastVisualVector: number[] | null = null;
  private lastSmoothMs: number | null = null;
  private deferred: { message: BridgeMessage; deferUntilBar: number } | null = null;

  constructor(
    private readonly cfg: SafetyConfig,
    private readonly clock: Clock,
    private readonly lineage: LineageTracker,
  ) {}

  setSceneLock(on: boolean): void {
    this.sceneLocked = on;
  }
  setManualOverride(on: boolean): void {
    this.manualOverride = on;
  }
  setTransport(t: { bar: number; beat: number }): void {
    this.transport = t;
  }
  isSceneLocked(): boolean {
    return this.sceneLocked;
  }
  isManualOverride(): boolean {
    return this.manualOverride;
  }

  /** The pipeline. */
  admit(input: BridgeMessage): SafetyDecision {
    // 1. stale
    if (this.clock.now() - input.timestamp > this.cfg.staleMessageMs) {
      return { action: 'drop', reason: 'stale' };
    }
    // 2. causal loop
    const target = targetKindFor(input.type);
    if (target) {
      const ref: CauseRef = { causeId: input.causeId };
      if (input.parentCauseId !== undefined) ref.parentCauseId = input.parentCauseId;
      if (this.lineage.wouldLoop(ref, target)) return { action: 'drop', reason: 'loop' };
    }
    // 3. manual override (pauses automatic semantic updates)
    if (this.manualOverride && AUTOMATIC_SEMANTIC_TYPES.has(input.type)) {
      return { action: 'drop', reason: 'override' };
    }

    switch (input.type) {
      case 'magenta.prompt.update':
        return this.admitPrompt(input);
      case 'magenta.params.update':
        return this.admitAudioParam(input);
      case 'lichtspiel.visual.update':
        return this.admitVisual(input);
      default:
        return { action: 'emit', message: input };
    }
  }

  private admitPrompt(input: Extract<BridgeMessage, { type: 'magenta.prompt.update' }>): SafetyDecision {
    // 4. rate-limit
    if (!this.allow('prompt', this.cfg.maxPromptUpdatesPerSecond)) {
      return { action: 'drop', reason: 'rate' };
    }
    // 8. quantization
    if (this.cfg.quantizePromptChanges === 'next_bar' && input.payload.applyAt !== 'immediate') {
      if (this.transport.beat > BAR_EPSILON) {
        const deferUntilBar = Math.floor(this.transport.bar) + 1;
        this.deferred = { message: input, deferUntilBar };
        return { action: 'defer', reason: 'quantize', deferUntilBar };
      }
    }
    return { action: 'emit', message: input };
  }

  private admitAudioParam(input: Extract<BridgeMessage, { type: 'magenta.params.update' }>): SafetyDecision {
    // 3b. scene lock blocks the visual->audio branch
    if (this.sceneLocked) return { action: 'drop', reason: 'scene-lock' };
    // 4. rate-limit (shared param channel)
    if (!this.allow('param', this.cfg.maxParamUpdatesPerSecond)) {
      return { action: 'drop', reason: 'rate' };
    }
    return { action: 'emit', message: input };
  }

  private admitVisual(input: Extract<BridgeMessage, { type: 'lichtspiel.visual.update' }>): SafetyDecision {
    // 4. rate-limit
    if (!this.allow('param', this.cfg.maxParamUpdatesPerSecond)) {
      return { action: 'drop', reason: 'rate' };
    }
    const target = input.payload.visualParamVector;
    // 5. deadband
    if (this.lastVisualVector && maxAbsDelta(target, this.lastVisualVector) < this.cfg.deadband) {
      return { action: 'drop', reason: 'deadband' };
    }
    // 6. smoothing (EMA toward target, time-aware)
    const smoothed = this.smoothVector(target);
    this.lastVisualVector = smoothed;
    const message: BridgeMessage = {
      ...input,
      payload: { ...input.payload, visualParamVector: smoothed },
    };
    return { action: 'emit', message };
  }

  /**
   * 7. Bound a normalized visual->audio modulation delta to the configured
   * mod depth. Used by the orchestrator when nudging MRT2 params from visual
   * state; exposed for direct testing.
   */
  clampModulation(delta: number): number {
    const d = this.cfg.maxVisualToAudioModDepth;
    if (Number.isNaN(delta)) return 0;
    return Math.max(-d, Math.min(d, delta));
  }

  /** Release a deferred prompt change when the transport reaches its downbeat. */
  tickQuantizer(transport: { bar: number; beat: number }): BridgeMessage[] {
    this.transport = transport;
    if (this.deferred && transport.bar >= this.deferred.deferUntilBar) {
      const m = this.deferred.message;
      this.deferred = null;
      return [m];
    }
    return [];
  }

  /** Deterministic fallback state (emergency / degraded). */
  emergencyBypass(): SemanticState {
    return defaultSemanticState();
  }

  private allow(channel: string, perSec: number): boolean {
    const now = this.clock.now();
    const windowStart = now - 1000;
    const hits = (this.windowHits.get(channel) ?? []).filter((t) => t > windowStart);
    if (hits.length >= perSec) {
      this.windowHits.set(channel, hits);
      return false;
    }
    hits.push(now);
    this.windowHits.set(channel, hits);
    return true;
  }

  private smoothVector(target: number[]): number[] {
    const now = this.clock.now();
    if (!this.lastVisualVector || this.lastSmoothMs === null) {
      this.lastSmoothMs = now;
      return target.slice();
    }
    const alpha =
      this.cfg.smoothingMs <= 0 ? 1 : Math.max(0, Math.min(1, (now - this.lastSmoothMs) / this.cfg.smoothingMs));
    this.lastSmoothMs = now;
    const last = this.lastVisualVector;
    return target.map((t, i) => lerp(last[i] ?? t, t, alpha));
  }
}
