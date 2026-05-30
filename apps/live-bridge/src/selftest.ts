/**
 * Bridge self-test: boots the hub on a test port, connects a fake p5 client
 * and a cli client, and asserts (1) a scene.select from cli reaches p5, and
 * (2) an invalid live.state is validated-and-dropped (never forwarded).
 * Run via `pnpm --filter @lichtspiel/live-bridge test`.
 */

import { WebSocket } from 'ws';
import { type WireMessage, isWireMessage, wire } from '@lichtspiel/schemas';
import { BridgeServer } from './websocketServer.js';

const HOST = '127.0.0.1';
const PORT = 7899;
const URL = `ws://${HOST}:${PORT}`;

function connect(role: 'p5' | 'cli'): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on('open', () => {
      ws.send(JSON.stringify(wire('hello', { protocolVersion: 1, role })));
      resolve(ws);
    });
    ws.on('error', reject);
  });
}

function nextMessage(ws: WebSocket, type: string, timeoutMs = 1500): Promise<WireMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs);
    const onMsg = (data: Buffer): void => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (isWireMessage(parsed) && parsed.type === type) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(parsed);
      }
    };
    ws.on('message', onMsg);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const server = new BridgeServer({ host: HOST, port: PORT });
  server.start();
  await sleep(200);

  const p5 = await connect('p5');
  const cli = await connect('cli');
  await sleep(100);

  let failures = 0;

  // 1. scene.select from cli must reach p5
  const want = nextMessage(p5, 'scene.select');
  cli.send(JSON.stringify(wire('scene.select', { sceneId: 'gridWorld' })));
  try {
    const got = await want;
    if (got.type === 'scene.select' && got.payload.sceneId === 'gridWorld') {
      console.log('✓ scene.select cli → p5');
    } else {
      console.error('✗ scene.select payload wrong', got);
      failures++;
    }
  } catch (err) {
    console.error('✗ scene.select did not reach p5:', String(err));
    failures++;
  }

  // 2. invalid live.state must be dropped (p5 should NOT receive it)
  let leaked = false;
  const onMsg = (data: Buffer): void => {
    const parsed = JSON.parse(data.toString());
    if (isWireMessage(parsed) && parsed.type === 'live.state') leaked = true;
  };
  p5.on('message', onMsg);
  // bogus payload: tempo is a string, missing required fields
  cli.send(
    JSON.stringify(wire('live.state', { type: 'live_session_state', version: 'x' } as never)),
  );
  await sleep(400);
  p5.off('message', onMsg);
  if (leaked) {
    console.error('✗ invalid live.state was forwarded to p5');
    failures++;
  } else {
    console.log('✓ invalid live.state dropped at bridge');
  }

  p5.close();
  cli.close();
  server.stop();
  await sleep(100);

  if (failures > 0) {
    console.error(`\n${failures} bridge self-test(s) failed`);
    process.exit(1);
  }
  console.log('\nbridge self-test OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('self-test crashed:', err);
  process.exit(1);
});
