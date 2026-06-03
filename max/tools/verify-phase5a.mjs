/**
 * Phase 5a in-Live verification harness.
 * Monitors the bridge WS (:7890) for what the M4L emits, drives Ableton via the
 * Remote Script socket (:9877), and logs back_to_arranger so Session vs
 * Arrangement mode separation is visible.
 */
import { WebSocket } from 'ws';
import net from 'node:net';

function abletonCmd(type, params = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(9877, 'localhost');
    let buf = '';
    sock.setTimeout(12000);
    sock.on('connect', () => sock.write(JSON.stringify({ type, params })));
    sock.on('data', (d) => { buf += d.toString(); try { const r = JSON.parse(buf); sock.end(); resolve(r); } catch (e) {} });
    sock.on('timeout', () => { sock.destroy(); reject(new Error('ableton timeout: ' + type)); });
    sock.on('error', reject);
  });
}

const events = [];
const t0 = Date.now();
const ws = new WebSocket('ws://127.0.0.1:7890');
const ready = new Promise((res, rej) => {
  ws.on('open', () => { ws.send(JSON.stringify({ v: 1, ts: Date.now(), type: 'hello', payload: { protocolVersion: 1, role: 'p5' } })); res(); });
  ws.on('error', rej);
});
ws.on('message', (data) => {
  try { const m = JSON.parse(data.toString());
    if (m.type === 'scene.launched' || m.type === 'locator.crossed')
      events.push({ type: m.type, index: m.payload.index, name: m.payload.name });
  } catch (e) {}
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function state() {
  try { const r = (await abletonCmd('get_scene_info')).result || {};
    return `playing=${r.is_playing} bta=${r.back_to_arranger} t=${(r.current_song_time || 0).toFixed(0)}`;
  } catch (e) { return 'state?'; }
}
function drain(label, st) {
  const e = events.splice(0);
  const s = e.map(x => `${x.type === 'scene.launched' ? 'SCENE' : 'LOC'}#${x.index}"${x.name}"`).join('  ') || '(none)';
  console.log('  ' + label.padEnd(34) + ' => ' + s + (st ? '   [' + st + ']' : ''));
}

async function main() {
  await ready; await sleep(300);
  await abletonCmd('stop_playback'); await sleep(200); await abletonCmd('stop_playback'); await sleep(200);
  await abletonCmd('back_to_arrangement'); await sleep(400); events.splice(0);

  console.log('\n===== A. SESSION: scene switches (expect a SCENE each, no LOC) =====');
  await abletonCmd('fire_scene', { scene_index: 0 }); await sleep(1400); drain('fire Scene1', await state());
  await abletonCmd('fire_scene', { scene_index: 1 }); await sleep(1400); drain('fire Scene2', await state());
  await abletonCmd('fire_scene', { scene_index: 0 }); await sleep(1400); drain('fire Scene1', await state());
  await abletonCmd('fire_scene', { scene_index: 1 }); await sleep(1400); drain('fire Scene2', await state());
  await sleep(1600); drain('session idle (expect NO LOC)', await state());

  console.log('\n===== B. ARRANGEMENT: locator crossings (expect a LOC each, no SCENE) =====');
  await abletonCmd('stop_playback'); await sleep(300); await abletonCmd('stop_playback'); await sleep(300);
  await abletonCmd('back_to_arrangement'); await sleep(400);
  await abletonCmd('start_playback'); await sleep(700); events.splice(0);
  drain('Back to Arrangement + play', await state());
  await abletonCmd('set_song_position', { time: 38 }); await sleep(2600); drain('cross buildup@40', await state());
  await abletonCmd('set_song_position', { time: 70 }); await sleep(2600); drain('cross Drop@72', await state());
  await abletonCmd('set_song_position', { time: 142 }); await sleep(2600); drain('cross next@144', await state());
  await abletonCmd('set_song_position', { time: 174 }); await sleep(2600); drain('cross hats back@176', await state());

  console.log('\n===== C. MODE SWITCH (SCENE in Session, then LOC in Arrangement) =====');
  await abletonCmd('fire_scene', { scene_index: 0 }); await sleep(1600); drain('launch Scene1 (session)', await state());
  await sleep(1400); drain('session idle (expect NO LOC)', await state());
  await abletonCmd('stop_playback'); await sleep(300); await abletonCmd('back_to_arrangement'); await sleep(400);
  await abletonCmd('start_playback'); await sleep(700); events.splice(0);
  await abletonCmd('set_song_position', { time: 70 }); await sleep(2600); drain('back-to-arr: cross Drop@72', await state());

  await abletonCmd('stop_playback'); await sleep(300); await abletonCmd('stop_playback');
  console.log('\n===== done =====');
  ws.close(); await sleep(200); process.exit(0);
}
main().catch(e => { console.error('HARNESS FAIL:', e); process.exit(1); });
