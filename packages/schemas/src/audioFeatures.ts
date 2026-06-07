/**
 * AudioFeatures — the normalized audio-analysis vector the runtime's audio
 * layer publishes on the app bus each frame. Like `VisualParamVector` (visuals)
 * and `MonomeEvent` (control), it's a shared runtime contract: the audio engine
 * produces it; the distortion post-FX and any audio-reactive template consume
 * it. All fields are 0..1.
 *
 * Browser-internal — it rides the in-browser app bus, not the Node/Max wire —
 * so (unlike the wire contracts) there is no JSON-schema mirror to keep in sync.
 */

export interface AudioFeatures {
  /** Overall loudness (RMS of the waveform), 0..1. */
  level: number;
  /** Sub/bass band energy ~20–140 Hz, 0..1. */
  bass: number;
  /** Low-mid band ~140–400 Hz, 0..1. */
  lowMid: number;
  /** Mid band ~400–2600 Hz, 0..1. */
  mid: number;
  /** Treble band ~2.6–16 kHz, 0..1. */
  treble: number;
  /** Spectral centroid (brightness), 0..1. */
  centroid: number;
  /** Spectral flux (onset strength) this frame, 0..1. */
  flux: number;
  /** Decaying beat envelope — spikes toward 1 on a detected onset, 0..1. */
  beat: number;
}

export const AUDIO_FEATURE_KEYS = [
  'level',
  'bass',
  'lowMid',
  'mid',
  'treble',
  'centroid',
  'flux',
  'beat',
] as const;

export type AudioFeatureKey = (typeof AUDIO_FEATURE_KEYS)[number];

/** The all-quiet vector — the safe default when no audio is running. */
export const SILENT_FEATURES: AudioFeatures = Object.freeze({
  level: 0,
  bass: 0,
  lowMid: 0,
  mid: 0,
  treble: 0,
  centroid: 0,
  flux: 0,
  beat: 0,
});
