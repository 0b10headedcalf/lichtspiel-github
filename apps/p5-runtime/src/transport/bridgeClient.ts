/**
 * WebSocket client to the Node live-bridge. Optional: if the bridge isn't
 * running, the runtime stays in browser-only mode and everything still works
 * from the keyboard / on-screen monome. Auto-reconnects with backoff.
 */

import {
  type VisualParamVector,
  type WireMessage,
  PROTOCOL_VERSION,
  isType,
  isWireMessage,
  wire,
} from '@lichtspiel/schemas';
import type { AppBus } from '../messageBus.js';

export interface BridgeClientOptions {
  url: string;
  bus: AppBus;
}

export class BridgeClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly bus: AppBus;
  private reconnectMs = 1000;
  private closed = false;

  constructor(opts: BridgeClientOptions) {
    this.url = opts.url;
    this.bus = opts.bus;
  }

  connect(): void {
    this.closed = false;
    this.open();
  }

  private open(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.reconnectMs = 1000;
      this.send(wire('hello', { protocolVersion: PROTOCOL_VERSION, role: 'p5' }));
      this.bus.emit('status', { connected: true });
      console.info('[bridge] connected', this.url);
    });

    ws.addEventListener('message', (ev) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      if (!isWireMessage(parsed)) return;
      this.route(parsed);
    });

    ws.addEventListener('close', () => {
      this.ws = null;
      this.bus.emit('status', { connected: false });
      if (!this.closed) this.scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // close handler does the reconnect; just avoid an unhandled error.
      ws.close();
    });
  }

  private route(m: WireMessage): void {
    if (isType(m, 'scene.select')) {
      this.bus.emit('scene.select', { sceneId: m.payload.sceneId });
    } else if (isType(m, 'params.update')) {
      this.bus.emit('params.patch', m.payload);
    } else if (isType(m, 'live.state')) {
      this.bus.emit('live.state', m.payload);
    } else if (isType(m, 'scene.launched')) {
      this.bus.emit('scene.launched', m.payload);
    } else if (isType(m, 'locator.crossed')) {
      this.bus.emit('locator.crossed', m.payload);
    } else if (isType(m, 'retrieval.result')) {
      // Apply the retrieved scene + its params.
      this.bus.emit('scene.select', { sceneId: m.payload.sceneId });
      this.bus.emit('params.patch', m.payload.params as Partial<VisualParamVector>);
    } else if (isType(m, 'monome.event')) {
      const e = m.payload;
      if (e.type === 'grid.key') this.bus.emit('monome.grid', e);
      else if (e.type === 'arc.delta') this.bus.emit('monome.arcDelta', e);
      else if (e.type === 'arc.key') this.bus.emit('monome.arcKey', e);
    } else if (isType(m, 'device.attached')) {
      this.bus.emit('device.attached', m.payload);
    } else if (isType(m, 'device.detached')) {
      this.bus.emit('device.detached', m.payload);
    } else if (isType(m, 'ableton.snapshot')) {
      this.bus.emit('ableton.snapshot', m.payload);
    } else if (isType(m, 'mapping.result')) {
      this.bus.emit('mapping.result', m.payload);
    }
  }

  send(msg: WireMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private scheduleReconnect(): void {
    const delay = this.reconnectMs;
    this.reconnectMs = Math.min(this.reconnectMs * 1.6, 10000);
    window.setTimeout(() => {
      if (!this.closed) this.open();
    }, delay);
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }
}
