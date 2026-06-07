/**
 * audioReactive — drive the visual param vector AND animation swaps from a LIVE
 * audio input (e.g. an effected electric guitar). Opt-in; off by default.
 *
 * Each animation frame it captures the chosen input via Web Audio and extracts:
 *   loudness (RMS), low/mid/high band energy, spectral brightness (centroid),
 *   onset transients (spectral flux), and monophonic pitch (autocorrelation).
 * Features are enveloped (fast attack / slow release) and mapped to an
 * "audio-owned" subset of params via `onParams` (the monome/keyboard keep the
 * rest — last-writer-wins). Separately it watches for musical EVENTS — a
 * >1.5-octave note jump, or a sustained timbre shift — and fires `onSwapTrigger`
 * so the host can crossfade to a different scene. `readout()` exposes the live
 * pitch/note for the HUD ("live feedback").
 *
 * 100% local (Web Audio) — no network. Pitch is best-effort + monophonic, gated
 * by loudness + confidence, so heavy distortion / chords may be unreliable.
 *
 * URL opts: ?audioInput=<label substr> (e.g. Loopback) · ?audioGain=<n>.
 */
import { type VisualParamVector, type NumericParamKey, clamp01 } from '@lichtspiel/schemas';

export interface AudioReactiveStatus {
  enabled: boolean;
  device?: string;
  error?: string;
}

export interface SwapTrigger {
  reason: 'pitch-jump' | 'timbre-shift';
  detail: string;
}

export interface AudioReadout {
  pitchHz: number;
  note: string;
  conf: number;
  lastTrigger: string;
}

export interface AudioReactiveOptions {
  /** ~60 Hz param patch derived from the live audio. Wire to host.setTargetParams. */
  onParams: (patch: Partial<VisualParamVector>) => void;
  /** Enabled/device/error notifications (for the HUD or console). */
  onStatus?: (s: AudioReactiveStatus) => void;
  /** Fired when the audio suggests an animation swap. The HOST gates it (cooldown + lock). */
  onSwapTrigger?: (t: SwapTrigger) => void;
  /** Prefer an input whose label contains this substring (e.g. "Loopback", "Scarlett"). */
  preferDeviceLabel?: string;
  /** Overall sensitivity multiplier for the param mapping (default 1). */
  gain?: number;
  /** Octave jump that fires a pitch swap (default 1.5; lower = more sensitive). */
  jumpOctaves?: number;
  /** Brightness departure that fires a timbre swap (default 0.18; lower = more sensitive). */
  timbreDelta?: number;
}

type FeatureKey = 'rms' | 'low' | 'mid' | 'high' | 'centroid' | 'onset';
type Features = Record<FeatureKey, number>;

interface Mapping {
  param: NumericParamKey;
  from: FeatureKey;
  /** feature(0..1) × scale → param, then clamped to 0..1. */
  scale: number;
}

/** Default feature→param routing. Edit freely; each maps a 0..1 feature to a 0..1 param. */
const DEFAULT_MAP: Mapping[] = [
  { param: 'motion', from: 'rms', scale: 3.2 }, // how hard you play → overall energy
  { param: 'cameraDepth', from: 'low', scale: 2.2 }, // bass / palm-mutes → push-pull
  { param: 'contrast', from: 'mid', scale: 1.8 }, // midrange body → contrast
  { param: 'turbulence', from: 'high', scale: 2.6 }, // pick noise / air → chaos
  { param: 'palette', from: 'centroid', scale: 1.0 }, // tone brightness (wah/tone) → color
  { param: 'strobe', from: 'onset', scale: 1.0 }, // pick attacks → flashes
];

const ZERO: Features = { rms: 0, low: 0, mid: 0, high: 0, centroid: 0, onset: 0 };

// ── Pitch + swap-trigger tuning ──────────────────────────────────────
const MIN_F0_HZ = 80; // ~low-E open-string region
const MAX_F0_HZ = 1200; // upper guitar range
const PITCH_CONF_MIN = 0.9; // normalized autocorrelation peak to trust a pitch
const RMS_GATE = 0.012; // ignore near-silence for pitch + triggers
const STABLE_FRAMES = 3; // frames a note must hold to count as "played"
const NOTE_TOL_OCT = 0.04; // ~½ semitone: same-note tolerance (octaves)
const JUMP_OCT = 1.5; // octave jump that fires a swap
const TIMBRE_DELTA = 0.18; // centroid departure from baseline that fires a swap
const TIMBRE_BASE_K = 0.02; // slow baseline EMA for timbre
const REFRACTORY_MS = 600; // internal min between trigger fires (host owns the real cooldown)

export class AudioReactive {
  private readonly opts: AudioReactiveOptions;
  private readonly map: Mapping[] = DEFAULT_MAP;

  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private freq = new Uint8Array(0);
  private time = new Float32Array(0);
  private prevMag = new Float32Array(0);
  private raf = 0;
  private enabled = false;
  private env: Features = { ...ZERO };

  // pitch + note-jump tracking
  private pitchHz = 0;
  private pitchConf = 0;
  private stableHz = 0; // currently-held note
  private candHz = 0; // candidate note being confirmed
  private candFrames = 0;
  private candConfirmed = false;
  // timbre-shift tracking
  private centroidBaseline = -1;
  private refractoryUntil = 0;
  private lastTrigger = '';

  constructor(opts: AudioReactiveOptions) {
    this.opts = opts;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Live pitch/note + last swap trigger, for the HUD. */
  readout(): AudioReadout {
    return {
      pitchHz: this.pitchHz,
      note: hzToNote(this.pitchHz),
      conf: this.pitchConf,
      lastTrigger: this.lastTrigger,
    };
  }

  async toggle(): Promise<void> {
    if (this.enabled) this.disable();
    else await this.enable();
  }

  /** Live-update the swap-trigger sensitivity (the on-screen `j` control). */
  setSensitivity(s: { jumpOctaves?: number; timbreDelta?: number }): void {
    if (s.jumpOctaves !== undefined) this.opts.jumpOctaves = s.jumpOctaves;
    if (s.timbreDelta !== undefined) this.opts.timbreDelta = s.timbreDelta;
  }

  /** List available audio inputs (labels populate only after permission is granted). */
  async listInputs(): Promise<MediaDeviceInfo[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }

  async enable(): Promise<void> {
    if (this.enabled) return;
    try {
      // Disable the browser's voice processing — it would mangle a guitar.
      const base: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };
      let stream = await navigator.mediaDevices.getUserMedia({ audio: base });
      let device = stream.getAudioTracks()[0]?.label || 'default input';

      // Switch to a preferred device by label substring, if requested + found.
      const want = this.opts.preferDeviceLabel?.toLowerCase();
      if (want) {
        const inputs = await this.listInputs();
        const match = inputs.find((d) => d.label.toLowerCase().includes(want));
        if (match && match.deviceId) {
          stream.getTracks().forEach((t) => t.stop());
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { ...base, deviceId: { exact: match.deviceId } },
          });
          device = match.label || device;
        }
      }
      this.stream = stream;

      const ctx = new AudioContext();
      await ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      src.connect(analyser);

      this.ctx = ctx;
      this.analyser = analyser;
      this.freq = new Uint8Array(analyser.frequencyBinCount);
      this.time = new Float32Array(analyser.fftSize);
      this.prevMag = new Float32Array(analyser.frequencyBinCount);
      this.resetDetectors();
      this.enabled = true;
      this.opts.onStatus?.({ enabled: true, device });
      this.loop();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.onStatus?.({ enabled: false, error: message });
      this.disable();
    }
  }

  disable(): void {
    this.enabled = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    this.opts.onStatus?.({ enabled: false });
  }

  private resetDetectors(): void {
    this.env = { ...ZERO };
    this.pitchHz = 0;
    this.pitchConf = 0;
    this.stableHz = 0;
    this.candHz = 0;
    this.candFrames = 0;
    this.candConfirmed = false;
    this.centroidBaseline = -1;
    this.refractoryUntil = 0;
  }

  private loop = (): void => {
    if (!this.enabled || !this.analyser || !this.ctx) return;
    this.raf = requestAnimationFrame(this.loop);

    this.analyser.getFloatTimeDomainData(this.time);
    this.analyser.getByteFrequencyData(this.freq);
    const sampleRate = this.ctx.sampleRate;
    const f = this.extract(sampleRate);

    // ── params (audio-owned subset) — fast attack / slow release ──
    this.env.rms = approach(f.rms, this.env.rms, 0.5, 0.12);
    this.env.low = approach(f.low, this.env.low, 0.5, 0.12);
    this.env.mid = approach(f.mid, this.env.mid, 0.5, 0.12);
    this.env.high = approach(f.high, this.env.high, 0.6, 0.15);
    this.env.centroid = approach(f.centroid, this.env.centroid, 0.3, 0.08);
    this.env.onset = Math.max(f.onset, this.env.onset * 0.82);

    const gain = this.opts.gain ?? 1;
    const patch: Partial<VisualParamVector> = {};
    for (const m of this.map) {
      patch[m.param] = clamp01(this.env[m.from] * m.scale * gain);
    }
    this.opts.onParams(patch);

    // ── swap triggers (events, not params) ──
    this.detectTriggers(f, sampleRate);
  };

  private detectTriggers(f: Features, sampleRate: number): void {
    const now = performance.now();
    const gated = f.rms >= RMS_GATE;
    const jumpOct = this.opts.jumpOctaves ?? JUMP_OCT;
    const timbreDelta = this.opts.timbreDelta ?? TIMBRE_DELTA;

    const { hz, conf } = this.detectPitch(sampleRate);
    this.pitchHz = gated ? hz : 0;
    this.pitchConf = conf;

    // slow timbre baseline (tracks the "current tone" so only departures fire)
    if (this.centroidBaseline < 0) this.centroidBaseline = f.centroid;
    else this.centroidBaseline += (f.centroid - this.centroidBaseline) * TIMBRE_BASE_K;

    if (now < this.refractoryUntil) return;

    // pitch-jump: confirm a stable note, compare to the previous stable note.
    if (gated && conf >= PITCH_CONF_MIN && hz > 0) {
      if (this.candHz > 0 && Math.abs(Math.log2(hz / this.candHz)) < NOTE_TOL_OCT) {
        this.candFrames++;
      } else {
        this.candHz = hz;
        this.candFrames = 1;
        this.candConfirmed = false;
      }
      if (!this.candConfirmed && this.candFrames >= STABLE_FRAMES) {
        this.candConfirmed = true;
        const isNewNote =
          this.stableHz <= 0 || Math.abs(Math.log2(this.candHz / this.stableHz)) >= NOTE_TOL_OCT;
        if (isNewNote) {
          const prev = this.stableHz;
          this.stableHz = this.candHz;
          if (prev > 0) {
            const oct = Math.abs(Math.log2(this.stableHz / prev));
            if (oct >= jumpOct) {
              this.fire('pitch-jump', `${hzToNote(prev)}→${hzToNote(this.stableHz)} ${oct.toFixed(1)}oct`, now);
              return;
            }
          }
        }
      }
    }

    // timbre-shift: brightness departs the slow baseline (clean↔distorted / rhythm↔lead).
    const dCent = Math.abs(f.centroid - this.centroidBaseline);
    if (gated && dCent >= timbreDelta) {
      this.fire('timbre-shift', `Δbright ${dCent.toFixed(2)}`, now);
      this.centroidBaseline = f.centroid; // re-anchor so the new tone doesn't re-fire
    }
  }

  private fire(reason: SwapTrigger['reason'], detail: string, now: number): void {
    this.refractoryUntil = now + REFRACTORY_MS;
    this.lastTrigger = `${reason} · ${detail}`;
    this.opts.onSwapTrigger?.({ reason, detail });
  }

  /** Monophonic pitch via normalized autocorrelation over the guitar range. */
  private detectPitch(sampleRate: number): { hz: number; conf: number } {
    const buf = this.time;
    const n = buf.length;
    let e0 = 0;
    for (let i = 0; i < n; i++) e0 += buf[i] * buf[i];
    if (e0 <= 1e-6) return { hz: 0, conf: 0 };
    const minLag = Math.max(2, Math.floor(sampleRate / MAX_F0_HZ));
    const maxLag = Math.min(n - 1, Math.ceil(sampleRate / MIN_F0_HZ));
    let bestLag = -1;
    let bestCorr = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0;
      for (let i = 0; i < n - lag; i++) c += buf[i] * buf[i + lag];
      const norm = c / e0;
      if (norm > bestCorr) {
        bestCorr = norm;
        bestLag = lag;
      }
    }
    if (bestLag < 0) return { hz: 0, conf: 0 };
    return { hz: sampleRate / bestLag, conf: bestCorr };
  }

  private extract(sampleRate: number): Features {
    const time = this.time;
    const freq = this.freq;
    const bins = freq.length;

    // RMS loudness from the float time-domain waveform (-1..1).
    let sumSq = 0;
    for (let i = 0; i < time.length; i++) {
      const v = time[i];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, time.length));

    // Band energies by frequency range.
    const nyquist = sampleRate / 2;
    const binHz = nyquist / Math.max(1, bins);
    const band = (loHz: number, hiHz: number): number => {
      const lo = clampIdx(Math.round(loHz / binHz), bins);
      const hi = clampIdx(Math.round(hiHz / binHz), bins);
      let s = 0;
      let nn = 0;
      for (let i = lo; i <= hi; i++) {
        s += freq[i];
        nn++;
      }
      return nn > 0 ? s / nn / 255 : 0;
    };
    const low = band(40, 250);
    const mid = band(250, 2000);
    const high = band(2000, 8000);

    // Spectral centroid (brightness), normalized over a guitar-ish 0..4kHz span.
    let num = 0;
    let den = 0;
    for (let i = 0; i < bins; i++) {
      const mag = freq[i] / 255;
      num += i * mag;
      den += mag;
    }
    const centroidHz = (den > 0 ? num / den : 0) * binHz;
    const centroid = clamp01(centroidHz / 4000);

    // Spectral flux → onset strength (sum of positive bin-to-bin increases).
    let flux = 0;
    for (let i = 0; i < bins; i++) {
      const mag = freq[i] / 255;
      const d = mag - this.prevMag[i];
      if (d > 0) flux += d;
      this.prevMag[i] = mag;
    }
    const onset = clamp01((flux / Math.max(1, bins)) * 8);

    return { rms, low, mid, high, centroid, onset };
  }
}

/** Asymmetric one-pole: rising values use `atk`, falling values use `rel`. */
function approach(target: number, current: number, atk: number, rel: number): number {
  const k = target > current ? atk : rel;
  return current + (target - current) * k;
}

function clampIdx(i: number, bins: number): number {
  if (i < 0) return 0;
  if (i > bins - 1) return bins - 1;
  return i;
}

/** Frequency → nearest note name (e.g. 110 → "A2"). */
function hzToNote(hz: number): string {
  if (hz <= 0) return '–';
  const midi = Math.round(12 * Math.log2(hz / 440)) + 69;
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const name = names[((midi % 12) + 12) % 12];
  return `${name}${Math.floor(midi / 12) - 1}`;
}
