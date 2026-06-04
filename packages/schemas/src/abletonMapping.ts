/**
 * AbletonMapping — the performer's saved plan: each named Session scene and
 * Arrangement locator → a Template choice (a fixed id or "random") + a Variant
 * policy ("canonical" or "random"). The Phase 5b scene/locator-launch resolver
 * (apps/p5-runtime/src/live/abletonRetrieval.ts → `resolveActivation`) looks an
 * incoming event up here; the bridge persists it as JSON
 * (apps/live-bridge/src/mappingStore.ts → config/ableton-mappings/*.json).
 *
 * Naming note: "template" here is the *animation* a row loads (lichtspielOpus,
 * gridWorld, …). The research dossiers call this an "idiom", but in this codebase
 * "idiom" is the monome control layer (faderBank, stepSequencer, …), so the
 * contract uses `templateMode` / `templateId` to avoid the collision.
 *
 * Mirrors AbletonMapping.schema.json.
 */

export const MAPPING_VERSION = '0.1.0';

/** Parent choice: a fixed template id, or a fresh random template each trigger. */
export type TemplateMode = 'fixed' | 'random';
/** Child choice: the template's canonical (signature) variant, or a fresh random one. */
export type VariantMode = 'canonical' | 'random';

/**
 * One scene or locator row. `index` is the 0-based Session scene index or the
 * cue-point index; `name` is the match key (matched name-first, then index).
 */
export interface MappingRow {
  index: number;
  name: string;
  /** Locator song-time in beats (locators only; omitted for scenes). */
  time?: number;
  /** A disabled row is ignored by the resolver (event received but suppressed). */
  enabled: boolean;
  templateMode: TemplateMode;
  /** Required when templateMode === 'fixed': a registry template id. */
  templateId?: string;
  variantMode: VariantMode;
  /** Set when a refresh no longer found this row in the live set (kept, flagged). */
  stale?: boolean;
}

export interface AbletonMapping {
  version: string;
  /** The Live set this plan was snapshotted from (best-effort label). */
  setName: string;
  /**
   * Structural fingerprint of the set this plan was built for (see `signatureOf`).
   * Lets the panel flag presets that match the current set, and lets `mergeSnapshot`
   * decide replace-vs-merge. Optional for backward-compat with pre-set-awareness files.
   */
  setSignature?: string;
  /** ISO-8601 timestamp of the last edit/save. */
  updatedAt: string;
  session: { scenes: MappingRow[] };
  arrangement: { locators: MappingRow[] };
}

/**
 * A raw structural snapshot of a Live set's NAMED scenes + locators (no policy).
 * Produced by the bridge (apps/live-bridge/src/abletonSnapshot.ts) and merged
 * into an AbletonMapping in p5 (mergeSnapshot), preserving prior row edits.
 */
export interface SnapshotScene {
  index: number;
  name: string;
}
export interface SnapshotLocator {
  index: number;
  name: string;
  /** Locator song-time in beats. */
  time: number;
}
export interface AbletonSnapshot {
  setName: string;
  scenes: SnapshotScene[];
  locators: SnapshotLocator[];
  /**
   * Structural fingerprint of this set (see `signatureOf`). Stamped by the bridge
   * on every snapshot; `mergeSnapshot` compares it to the current mapping's
   * `setSignature` to decide whether to replace the rows (new set) or merge (same set).
   */
  signature?: string;
}

/**
 * A short, stable STRUCTURAL fingerprint of a set's named scenes + locators
 * (names, plus locator times, in order). Re-opening the same set hashes equal;
 * a different set — or an edited scene/locator structure — hashes differently.
 * The bridge stamps it on every snapshot; the panel uses it to flag matching
 * presets and `mergeSnapshot` uses it to decide replace-vs-merge. Deliberately
 * ignores `setName` (not always reported) and the rows' policy — purely the
 * set's shape. Deterministic + dependency-free (browser + Node): FNV-1a/base36.
 */
export function signatureOf(snap: {
  scenes: readonly { name: string }[];
  locators: readonly { name: string; time: number }[];
}): string {
  const canonical =
    `scenes:${snap.scenes.map((s) => s.name).join('|')}` +
    `;loc:${snap.locators.map((l) => `${l.name}@${l.time.toFixed(3)}`).join('|')}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * A fresh row's default policy: random template + random variant (so an
 * un-curated set is still performance-interesting out of the box), enabled.
 */
export function makeDefaultRow(init: { index: number; name: string; time?: number }): MappingRow {
  const row: MappingRow = {
    index: init.index,
    name: init.name,
    enabled: true,
    templateMode: 'random',
    variantMode: 'random',
  };
  if (init.time !== undefined) row.time = init.time;
  return row;
}

/**
 * The canonical ADE_Sleuth test set's named scenes + locators (the repo's demo
 * set, mirroring the M4L/feeder test material). Used as the offline fixture by
 * the mapping panel (no Ableton needed) and the bridge's snapshot fallback.
 */
export const ADE_SLEUTH_SNAPSHOT: AbletonSnapshot = {
  setName: 'ADE_Sleuth',
  scenes: [
    { index: 0, name: 'Scene1' },
    { index: 1, name: 'Scene2' },
  ],
  locators: [
    { index: 0, name: 'Intro', time: 0 },
    { index: 1, name: 'buildup', time: 40 },
    { index: 2, name: 'Drop', time: 72 },
    { index: 3, name: 'next', time: 144 },
    { index: 4, name: 'hats back', time: 176 },
    { index: 5, name: 'END', time: 216 },
  ],
};
