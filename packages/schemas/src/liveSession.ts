/**
 * LiveSessionState — the normalized snapshot the Max for Live layer emits
 * about the Ableton Live Set. The Max layer must always emit this shape,
 * even when fields are missing/unknown (use the empty defaults below).
 *
 * Mirrors LiveSessionState.schema.json.
 */

export type ClipType = 'audio' | 'midi' | 'unknown';

export interface LiveTransport {
  isPlaying: boolean;
  tempo: number;
  beat: number;
  bar: number;
}

export interface LiveSelection {
  trackIndex: number;
  trackName: string;
  sceneIndex: number;
  sceneName: string;
  clipSlotIndex: number;
  clipName: string;
  clipColor: string;
  clipType: ClipType;
}

/** Compact MIDI content summary for a MIDI clip (Phase 6). */
export interface MidiSummary {
  noteCount: number;
  pitchMin: number;
  pitchMax: number;
  avgRegister: number;
  noteDensity: number;
  polyphony: number;
  /** 12-bin pitch-class histogram, normalized 0..1. */
  pitchClasses: number[];
}

export interface LiveClip {
  lengthBeats: number;
  loopStart: number;
  loopEnd: number;
  isLooping: boolean;
  audioFilePath: string | null;
  midiSummary: MidiSummary | null;
}

export interface LiveDeviceParam {
  name: string;
  value: number;
  min: number;
  max: number;
}

export interface LiveDevice {
  trackIndex: number;
  deviceIndex: number;
  name: string;
  parameters: LiveDeviceParam[];
}

export interface LivePerformance {
  sceneLocked: boolean;
  manualOverride: boolean;
  semanticDistance: number;
  mutationAmount: number;
}

export interface LiveSessionState {
  type: 'live_session_state';
  version: string;
  timestampMs: number;
  transport: LiveTransport;
  selection: LiveSelection;
  clip: LiveClip;
  devices: LiveDevice[];
  performance: LivePerformance;
}

export const LIVE_STATE_VERSION = '0.1.0';

export const EMPTY_LIVE_STATE: LiveSessionState = Object.freeze({
  type: 'live_session_state',
  version: LIVE_STATE_VERSION,
  timestampMs: 0,
  transport: { isPlaying: false, tempo: 120.0, beat: 0, bar: 0 },
  selection: {
    trackIndex: 0,
    trackName: '',
    sceneIndex: 0,
    sceneName: '',
    clipSlotIndex: 0,
    clipName: '',
    clipColor: '',
    clipType: 'unknown',
  },
  clip: {
    lengthBeats: 0,
    loopStart: 0,
    loopEnd: 0,
    isLooping: true,
    audioFilePath: null,
    midiSummary: null,
  },
  devices: [],
  performance: {
    sceneLocked: false,
    manualOverride: false,
    semanticDistance: 0,
    mutationAmount: 0,
  },
}) as LiveSessionState;

/** Deep-ish clone so callers can mutate a working copy safely. */
export function cloneLiveState(s: LiveSessionState): LiveSessionState {
  return {
    ...s,
    transport: { ...s.transport },
    selection: { ...s.selection },
    clip: { ...s.clip, midiSummary: s.clip.midiSummary ? { ...s.clip.midiSummary } : null },
    devices: s.devices.map((d) => ({ ...d, parameters: d.parameters.map((p) => ({ ...p })) })),
    performance: { ...s.performance },
  };
}
