/**
 * CLI sender — fake Live state + scene/param messages over the bridge,
 * so the p5 runtime can be driven without Ableton (spec Phase 2 acceptance).
 *
 *   pnpm send scene gridWorld
 *   pnpm send state --tempo 140 --clip "dense perc loop" --type midi --playing
 *   pnpm send params --density 0.9 --motion 0.7 --palette 0.1
 *   pnpm send retrieval parquetGlitch --reason "dense + fragmented" --density 0.9
 */

import { WebSocket } from 'ws';
import {
  type LiveSessionState,
  type VisualParamVector,
  EMPTY_LIVE_STATE,
  NUMERIC_PARAM_KEYS,
  cloneLiveState,
  wire,
} from '@lichtspiel/schemas';

const host = process.env['LICHTSPIEL_BIND_HOST'] ?? '127.0.0.1';
const port = Number(process.env['LICHTSPIEL_BRIDGE_WS_PORT'] ?? 7890);

const [cmd, ...rest] = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}
function has(name: string): boolean {
  return rest.includes(`--${name}`);
}

function paramPatch(): Partial<VisualParamVector> {
  const patch: Partial<VisualParamVector> = {};
  for (const k of NUMERIC_PARAM_KEYS) {
    const v = flag(k);
    if (v !== undefined) patch[k] = Number(v);
  }
  return patch;
}

function buildState(): LiveSessionState {
  const s = cloneLiveState(EMPTY_LIVE_STATE);
  s.timestampMs = Date.now();
  if (flag('tempo')) s.transport.tempo = Number(flag('tempo'));
  s.transport.isPlaying = has('playing');
  if (flag('clip')) s.selection.clipName = flag('clip') as string;
  if (flag('track')) s.selection.trackName = flag('track') as string;
  if (flag('scene')) s.selection.sceneName = flag('scene') as string;
  const type = flag('type');
  if (type === 'audio' || type === 'midi' || type === 'unknown') s.selection.clipType = type;
  if (flag('color')) s.selection.clipColor = flag('color') as string;
  if (flag('length')) s.clip.lengthBeats = Number(flag('length'));
  return s;
}

function usage(): never {
  console.error('usage: send <scene|state|params|retrieval> [...]');
  process.exit(1);
}

const msg = (() => {
  switch (cmd) {
    case 'scene': {
      const id = rest[0];
      if (!id) usage();
      return wire('scene.select', { sceneId: id });
    }
    case 'params':
      return wire('params.update', paramPatch());
    case 'state':
      return wire('live.state', buildState());
    case 'retrieval': {
      const id = rest[0];
      if (!id) usage();
      return wire('retrieval.result', {
        type: 'visual_retrieval_result',
        version: '0.1.0',
        sceneId: id,
        confidence: Number(flag('confidence') ?? 0.7),
        distance: Number(flag('distance') ?? 0.3),
        reason: flag('reason') ?? 'CLI-issued',
        params: paramPatch(),
        alternatives: [],
      });
    }
    default:
      usage();
  }
})();

const url = `ws://${host}:${port}`;
const ws = new WebSocket(url);
ws.on('open', () => {
  ws.send(JSON.stringify(wire('hello', { protocolVersion: 1, role: 'cli' })));
  ws.send(JSON.stringify(msg));
  console.log(`sent ${msg.type} → ${url}`);
  setTimeout(() => {
    ws.close();
    process.exit(0);
  }, 150);
});
ws.on('error', (err) => {
  console.error(`bridge not reachable at ${url}: ${String(err)}`);
  process.exit(1);
});
