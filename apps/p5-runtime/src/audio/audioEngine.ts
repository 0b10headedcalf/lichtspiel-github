/**
 * AudioEngine — live Web Audio capture + per-frame feature extraction. The
 * "incoming audio signal" half of the audio-reactive layer: it taps a mic /
 * line-in / loopback device (e.g. BlackHole carrying Ableton's master) through
 * an AnalyserNode and distils each frame into a small AudioFeatures vector —
 * level + bass/lowMid/mid/treble bands + spectral centroid + flux/onset beat.
 *
 * Deliberately decoupled from the visuals' control surface: it NEVER touches the
 * VisualParamVector the monome drives. Its features feed the distortion post-FX
 * (see audioMapping + distortionLayer), which warps pixels — a different axis
 * entirely from the monome's param-fader control of scene content.
 *
 * Browser-only, no bridge/Ableton required. The AudioContext is created lazily
 * on start() (a user gesture from the panel's Enable button) so autoplay
 * policies are satisfied; the analyser is a pure sink (never connected to the
 * destination) so the input is read silently with no monitoring feedback.
 */

import { type AudioFeatures, SILENT_FEATURES, clamp01 } from '@lichtspiel/schemas';

export interface AudioInputInfo {
  deviceId: string;
  label: string;
}

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** One-pole envelope follower with separate attack/release coefficients. */
function follow(prev: number, target: number, attack: number, release: number): number {
  const k = target > prev ? attack : release;
  return prev + (target - prev) * k;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;

  private readonly fftSize: number;
  private freq = new Uint8Array(0);
  private time = new Uint8Array(0);
  private prevSpectrum = new Float32Array(0);

  private sensitivity = 1;
  private running = false;
  private deviceId: string | null = null;

  // Smoothed feature envelopes (so the distortion glides rather than jitters).
  private readonly env: AudioFeatures = { ...SILENT_FEATURES };
  private fluxAvg = 0; // running mean of flux → adaptive onset threshold
  private beatEnv = 0;

  constructor(opts: { fftSize?: number } = {}) {
    this.fftSize = opts.fftSize ?? 2048;
  }

  isRunning(): boolean {
    return this.running;
  }
  currentDeviceId(): string | null {
    return this.deviceId;
  }
  setSensitivity(x: number): void {
    this.sensitivity = Math.max(0, x);
  }
  sampleRate(): number {
    return this.ctx?.sampleRate ?? 0;
  }

  /** Enumerate audio inputs (labels populate only after permission is granted). */
  async listInputs(): Promise<AudioInputInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Input ${i + 1}` }));
  }

  /**
   * Start capture from the given input (or the system default). Stops any prior
   * stream first. Must be called from a user gesture so the AudioContext resumes.
   */
  async start(deviceId?: string): Promise<void> {
    const Ctor = getAudioContextCtor();
    if (!Ctor) throw new Error('Web Audio API unavailable in this browser');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia unavailable');

    this.stopStream();
    // Disable the browser's voice-processing so a music/loopback signal is read raw.
    const tuning = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    const constraints: MediaStreamConstraints = {
      audio: deviceId ? { deviceId: { exact: deviceId }, ...tuning } : { ...tuning },
      video: false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.stream = stream;
    this.deviceId = deviceId ?? stream.getAudioTracks()[0]?.getSettings().deviceId ?? null;

    if (!this.ctx) this.ctx = new Ctor();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = this.fftSize;
    analyser.smoothingTimeConstant = 0.7;
    const source = this.ctx.createMediaStreamSource(stream);
    source.connect(analyser); // sink only — never connect to destination

    this.analyser = analyser;
    this.source = source;
    this.freq = new Uint8Array(analyser.frequencyBinCount);
    this.time = new Uint8Array(analyser.fftSize);
    this.prevSpectrum = new Float32Array(analyser.frequencyBinCount);
    this.running = true;
  }

  stop(): void {
    this.stopStream();
    this.running = false;
    Object.assign(this.env, SILENT_FEATURES);
    this.beatEnv = 0;
    this.fluxAvg = 0;
  }

  private stopStream(): void {
    try {
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    this.source = null;
    this.analyser = null;
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
  }

  private binFor(hz: number): number {
    const sr = this.ctx?.sampleRate ?? 48000;
    const nyquist = sr / 2;
    const n = this.freq.length;
    return Math.max(0, Math.min(n - 1, Math.round((hz / nyquist) * n)));
  }

  private bandEnergy(loHz: number, hiHz: number): number {
    const lo = this.binFor(loHz);
    const hi = Math.max(lo + 1, this.binFor(hiHz));
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += this.freq[i];
    return sum / ((hi - lo) * 255); // 0..1
  }

  /** Read the analyser + update every feature. Call once per rendered frame. */
  sample(): AudioFeatures {
    const a = this.analyser;
    if (!a || !this.running) return SILENT_FEATURES;
    a.getByteFrequencyData(this.freq);
    a.getByteTimeDomainData(this.time);

    // RMS level from the waveform (centered at 128).
    let sumSq = 0;
    for (let i = 0; i < this.time.length; i++) {
      const v = (this.time[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, this.time.length));

    const s = this.sensitivity;
    const level = clamp01(rms * 2.6 * s);
    const bass = clamp01(this.bandEnergy(20, 140) * 1.4 * s);
    const lowMid = clamp01(this.bandEnergy(140, 400) * 1.6 * s);
    const mid = clamp01(this.bandEnergy(400, 2600) * 2.0 * s);
    const treble = clamp01(this.bandEnergy(2600, 16000) * 3.0 * s);

    // Spectral centroid (brightness): magnitude-weighted mean bin → Hz → 0..1.
    let num = 0;
    let den = 0;
    for (let i = 0; i < this.freq.length; i++) {
      const m = this.freq[i];
      num += i * m;
      den += m;
    }
    const centroidBin = den > 0 ? num / den : 0;
    const centroidHz = (centroidBin / Math.max(1, this.freq.length)) * ((this.ctx?.sampleRate ?? 48000) / 2);
    const centroid = clamp01(centroidHz / 5000);

    // Spectral flux (sum of positive bin deltas) → onset strength.
    let flux = 0;
    for (let i = 0; i < this.freq.length; i++) {
      const cur = this.freq[i] / 255;
      const d = cur - this.prevSpectrum[i];
      if (d > 0) flux += d;
      this.prevSpectrum[i] = cur;
    }
    flux = clamp01((flux / Math.max(1, this.freq.length)) * 30);

    // Adaptive onset: a flux spike well above the running mean → a beat impulse.
    this.fluxAvg = this.fluxAvg * 0.92 + flux * 0.08;
    const onset = flux > this.fluxAvg * 1.6 + 0.02 ? clamp01((flux - this.fluxAvg) * 4) : 0;
    this.beatEnv = Math.max(this.beatEnv * 0.86, onset);

    // Smooth (fast attack, slower release) for fluid motion.
    const e = this.env;
    e.level = follow(e.level, level, 0.6, 0.12);
    e.bass = follow(e.bass, bass, 0.7, 0.18);
    e.lowMid = follow(e.lowMid, lowMid, 0.6, 0.16);
    e.mid = follow(e.mid, mid, 0.6, 0.16);
    e.treble = follow(e.treble, treble, 0.8, 0.22);
    e.centroid = follow(e.centroid, centroid, 0.3, 0.1);
    e.flux = flux;
    e.beat = this.beatEnv;
    return e;
  }

  /** Last computed features without re-reading the analyser. */
  features(): AudioFeatures {
    return this.running ? this.env : SILENT_FEATURES;
  }
}
