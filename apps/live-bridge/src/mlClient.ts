/**
 * ML retrieval client — POSTs LiveSessionState snapshots to the Python
 * ml-service (`POST /retrieve`) and returns a VisualRetrievalResult for the
 * bridge to fan out to p5 as a `retrieval.result`.
 *
 * Design: fire-and-forget + debounced on the *selection* (never per transport
 * tick — the feeder pushes live.state on a ~50 ms loop), with a hard per-request
 * timeout. The performance path NEVER depends on this: any failure (service
 * down, timeout, non-200, bad JSON) resolves to `null` and the bridge keeps
 * forwarding raw Live state, so manual control still works. Honors AGENTS.md —
 * the bridge itself imports no model, only talks HTTP to the optional sidecar.
 */

import type { LiveSessionState, VisualRetrievalResult } from '@lichtspiel/schemas';
import { logger } from './log.js';

export interface MlClientOptions {
  host: string;
  port: number;
  /** When false, `retrieve()` is a no-op (manual mode). */
  enabled: boolean;
  /** Per-request timeout in ms (default 750). */
  timeoutMs?: number;
  /** Floor between successive retrievals, even when the selection changes (default 150 ms). */
  minIntervalMs?: number;
}

export class MlClient {
  private readonly base: string;
  private readonly enabled: boolean;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private lastKey = '';
  private lastAt = 0;
  private connected = false;
  /** Notified when connectivity flips (so the bridge can refresh /status). */
  onConnectedChange?: (connected: boolean) => void;

  constructor(opts: MlClientOptions) {
    this.base = `http://${opts.host}:${opts.port}`;
    this.enabled = opts.enabled;
    this.timeoutMs = opts.timeoutMs ?? 750;
    this.minIntervalMs = opts.minIntervalMs ?? 150;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Stable key for the *selection* — retrieval only fires when this changes. */
  private static selectionKey(s: LiveSessionState): string {
    const sel = s.selection;
    return `${sel.trackIndex}:${sel.sceneIndex}:${sel.clipSlotIndex}:${s.clip.audioFilePath ?? ''}`;
  }

  /**
   * POST the state to the sidecar and resolve the retrieval result — or `null`
   * when skipped (disabled / unchanged selection / rate-limited) or on any
   * failure. Never throws.
   */
  async retrieve(
    state: LiveSessionState,
    now: number = Date.now(),
  ): Promise<VisualRetrievalResult | null> {
    if (!this.enabled) return null;
    const key = MlClient.selectionKey(state);
    if (key === this.lastKey) return null; // selection unchanged → nothing new to retrieve
    if (now - this.lastAt < this.minIntervalMs) return null; // distinct, but too soon — retry next tick
    this.lastKey = key;
    this.lastAt = now;

    try {
      const res = await fetch(`${this.base}/retrieve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(state),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        this.setConnected(false);
        logger.warn('ml retrieve non-200', {
          source: 'ml',
          target: 'p5',
          type: 'retrieval.result',
          error: `HTTP ${res.status}`,
        });
        return null;
      }
      const body = (await res.json()) as VisualRetrievalResult;
      this.setConnected(true);
      logger.info('ml retrieve', {
        source: 'ml',
        target: 'p5',
        type: 'retrieval.result',
        summary: `${body.sceneId} (conf ${body.confidence})`,
      });
      return body;
    } catch (err) {
      this.setConnected(false);
      logger.warn('ml retrieve failed', {
        source: 'ml',
        target: 'p5',
        type: 'retrieval.result',
        error: String(err),
      });
      return null;
    }
  }

  /** One-shot connectivity probe for /status (`GET /health`). Never throws. */
  async probeHealth(): Promise<void> {
    if (!this.enabled) return;
    try {
      const res = await fetch(`${this.base}/health`, { signal: AbortSignal.timeout(this.timeoutMs) });
      this.setConnected(res.ok);
    } catch {
      this.setConnected(false);
    }
  }

  private setConnected(connected: boolean): void {
    if (connected === this.connected) return;
    this.connected = connected;
    logger.info(`ml-service ${connected ? 'connected' : 'unreachable'}`, { source: 'ml' });
    this.onConnectedChange?.(connected);
  }
}
