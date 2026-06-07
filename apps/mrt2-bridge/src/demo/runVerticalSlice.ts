/**
 * One-command mock demo (`pnpm demo` / `npm run demo`). Fully self-contained:
 * a bundled mock Lichtspiel WS server + the REAL LichtspielWsClient (proving the
 * Mode-2 wire path) + mock Ableton + mock MRT2 + a monome gesture injected over
 * the wire. Prints a human-readable trace of the vertical slice, then exits 0.
 */
import { config as dotenvConfig } from 'dotenv';
import { loadConfig } from '../config.js';
import { createLogger, trace } from '../logging.js';
import { SystemClock } from '../core/clock.js';
import { SeqCounter } from '../schemas/wire.js';
import { LineageTracker } from '../core/lineageTracker.js';
import { StateStore } from '../core/stateStore.js';
import { SemanticStateEngine } from '../core/semanticState.js';
import { SafetyController } from '../core/safetyController.js';
import { PromptMapper } from '../core/promptMapper.js';
import { Bridge } from '../core/bridge.js';
import { AbletonMockAdapter } from '../adapters/abletonMockAdapter.js';
import { Mrt2MockAdapter } from '../adapters/mrt2MockAdapter.js';
import { LichtspielWsServerMock } from '../adapters/lichtspielWsServerMock.js';
import { LichtspielWsClient } from '../adapters/lichtspielWsClient.js';
import type { BridgeContext, InboundAdapter } from '../adapters/types.js';
import { PROMPT_MAP, DESERT_RITUAL, DEMO_METRICS_TIMELINE, DEMO_MONOME_EVENT } from './fixtures.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) return;
    await sleep(20);
  }
}

async function main(): Promise<void> {
  dotenvConfig();
  const cfg = loadConfig();
  // Quiet structured logs so the readable trace is the star; warnings still show.
  const logger = createLogger({ level: 'warn', pretty: cfg.log.pretty });
  const clock = new SystemClock();

  const ctx: BridgeContext = {
    sessionId: cfg.sessionId,
    clock,
    seq: new SeqCounter(),
    lineage: new LineageTracker(clock),
    logger,
  };

  const mapper = new PromptMapper(PROMPT_MAP);
  const store = new StateStore();
  const engine = new SemanticStateEngine(mapper);
  const safety = new SafetyController(cfg.safety, clock, ctx.lineage);

  const ableton = new AbletonMockAdapter(ctx, {
    bpm: cfg.transport.bpm,
    beatsPerBar: cfg.transport.beatsPerBar,
  });
  const mrt2 = new Mrt2MockAdapter(ctx, { model: cfg.mrt2Model, metricsTickMs: 2000 });

  const server = new LichtspielWsServerMock({ host: cfg.mockWs.host, port: cfg.mockWs.port, clock, logger });
  try {
    await server.start();
  } catch (err) {
    trace('demo', `Could not bind the mock Lichtspiel WS on ${cfg.mockWs.host}:${cfg.mockWs.port} — ${String(err)}`);
    trace('demo', 'Is a real Lichtspiel bridge already running there? Set BRIDGE_MOCK_WS_PORT to a free port and retry.');
    process.exit(1);
    return;
  }
  // Prove the wire reaches (mock) Lichtspiel.
  server.onParamsUpdate((p) =>
    trace(
      'lichtspiel',
      `received params.update: sceneId=${p.sceneId} density=${p.density?.toFixed(2)} mutationAmount=${p.mutationAmount?.toFixed(2)}`,
    ),
  );

  const client = new LichtspielWsClient(ctx, { url: `ws://${cfg.mockWs.host}:${cfg.mockWs.port}` });
  const inbound: InboundAdapter[] = [ableton, mrt2, client];
  const bridge = new Bridge({
    ctx,
    config: cfg,
    store,
    engine,
    safety,
    inbound,
    mrt2Out: mrt2,
    lichtspielOut: client,
    trace,
  });

  try {
    trace('demo', '— Vertical slice: Lichtspiel × MRT2 × Ableton (mock mode) —');
    bridge.start();
    await waitFor(() => client.isReady());
    trace('demo', `Lichtspiel client connected to mock bridge on ${cfg.mockWs.host}:${cfg.mockWs.port}`);

    await sleep(400);
    trace('demo', `Scene launched: ${DESERT_RITUAL}`);
    ableton.launchScene(0, DESERT_RITUAL);

    // Let a bar pass so the next-bar-quantized prompt releases.
    await sleep(2600);

    trace('demo', 'MRT2 telemetry streaming (~10s)…');
    mrt2.scriptMetrics(DEMO_METRICS_TIMELINE);
    await sleep(5000);

    trace('demo', 'monome gesture incoming (over the Lichtspiel wire)');
    server.injectMonome(DEMO_MONOME_EVENT);
    await sleep(2600);

    trace('demo', 'Simulating MRT2 disconnect…');
    mrt2.simulateDisconnect();
    await sleep(1200);

    trace('demo', 'Vertical slice complete. ✔');
  } finally {
    await bridge.stop();
    client.stop();
    server.stop();
  }
  // Timers/sockets would keep the loop alive; exit cleanly.
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
