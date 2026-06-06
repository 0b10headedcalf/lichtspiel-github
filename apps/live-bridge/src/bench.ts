/**
 * Bridge throughput + latency benchmark. Boots the hub on a test port, connects
 * a `cli` sender and a `p5` receiver, floods `params.update` messages through the
 * real route/broadcast path, and measures (1) sustained throughput (msg/s) and
 * (2) per-message latency = receiver-arrival − sender-stamped `ts`.
 *
 * This is the headless, no-browser, no-hardware half of the perf story: it tells
 * you the bridge's ceiling and its tail latency under load. (The other half —
 * render frame time — is measured in the browser; see docs note in the PR.)
 *
 * Run via `pnpm --filter @lichtspiel/live-bridge bench`.
 * Tunables:  BENCH_N (messages, default 50000) · BENCH_RATE (msg/s; unset = flood).
 *
 * Provenance: reuses the connect()/sleep() client shape from selftest.ts.
 */

import { WebSocket } from 'ws';
import { isWireMessage, wire } from '@lichtspiel/schemas';
import { BridgeServer } from './websocketServer.js';

const HOST = '127.0.0.1';
const PORT = 7898;
const URL = `ws://${HOST}:${PORT}`;
const N = Number(process.env['BENCH_N'] ?? 50_000);
const RATE = process.env['BENCH_RATE'] ? Number(process.env['BENCH_RATE']) : 0; // 0 = flood

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface LatencyStats {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

/**
 * TODO(you) — THE MEANINGFUL DECISION. Turn an array of latency samples (ms)
 * into the summary above.
 *
 * Why this is the part that matters: the mean is a liar for a live instrument.
 * A bridge that runs 0.2ms mean but spikes to 40ms once a second feels broken
 * to a performer — and only p95/p99 expose that. Decide how you compute the
 * percentiles (sort + nearest-rank index is fine for 50k samples; a histogram
 * scales better if you push N to millions) and whether you trim the warmup
 * samples (the first connections + JIT warm-up inflate the early numbers).
 *
 * apps/live-bridge/src/bench.ts — fill this in (≈6-10 lines).
 */
function summarize(samples: number[]): LatencyStats {
  // TODO: implement — see the doc comment above for the decisions to make.
  throw new Error('summarize() not implemented yet');
}

async function main(): Promise<void> {
  const server = new BridgeServer({ host: HOST, port: PORT });
  server.start();
  await sleep(150);

  const sender = await connect('cli');
  const receiver = await connect('p5');
  await sleep(100); // let `hello` settle so the receiver is registered as a p5 client

  const latencies: number[] = [];
  let received = 0;
  const done = new Promise<void>((resolve) => {
    receiver.on('message', (data: Buffer) => {
      let m: unknown;
      try {
        m = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!isWireMessage(m) || m.type !== 'params.update') return;
      latencies.push(Date.now() - m.ts);
      if (++received >= N) resolve();
    });
  });

  const start = Date.now();
  if (RATE > 0) {
    // Paced mode: send at a fixed rate — measures latency at *realistic* load.
    const gap = 1000 / RATE;
    for (let i = 0; i < N; i++) {
      sender.send(JSON.stringify(wire('params.update', { motion: Math.random() })));
      await sleep(gap);
    }
  } else {
    // Flood mode: fire as fast as possible — measures the saturation ceiling.
    for (let i = 0; i < N; i++) {
      sender.send(JSON.stringify(wire('params.update', { motion: Math.random() })));
    }
  }
  await done;
  const elapsed = (Date.now() - start) / 1000;

  const s = summarize(latencies);
  console.log(
    `bridge bench: ${received}/${N} msgs in ${elapsed.toFixed(2)}s = ${Math.round(received / elapsed)} msg/s`,
  );
  console.log(
    `latency ms — p50 ${s.p50} · p95 ${s.p95} · p99 ${s.p99} · max ${s.max} · mean ${s.mean.toFixed(3)}`,
  );

  sender.close();
  receiver.close();
  server.stop();
  process.exit(0);
}

void main();
