/**
 * Live connectivity check against a REAL Lichtspiel bridge (read-only,
 * NON-INTRUSIVE). Not part of the test suite. Run with the real live-bridge up:
 *
 *   pnpm exec tsx scripts/liveLichtspielCheck.ts
 *
 * It proves Mode-2 wire compatibility WITHOUT altering any live visuals:
 *   1. a raw 'bridge' socket sends our exact `hello` and awaits the `status`
 *      reply (proves the real bridge accepts our role + envelope);
 *   2. our real LichtspielWsClient connects (proves the adapter works).
 * It deliberately does NOT send a params.update (that would broadcast to live
 * p5 clients). Pass --send-visual to additionally emit one neutral params.update
 * (only do this against a non-live bridge).
 */
import WebSocket from 'ws';
import { SystemClock } from '../src/core/clock.js';
import { makeMessage, SeqCounter } from '../src/schemas/wire.js';
import { LineageTracker } from '../src/core/lineageTracker.js';
import { createLogger } from '../src/logging.js';
import { LichtspielWsClient } from '../src/adapters/lichtspielWsClient.js';
import type { BridgeContext } from '../src/adapters/types.js';

const URL = process.env.LICHTSPIEL_WS_URL ?? 'ws://127.0.0.1:7890';
const SEND_VISUAL = process.argv.includes('--send-visual');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function handshake(clock: SystemClock): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    let done = false;
    const finish = (v: Record<string, unknown> | null): void => {
      if (done) return;
      done = true;
      ws.close();
      resolve(v);
    };
    ws.on('open', () => {
      ws.send(JSON.stringify({ v: 1, ts: clock.now(), type: 'hello', payload: { protocolVersion: 1, role: 'bridge' } }));
    });
    ws.on('message', (d) => {
      try {
        const m = JSON.parse(d.toString());
        if (m && m.type === 'status') finish(m.payload as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    });
    ws.on('error', () => finish(null));
    setTimeout(() => finish(null), 3000);
  });
}

async function main(): Promise<void> {
  const clock = new SystemClock();
  const logger = createLogger({ level: 'warn', pretty: true });

  // 1. Raw 'bridge' hello -> status (proves the real bridge accepts our wire).
  const status = await handshake(clock);
  if (!status) {
    console.log(`LIVE FAIL: no status reply from ${URL} (is the real bridge running?)`);
    process.exit(2);
  }
  console.log('LIVE OK (handshake): real bridge accepted our hello{role:bridge} and replied status:');
  console.log('  ' + JSON.stringify(status));

  // 2. Our real adapter connects.
  const ctx: BridgeContext = {
    sessionId: 'live',
    clock,
    seq: new SeqCounter(),
    lineage: new LineageTracker(clock),
    logger,
  };
  const client = new LichtspielWsClient(ctx, { url: URL });
  client.start();
  for (let i = 0; i < 100 && !client.isReady(); i++) await sleep(50);
  console.log(`LIVE ${client.isReady() ? 'OK' : 'FAIL'} (adapter): LichtspielWsClient ${client.isReady() ? 'connected' : 'did NOT connect'}`);

  if (SEND_VISUAL && client.isReady()) {
    const visual = makeMessage({
      type: 'lichtspiel.visual.update',
      source: 'core',
      sessionId: 'live',
      sourceInstanceId: 'live',
      clock,
      seq: ctx.seq,
      cause: ctx.lineage.newRoot('core'),
      payload: {
        visualCluster: 'sand-metal-organic',
        sceneLock: false,
        manualOverride: false,
        transitionMs: 1200,
        visualParamVector: new Array(16).fill(0.5),
      },
    });
    client.send(visual);
    console.log('LIVE: sent one neutral params.update (--send-visual).');
    await sleep(300);
  }

  client.stop();
  process.exit(client.isReady() || status ? 0 : 2);
}

main().catch((err) => {
  console.error('LIVE ERROR:', err);
  process.exit(3);
});
