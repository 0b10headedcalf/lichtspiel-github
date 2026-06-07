/**
 * PromptMapper — the bridge between scenes, semantic space, MRT2 prompts, and
 * Lichtspiel visual params.
 *
 *  - scene name/index  -> PromptMapEntry (blend + cluster + seed position)
 *  - semantic position -> interpolated prompt blend (distance-weighted anchors)
 *  - 16-float vector   -> Lichtspiel `Partial<VisualParamVector>` (index->key)
 *  - visual cluster    -> Lichtspiel template id (sceneId)
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { clamp01, unit, type PromptSlot } from '../schemas/semantic.js';
import {
  DEFAULT_LICHTSPIEL_SCENE_ID,
  NUMERIC_PARAM_KEYS,
  type VisualParamVector,
} from '../schemas/lichtspiel.js';

export const PromptMapSlotSchema = z.object({
  promptId: z.string(),
  text: z.string(),
  weight: z.number().min(0),
});

export const PromptMapEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  index: z.number().int(),
  promptBlend: z.array(PromptMapSlotSchema).min(1),
  visualCluster: z.string(),
  semanticPosition: z.object({ x: unit, y: unit, z: unit }),
  mutation: unit,
  energy: unit,
  density: unit,
});
export type PromptMapEntry = z.infer<typeof PromptMapEntrySchema>;

export const PromptMapFileSchema = z.object({ scenes: z.array(PromptMapEntrySchema) });

export function loadPromptMapFile(path: string): PromptMapEntry[] {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return PromptMapFileSchema.parse(raw).scenes;
}

/**
 * Visual-cluster name -> Lichtspiel p5 template id. Cluster names are the
 * bridge's semantic vocabulary; `sceneId` names an actual template (defaults to
 * 'minimalPulse'). Template ids are real Lichtspiel templates.
 */
const CLUSTER_TEMPLATE_LUT: Record<string, string> = {
  'sand-metal-organic': 'patternGridWorld',
  'neon-grid-organic': 'lichtspielOpus',
  neutral: DEFAULT_LICHTSPIEL_SCENE_ID,
};

export function clusterToSceneId(cluster: string): string {
  return CLUSTER_TEMPLATE_LUT[cluster] ?? DEFAULT_LICHTSPIEL_SCENE_ID;
}

/**
 * Map the canonical 16-float vector + a template id to a Lichtspiel
 * `params.update` payload. Indices 0..14 map identity-in-order onto the 15
 * NUMERIC_PARAM_KEYS; index 15 (energyReserve) is bridge-internal and dropped.
 * Standalone so adapters can reuse it without a PromptMapper instance.
 */
export function vectorToLichtspielParams(
  v: ReadonlyArray<number>,
  sceneId: string,
): Partial<VisualParamVector> {
  const out: Partial<VisualParamVector> = { sceneId };
  for (let i = 0; i < NUMERIC_PARAM_KEYS.length; i++) {
    out[NUMERIC_PARAM_KEYS[i]!] = clamp01(v[i] ?? 0);
  }
  return out;
}

export class PromptMapper {
  constructor(private readonly entries: PromptMapEntry[]) {}

  all(): readonly PromptMapEntry[] {
    return this.entries;
  }

  lookupScene(name: string): PromptMapEntry | undefined {
    const target = name.trim().toLowerCase();
    return this.entries.find((e) => e.name.trim().toLowerCase() === target);
  }

  lookupByIndex(index: number): PromptMapEntry | undefined {
    return this.entries.find((e) => e.index === index);
  }

  /** Normalize blend weights to sum to 1.0; empty/zero -> uniform. */
  static normalizeBlend(
    blend: ReadonlyArray<{ promptId?: string; text: string; weight: number }>,
  ): PromptSlot[] {
    if (blend.length === 0) return [{ text: 'neutral ambient', weight: 1 }];
    const total = blend.reduce((s, b) => s + Math.max(0, b.weight), 0);
    if (total <= 0) {
      const w = 1 / blend.length;
      return blend.map((b) => ({ promptId: b.promptId, text: b.text, weight: w }));
    }
    return blend.map((b) => ({
      promptId: b.promptId,
      text: b.text,
      weight: clamp01(Math.max(0, b.weight) / total),
    }));
  }

  /**
   * Interpolate a prompt blend for a semantic position by inverse-distance
   * weighting each scene anchor's dominant prompt. `exploration` flattens the
   * weighting (more exploration -> more even spread). Weights sum to ~1.
   */
  blendForPosition(pos: { x: number; y: number; z: number }, exploration: number): PromptSlot[] {
    if (this.entries.length === 0) return [{ text: 'neutral ambient', weight: 1 }];
    const eps = 1e-3;
    const weighted = this.entries.map((e) => {
      const dx = pos.x - e.semanticPosition.x;
      const dy = pos.y - e.semanticPosition.y;
      const dz = pos.z - e.semanticPosition.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      return { entry: e, w: 1 / (eps + dist + clamp01(exploration)) };
    });
    const total = weighted.reduce((s, x) => s + x.w, 0);
    return weighted.map(({ entry, w }) => {
      const top = [...entry.promptBlend].sort((a, b) => b.weight - a.weight)[0]!;
      return { promptId: top.promptId, text: top.text, weight: clamp01(w / total) };
    });
  }

  /**
   * Map the canonical 16-float vector + a template id to a Lichtspiel
   * `params.update` payload. Indices 0..14 map identity-in-order onto the 15
   * NUMERIC_PARAM_KEYS; index 15 (energyReserve) is bridge-internal and dropped.
   */
  vectorToLichtspielParams(v: ReadonlyArray<number>, sceneId: string): Partial<VisualParamVector> {
    return vectorToLichtspielParams(v, sceneId);
  }
}
