/**
 * SemanticStateEngine — the MATH that turns inputs (scene launch, monome
 * gesture, MRT2 telemetry) into a normalized, clamped candidate SemanticState.
 * It does NOT throttle/quantize (that is the SafetyController's job); it only
 * computes. Every output is clamped to [0,1] and the visual vector is length 16.
 */
import {
  clamp01,
  defaultSemanticState,
  lerp,
  type NormalizedGesture,
  type SemanticState,
} from '../schemas/semantic.js';
import type { AbletonSceneLaunched } from '../schemas/ableton.js';
import type { MagentaMetrics } from '../schemas/magenta.js';
import type { MonomeEvent } from '../schemas/lichtspiel.js';
import { PromptMapper } from './promptMapper.js';

/** Bounded per-event gesture influence (move-toward gain). */
export const GESTURE_GAIN = 0.25;
/** Below this ring-buffer occupancy MRT2 is starving — freeze prompts, calm visuals. */
export const LOW_BUFFER_THRESHOLD = 0.25;
/** Monome arc ticks per full turn (for delta normalization). */
export const ARC_TICKS_PER_TURN = 64;

function fmtDelta(x: number): string {
  return `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
}

/** Normalize a raw Lichtspiel monome event into a bounded gesture. */
export function normalizeMonomeEvent(
  ev: MonomeEvent,
  grid: { cols: number; rows: number } = { cols: 16, rows: 8 },
): NormalizedGesture {
  if (ev.type === 'arc.delta') {
    const scaled = Math.max(-1, Math.min(1, ev.delta / ARC_TICKS_PER_TURN));
    if (ev.encoder === 0) {
      return { source: 'arc', explorationDelta: scaled, label: `arc enc0 ${fmtDelta(scaled)}` };
    }
    return { source: 'arc', blendDelta: scaled, label: `arc enc${ev.encoder} ${fmtDelta(scaled)}` };
  }
  if (ev.type === 'grid.key') {
    return {
      source: 'grid',
      targetX: clamp01(ev.x / Math.max(1, grid.cols - 1)),
      targetY: clamp01(ev.y / Math.max(1, grid.rows - 1)),
      label: `grid (${ev.x},${ev.y}) ${ev.state ? 'down' : 'up'}`,
    };
  }
  return { source: 'arc', label: `arc.key enc${ev.encoder} ${ev.state ? 'down' : 'up'}` };
}

export interface Mrt2Influence {
  next: SemanticState;
  warnings: string[];
}

export class SemanticStateEngine {
  /** The last scene's seed position, for the `semanticDistance` channel. */
  private seed = { x: 0.5, y: 0.5, z: 0.5 };

  constructor(private readonly mapper: PromptMapper) {}

  /** Scene launch -> blend + cluster + seed position + mutation/energy/density. */
  fromSceneLaunch(scene: AbletonSceneLaunched, prev: SemanticState): SemanticState {
    const entry =
      this.mapper.lookupScene(scene.sceneName) ?? this.mapper.lookupByIndex(scene.sceneIndex);
    if (!entry) {
      // Missing scene -> deterministic fallback state.
      this.seed = { x: 0.5, y: 0.5, z: 0.5 };
      return defaultSemanticState();
    }
    this.seed = { ...entry.semanticPosition };
    const next: SemanticState = {
      semanticPosition: { ...entry.semanticPosition },
      energy: clamp01(entry.energy),
      density: clamp01(entry.density),
      mutation: clamp01(entry.mutation),
      certainty: 1.0, // a freshly launched scene is "certain"
      exploration: 0.0, // reset wandering on a scene change
      visualCluster: entry.visualCluster,
      promptBlend: PromptMapper.normalizeBlend(entry.promptBlend),
      visualParamVector: prev.visualParamVector,
    };
    next.visualParamVector = this.toVisualParamVector(next);
    return this.clampState(next);
  }

  /** Bounded gesture application (per-event change <= GESTURE_GAIN per field). */
  fromGesture(g: NormalizedGesture, prev: SemanticState): SemanticState {
    const next = structuredClone(prev);
    if (g.targetX !== undefined) {
      next.semanticPosition.x = lerp(prev.semanticPosition.x, g.targetX, GESTURE_GAIN);
    }
    if (g.targetY !== undefined) {
      next.semanticPosition.y = lerp(prev.semanticPosition.y, g.targetY, GESTURE_GAIN);
    }
    if (g.explorationDelta !== undefined) {
      next.exploration = clamp01(prev.exploration + g.explorationDelta * GESTURE_GAIN);
    }
    if (g.blendDelta !== undefined) {
      next.promptBlend = this.mapper.blendForPosition(next.semanticPosition, next.exploration);
    }
    next.visualParamVector = this.toVisualParamVector(next);
    return this.clampState(next);
  }

  /**
   * MRT2 telemetry -> visual mutation / stability / warnings.
   *  - higher entropy -> more visual mutation
   *  - underruns > 0  -> warning + cap chaos
   *  - low buffer     -> calm visuals + "freeze prompts" warning
   *  - disconnected   -> hold last state, emit 'mrt2-disconnected'
   */
  fromMrt2Metrics(m: MagentaMetrics, prev: SemanticState): Mrt2Influence {
    if (!m.connected) {
      return { next: prev, warnings: ['mrt2-disconnected'] };
    }
    const warnings: string[] = [];
    const next = structuredClone(prev);

    const entropy = m.entropy ?? this.deriveEntropy(m);
    next.mutation = clamp01(0.5 * prev.mutation + 0.5 * entropy);

    if (m.underruns > 0) {
      warnings.push('underrun');
      next.mutation = clamp01(Math.min(next.mutation, 0.4));
      next.energy = clamp01(prev.energy * 0.9);
    }
    if (m.bufferOccupancy < LOW_BUFFER_THRESHOLD) {
      warnings.push('low-buffer-freeze-prompts');
      next.mutation = clamp01(next.mutation * 0.5);
      next.exploration = clamp01(prev.exploration * 0.5);
    }
    // Real-time factor > 1 means we can't keep up -> lower certainty.
    next.certainty = clamp01(1 - (m.rtf > 1 ? Math.min(1, m.rtf - 1) : 0));

    next.visualParamVector = this.toVisualParamVector(next);
    return { next: this.clampState(next), warnings };
  }

  /** Proxy entropy for real MRT2 (which emits none): starve + slowdown read as chaos. */
  private deriveEntropy(m: MagentaMetrics): number {
    return clamp01(0.3 + 0.4 * (1 - m.bufferOccupancy) + 0.3 * Math.min(1, m.rtf));
  }

  /** Build the canonical 16-float visual param vector from semantic state. */
  toVisualParamVector(s: SemanticState): number[] {
    const turbulence = 0.5 * s.mutation + 0.5 * s.exploration;
    const strobe = s.energy * s.mutation;
    const rotationZ = (s.semanticPosition.x + s.semanticPosition.y) / 2;
    const v = [
      s.density, // 0  density
      s.energy, // 1  motion
      turbulence, // 2  turbulence
      1 - s.exploration, // 3  symmetry
      strobe, // 4  strobe
      s.semanticPosition.z, // 5  cameraDepth
      s.semanticPosition.x, // 6  rotationX
      s.semanticPosition.y, // 7  rotationY
      rotationZ, // 8  rotationZ
      s.semanticPosition.x, // 9  palette
      s.certainty, // 10 contrast
      1 - s.density, // 11 lineWeight
      s.mutation, // 12 feedback
      s.mutation, // 13 mutationAmount
      this.distanceFromSeed(s), // 14 semanticDistance
      s.energy, // 15 energyReserve (bridge-internal)
    ];
    return v.map(clamp01);
  }

  private distanceFromSeed(s: SemanticState): number {
    const dx = s.semanticPosition.x - this.seed.x;
    const dy = s.semanticPosition.y - this.seed.y;
    const dz = s.semanticPosition.z - this.seed.z;
    return clamp01(Math.sqrt(dx * dx + dy * dy + dz * dz) / Math.sqrt(3));
  }

  /** Clamp every numeric to [0,1] (NaN->0) and force a length-16 visual vector. */
  clampState(s: SemanticState): SemanticState {
    const v = s.visualParamVector.slice(0, 16).map(clamp01);
    while (v.length < 16) v.push(0);
    return {
      semanticPosition: {
        x: clamp01(s.semanticPosition.x),
        y: clamp01(s.semanticPosition.y),
        z: clamp01(s.semanticPosition.z),
      },
      energy: clamp01(s.energy),
      density: clamp01(s.density),
      mutation: clamp01(s.mutation),
      certainty: clamp01(s.certainty),
      exploration: clamp01(s.exploration),
      visualCluster: s.visualCluster,
      promptBlend: s.promptBlend.map((p) => ({ ...p, weight: clamp01(p.weight) })),
      visualParamVector: v,
    };
  }
}
