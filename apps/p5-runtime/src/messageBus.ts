/**
 * Tiny typed pub/sub used to decouple input sources (keyboard, bridge,
 * on-screen emulator) from the host + UI. Not the control bus — this is an
 * in-browser event bus for the runtime's own wiring.
 */

import type {
  ArcDeltaEvent,
  ArcKeyEvent,
  GridKeyEvent,
  LiveSessionState,
  StatusPayload,
  VisualParamVector,
} from '@lichtspiel/schemas';

export interface AppEvents {
  /** A scene change was requested (by id). */
  'scene.select': { sceneId: string };
  /** A partial param patch was requested (keyboard, bridge, monome…). */
  'params.patch': Partial<VisualParamVector>;
  /** New Live session state arrived. */
  'live.state': LiveSessionState;
  /** A monome (or emulated) input event. */
  'monome.grid': GridKeyEvent;
  'monome.arcDelta': ArcDeltaEvent;
  'monome.arcKey': ArcKeyEvent;
  /** Lock toggled. */
  'lock.toggle': { locked: boolean };
  /** Randomize current params within safe ranges. */
  'params.randomize': void;
  /** Per-frame tick for HUD (fps + current smoothed params). */
  frame: { fps: number; params: VisualParamVector; templateId: string };
  /** Bridge/connection status changed. */
  status: Partial<StatusPayload> & { connected: boolean };
}

type Handler<T> = (payload: T) => void;

export class Emitter<E> {
  private handlers: { [K in keyof E]?: Set<Handler<E[K]>> } = {};

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    (this.handlers[type] ??= new Set()).add(fn);
    return () => this.handlers[type]?.delete(fn);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers[type];
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[bus] handler for "${String(type)}" threw`, err);
      }
    }
  }
}

export type AppBus = Emitter<AppEvents>;
export function createBus(): AppBus {
  return new Emitter<AppEvents>();
}
