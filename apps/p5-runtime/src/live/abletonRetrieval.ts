/**
 * Ableton → Lichtspiel retrieval (Phase 5a). Pure template-picking for the two
 * auto-retrieval triggers — a Session scene launch and an Arrangement locator
 * crossing. No p5, no bus, no side effects: (event, mode, registry) → a template.
 * main.ts re-rolls a fresh random *variant* of whatever this returns.
 *
 * Two retrieval modes (the on-screen retrieval-mode toggle):
 *  - `mapped`  — a curatable name/index → template-id table (MAPPED_TABLE below).
 *                Looks the event up by name (case-insensitive), then by index,
 *                then falls back to the index-based default `registry.at(i % size)`.
 *                Curate e.g. `Drop → the Opus hero`. (Name-based *semantic*
 *                retrieval via the ml-service is a deferred 3rd mode.)
 *  - `random`  — a random template, avoiding an immediate repeat of `lastId`.
 */

import type { AbletonMapping, MappingRow, VariantMode } from '@lichtspiel/schemas';
import type { TemplateRegistry } from '../templateRegistry.js';
import type { VisualTemplate } from '../visualTemplate.js';

export type AbletonEventKind = 'scene' | 'locator';
/** Retrieval-mode toggle (`m`). */
export type RetrievalMode = 'mapped' | 'random';
/** Event-source toggle (`e`): real M4L OSC vs UI-fired synthetic events. */
export type EventSource = 'live' | 'simulated';

export interface AbletonEvent {
  kind: AbletonEventKind;
  /** 0-based scene / locator index. */
  index: number;
  /** Scene / locator name (may be empty). */
  name: string;
}

/** A scene/locator key (name lowercased, or stringified index) → template id. */
export type MappingTable = Record<string, string>;

/**
 * Curate `mapped` mode here. Empty by default ⇒ the index-based fallback, so the
 * feature works out of the box. Keys are matched case-insensitively against the
 * event name first, then the stringified index. Examples:
 *   export const MAPPED_TABLE: MappingTable = { drop: 'lichtspielOpus', intro: 'topographicTunnel' };
 */
export const MAPPED_TABLE: MappingTable = {};

/** Wrap an index into a valid registry slot (handles negatives + overflow). */
function wrapIndex(i: number, size: number): number {
  return ((Math.trunc(i) % size) + size) % size;
}

function pickRandom(
  registry: TemplateRegistry,
  lastId: string | undefined,
  rnd: () => number,
): VisualTemplate | undefined {
  const all = registry.all();
  if (all.length <= 1) return all[0];
  const pool = all.filter((t) => t.id !== lastId);
  const arr = pool.length ? pool : all;
  return arr[Math.floor(rnd() * arr.length)];
}

/**
 * Pick the template an Ableton event should load. Returns undefined only if the
 * registry is empty. `rnd` is injectable for deterministic tests.
 */
export function pickTemplate(
  evt: AbletonEvent,
  mode: RetrievalMode,
  registry: TemplateRegistry,
  lastId: string | undefined,
  table: MappingTable = MAPPED_TABLE,
  rnd: () => number = Math.random,
): VisualTemplate | undefined {
  if (registry.size === 0) return undefined;
  if (mode === 'random') return pickRandom(registry, lastId, rnd);
  // mapped: name (case-insensitive) → index key → index-based fallback.
  const mappedId = (evt.name ? table[evt.name.toLowerCase()] : undefined) ?? table[String(evt.index)];
  const mapped = mappedId ? registry.get(mappedId) : undefined;
  return mapped ?? registry.at(wrapIndex(evt.index, registry.size));
}

/**
 * A scene/locator-launch activation decision (Phase 5b). The resolver consults
 * the saved mapping FIRST: a matching enabled row pins the template + variant
 * policy; a disabled row *suppresses* the swap (the event was received, but the
 * performer turned that row off); no matching row (or no mapping) falls back to
 * the Phase-5a global behavior so nothing regresses.
 */
export type Activation =
  | { kind: 'activate'; template: VisualTemplate; variantMode: VariantMode; source: 'mapped' | 'fallback' }
  | { kind: 'suppressed'; reason: 'disabled' }
  | { kind: 'none' };

/** Find the row an event maps to: name (case-insensitive) first, then index. */
function findRow(rows: readonly MappingRow[], evt: AbletonEvent): MappingRow | undefined {
  const byName = evt.name
    ? rows.find((r) => r.name.toLowerCase() === evt.name.toLowerCase())
    : undefined;
  return byName ?? rows.find((r) => r.index === evt.index);
}

/**
 * Resolve what a scene/locator launch should activate, given the saved mapping.
 * Parent (template) → child (variant): a `fixed` row loads its `templateId`
 * (gracefully falling back to a random template if the id is missing/unknown);
 * a `random` row picks a fresh template (avoiding an immediate repeat of
 * `lastId`). With no matching row we defer to `pickTemplate(fallbackMode)` + a
 * random variant — exactly the Phase-5a behavior, so the feature degrades
 * cleanly. `rnd` is injectable for deterministic tests.
 */
export function resolveActivation(
  evt: AbletonEvent,
  mapping: AbletonMapping | null,
  fallbackMode: RetrievalMode,
  registry: TemplateRegistry,
  lastId?: string,
  rnd: () => number = Math.random,
): Activation {
  if (registry.size === 0) return { kind: 'none' };
  const rows = mapping
    ? evt.kind === 'scene'
      ? mapping.session.scenes
      : mapping.arrangement.locators
    : [];
  const row = findRow(rows, evt);
  if (row) {
    if (!row.enabled) return { kind: 'suppressed', reason: 'disabled' };
    const fixed =
      row.templateMode === 'fixed' && row.templateId ? registry.get(row.templateId) : undefined;
    const template = fixed ?? pickRandom(registry, lastId, rnd);
    if (!template) return { kind: 'none' };
    return { kind: 'activate', template, variantMode: row.variantMode, source: 'mapped' };
  }
  const template = pickTemplate(evt, fallbackMode, registry, lastId, MAPPED_TABLE, rnd);
  if (!template) return { kind: 'none' };
  return { kind: 'activate', template, variantMode: 'random', source: 'fallback' };
}
