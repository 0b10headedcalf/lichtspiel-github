import { describe, it, expect } from 'vitest';
import { PromptMapper, clusterToSceneId } from '../core/promptMapper.js';
import { PROMPT_MAP } from '../demo/fixtures.js';
import { NUMERIC_PARAM_KEYS } from '../schemas/lichtspiel.js';

describe('lookupScene', () => {
  const m = new PromptMapper(PROMPT_MAP);
  it('finds a scene case-insensitively', () => {
    expect(m.lookupScene('desert ritual')?.id).toBe('scene-001');
    expect(m.lookupScene('  Neon Market ')?.id).toBe('scene-002');
  });
  it('returns undefined for unknown scenes', () => {
    expect(m.lookupScene('nope')).toBeUndefined();
  });
});

describe('normalizeBlend', () => {
  it('normalizes weights to sum 1.0', () => {
    const out = PromptMapper.normalizeBlend([
      { text: 'a', weight: 7 },
      { text: 'b', weight: 3 },
    ]);
    expect(out.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 6);
    expect(out[0]!.weight).toBeCloseTo(0.7, 6);
  });
  it('handles zero / empty gracefully', () => {
    const z = PromptMapper.normalizeBlend([
      { text: 'a', weight: 0 },
      { text: 'b', weight: 0 },
    ]);
    expect(z.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 6);
    expect(PromptMapper.normalizeBlend([])).toHaveLength(1);
  });
});

describe('vectorToLichtspielParams', () => {
  const m = new PromptMapper(PROMPT_MAP);
  it('maps the 16-float vector to sceneId + 15 named keys in order, dropping index 15', () => {
    const v = Array.from({ length: 16 }, (_, i) => i / 15);
    const params = m.vectorToLichtspielParams(v, 'patternGridWorld');
    expect(params.sceneId).toBe('patternGridWorld');
    NUMERIC_PARAM_KEYS.forEach((k, i) => {
      expect(params[k]).toBeCloseTo(v[i]!, 6);
    });
    expect(Object.keys(params)).toHaveLength(1 + NUMERIC_PARAM_KEYS.length);
  });
  it('clamps out-of-range vector values', () => {
    const params = m.vectorToLichtspielParams(new Array(16).fill(5), 'x');
    expect(params.density).toBe(1);
  });
});

describe('blendForPosition', () => {
  const m = new PromptMapper(PROMPT_MAP);
  it('weights sum to ~1 and dominance follows proximity to an anchor', () => {
    const nearDesert = m.blendForPosition({ x: 0.42, y: 0.67, z: 0.25 }, 0);
    const nearNeon = m.blendForPosition({ x: 0.75, y: 0.35, z: 0.6 }, 0);
    expect(nearDesert.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 6);
    // slot 0 corresponds to the first entry (Desert); dominant near Desert, weaker near Neon.
    expect(nearDesert[0]!.weight).toBeGreaterThan(nearNeon[0]!.weight);
  });
});

describe('clusterToSceneId', () => {
  it('maps known clusters to template ids and falls back to minimalPulse', () => {
    expect(clusterToSceneId('sand-metal-organic')).toBe('patternGridWorld');
    expect(clusterToSceneId('totally-unknown')).toBe('minimalPulse');
  });
});
