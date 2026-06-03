/**
 * live_api_helpers.js - the brain of the Lichtspiel M4L probe. Runs in a Max
 * `js` object inside a Max for Live device. On every `bang` (from a metro and
 * from live.thisdevice) it reads the Live Object Model via `LiveAPI`, builds a
 * normalized LiveSessionState, and emits it as one JSON symbol on outlet 0.
 * The patch routes that as OSC: [prepend /lichtspiel/state] -> [udpsend ...].
 *
 * Phase 5a adds outlet 1: full-address OSC events for a Session scene launch
 * (/lichtspiel/scene/launch <index> <name>) and an Arrangement locator crossing
 * (/lichtspiel/locator <index> <name>), wired straight into the same [udpsend]
 * (no [prepend] - the address is already in the message). Outlet 0 is untouched.
 *
 * Self-contained (no requires) so a single `js live_api_helpers.js` works.
 * Every LiveAPI call is guarded so the object never errors out - outside Live
 * (standalone Max) it simply emits the default state, which is still useful for
 * testing the OSC plumbing. Mirrors packages/schemas LiveSessionState.
 */

autowatch = 1;
inlets = 1;
outlets = 2; // out 0: LiveSessionState JSON (-> [prepend /lichtspiel/state]); out 1: full-address OSC events (-> [udpsend])

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
  // selected track - session launched slot, then arrangement-at-playhead (3c).
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

/** Path to the clip currently playing on the selected track, or null (3c).
 * Session-only: the arrangement-at-playhead lookup was REMOVED because iterating
 * arrangement_clips (a LiveAPI per clip) stalled the 250 ms poll on a full
 * arrangement - the main cause of the detection lag. The HUD clip name is
 * best-effort and still reflects the selected/playing session slot. */
function playingClipPath(songTime) {
  try {
    var track = new LiveAPI('live_set view selected_track');
    var psi = num(track, 'playing_slot_index', -1);
    if (psi >= 0) return 'live_set view selected_track clip_slots ' + psi + ' clip';
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

// -- Phase 5a - scene-launch + locator events (emitted on outlet 1) ---------
// Outlet 1 carries a FULL OSC address (/lichtspiel/scene/launch <i> <name>,
// /lichtspiel/locator <i> <name>) straight into [udpsend 127.0.0.1 7400] - no
// [prepend]. Mirrors the guarded reads + the playingClipPath time-loop above.

var SEEK_GUARD_BEATS = 8; // a forward jump bigger than this = a seek, not playback (lag-tolerant)
var CUE_REFRESH_TICKS = 8; // re-read locators / track list ~every 2 s (8 x 250 ms)
var STATE_TICKS = 8; // emit the full LiveSessionState (HUD) ~every 2 s; detection is independent
var SCENE_SCAN_TICKS = 2; // scan tracks for the playing scene ~every 500 ms (24 LiveAPI .get is costly)

var cuePoints = []; // [{time, name}] sorted by time (cached, refreshed periodically)
var tickN = 0;
var lastSongTime = -1; // locator-crossing anchor (-1 = stopped / not yet anchored)
var lastSceneIdx = -1; // last detected playing-scene row (-1 = none / nothing playing)
var trackCount = 0; // cached track count (refreshed periodically)
var trackAPIs = []; // cached per-track LiveAPI objects (created once; reused each scan)
var sessionActive = false; // were Session clips playing at the last scan? (Session vs Arrangement mode)
var songCache = null; // cached live_set LiveAPI (stable; reused for the cheap per-tick read)

/** Emit a full-address OSC event on outlet 1 (drop an empty name). */
function emitEvent(address, index, name) {
  if (name && ('' + name).length) outlet(1, address, index, name);
  else outlet(1, address, index);
}

/** Cached live_set LiveAPI - stable across the set, reused for the cheap per-tick
 * transport read so flush() never allocates a LiveAPI every tick. */
function getSong() {
  if (!songCache) { try { songCache = new LiveAPI('live_set'); } catch (e) { songCache = null; } }
  return songCache;
}

/** Name of scene `i` (best-effort). */
function sceneName(i) {
  try { return str(new LiveAPI('live_set scenes ' + i), 'name', ''); } catch (e) { return ''; }
}

/** Read live_set cue_points -> [{time, name}] sorted by time (best-effort). */
function readCuePoints() {
  var pts = [];
  try {
    var lset = new LiveAPI('live_set');
    var ids = lset.get('cue_points'); // ['id', n, 'id', m, ...]
    if (ids && ids.length) {
      for (var i = 0; i < ids.length; i++) {
        if (ids[i] === 'id') {
          try {
            var c = new LiveAPI('id ' + ids[i + 1]);
            var t = num(c, 'time', -1);
            if (t >= 0) pts.push({ time: t, name: str(c, 'name', '') });
          } catch (e) {}
        }
      }
    }
  } catch (e) {}
  pts.sort(function (a, b) { return a.time - b.time; });
  return pts;
}

/**
 * Fire /lichtspiel/locator when playback crosses a cue point. Forward motion
 * only: a rewind or a big forward jump (a seek) re-anchors without firing, and
 * stopping resets the anchor. (current_song_time + cue times are in beats.)
 */
function detectLocators(isPlaying, songTime) {
  if (!isPlaying) { lastSongTime = -1; return; }
  if (lastSongTime < 0) { lastSongTime = songTime; return; } // first playing tick: anchor only
  var delta = songTime - lastSongTime;
  if (delta <= 0 || delta > SEEK_GUARD_BEATS) { lastSongTime = songTime; return; } // rewind/seek
  for (var i = 0; i < cuePoints.length; i++) {
    var t = cuePoints[i].time;
    if (t > lastSongTime && t <= songTime) emitEvent('/lichtspiel/locator', i, cuePoints[i].name);
  }
  lastSongTime = songTime;
}

/**
 * (Re)build the cached per-track LiveAPI objects. Only rebuilds when the track
 * count actually changes - creating LiveAPI objects every tick is what overloads
 * Live (a beachball). Built once, then reused for every scene scan.
 */
function refreshTracks() {
  var n = 0;
  try { n = parseInt(new LiveAPI('live_set').getcount('tracks'), 10) || 0; } catch (e) { n = 0; }
  if (n === trackCount && trackAPIs.length === n) return; // unchanged: keep the cache
  trackCount = n;
  trackAPIs = [];
  for (var i = 0; i < n; i++) {
    try { trackAPIs[i] = new LiveAPI('live_set tracks ' + i); } catch (e) { trackAPIs[i] = null; }
  }
}

/**
 * Fire /lichtspiel/scene/launch when the playing Session scene changes. The LOM
 * exposes no "playing scene" property, and is_triggered is too brief to catch at
 * the poll (verified in-set: an instant launch never showed is_triggered). The
 * robust signal is the DOMINANT Session row among the tracks' playing_slot_index
 * - verified live: Scene1 -> row 0 (15 tracks), Scene2 -> row 1 (7 tracks). Reads
 * the CACHED trackAPIs (no per-tick allocation) and runs only while playing; the
 * stop path in detectEvents clears lastSceneIdx so a scene re-fires next launch.
 */
function detectScene() {
  // EARLY-EXIT at the first track playing a Session clip: in a launched scene every
  // track shares that row, so the first one IS the scene. Avoids 24 slow LiveAPI
  // .get calls per scan (the lag) - typically 3-8 reads instead. (For sets where
  // scenes don't share a single row, switch back to a dominant-row tally.)
  var row = -1;
  for (var i = 0; i < trackAPIs.length; i++) {
    if (!trackAPIs[i]) continue;
    var slot = num(trackAPIs[i], 'playing_slot_index', -1);
    if (slot >= 0) { row = slot; break; }
  }
  if (row >= 0 && row !== lastSceneIdx) {
    lastSceneIdx = row;
    emitEvent('/lichtspiel/scene/launch', row, sceneName(row));
  }
  return row >= 0; // sessionActive: a Session clip is playing
}

/** Per-tick event detection. Runs every tick (responsive) off a cheap transport
 * read - NOT the heavy readState (throttled separately). Mode comes from Live's
 * back_to_arranger (1 = Session clips override the Arrangement): scene launches
 * belong to Session, locator crossings to the Arrangement, and the two never fire
 * together. Falls back to a track scan if back_to_arranger is unavailable.
 * `bta`: back_to_arranger, or -1 if it couldn't be read. */
function detectEvents(lset, isPlaying, bta) {
  if (!isPlaying) {
    lastSongTime = -1; // re-anchor locators on the next play
    lastSceneIdx = -1; // re-fire the scene on its next launch
    sessionActive = false;
    return;
  }
  // ARRANGEMENT (back_to_arranger == 0): track locator crossings. current_song_time
  // is read ONLY here - LiveAPI .get is costly on a big set, so we avoid it in
  // session mode where locators are suppressed anyway.
  if (bta === 0) {
    sessionActive = false;
    lastSceneIdx = -1; // re-fire the scene on its next launch
    detectLocators(true, lset ? num(lset, 'current_song_time', 0) : 0);
    return;
  }
  // SESSION (or back_to_arranger unavailable = -1): throttled scan fires the scene +
  // CONFIRMS session activity (robust even if back_to_arranger is sticky).
  if (tickN % SCENE_SCAN_TICKS === 0) sessionActive = detectScene();
  if (sessionActive) {
    lastSongTime = -1; // suppress locators while a Session clip overrides
  } else {
    lastSceneIdx = -1;
    detectLocators(true, lset ? num(lset, 'current_song_time', 0) : 0);
  }
}

/** Per metro tick: a cheap transport read drives event detection EVERY tick,
 * while the heavy LiveSessionState (outlet 0 -> the HUD) + the slow caches are
 * throttled. This keeps scene/locator detection responsive without the lag of
 * reading clip/track/device state at 4 Hz. */
function flush() {
  var lset = getSong();
  var bta = lset ? num(lset, 'back_to_arranger', -1) : -1; // .get: mode (-1 = unavailable)
  var isPlaying = lset ? num(lset, 'is_playing', 0) >= 1 : false; // .get: transport
  // (current_song_time is read inside detectEvents only when actually needed)

  if (tickN % CUE_REFRESH_TICKS === 0) { cuePoints = readCuePoints(); refreshTracks(); }
  if (tickN % STATE_TICKS === 0) { try { outlet(0, JSON.stringify(readState())); } catch (e) {} }
  tickN++;
  try { detectEvents(lset, isPlaying, bta); } catch (e) {}
}

// metro / live.thisdevice / a manual button all send bang -> re-read + emit.
function bang() { flush(); }
function loadbang() { flush(); }

// Forward a single macro/param change as a params.update wire payload.
// Patch route: [live.dial] -> [js] (call "macro density 0.8") -> prepend /lichtspiel/param.
function macro(name, value) {
  outlet(0, name + ' ' + value); // -> [prepend /lichtspiel/param] -> udpsend
}
