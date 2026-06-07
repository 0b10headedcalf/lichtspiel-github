/**
 * Ableton -> Lichtspiel feeder (the adopted "bypass" trigger path; run via
 * `pnpm dev:feeder`). Polls Ableton through the ableton-mcp Remote Script socket
 * (9877, get_scene_info) and fires scene.launched (Session) + locator.crossed
 * (Arrangement) to the bridge (7890) -> p5, mirroring the M4L's mode gate. Less
 * laggy than the in-Max polling. The native M4L device (max/js/live_api_helpers.js)
 * + the observer-rewrite plan are kept for a self-contained, ableton-mcp-free
 * deploy. See docs/ableton-integration.md "Trigger path: native M4L vs feeder".
 */
import { WebSocket } from 'ws';
import net from 'node:net';

function ableton(type, params = {}) {
  return new Promise((resolve, reject) => {
    const s = net.connect(9877, 'localhost');
    let buf = '';
    s.setTimeout(8000);
    s.on('connect', () => s.write(JSON.stringify({ type, params })));
    s.on('data', (d) => { buf += d.toString(); try { const r = JSON.parse(buf); s.end(); resolve(r); } catch (e) {} });
    s.on('timeout', () => { s.destroy(); reject(new Error('ableton timeout')); });
    s.on('error', reject);
  });
}

let lastSig = null; // set fingerprint (also reset on reconnect, below)

// Bridge connection with auto-reconnect: the feeder is often started before the
// bridge (or outlives a bridge restart), and a one-shot WebSocket left it
// permanently deaf — events kept polling but never reached p5. Reconnect with
// backoff, and reset lastSig on each (re)connect so the set snapshot re-broadcasts.
let ws = null;
let wsReady = false;
let reconnectMs = 1000;
function connectBridge() {
  ws = new WebSocket('ws://127.0.0.1:7890');
  ws.on('open', () => {
    ws.send(JSON.stringify({ v: 1, ts: Date.now(), type: 'hello', payload: { protocolVersion: 1, role: 'cli' } }));
    wsReady = true;
    reconnectMs = 1000;
    lastSig = null; // re-send the snapshot poke for the current set
    console.log('[feeder] connected to bridge');
  });
  ws.on('close', () => {
    if (wsReady) console.log('[feeder] bridge connection lost — reconnecting');
    wsReady = false;
    const delay = reconnectMs;
    reconnectMs = Math.min(reconnectMs * 1.6, 10000);
    setTimeout(connectBridge, delay);
  });
  ws.on('error', () => { /* close handler does the reconnect */ });
}
connectBridge();
function fire(type, payload) { if (wsReady && ws && ws.readyState === 1) ws.send(JSON.stringify({ v: 1, ts: Date.now(), type, payload })); }

let cues = [];
let lastT = -1;
let lastScene = -1;
const SEEK_GUARD = 8;
let busy = false;

/** Cheap STRUCTURAL fingerprint of the set (scene + locator names/times) for
 * change-detection only — it needn't match the bridge's canonical signature. */
function setFingerprint(si) {
  const scenes = Array.isArray(si.scenes) ? si.scenes : [];
  const cuePts = Array.isArray(si.cue_points) ? si.cue_points : [];
  const canonical =
    'scenes:' + scenes.map((s) => String((s && s.name) || '')).join('|') +
    ';loc:' + cuePts.map((c) => String((c && c.name) || '') + '@' + Number((c && c.time) || 0).toFixed(3)).join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) { h ^= canonical.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** A valid LiveSessionState carrying just the transport (BPM / play-state /
 * song position) from get_scene_info; the rest is the canonical empty default.
 * Forwarded each poll so the p5 takeover clock can follow Live's tempo without a
 * constant pulse. Reuses the existing live.state wire path (the bridge validates +
 * routes it to p5 — no bridge/schema change). */
function liveState(si) {
  const tempo = (typeof si.tempo === 'number' && si.tempo > 0) ? si.tempo : 120;
  const beat = (typeof si.current_song_time === 'number') ? si.current_song_time : 0;
  return {
    type: 'live_session_state',
    version: '0.1.0',
    timestampMs: Date.now(),
    transport: { isPlaying: !!si.is_playing, tempo, beat, bar: Math.floor(beat / 4) },
    selection: { trackIndex: 0, trackName: '', sceneIndex: 0, sceneName: '', clipSlotIndex: 0, clipName: '', clipColor: '', clipType: 'unknown' },
    clip: { lengthBeats: 0, loopStart: 0, loopEnd: 0, isLooping: true, audioFilePath: null, midiSummary: null },
    devices: [],
    performance: { sceneLocked: false, manualOverride: false, semanticDistance: 0, mutationAmount: 0 },
  };
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const resp = await ableton('get_scene_info');
    const si = resp && resp.result;
    if (si && typeof si === 'object') {
      if (Array.isArray(si.cue_points) && si.cue_points.length) cues = si.cue_points;
      // Auto-snapshot on set CHANGE: when the structural fingerprint changes (a
      // different set opened/closed), poke the bridge to re-snapshot + broadcast →
      // p5 replaces the rows with fresh defaults. lastSig only advances once the
      // poke is actually sent, so the first set (sent before the WS is open) isn't lost.
      const sig = setFingerprint(si);
      if (sig !== lastSig && wsReady && ws.readyState === 1) {
        lastSig = sig;
        fire('ableton.snapshotRequest', {});
        console.log('[feeder] set change -> ableton.snapshotRequest', sig);
      }
      // Transport forward (Part 2) — every poll, so the takeover clock follows Live's BPM.
      fire('live.state', liveState(si));
      if (!si.is_playing) {
        lastT = -1; lastScene = -1; // stopped
      } else {
        // The mode gate keys off playing_scene, NOT back_to_arranger: the orange
        // "Back to Arrangement" flag stays lit after any session override — even
        // while the Arrangement is what's audibly playing — so gating locators on
        // it silently killed crossings mid-set. A playing session ROW is the
        // reliable signal for both directions.
        // (si.playing_scene needs the Remote Script's get_scene_info extension;
        // until that loads — next Ableton restart — scenes stay dormant here.)
        const row = (typeof si.playing_scene === 'number') ? si.playing_scene : -1;
        if (row >= 0 && row !== lastScene) {
          lastScene = row;
          const name = (si.scenes && si.scenes[row] && si.scenes[row].name) || ('Scene' + (row + 1));
          fire('scene.launched', { index: row, name: name });
          console.log('[feeder] -> scene.launched', row, JSON.stringify(name));
        }
        if (row < 0) lastScene = -1; // session row stopped -> rearm relaunch of the same scene
        if (row >= 0) {
          // SESSION owns the show -> locators suppressed; re-anchor on return.
          lastT = -1;
        } else {
          // ARRANGEMENT (no session scene playing) -> locator crossings.
          const t = si.current_song_time;
          if (lastT < 0) {
            lastT = t; // anchor
          } else {
            const d = t - lastT;
            if (d > 0 && d <= SEEK_GUARD) {
              for (const c of cues) {
                if (c.time > lastT && c.time <= t) {
                  fire('locator.crossed', { index: c.index, name: c.name });
                  console.log('[feeder] -> locator.crossed', c.index, JSON.stringify(c.name), 'at t=' + t.toFixed(1));
                }
              }
            }
            lastT = t;
          }
        }
      }
    }
  } catch (e) { /* transient socket hiccup */ }
  busy = false;
}

console.log('[feeder] locator feeder up — Ableton :9877 -> bridge :7890 (poll 300ms)');
setInterval(tick, 300);
