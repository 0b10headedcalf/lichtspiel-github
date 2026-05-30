/**
 * live_api_helpers.js — the brain of the Lichtspiel M4L probe. Runs in a Max
 * `js` object inside a Max for Live device. On every `bang` (from a metro and
 * from live.thisdevice) it reads the Live Object Model via `LiveAPI`, builds a
 * normalized LiveSessionState, and emits it as one JSON symbol on its output.
 * The patch routes that as OSC: [prepend /lichtspiel/state] → [udpsend …].
 *
 * Self-contained (no requires) so a single `js live_api_helpers.js` works.
 * Every LiveAPI call is guarded so the object never errors out — outside Live
 * (standalone Max) it simply emits the default state, which is still useful for
 * testing the OSC plumbing. Mirrors packages/schemas LiveSessionState.
 */

autowatch = 1;
inlets = 1;
outlets = 1; // out 0: a LiveSessionState JSON string (one Max symbol)

function blankState() {
  return {
    type: 'live_session_state',
    version: '0.1.0',
    timestampMs: 0,
    transport: { isPlaying: false, tempo: 120.0, beat: 0, bar: 0 },
    selection: {
      trackIndex: 0, trackName: '', sceneIndex: 0, sceneName: '',
      clipSlotIndex: 0, clipName: '', clipColor: '', clipType: 'unknown',
    },
    clip: { lengthBeats: 0, loopStart: 0, loopEnd: 0, isLooping: true, audioFilePath: null, midiSummary: null },
    devices: [],
    performance: { sceneLocked: false, manualOverride: false, semanticDistance: 0, mutationAmount: 0 },
  };
}

function num(api, prop, dflt) {
  try {
    var v = api.get(prop);
    if (v === undefined || v === null) return dflt;
    if (Array.isArray(v)) v = v[0];
    var n = parseFloat(v);
    return isNaN(n) ? dflt : n;
  } catch (e) { return dflt; }
}

function str(api, prop, dflt) {
  try {
    var v = api.getstring ? api.getstring(prop) : api.get(prop);
    if (v === undefined || v === null) return dflt;
    return ('' + v).replace(/^"|"$/g, '');
  } catch (e) { return dflt; }
}

/** Read the Live Object Model into a LiveSessionState (best-effort). */
function readState() {
  var s = blankState();
  s.timestampMs = Date.now ? Date.now() : new Date().getTime();

  try {
    var lset = new LiveAPI('live_set');
    s.transport.tempo = num(lset, 'tempo', 120);
    s.transport.isPlaying = num(lset, 'is_playing', 0) >= 1;
    s.transport.beat = num(lset, 'current_song_time', 0);
  } catch (e) {}

  try {
    var track = new LiveAPI('live_set view selected_track');
    s.selection.trackName = str(track, 'name', '');
  } catch (e) {}

  try {
    var scene = new LiveAPI('live_set view selected_scene');
    s.selection.sceneName = str(scene, 'name', '');
  } catch (e) {}

  // Selected clip slot → clip name / type / length (when a clip exists).
  try {
    var slot = new LiveAPI('live_set view highlighted_clip_slot');
    var hasClip = num(slot, 'has_clip', 0) >= 1;
    if (hasClip) {
      var clip = new LiveAPI('live_set view highlighted_clip_slot clip');
      s.selection.clipName = str(clip, 'name', '');
      s.selection.clipType = num(clip, 'is_midi_clip', 0) >= 1 ? 'midi' : 'audio';
      s.clip.lengthBeats = num(clip, 'length', 0);
      s.clip.isLooping = num(clip, 'looping', 1) >= 1;
      s.clip.loopStart = num(clip, 'loop_start', 0);
      s.clip.loopEnd = num(clip, 'loop_end', 0);
    }
  } catch (e) {}

  return s;
}

/** Read + emit the current state as one JSON symbol. */
function flush() {
  outlet(0, JSON.stringify(readState()));
}

// metro / live.thisdevice / a manual button all send bang → re-read + emit.
function bang() { flush(); }
function loadbang() { flush(); }

// Forward a single macro/param change as a params.update wire payload.
// Patch route: [live.dial] → [js] (call "macro density 0.8") → prepend /lichtspiel/param.
function macro(name, value) {
  outlet(0, name + ' ' + value); // → [prepend /lichtspiel/param] → udpsend
}
