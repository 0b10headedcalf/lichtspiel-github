/**
 * Mapping store (Phase 5b) — the bridge's authoritative JSON persistence for the
 * performer's scene/locator → animation mappings. Plain files under a configured
 * directory (default `<repo>/config/ableton-mappings/*.json`). The FIRST bridge
 * filesystem code: kept tight + loopback-only. Names are sanitized (no path
 * traversal) and every mapping is ajv-validated against AbletonMapping on the way
 * in and out, so a hand-edited file can never feed garbage to p5.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AbletonMapping, MappingPresetInfo } from '@lichtspiel/schemas';
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

  /**
   * Saved presets with their set fingerprint + label, so the panel can flag the
   * ones that match the currently-loaded set. Skips files that fail validation.
   */
  listDetailed(): MappingPresetInfo[] {
    return this.list().flatMap((name) => {
      const r = this.load(name);
      return r.ok
        ? [{ name, setSignature: r.mapping.setSignature, setName: r.mapping.setName }]
        : [];
    });
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

  /** Rename a saved preset. Won't clobber an existing target. */
  rename(from: string, to: string): SaveResult {
    const a = this.safeName(from);
    const b = this.safeName(to);
    if (!a) return { ok: false, error: `invalid name "${from}"` };
    if (!b) return { ok: false, error: `invalid name "${to}"` };
    if (a === b) return { ok: true };
    const src = join(this.dir, `${a}.json`);
    const dst = join(this.dir, `${b}.json`);
    if (!existsSync(src)) return { ok: false, error: `"${a}" not found` };
    if (existsSync(dst)) return { ok: false, error: `"${b}" already exists` };
    try {
      renameSync(src, dst);
      logger.info('mapping renamed', { summary: `${a} → ${b}` });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  /** Delete a saved preset (a missing file is treated as success). */
  remove(name: string): SaveResult {
    const base = this.safeName(name);
    if (!base) return { ok: false, error: `invalid name "${name}"` };
    const f = join(this.dir, `${base}.json`);
    try {
      if (existsSync(f)) unlinkSync(f);
      logger.info('mapping deleted', { summary: base });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}
