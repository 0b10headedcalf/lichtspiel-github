/**
 * message_formatters.js — build the normalized LiveSessionState JSON the
 * bridge expects, from raw Live API reads. Runs inside a Max `v8`/`js` object.
 * Pure functions (no Max globals) so the shape stays auditable + testable.
 *
 * Mirrors packages/schemas/src/LiveSessionState.schema.json — keep in sync.
 */

var LIVE_STATE_VERSION = '0.1.0';

function emptyLiveState() {
  return {
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
    performance: { sceneLocked: false, manualOverride: false, semanticDistance: 0, mutationAmount: 0 },
  };
}

/** Map a Live clip "is_midi_clip" flag to our clipType enum. */
function clipType(isMidi, hasClip) {
  if (!hasClip) return 'unknown';
  return isMidi ? 'midi' : 'audio';
}

/** Wrap a payload in the bridge wire envelope. */
function wire(type, payload, nowMs) {
  return { v: 1, ts: nowMs || 0, type: type, payload: payload };
}

if (typeof exports !== 'undefined') {
  exports.emptyLiveState = emptyLiveState;
  exports.clipType = clipType;
  exports.wire = wire;
}
