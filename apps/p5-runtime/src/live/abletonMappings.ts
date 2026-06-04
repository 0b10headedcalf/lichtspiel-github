/**
 * Mapping-state helpers for the Ableton mapping panel (Phase 5b). Pure data:
 * merge a fresh structural snapshot into the performer's saved mapping WITHOUT
 * losing their edits, build an empty mapping, and parse a stored one defensively.
 * The resolver (abletonRetrieval.ts) consumes the result; the bridge owns the
 * authoritative JSON files (mappingStore.ts) and full ajv validation.
 */

import {
  type AbletonMapping,
  type AbletonSnapshot,
  type MappingRow,
  MAPPING_VERSION,
  makeDefaultRow,
} from '@lichtspiel/schemas';

/** An empty mapping (no rows) for a set. */
export function emptyMapping(setName = ''): AbletonMapping {
  return {
    version: MAPPING_VERSION,
    setName,
    updatedAt: new Date().toISOString(),
    session: { scenes: [] },
    arrangement: { locators: [] },
  };
}

interface RowInit {
  index: number;
  name: string;
  time?: number;
}

function mergeRows(prev: readonly MappingRow[], snap: readonly RowInit[]): MappingRow[] {
  const used = new Set<MappingRow>();
  const out: MappingRow[] = snap.map((s) => {
    const byName = s.name
      ? prev.find((r) => !used.has(r) && r.name.toLowerCase() === s.name.toLowerCase())
      : undefined;
    const match = byName ?? prev.find((r) => !used.has(r) && r.index === s.index);
    if (match) {
      used.add(match);
      // Refresh the structural facts; keep the performer's policy (template/variant/enabled).
      const merged: MappingRow = { ...match, index: s.index, name: s.name };
      if (s.time !== undefined) merged.time = s.time;
      else delete merged.time;
      delete merged.stale;
      return merged;
    }
    return makeDefaultRow(s);
  });
  // Keep rows the snapshot no longer contains — flagged stale, never silently dropped.
  for (const r of prev) if (!used.has(r)) out.push({ ...r, stale: true });
  return out;
}

/**
 * Merge a snapshot into the current mapping (or a fresh one). Set-aware: when the
 * snapshot's structural `signature` differs from the current mapping's
 * `setSignature` (a DIFFERENT set loaded), the rows are REPLACED with fresh
 * all-random defaults — the closed set's edits are stale and discarded. When the
 * signature matches (or neither has one), it MERGES: name-first match preserves
 * the performer's edits, new scenes/locators get default rows, and rows the
 * snapshot no longer contains are kept + flagged `stale`. Pure — returns a new mapping.
 */
export function mergeSnapshot(
  current: AbletonMapping | null,
  snapshot: AbletonSnapshot,
): AbletonMapping {
  const replacing = !!snapshot.signature && snapshot.signature !== current?.setSignature;
  const prev = replacing || !current ? emptyMapping(snapshot.setName) : current;
  return {
    version: MAPPING_VERSION,
    setName: snapshot.setName || prev.setName,
    setSignature: snapshot.signature ?? current?.setSignature,
    updatedAt: new Date().toISOString(),
    session: { scenes: mergeRows(prev.session.scenes, snapshot.scenes) },
    arrangement: { locators: mergeRows(prev.arrangement.locators, snapshot.locators) },
  };
}

/** Defensive parse of a stored mapping (e.g. the browser localStorage cache). */
export function parseMapping(text: string): AbletonMapping | null {
  try {
    const m = JSON.parse(text) as AbletonMapping;
    if (
      m &&
      typeof m === 'object' &&
      Array.isArray(m.session?.scenes) &&
      Array.isArray(m.arrangement?.locators)
    ) {
      return m;
    }
  } catch {
    /* ignore malformed cache */
  }
  return null;
}
