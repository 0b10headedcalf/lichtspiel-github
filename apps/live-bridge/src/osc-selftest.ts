/**
 * OSC self-test: boots the hub + OSC router, connects a fake p5 client, then
 * sends OSC packets to the Max→bridge UDP port exactly as the M4L device will,
 * and asserts they arrive at p5 as wire messages. Run:
 *   pnpm --filter @lichtspiel/live-bridge test:osc
 */

import { createSocket } from 'node:dgram';
import { WebSocket } from 'ws';
import { type WireMessage, EMPTY_LIVE_STATE, cloneLiveState, isWireMessage, wire } from '@lichtspiel/schemas';
import { BridgeServer } from './websocketServer.js';
import { OscRouter } from './oscRouter.js';
import { encodeOscMessage } from './oscCodec.js';

const HOST = '127.0.0.1';
const WS_PORT = 7898;
const OSC_PORT = 7402;
const PREFIX = '/lichtspiel';

function connectP5(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${WS_PORT}`);
    ws.on('open', () => {
      ws.send(JSON.stringify(wire('hello', { protocolVersion: 1, role: 'p5' })));
      resolve(ws);
    });
    ws.on('error', reject);
  });
}

function nextMessage(ws: WebSocket, type: string, timeoutMs = 1500): Promise<WireMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs);
    const onMsg = (data: Buffer): void => {
      const parsed: unknown = JSON.parse(data.toString());
      if (isWireMessage(parsed) && parsed.type === type) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(parsed);
      }
    };
    ws.on('message', onMsg);
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const server = new BridgeServer({ host: HOST, port: WS_PORT });
  server.start();
  const osc = new OscRouter({
    host: HOST,
    maxToBridgePort: OSC_PORT,
    bridgeToMaxPort: OSC_PORT + 1,
    prefix: PREFIX,
    onMessage: (m) => server.ingest(m),
  });
  osc.start();
  await sleep(250);

  const p5 = await connectP5();
  await sleep(100);
  const udp = createSocket('udp4');
  const sendOsc = (address: string, args: Array<string | number>): void => {
    udp.send(encodeOscMessage(address, args), OSC_PORT, HOST);
  };

  let failures = 0;

  // 1. /lichtspiel/state <json> → live.state at p5
  const state = cloneLiveState(EMPTY_LIVE_STATE);
  state.timestampMs = 1;
  state.selection.clipName = 'osc test clip';
  state.transport.tempo = 132;
  const wantState = nextMessage(p5, 'live.state');
  sendOsc(`${PREFIX}/state`, [JSON.stringify(state)]);
  try {
    const got = await wantState;
    const ok = got.type === 'live.state' && got.payload.selection.clipName === 'osc test clip';
    console.log(ok ? '✓ OSC /state → p5 live.state' : '✗ /state payload wrong');
    if (!ok) failures++;
  } catch (err) {
    console.error('✗ /state did not reach p5:', String(err));
    failures++;
  }

  // 2. /lichtspiel/scene <id> → scene.select at p5
  const wantScene = nextMessage(p5, 'scene.select');
  sendOsc(`${PREFIX}/scene`, ['gridWorld']);
  try {
    const got = await wantScene;
    const ok = got.type === 'scene.select' && got.payload.sceneId === 'gridWorld';
    console.log(ok ? '✓ OSC /scene → p5 scene.select' : '✗ /scene payload wrong');
    if (!ok) failures++;
  } catch (err) {
    console.error('✗ /scene did not reach p5:', String(err));
    failures++;
  }

  // 3. /lichtspiel/param <name> <float> → params.update at p5
  const wantParam = nextMessage(p5, 'params.update');
  sendOsc(`${PREFIX}/param`, ['density', 0.9]);
  try {
    const got = await wantParam;
    const ok = got.type === 'params.update' && Math.abs((got.payload.density ?? 0) - 0.9) < 1e-5;
    console.log(ok ? '✓ OSC /param → p5 params.update' : '✗ /param payload wrong');
    if (!ok) failures++;
  } catch (err) {
    console.error('✗ /param did not reach p5:', String(err));
    failures++;
  }

  // 4. /lichtspiel/scene/launch <i> <name> → scene.launched at p5
  const wantLaunch = nextMessage(p5, 'scene.launched');
  sendOsc(`${PREFIX}/scene/launch`, [1, 'Scene2']);
  try {
    const got = await wantLaunch;
    const ok =
      got.type === 'scene.launched' && got.payload.index === 1 && got.payload.name === 'Scene2';
    console.log(ok ? '✓ OSC /scene/launch → p5 scene.launched' : '✗ /scene/launch payload wrong');
    if (!ok) failures++;
  } catch (err) {
    console.error('✗ /scene/launch did not reach p5:', String(err));
    failures++;
  }

  // 5. /lichtspiel/locator <i> <name> → locator.crossed at p5. Sent as split
  //    atoms ['hats','back'] to prove the bridge rejoins a spaced name.
  const wantLocator = nextMessage(p5, 'locator.crossed');
  sendOsc(`${PREFIX}/locator`, [4, 'hats', 'back']);
  try {
    const got = await wantLocator;
    const ok =
      got.type === 'locator.crossed' && got.payload.index === 4 && got.payload.name === 'hats back';
    console.log(
      ok ? '✓ OSC /locator → p5 locator.crossed (space-safe name)' : '✗ /locator payload wrong',
    );
    if (!ok) failures++;
  } catch (err) {
    console.error('✗ /locator did not reach p5:', String(err));
    failures++;
  }

  udp.close();
  p5.close();
  osc.stop();
  server.stop();
  await sleep(100);

  if (failures > 0) {
    console.error(`\n${failures} OSC self-test(s) failed`);
    process.exit(1);
  }
  console.log('\nOSC self-test OK — Max→bridge→p5 path works');
  process.exit(0);
}

main().catch((err) => {
  console.error('OSC self-test crashed:', err);
  process.exit(1);
});
