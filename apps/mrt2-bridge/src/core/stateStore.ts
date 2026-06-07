/**
 * StateStore — the single holder of the current SemanticState plus the
 * performance flags (scene lock, manual override, degraded mode). Pub/sub so
 * the orchestrator and adapters can react to applied changes.
 */
import type { Cancel } from './clock.js';
import { defaultSemanticState, type SemanticState } from '../schemas/semantic.js';
import type { BridgeMessage } from '../schemas/wire.js';

export type StateListener = (state: SemanticState, cause: BridgeMessage) => void;

export class StateStore {
  private state: SemanticState;
  private readonly listeners = new Set<StateListener>();

  /** Scene lock prevents visual state from driving MRT2 prompts. */
  sceneLocked = false;
  /** Manual override pauses automatic semantic updates. */
  manualOverride = false;
  /** Degraded mode: MRT2 (or another critical input) is unavailable. */
  degradedMode = false;

  constructor(initial: SemanticState = defaultSemanticState()) {
    this.state = initial;
  }

  get(): SemanticState {
    return this.state;
  }

  apply(next: SemanticState, cause: BridgeMessage): void {
    this.state = next;
    for (const l of this.listeners) l(next, cause);
  }

  subscribe(fn: StateListener): Cancel {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}
