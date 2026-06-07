/**
 * Bridge orchestrator — the wiring hub shared by `index.ts` and the demo.
 *
 * For each inbound message it: gates staleness, routes by type into the
 * SemanticStateEngine, runs the candidate through the SafetyController, applies
 * it to the StateStore, then fans out to Lichtspiel (visual) and MRT2 (audio).
 * The directional DAG is enforced here + by the LineageTracker:
 *   scene / gesture -> BOTH audio prompt + visual
 *   MRT2 metrics    -> visual ONLY (never an audio prompt)
 */
import type { AppConfig } from '../config.js';
import type { TraceTag } from '../logging.js';
import type { SemanticState } from '../schemas/semantic.js';
import {
  emitFrom,
  shortId,
  type BridgeContext,
  type InboundAdapter,
  type MessageHandler,
  type OutboundAdapter,
  type AdapterStatus,
} from '../adapters/types.js';
import type { BridgeMessage, CauseRef, MessageFor } from '../schemas/wire.js';
import type { SystemHealth } from '../schemas/wire.js';
import { StateStore } from './stateStore.js';
import { SemanticStateEngine } from './semanticState.js';
import { SafetyController } from './safetyController.js';
import type { PromptSlot } from '../schemas/semantic.js';

export interface BridgeDeps {
  ctx: BridgeContext;
  config: AppConfig;
  store: StateStore;
  engine: SemanticStateEngine;
  safety: SafetyController;
  inbound: InboundAdapter[];
  mrt2Out: OutboundAdapter | null;
  lichtspielOut: OutboundAdapter | null;
  trace?: (tag: TraceTag, message: string) => void;
}

const f = (n: number): string => n.toFixed(2);
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const summarizeBlend = (blend: PromptSlot[]): string =>
  blend.map((p) => `${p.text} ${Math.round(p.weight * 100)}%`).join(', ');

function causeRefOf(m: BridgeMessage): CauseRef {
  return m.parentCauseId !== undefined ? { causeId: m.causeId, parentCauseId: m.parentCauseId } : { causeId: m.causeId };
}

export class Bridge {
  private readonly instanceId = shortId('bridge');
  private readonly handler: MessageHandler;
  private lastVisualCluster: string | null = null;

  constructor(private readonly deps: BridgeDeps) {
    this.handler = (m) => this.handle(m);
  }

  start(): void {
    for (const a of this.deps.inbound) {
      a.on(this.handler);
      void a.start();
    }
    this.deps.ctx.logger.info({ instanceId: this.instanceId }, 'bridge started');
  }

  async stop(): Promise<void> {
    for (const a of this.deps.inbound) await a.stop();
    this.deps.ctx.logger.info('bridge stopped');
  }

  private t(tag: TraceTag, message: string): void {
    this.deps.trace?.(tag, message);
  }

  private handle(m: BridgeMessage): void {
    // Stale gate (admit runs the stale check first for any type).
    const gate = this.deps.safety.admit(m);
    if (gate.action === 'drop' && gate.reason === 'stale') {
      this.deps.ctx.logger.debug({ type: m.type }, 'inbound dropped: stale');
      return;
    }
    switch (m.type) {
      case 'ableton.scene.launched':
        this.onScene(m);
        break;
      case 'ableton.transport':
        this.onTransport(m);
        break;
      case 'magenta.metrics':
        this.onMetrics(m);
        break;
      case 'magenta.state':
        this.t('mrt2', `Ready: model ${m.payload.model}`);
        break;
      case 'semantic.gesture':
        this.onGesture(m);
        break;
      default:
        break;
    }
  }

  private onScene(m: MessageFor<'ableton.scene.launched'>): void {
    const candidate = this.deps.engine.fromSceneLaunch(m.payload, this.deps.store.get());
    const semCause = this.deps.ctx.lineage.derive(causeRefOf(m), 'core');
    const stateMsg = emitFrom(this.deps.ctx, 'core', this.instanceId, 'semantic.state', candidate, semCause);
    this.applySemantic(stateMsg, semCause, true);
  }

  private onGesture(m: MessageFor<'semantic.gesture'>): void {
    this.t('monome', `Gesture: ${m.payload.label}`);
    const candidate = this.deps.engine.fromGesture(m.payload, this.deps.store.get());
    const semCause = this.deps.ctx.lineage.derive(causeRefOf(m), 'core');
    const stateMsg = emitFrom(this.deps.ctx, 'core', this.instanceId, 'semantic.state', candidate, semCause);
    this.applySemantic(stateMsg, semCause, true);
    this.t('bridge', 'Updated prompt blend and visual vector');
  }

  private onMetrics(m: MessageFor<'magenta.metrics'>): void {
    const metrics = m.payload;
    const entropy = metrics.entropy ?? -1;
    this.t(
      'mrt2',
      `Telemetry: entropy=${entropy >= 0 ? f(entropy) : '~'} buffer=${pct(metrics.bufferOccupancy)} underruns=${metrics.underruns}`,
    );
    if (!metrics.connected) {
      this.onMrt2Disconnected();
      return;
    }
    if (this.deps.store.degradedMode) this.onMrt2Reconnected();

    const { next, warnings } = this.deps.engine.fromMrt2Metrics(metrics, this.deps.store.get());
    if (warnings.includes('low-buffer-freeze-prompts')) {
      this.t('safety', 'Buffer low — calming visuals and freezing prompt changes');
    }
    if (warnings.includes('underrun')) {
      this.t('safety', 'MRT2 underrun — capping visual chaos');
    }
    const semCause = this.deps.ctx.lineage.derive(causeRefOf(m), 'core');
    const stateMsg = emitFrom(this.deps.ctx, 'core', this.instanceId, 'semantic.state', next, semCause);
    this.applySemantic(stateMsg, semCause, false); // metrics -> visual only
  }

  private onTransport(m: MessageFor<'ableton.transport'>): void {
    const pos = { bar: m.payload.bar, beat: m.payload.beat };
    this.deps.safety.setTransport(pos);
    for (const released of this.deps.safety.tickQuantizer(pos)) {
      this.deps.mrt2Out?.send(released);
      if (released.type === 'magenta.prompt.update') {
        this.t('bridge', `Prompt blend applied at bar ${Math.floor(pos.bar)}: ${summarizeBlend(released.payload.promptBlend)}`);
      }
    }
  }

  private applySemantic(
    stateMsg: MessageFor<'semantic.state'>,
    parentCause: CauseRef,
    allowAudioPrompt: boolean,
  ): void {
    const decision = this.deps.safety.admit(stateMsg);
    if (decision.action !== 'emit' || !decision.message) {
      this.deps.ctx.logger.debug({ reason: decision.reason }, 'semantic.state not emitted');
      return;
    }
    const emitted = decision.message as MessageFor<'semantic.state'>;
    const state = emitted.payload;
    this.deps.store.apply(state, emitted);
    this.t(
      'bridge',
      `Semantic state updated: x=${f(state.semanticPosition.x)} y=${f(state.semanticPosition.y)} mutation=${f(state.mutation)}`,
    );

    // Visual fan-out.
    const visualMsg = this.buildVisual(state, parentCause);
    const vd = this.deps.safety.admit(visualMsg);
    if (vd.action === 'emit' && vd.message) {
      this.deps.lichtspielOut?.send(vd.message);
      if (state.visualCluster !== this.lastVisualCluster) {
        this.t('lichtspiel', `Visual cluster selected: ${state.visualCluster}`);
        this.lastVisualCluster = state.visualCluster;
      }
    } else {
      this.deps.ctx.logger.debug({ reason: vd.reason }, 'visual.update not emitted');
    }

    // Audio fan-out (scene/gesture only; metrics never produce prompts).
    if (allowAudioPrompt && this.deps.mrt2Out) {
      const promptMsg = this.buildPrompt(state, parentCause);
      const pd = this.deps.safety.admit(promptMsg);
      if (pd.action === 'emit' && pd.message) {
        this.deps.mrt2Out.send(pd.message);
        this.t('bridge', `Prompt blend set: ${summarizeBlend(state.promptBlend)}`);
      } else if (pd.action === 'defer') {
        this.t(
          'bridge',
          `Prompt blend scheduled for next bar (bar ${pd.deferUntilBar}): ${summarizeBlend(state.promptBlend)}`,
        );
      } else {
        this.deps.ctx.logger.debug({ reason: pd.reason }, 'prompt.update not emitted');
      }
    }
  }

  private buildVisual(state: SemanticState, parentCause: CauseRef): MessageFor<'lichtspiel.visual.update'> {
    const cause = this.deps.ctx.lineage.derive(parentCause, 'lichtspiel');
    return emitFrom(
      this.deps.ctx,
      'core',
      this.instanceId,
      'lichtspiel.visual.update',
      {
        visualCluster: state.visualCluster,
        sceneLock: this.deps.store.sceneLocked,
        manualOverride: this.deps.store.manualOverride,
        transitionMs: 1200,
        visualParamVector: state.visualParamVector,
      },
      cause,
    );
  }

  private buildPrompt(state: SemanticState, parentCause: CauseRef): MessageFor<'magenta.prompt.update'> {
    const cause = this.deps.ctx.lineage.derive(parentCause, 'core');
    const applyAt = this.deps.config.safety.quantizePromptChanges === 'immediate' ? 'immediate' : 'next_bar';
    const promptBlend: PromptSlot[] = state.promptBlend.slice(0, 6);
    return emitFrom(
      this.deps.ctx,
      'core',
      this.instanceId,
      'magenta.prompt.update',
      { promptBlend, applyAt },
      cause,
    );
  }

  private onMrt2Disconnected(): void {
    if (this.deps.store.degradedMode) return;
    this.deps.store.degradedMode = true;
    this.t('mrt2', 'Disconnected');
    this.t('safety', 'Holding last semantic state; visual fallback active; audio control disabled');
    this.deps.ctx.logger.info('MRT2 disconnected — degraded mode');
  }

  private onMrt2Reconnected(): void {
    this.deps.store.degradedMode = false;
    this.t('mrt2', 'Reconnected');
    this.deps.ctx.logger.info('MRT2 reconnected — leaving degraded mode');
  }

  health(): SystemHealth {
    const adapters: Record<string, AdapterStatus> = {
      ableton: this.deps.config.enableMockAbleton ? 'mock' : 'disabled',
      mrt2: this.deps.store.degradedMode
        ? 'down'
        : this.deps.config.enableMrt2Real
          ? 'up'
          : this.deps.config.enableMockMrt2
            ? 'mock'
            : 'disabled',
      lichtspiel: this.deps.lichtspielOut
        ? this.deps.config.enableLichtspielClient
          ? 'up'
          : 'mock'
        : 'disabled',
      monome: this.deps.config.enableMockMonome ? 'mock' : 'disabled',
    };
    const degraded = this.deps.store.degradedMode;
    return { ok: !degraded, degraded, adapters };
  }
}

// Re-export for convenience (constructed by index.ts / demo).
export { StateStore, SemanticStateEngine, SafetyController };
