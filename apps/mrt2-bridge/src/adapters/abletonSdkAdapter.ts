/**
 * Ableton Extensions SDK adapter — STUB (real integration documented in
 * docs/ableton-sdk-integration.md).
 *
 * The Extensions SDK reads the Live Object Model (scenes, clips, locators,
 * track names/colors, devices) but has NO outbound network. So its realistic
 * role is the AUTHORING / metadata layer: an extension exports a static
 * set-metadata JSON (the prompt-map shape) that this adapter ingests. REALTIME
 * scene/locator triggers come from the Max device -> OSC :7400 -> Lichtspiel
 * live-bridge path instead (see the Max patch + oscRouter).
 *
 * This stub satisfies the InboundAdapter contract and can already turn an
 * ingested set-metadata object into ableton.scene.launched events on demand; it
 * just doesn't talk to Live yet.
 */
import { emitFrom, shortId, type BridgeContext, type InboundAdapter, type MessageHandler } from './types.js';
import type { BridgeMessage } from '../schemas/wire.js';

export interface AbletonSetSceneMeta {
  id?: string;
  name: string;
  index: number;
}
export interface AbletonSetMetadata {
  scenes: AbletonSetSceneMeta[];
}

export class AbletonSdkAdapter implements InboundAdapter {
  readonly name = 'ableton-sdk';
  private readonly handlers: MessageHandler[] = [];
  private readonly instanceId = shortId('ableton-sdk');

  constructor(private readonly ctx: BridgeContext) {}

  on(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  start(): void {
    this.ctx.logger.warn(
      'AbletonSdkAdapter is a stub (Live intelligence / set-metadata layer). ' +
        'Use AbletonMockAdapter for the demo, or the Max -> OSC -> live-bridge path for realtime sensing. ' +
        'See docs/ableton-sdk-integration.md.',
    );
  }

  stop(): void {
    /* nothing to stop */
  }

  /**
   * Ingest set metadata exported by an Ableton Extension and replay it as a
   * scene launch (manual — the SDK cannot push realtime, so a UI/command would
   * trigger this).
   */
  launchFromMetadata(meta: AbletonSetMetadata, index: number): BridgeMessage | null {
    const scene = meta.scenes.find((s) => s.index === index);
    if (!scene) return null;
    const msg = emitFrom(this.ctx, 'ableton', this.instanceId, 'ableton.scene.launched', {
      sceneName: scene.name,
      sceneIndex: scene.index,
      ...(scene.id ? { sceneId: scene.id } : {}),
    });
    for (const h of this.handlers) h(msg);
    return msg;
  }
}
