/**
 * Real entry point (Modes 2 & 3) + `--health`. The one-command MOCK DEMO lives
 * in src/demo/runVerticalSlice.ts; this is the long-running bridge process.
 *
 * Wiring is flag-driven (see .env.example). With no flags it runs the mock
 * adapters so `npm start` works with zero external dependencies.
 */
import { config as dotenvConfig } from 'dotenv';
import { loadConfig, type AppConfig } from './config.js';
import { createLogger, type Logger } from './logging.js';
import { SystemClock } from './core/clock.js';
import { SeqCounter, type SystemHealth } from './schemas/wire.js';
import { LineageTracker } from './core/lineageTracker.js';
import { StateStore } from './core/stateStore.js';
import { SemanticStateEngine } from './core/semanticState.js';
import { SafetyController } from './core/safetyController.js';
import { PromptMapper, loadPromptMapFile, type PromptMapEntry } from './core/promptMapper.js';
import { PROMPT_MAP } from './demo/fixtures.js';
import { Bridge } from './core/bridge.js';
import { AbletonMockAdapter } from './adapters/abletonMockAdapter.js';
import { Mrt2MockAdapter } from './adapters/mrt2MockAdapter.js';
import { MonomeMockAdapter } from './adapters/monomeMockAdapter.js';
import { LichtspielWsClient } from './adapters/lichtspielWsClient.js';
import { Mrt2Adapter } from './adapters/mrt2Adapter.js';
import type { BridgeContext, InboundAdapter, OutboundAdapter } from './adapters/types.js';

function resolvePromptMap(cfg: AppConfig, logger: Logger): PromptMapEntry[] {
  try {
    return loadPromptMapFile(cfg.promptMapFile);
  } catch (err) {
    logger.warn({ file: cfg.promptMapFile, err: String(err) }, 'prompt map not found; using built-in example');
    return PROMPT_MAP;
  }
}

function computeHealth(cfg: AppConfig): SystemHealth {
  return {
    ok: true,
    degraded: false,
    adapters: {
      ableton: cfg.enableMockAbleton ? 'mock' : 'disabled',
      mrt2: cfg.enableMrt2Real ? 'up' : cfg.enableMockMrt2 ? 'mock' : 'disabled',
      lichtspiel: cfg.enableLichtspielClient ? 'up' : 'mock',
      monome: cfg.enableMockMonome ? 'mock' : 'disabled',
    },
  };
}

async function run(cfg: AppConfig, logger: Logger): Promise<void> {
  const clock = new SystemClock();
  const ctx: BridgeContext = {
    sessionId: cfg.sessionId,
    clock,
    seq: new SeqCounter(),
    lineage: new LineageTracker(clock),
    logger,
  };

  const mapper = new PromptMapper(resolvePromptMap(cfg, logger));
  const store = new StateStore();
  const engine = new SemanticStateEngine(mapper);
  const safety = new SafetyController(cfg.safety, clock, ctx.lineage);

  const ableton = new AbletonMockAdapter(ctx, { bpm: cfg.transport.bpm, beatsPerBar: cfg.transport.beatsPerBar });
  const inbound: InboundAdapter[] = [ableton];

  // MRT2: real adapter (Python sidecar) when enabled, else mock.
  let mrt2Out: OutboundAdapter;
  if (cfg.enableMrt2Real) {
    const real = new Mrt2Adapter(ctx, { sidecarCmd: cfg.mrt2SidecarCmd, model: cfg.mrt2Model, magentaHome: cfg.magentaHome });
    inbound.push(real);
    mrt2Out = real;
  } else {
    const mock = new Mrt2MockAdapter(ctx, { model: cfg.mrt2Model });
    inbound.push(mock);
    mrt2Out = mock;
  }

  if (cfg.enableMockMonome) inbound.push(new MonomeMockAdapter(ctx));

  // Lichtspiel client (Mode 2). Both inbound (monome.event) and outbound (visual).
  let lichtspielOut: OutboundAdapter | null = null;
  if (cfg.enableLichtspielClient) {
    const client = new LichtspielWsClient(ctx, { url: cfg.lichtspielWsUrl });
    inbound.push(client);
    lichtspielOut = client;
  }

  const bridge = new Bridge({ ctx, config: cfg, store, engine, safety, inbound, mrt2Out, lichtspielOut });
  bridge.start();
  logger.info(
    { lichtspiel: cfg.enableLichtspielClient, mrt2Real: cfg.enableMrt2Real },
    'bridge running — Ctrl+C to stop',
  );

  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info('shutting down...');
    await bridge.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

async function main(argv: string[] = process.argv): Promise<void> {
  dotenvConfig();
  const cfg = loadConfig();
  const logger = createLogger(cfg.log);

  if (argv.includes('--health')) {
    const health = computeHealth(cfg);
    process.stdout.write(`health: ${health.ok ? 'OK' : 'DEGRADED'} ${JSON.stringify(health.adapters)}\n`);
    process.exit(0);
  }

  await run(cfg, logger);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
