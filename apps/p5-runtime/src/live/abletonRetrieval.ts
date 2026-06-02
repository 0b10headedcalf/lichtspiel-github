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
