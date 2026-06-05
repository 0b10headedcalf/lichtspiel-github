/**
 * Takeover clock (Phase 5b refinements, Part 2) — a local musical clock that, when
 * enabled, generates synthetic monome gestures locked to the tempo so the
 * animation keeps "playing" hands-free (e.g. while the performer launches scenes
 * from another controller). Pure + deterministic: it holds BPM + play-state (from
 * Live via the feeder's transport, or a manual fallback) and `tick(now)` returns
 * the `MonomeEvent`s to emit this frame. The caller emits them on the SAME bus
 * real input uses, so the idiom layer drives the CURRENT sketch and the twin +
 * hardware LEDs reflect it. Real input stays live (blended). Never switches templates.
 *
 * No constant pulse from Live is needed: the clock free-runs from BPM and only
 * re-phases to Live's bar position when a transport update arrives (~every 300 ms).
 */

import type { MonomeEvent, MonomeSetup } from '@lichtspiel/schemas';

export interface TakeoverTransport {
  /** Beats per minute. */
  tempo: number;
  isPlaying: boolean;
  /** Song position in beats (for phase-alignment to Live's bars). */
  beat: number;
}

export interface TakeoverClockOptions {
  /** BPM used when no live transport is present (standalone). */
  manualBpm?: number;
  /** Beats per bar (the downbeat cadence). */
  beatsPerBar?: number;
  /** Arc delta magnitude per beat sweep. */
  arcStep?: number;
}

const DEFAULT_BPM = 120;
const DEFAULT_BEATS_PER_BAR = 4;
const DEFAULT_ARC_STEP = 6;
/** Cap per-tick catch-up so a long pause / playhead jump never bursts a flurry of beats. */
const MAX_DT_MS = 250;

export class TakeoverClock {
  private enabled = false;
  private setup: MonomeSetup | null = null;
  private hasLiveTransport = false;
  private liveTempo = DEFAULT_BPM;
  private liveIsPlaying = false;
  private manualBpm: number;
  private readonly beatsPerBar: number;
  private readonly arcStep: number;
  private lastNow = -1; // -1 = unanchored (so a tick at now=0 still works)
  private phaseMs = 0; // elapsed ms into the current beat
  private beatIdx = -1; // running beat counter; parity = bar position; -1 so the first beat is a downbeat

  constructor(opts: TakeoverClockOptions = {}) {
    this.manualBpm = opts.manualBpm ?? DEFAULT_BPM;
    this.beatsPerBar = opts.beatsPerBar ?? DEFAULT_BEATS_PER_BAR;
    this.arcStep = opts.arcStep ?? DEFAULT_ARC_STEP;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    // Restart cleanly so gestures begin on a downbeat.
    this.phaseMs = 0;
    this.beatIdx = -1;
    this.lastNow = -1;
  }

  setProfile(setup: MonomeSetup): void {
    this.setup = setup;
  }

  setManualBpm(bpm: number): void {
    if (bpm > 0) this.manualBpm = bpm;
  }

  /** Feed the live transport (BPM + play-state + song position). */
  setTransport(t: TakeoverTransport): void {
    this.hasLiveTransport = true;
    if (t.tempo > 0) this.liveTempo = t.tempo;
    this.liveIsPlaying = t.isPlaying;
    // Re-phase to Live's bar position (drift correction; does NOT emit beats).
    if (Number.isFinite(t.beat) && t.beat >= 0) {
      this.beatIdx = Math.floor(t.beat);
      this.phaseMs = (t.beat - this.beatIdx) * this.beatDurMs();
    }
  }

  /** BPM in effect — live tempo when present, else the manual fallback. */
  bpm(): number {
    return this.hasLiveTransport ? this.liveTempo : this.manualBpm;
  }

  /** Whether a live transport feed is driving the clock (for the twin readout). */
  hasTransport(): boolean {
    return this.hasLiveTransport;
  }

  private beatDurMs(): number {
    return 60000 / Math.max(1, this.bpm());
  }

  /** Advance the clock to `now` (ms); return the synthetic events to emit this tick. */
  tick(now: number): MonomeEvent[] {
    if (!this.enabled) {
      this.lastNow = now;
      return [];
    }
    // Gate: with a live transport, only run while Live is playing; standalone runs whenever enabled.
    const running = this.hasLiveTransport ? this.liveIsPlaying : true;
    if (!running || this.lastNow < 0) {
      this.lastNow = now; // anchor (first tick / resume) so dt never jumps
      return [];
    }

    let dt = now - this.lastNow;
    this.lastNow = now;
    if (dt <= 0) return [];
    if (dt > MAX_DT_MS) dt = 0; // skip the gap after a pause / jump — re-anchor, don't burst

    const out: MonomeEvent[] = [];
    const beatDur = this.beatDurMs();
    this.phaseMs += dt;
    let guard = 0;
    while (this.phaseMs >= beatDur && guard++ < 8) {
      this.phaseMs -= beatDur;
      this.beatIdx += 1;
      this.emitBeat(this.beatIdx, out);
    }
    return out;
  }

  /** One beat's worth of gestures: an encoder sweep; on the downbeat, presses. */
  private emitBeat(beat: number, out: MonomeEvent[]): void {
    const encoders = this.setup?.arc?.encoders ?? 0;
    const cols = this.setup?.grid?.cols ?? 0;
    const rows = this.setup?.grid?.rows ?? 0;
    const arcId = this.setup?.arc?.serial ?? 'arc';
    const gridId = this.setup?.grid?.serial ?? 'grid';
    const bar = Math.floor(beat / this.beatsPerBar);
    const downbeat = beat % this.beatsPerBar === 0;

    // Encoder sweep every beat: cycle encoders, flip direction each bar so the
    // mapped params oscillate up then down instead of pinning at a rail.
    if (encoders > 0) {
      const enc = beat % encoders;
      const dir = bar % 2 === 0 ? 1 : -1;
      out.push({ type: 'arc.delta', deviceId: arcId, encoder: enc, delta: this.arcStep * dir });
    }

    if (downbeat) {
      // Arc press (a within-sketch action) on encoder 0 — a tap (press + release).
      if (encoders > 0) {
        out.push({ type: 'arc.key', deviceId: arcId, encoder: 0, state: 1 });
        out.push({ type: 'arc.key', deviceId: arcId, encoder: 0, state: 0 });
      }
      // Grid press: a walking cell (column across bars, row stepping) — taps a
      // fader / step / paint cell in whatever idiom the current sketch uses.
      if (cols > 0 && rows > 0) {
        const x = bar % cols;
        const y = (bar * 2) % rows;
        out.push({ type: 'grid.key', deviceId: gridId, x, y, state: 1 });
        out.push({ type: 'grid.key', deviceId: gridId, x, y, state: 0 });
      }
    }
  }
}
