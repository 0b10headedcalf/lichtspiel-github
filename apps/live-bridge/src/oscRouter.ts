/**
 * OSC routing — Phase 3/4 stub. This will bridge two OSC worlds into the
 * WebSocket hub:
 *   - Max for Live (node_bridge.maxpat) ⇄ bridge, for LiveSessionState in
 *     and visual/param messages out.
 *   - serialosc ⇄ bridge, as the monome fallback when the Max monome
 *     package isn't in the loop (see spec §10.2).
 *
 * Intentionally not wired yet — the Phase 1/2 demo path is WebSocket + the
 * on-screen monome emulator. Implemented behind this interface so enabling
 * OSC later doesn't touch the WS hub.
 */

import { logger } from './log.js';
import type { WireMessage } from '@lichtspiel/schemas';

export interface OscRouterOptions {
  host: string;
  /** OSC port Max sends to (bridge listens). */
  maxToBridgePort: number;
  /** OSC port the bridge sends to Max. */
  bridgeToMaxPort: number;
  /** serialosc discovery port (monome fallback). */
  serialoscPort: number;
  /** Push a decoded wire message into the hub. */
  onMessage: (m: WireMessage) => void;
}

export class OscRouter {
  private readonly opts: OscRouterOptions;
  constructor(opts: OscRouterOptions) {
    this.opts = opts;
  }

  start(): void {
    logger.info(
      `OSC router stubbed (Phase 3/4): max⇄${this.opts.maxToBridgePort}/${this.opts.bridgeToMaxPort}, serialosc:${this.opts.serialoscPort}`,
    );
    // TODO(phase3): bind UDP via `osc` / `node-osc`, decode /lichtspiel/* and
    // /serialosc/* address patterns into WireMessages, call onMessage().
  }

  /** Send a wire message out as OSC toward Max (Phase 3). */
  send(_m: WireMessage): void {
    // TODO(phase3): encode + UDP send to bridgeToMaxPort.
  }

  stop(): void {}
}
