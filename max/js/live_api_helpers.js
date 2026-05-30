/**
 * live_api_helpers.js — Live API observation skeleton for a Max `v8`/`js`
 * object inside LichtspielHub.amxd. Instantiates LiveAPI observers for
 * transport + the selected track/clip, formats a LiveSessionState, and
 * outlets it for forwarding to the bridge (via node.script ws or OSC).
 *
 * This is a Phase-3 starting point — it must be wired + tested in the Max GUI
 * (see ../docs/max_patch_notes.md). Pseudereal: uses Max globals (LiveAPI,
 * post, outlet, Task) that only exist inside Max.
 */

autowatch = 1;
inlets = 1;
outlets = 1; // out 0: LiveSessionState JSON (as a single Max symbol)

var fmt = null; // require('message_formatters') inside Max if using node/v8 modules

var state = null;
var observers = {};

function init() {
  state = blankState();
  // Transport
  observers.transport = new LiveAPI(onTransport, 'live_set');
  observers.transport.property = 'tempo';
  observers.tempo2 = new LiveAPI(onTransport, 'live_set');
  observers.tempo2.property = 'is_playing';
  // Selected track + clip
  observers.selTrack = new LiveAPI(onSelection, 'live_set view selected_track');
  observers.selScene = new LiveAPI(onSelection, 'live_set view selected_scene');
  post('lichtspiel: live_api_helpers initialized\n');
  flush();
}

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

function onTransport() {
  var lset = new LiveAPI('live_set');
  state.transport.tempo = lset.get('tempo');
  state.transport.isPlaying = lset.get('is_playing') == 1;
  state.transport.beat = lset.get('current_song_time');
  flush();
}

function onSelection() {
  var track = new LiveAPI('live_set view selected_track');
  state.selection.trackName = track.getstring('name');
  // TODO(phase3): read selected clip slot/clip name/color/type + clip content.
  flush();
}

/** Send the current state out as JSON for the bridge forwarder. */
function flush() {
  state.timestampMs = Date.now ? Date.now() : new Date().getTime();
  outlet(0, JSON.stringify(state));
}

// Manual macro setters called from Live params → forwarded as params.update.
function setMacro(name, value) {
  outlet(0, JSON.stringify({ v: 1, ts: 0, type: 'params.update', payload: keyed(name, value) }));
}
function keyed(k, v) { var o = {}; o[k] = v; return o; }

function bang() { flush(); }
