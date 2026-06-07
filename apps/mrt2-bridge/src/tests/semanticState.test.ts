import { describe, it, expect } from 'vitest';
import { SemanticStateEngine, normalizeMonomeEvent, GESTURE_GAIN } from '../core/semanticState.js';
import { PromptMapper } from '../core/promptMapper.js';
import { PROMPT_MAP, DESERT_RITUAL } from '../demo/fixtures.js';
import { defaultSemanticState, type SemanticState } from '../schemas/semantic.js';
import type { MagentaMetrics } from '../schemas/magenta.js';

function engine(): SemanticStateEngine {
  return new SemanticStateEngine(new PromptMapper(PROMPT_MAP));
}
const sceneLaunch = (sceneName: string, sceneIndex = 0) => ({ sceneName, sceneIndex });
const metrics = (over: Partial<MagentaMetrics> = {}): MagentaMetrics => ({
  transformerMs: 9,
  totalMs: 14,
  bufferAvailable: 1600,
  bufferCapacity: 2048,
  bufferOccupancy: 0.8,
  droppedFrames: 0,
  underruns: 0,
  rtf: 0.35,
  transportFlags: 0,
  connected: true,
  ...over,
});

describe('fromSceneLaunch', () => {
  it('maps Desert Ritual to its blend/cluster/position/mutation', () => {
    const s = engine().fromSceneLaunch(sceneLaunch(DESERT_RITUAL), defaultSemanticState());
    expect(s.visualCluster).toBe('sand-metal-organic');
    expect(s.semanticPosition).toEqual({ x: 0.42, y: 0.67, z: 0.25 });
    expect(s.mutation).toBeCloseTo(0.35, 5);
    expect(s.energy).toBeCloseTo(0.6, 5);
    expect(s.density).toBeCloseTo(0.5, 5);
    expect(s.promptBlend.reduce((a, p) => a + p.weight, 0)).toBeCloseTo(1, 5);
    expect(s.promptBlend[0]!.text).toBe('ceremonial percussion');
    expect(s.promptBlend[0]!.weight).toBeCloseTo(0.7, 5);
  });

  it('returns the deterministic fallback for an unknown scene', () => {
    const s = engine().fromSceneLaunch(sceneLaunch('Nonexistent', 99), defaultSemanticState());
    expect(s).toEqual(defaultSemanticState());
  });
});

describe('clamping + vector invariants', () => {
  it('clamps out-of-range values to [0,1] (NaN -> 0)', () => {
    const bad: SemanticState = {
      semanticPosition: { x: 2, y: -1, z: NaN },
      energy: 5,
      density: -3,
      mutation: NaN,
      certainty: 9,
      exploration: -0.5,
      visualCluster: 'x',
      promptBlend: [{ text: 'a', weight: 8 }],
      visualParamVector: new Array(16).fill(7),
    };
    const c = engine().clampState(bad);
    expect(c.semanticPosition).toEqual({ x: 1, y: 0, z: 0 });
    expect(c.energy).toBe(1);
    expect(c.density).toBe(0);
    expect(c.mutation).toBe(0);
    expect(c.certainty).toBe(1);
    expect(c.exploration).toBe(0);
    expect(c.promptBlend[0]!.weight).toBe(1);
    for (const x of c.visualParamVector) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
  });

  it('always produces a length-16 visual vector', () => {
    const e = engine();
    expect(e.clampState({ ...defaultSemanticState(), visualParamVector: [0.5, 0.5] }).visualParamVector).toHaveLength(16);
    expect(
      e.clampState({ ...defaultSemanticState(), visualParamVector: new Array(40).fill(0.5) }).visualParamVector,
    ).toHaveLength(16);
    expect(e.toVisualParamVector(defaultSemanticState())).toHaveLength(16);
  });
});

describe('fromMrt2Metrics', () => {
  it('higher entropy yields more visual mutation', () => {
    const e = engine();
    const prev = e.fromSceneLaunch(sceneLaunch(DESERT_RITUAL), defaultSemanticState());
    const low = e.fromMrt2Metrics(metrics({ entropy: 0.1 }), prev).next;
    const high = e.fromMrt2Metrics(metrics({ entropy: 0.9 }), prev).next;
    expect(high.mutation).toBeGreaterThan(low.mutation);
    expect(high.visualParamVector[13]!).toBeGreaterThan(low.visualParamVector[13]!); // mutationAmount
  });

  it('underruns raise a warning and cap chaos', () => {
    const r = engine().fromMrt2Metrics(metrics({ entropy: 0.9, underruns: 2 }), defaultSemanticState());
    expect(r.warnings).toContain('underrun');
    expect(r.next.mutation).toBeLessThanOrEqual(0.4);
  });

  it('low buffer warns to freeze prompts and calms visuals', () => {
    const prev = { ...defaultSemanticState(), mutation: 0.8, exploration: 0.8 };
    const r = engine().fromMrt2Metrics(metrics({ bufferOccupancy: 0.1, entropy: 0.5 }), prev);
    expect(r.warnings).toContain('low-buffer-freeze-prompts');
    expect(r.next.exploration).toBeLessThan(prev.exploration);
  });

  it('disconnected holds the last state and flags it', () => {
    const e = engine();
    const prev = e.fromSceneLaunch(sceneLaunch(DESERT_RITUAL), defaultSemanticState());
    const r = e.fromMrt2Metrics(metrics({ connected: false }), prev);
    expect(r.warnings).toContain('mrt2-disconnected');
    expect(r.next).toBe(prev);
  });
});

describe('gesture bounding', () => {
  it('moves toward a grid target by at most GESTURE_GAIN', () => {
    const prev = { ...defaultSemanticState(), semanticPosition: { x: 0, y: 0, z: 0.5 } };
    const g = normalizeMonomeEvent({ type: 'grid.key', deviceId: 'g', x: 15, y: 7, state: 1 });
    const s = engine().fromGesture(g, prev);
    expect(s.semanticPosition.x).toBeCloseTo(GESTURE_GAIN, 2);
    expect(s.semanticPosition.x).toBeLessThanOrEqual(GESTURE_GAIN + 1e-9);
  });

  it('bounds the arc exploration delta even for a huge raw delta', () => {
    const g = normalizeMonomeEvent({ type: 'arc.delta', deviceId: 'a', encoder: 0, delta: 1000 });
    const s = engine().fromGesture(g, defaultSemanticState());
    expect(s.exploration).toBeLessThanOrEqual(GESTURE_GAIN + 1e-9);
  });
});
