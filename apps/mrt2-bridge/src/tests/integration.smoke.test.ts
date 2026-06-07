import { describe, it, expect } from 'vitest';
import { LichtspielWsServerMock } from '../adapters/lichtspielWsServerMock.js';
import { LichtspielWsClient } from '../adapters/lichtspielWsClient.js';
import { SystemClock } from '../core/clock.js';
import { makeMessage, SeqCounter, type BridgeMessage } from '../schemas/wire.js';
import { LineageTracker } from '../core/lineageTracker.js';
import { createLogger } from '../logging.js';
import type { BridgeContext } from '../adapters/types.js';
import type { VisualParamVector } from '../schemas/lichtspiel.js';
import type { NormalizedGesture } from '../schemas/semantic.js';

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('Lichtspiel client <-> mock server (Mode-2 wire path)', () => {
  it('connects, sends a params.update, and receives an injected monome event', async () => {
    const clock = new SystemClock();
    const logger = createLogger({ level: 'silent', pretty: false });
    const server = new LichtspielWsServerMock({ host: '127.0.0.1', port: 0, clock, logger });
    await server.start();
    const port = server.address();
    expect(port).not.toBeNull();

    const received: Array<Partial<VisualParamVector>> = [];
    server.onParamsUpdate((p) => received.push(p));

    const ctx: BridgeContext = {
      sessionId: 's',
      clock,
      seq: new SeqCounter(),
      lineage: new LineageTracker(clock),
      logger,
    };
    const client = new LichtspielWsClient(ctx, { url: `ws://127.0.0.1:${port}` });
    const gestures: BridgeMessage[] = [];
    client.on((m) => gestures.push(m));
    client.start();

    await waitFor(() => client.isReady());

    const visual = makeMessage({
      type: 'lichtspiel.visual.update',
      source: 'core',
      sessionId: 's',
      sourceInstanceId: 'i',
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

    await waitFor(() => received.length > 0);
    expect(received[0]!.sceneId).toBe('patternGridWorld'); // sand-metal-organic -> template
    expect(received[0]!.density).toBeCloseTo(0.5, 6);

    server.injectMonome({ type: 'arc.delta', deviceId: 'arc', encoder: 0, delta: 16 });
    await waitFor(() => gestures.length > 0);
    expect(gestures[0]!.type).toBe('semantic.gesture');
    expect((gestures[0]!.payload as NormalizedGesture).source).toBe('arc');

    client.stop();
    server.stop();
  });
});
