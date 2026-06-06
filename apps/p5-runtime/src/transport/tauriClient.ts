/**
 * Tauri IPC transport for the Lichtspiel p5 runtime.
 *
 * Replaces the WebSocket BridgeClient when running inside the Tauri desktop shell.
 * Uses Tauri commands (invoke) for outgoing messages and Tauri events (listen)
 * for incoming messages from the Rust backend.
 *
 * The Rust backend spawns the Node live-bridge as a child process and forwards
 * messages between the bridge and the webview via Tauri IPC.
 */

import {
  type VisualParamVector,
  isType,
} from '@lichtspiel/schemas';
import type { AppBus } from '../messageBus.js';
import type { WireMessage } from '@lichtspiel/schemas';

// Tauri v2 API — lazy import so this module doesn't crash in browser mode
type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type TauriListen = (event: string, handler: (evt: { payload: unknown }) => void) => Promise<() => void>;

let invoke: TauriInvoke | null = null;
let listen: TauriListen | null = null;
let tauriAvailable = false;

async function loadTauri(): Promise<boolean> {
  if (tauriAvailable) return true;
  if (!window.__TAURI__) return false;

  try {
    const core = await import(/* @vite-ignore */ '@tauri-apps/api/core');
    const event = await import(/* @vite-ignore */ '@tauri-apps/api/event');
    invoke = core.invoke;
    listen = event.listen;
    tauriAvailable = true;
    return true;
  } catch {
    // Tauri packages not installed (dev mode with external Vite server)
    // Fall back to using the global __TAURI__ object directly
    if (window.__TAURI__?.core?.invoke) {
      invoke = window.__TAURI__.core.invoke.bind(window.__TAURI__.core);
      listen = async (event: string, handler: (evt: { payload: unknown }) => void) => {
        return window.__TAURI__!.event.listen(event, handler);
      };
      tauriAvailable = true;
      return true;
    }
    return false;
  }
}

export interface TauriClientOptions {
  bus: AppBus;
}

export class TauriClient {
  private readonly bus: AppBus;
  private connected = false;
  private unlistenFns: Array<() => void> = [];
  private initialized = false;

  constructor(opts: TauriClientOptions) {
    this.bus = opts.bus;
  }

  async connect(): Promise<void> {
    const available = await loadTauri();
    if (!available) {
      console.warn('[tauri] Tauri IPC not available, falling back to browser mode');
      return;
    }

    if (this.initialized) return;
    this.initialized = true;

    // Try to spawn the bridge
    try {
      await invoke!('spawn_bridge');
    } catch (e) {
      console.warn('[tauri] bridge spawn failed (may not be bundled):', e);
    }

    // Listen for events from the Rust backend
    await this.setupListeners();

    this.connected = true;
    this.bus.emit('status', { connected: true });
    console.info('[tauri] IPC connected');
  }

  private async setupListeners(): Promise<void> {
    if (!listen) return;

    // Map Tauri events to bus events
    const eventMap: Record<string, string> = {
      'live-state': 'live.state',
      'scene-select': 'scene.select',
      'params-update': 'params.patch',
      'scene-launched': 'scene.launched',
      'locator-crossed': 'locator.crossed',
      'retrieval-result': 'retrieval.result',
      'monome-grid': 'monome.grid',
      'monome-arc-delta': 'monome.arcDelta',
      'monome-arc-key': 'monome.arcKey',
      'device-attached': 'device.attached',
      'device-detached': 'device.detached',
      'ableton-snapshot': 'ableton.snapshot',
      'mapping-result': 'mapping.result',
    };

    for (const [tauriEvent, busEvent] of Object.entries(eventMap)) {
      const unlisten = await listen!(tauriEvent, (evt) => {
        this.route(busEvent, evt.payload);
      });
      this.unlistenFns.push(unlisten);
    }
  }

  private route(busEvent: string, payload: unknown): void {
    switch (busEvent) {
      case 'scene.select':
        this.bus.emit('scene.select', { sceneId: (payload as any).sceneId });
        break;
      case 'params.patch':
        this.bus.emit('params.patch', payload as Partial<VisualParamVector>);
        break;
      case 'live.state':
        this.bus.emit('live.state', payload as any);
        break;
      case 'scene.launched':
        this.bus.emit('scene.launched', payload as any);
        break;
      case 'locator.crossed':
        this.bus.emit('locator.crossed', payload as any);
        break;
      case 'retrieval.result':
        this.bus.emit('scene.select', { sceneId: (payload as any).sceneId });
        this.bus.emit('params.patch', (payload as any).params as Partial<VisualParamVector>);
        break;
      case 'monome.grid':
        this.bus.emit('monome.grid', payload as any);
        break;
      case 'monome.arcDelta':
        this.bus.emit('monome.arcDelta', payload as any);
        break;
      case 'monome.arcKey':
        this.bus.emit('monome.arcKey', payload as any);
        break;
      case 'device.attached':
        this.bus.emit('device.attached', payload as any);
        break;
      case 'device.detached':
        this.bus.emit('device.detached', payload as any);
        break;
      case 'ableton.snapshot':
        this.bus.emit('ableton.snapshot', payload as any);
        break;
      case 'mapping.result':
        this.bus.emit('mapping.result', payload as any);
        break;
    }
  }

  send(msg: WireMessage): void {
    if (!invoke || !this.connected) return;

    // Route wire messages to the appropriate Tauri command
    if (isType(msg, 'led.frame')) {
      invoke('send_led_frame', { frame: msg.payload }).catch(() => {});
    } else if (isType(msg, 'mapping.request')) {
      invoke('mapping_request', { op: msg.payload.op, name: msg.payload.name, mapping: msg.payload.mapping }).catch(() => {});
    } else if (isType(msg, 'ableton.snapshotRequest')) {
      invoke('snapshot_request').catch(() => {});
    } else if (isType(msg, 'hello')) {
      // hello is a no-op in Tauri mode (connection is implicit)
    } else {
      // Generic: forward as a wire message to the bridge
      invoke('forward_wire', { type: msg.type, payload: msg.payload }).catch(() => {});
    }
  }

  close(): void {
    for (const unlisten of this.unlistenFns) {
      unlisten();
    }
    this.unlistenFns = [];
    this.connected = false;
    this.bus.emit('status', { connected: false });

    invoke?.('stop_bridge').catch(() => {});
  }
}

/** Check if we're running inside Tauri. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI__;
}
