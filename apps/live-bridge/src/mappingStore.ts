/**
 * Mapping store (Phase 5b) — the bridge's authoritative JSON persistence for the
 * performer's scene/locator → animation mappings. Plain files under a configured
 * directory (default `<repo>/config/ableton-mappings/*.json`). The FIRST bridge
 * filesystem code: kept tight + loopback-only. Names are sanitized (no path
 * traversal) and every mapping is ajv-validated against AbletonMapping on the way
 * in and out, so a hand-edited file can never feed garbage to p5.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AbletonMapping } from '@lichtspiel/schemas';
import { logger } from './log.js';
import { validate } from './validate.js';

export type LoadResult =
  | { ok: true; mapping: AbletonMapping }
  | { ok: false; error: string };
export type SaveResult = { ok: true } | { ok: false; error: string };

export class MappingStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  /** A filesystem-safe base name, or null if it can't be made safe. */
  private safeName(name: string): string | null {
    const base = name.replace(/[^A-Za-z0-9 _.-]/g, '').trim();
    if (!base || base.startsWith('.') || base.includes('..')) return null;
    return base;
  }

  /** Saved mapping names (sans .json), sorted. */
  list(): string[] {
    try {
      return readdirSync(this.dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -'.json'.length))
        .sort();
    } catch {
      return []; // dir not created yet
    }
  }

  load(name: string): LoadResult {
    const base = this.safeName(name);
    if (!base) return { ok: false, error: `invalid name "${name}"` };
    try {
      const raw = readFileSync(join(this.dir, `${base}.json`), 'utf8');
      const parsed = JSON.parse(raw);
      const v = validate('AbletonMapping', parsed);
      if (!v.valid) return { ok: false, error: v.error ?? 'invalid mapping' };
      return { ok: true, mapping: parsed as AbletonMapping };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  save(name: string, mapping: AbletonMapping): SaveResult {
    const base = this.safeName(name);
    if (!base) return { ok: false, error: `invalid name "${name}"` };
    const v = validate('AbletonMapping', mapping);
    if (!v.valid) return { ok: false, error: v.error ?? 'invalid mapping' };
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(join(this.dir, `${base}.json`), `${JSON.stringify(mapping, null, 2)}\n`);
      logger.info('mapping saved', { summary: `${base} → ${this.dir}` });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}
