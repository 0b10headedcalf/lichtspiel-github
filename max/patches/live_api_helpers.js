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

  var songTime = 0;
  try {
    var lset = new LiveAPI('live_set');
    s.transport.tempo = num(lset, 'tempo', 120);
    s.transport.isPlaying = num(lset, 'is_playing', 0) >= 1;
    songTime = num(lset, 'current_song_time', 0);
    s.transport.beat = songTime;
  } catch (e) {}

  try {
    var scene = new LiveAPI('live_set view selected_scene');
    s.selection.sceneName = str(scene, 'name', '');
  } catch (e) {}

  // Selected track: name (3) + device names (3d).
  try {
    var track = new LiveAPI('live_set view selected_track');
    s.selection.trackName = str(track, 'name', '');
    s.devices = readDevices('live_set view selected_track');
  } catch (e) {}

  // Clip: prefer the session-selected clip; else the clip playing on the
  // selected track — session launched slot, then arrangement-at-playhead (3c).
  var clipPath = null;
  try {
    var slot = new LiveAPI('live_set view highlighted_clip_slot');
    if (num(slot, 'has_clip', 0) >= 1) clipPath = 'live_set view highlighted_clip_slot clip';
  } catch (e) {}
  if (clipPath === null) clipPath = playingClipPath(songTime);
  if (clipPath !== null) readClip(s, clipPath);

  return s;
}

/** Device names on a track path (3d, best-effort, capped at 8). */
function readDevices(trackPath) {
  var out = [];
  try {
    var track = new LiveAPI(trackPath);
    var n = 0;
    try { n = parseInt(track.getcount('devices'), 10) || 0; } catch (e) { n = 0; }
    for (var i = 0; i < n && i < 8; i++) {
      try {
        var d = new LiveAPI(trackPath + ' devices ' + i);
        out.push({ trackIndex: 0, deviceIndex: i, name: str(d, 'name', ''), parameters: [] });
      } catch (e) {}
    }
  } catch (e) {}
  return out;
}

/** Path to the clip currently playing on the selected track, or null (3c). */
function playingClipPath(songTime) {
  try {
    var track = new LiveAPI('live_set view selected_track');
    // Session view: a launched clip slot.
    var psi = num(track, 'playing_slot_index', -1);
    if (psi >= 0) return 'live_set view selected_track clip_slots ' + psi + ' clip';
    // Arrangement view: the arrangement clip spanning the playhead. (LOM
    // property names assumed start_time/end_time — guarded; verify in-set.)
    var ids = track.get('arrangement_clips');
    if (ids && ids.length) {
      for (var k = 0; k < ids.length; k++) {
        if (ids[k] === 'id') {
          var cid = ids[k + 1];
          try {
            var c = new LiveAPI('id ' + cid);
            var st = num(c, 'start_time', -1);
            var et = num(c, 'end_time', -1);
            if (st >= 0 && et > st && songTime >= st && songTime < et) return 'id ' + cid;
          } catch (e) {}
        }
      }
    }
  } catch (e) {}
  return null;
}

/** Read clip name/type/color/length from a clip path into the state (3c/3d). */
function readClip(s, path) {
  try {
    var clip = new LiveAPI(path);
    s.selection.clipName = str(clip, 'name', '');
    s.selection.clipType = num(clip, 'is_midi_clip', 0) >= 1 ? 'midi' : 'audio';
    s.selection.clipColor = '' + num(clip, 'color', 0); // Live color as int (3d)
    s.clip.lengthBeats = num(clip, 'length', 0);
    s.clip.isLooping = num(clip, 'looping', 1) >= 1;
    s.clip.loopStart = num(clip, 'loop_start', 0);
    s.clip.loopEnd = num(clip, 'loop_end', 0);
  } catch (e) {}
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
