/**
 * Bridge mapping self-test (Phase 5b). Exercises the MappingStore directly
 * (round-trip + validation + path-traversal rejection), then over the WebSocket:
 * a p5 client requests a snapshot (fixture) and saves / lists / loads a mapping
 * through the hub. No Ableton, no p5, no browser. Run via
 * `pnpm --filter @lichtspiel/live-bridge test:mapping`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import {
  type AbletonMapping,
  type WireMessage,
  ADE_SLEUTH_SNAPSHOT,
  isType,
  isWireMessage,
  makeDefaultRow,
  wire,
} from '@lichtspiel/schemas';
import { BridgeServer } from './websocketServer.js';
import { MappingStore } from './mappingStore.js';

const HOST = '127.0.0.1';
const PORT = 7898;
const URL = `ws://${HOST}:${PORT}`;

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) console.log(`✓ ${msg}`);
  else {
    console.error(`✗ ${msg}`);
    failures++;
  }
}

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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function sampleMapping(name: string): AbletonMapping {
  return {
    version: '0.1.0',
    setName: name,
    updatedAt: '2026-06-03T00:00:00.000Z',
    session: { scenes: [makeDefaultRow({ index: 0, name: 'Scene1' })] },
    arrangement: {
      locators: [
        { index: 0, name: 'Drop', time: 72, enabled: true, templateMode: 'fixed', templateId: 'lichtspielOpus', variantMode: 'canonical' },
      ],
    },
  };
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'lichtspiel-mapping-'));
  const store = new MappingStore(dir);

  // ── MappingStore unit ─────────────────────────────────────────────
  const m = sampleMapping('UnitSet');
  ok(store.save('UnitSet', m).ok, 'store.save valid mapping → ok');
  ok(store.list().includes('UnitSet'), 'store.list includes the saved name');
  const loaded = store.load('UnitSet');
  ok(
    loaded.ok && loaded.mapping.arrangement.locators[0]!.templateId === 'lichtspielOpus',
    'store.load round-trips the mapping',
  );
  ok(!store.load('Nope').ok, 'store.load of a missing name → not ok');
  ok(!store.save('../escape', m).ok, 'store.save rejects path traversal');
  ok(!store.save('Bad', { version: 'x', foo: 1 } as unknown as AbletonMapping).ok, 'store.save rejects an invalid mapping (ajv)');

  // ── Over the WebSocket ────────────────────────────────────────────
  const server = new BridgeServer({
    host: HOST,
    port: PORT,
    snapshot: async () => ADE_SLEUTH_SNAPSHOT,
    mappingStore: store,
  });
  server.start();
  await sleep(200);
  const p5 = await connect('p5');
  await sleep(100);

  try {
    const want = nextMessage(p5, 'ableton.snapshot');
    p5.send(JSON.stringify(wire('ableton.snapshotRequest', {})));
    const got = await want;
    ok(
      isType(got, 'ableton.snapshot') && got.payload.locators.length === ADE_SLEUTH_SNAPSHOT.locators.length,
      'snapshotRequest → ableton.snapshot (fixture, all locators)',
    );
  } catch (err) {
    ok(false, `snapshot over WS: ${String(err)}`);
  }

  try {
    const want = nextMessage(p5, 'mapping.result');
    p5.send(JSON.stringify(wire('mapping.request', { op: 'save', name: 'WsSet', mapping: sampleMapping('WsSet') })));
    const got = await want;
    ok(
      isType(got, 'mapping.result') && got.payload.op === 'save' && got.payload.ok && (got.payload.names ?? []).includes('WsSet'),
      'mapping.request save → result ok + names',
    );
  } catch (err) {
    ok(false, `save over WS: ${String(err)}`);
  }

  try {
    const want = nextMessage(p5, 'mapping.result');
    p5.send(JSON.stringify(wire('mapping.request', { op: 'load', name: 'WsSet' })));
    const got = await want;
    ok(
      isType(got, 'mapping.result') && got.payload.op === 'load' && got.payload.ok && got.payload.mapping?.setName === 'WsSet',
      'mapping.request load → result with the mapping',
    );
  } catch (err) {
    ok(false, `load over WS: ${String(err)}`);
  }

  p5.close();
  server.stop();
  await sleep(100);
  rmSync(dir, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n${failures} mapping self-test(s) failed`);
    process.exit(1);
  }
  console.log('\nbridge mapping self-test OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('mapping self-test crashed:', err);
  process.exit(1);
});
