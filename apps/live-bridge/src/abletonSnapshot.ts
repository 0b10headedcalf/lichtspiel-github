/**
 * Ableton snapshot (Phase 5b) — read the connected Live set's NAMED scenes +
 * Arrangement locators for the mapping panel. Talks to the ableton-mcp Remote
 * Script socket (the same `get_scene_info` the feeder polls), and falls back to
 * the ADE_Sleuth fixture when Ableton is unreachable or the fixture is forced
 * (headless dev). This is a SNAPSHOT path (deliberate, manual) — NOT a runtime
 * trigger; MCP/Remote-Script stays out of the hot event path.
 */

import net from 'node:net';
import { type AbletonSnapshot, ADE_SLEUTH_SNAPSHOT } from '@lichtspiel/schemas';
import { logger } from './log.js';

export interface SnapshotOptions {
  /** TCP port of the ableton-mcp Remote Script socket (default 9877). */
  abletonPort: number;
  /** Skip Ableton and always return the fixture (LICHTSPIEL_SNAPSHOT_FIXTURE=1). */
  forceFixture: boolean;
}

/** One round-trip JSON request to the Remote Script socket. */
function abletonGet(type: string, port: number): Promise<{ result?: unknown }> {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1');
    let buf = '';
    s.setTimeout(4000);
    s.on('connect', () => s.write(JSON.stringify({ type, params: {} })));
    s.on('data', (d) => {
      buf += d.toString();
      try {
        const r = JSON.parse(buf) as { result?: unknown };
        s.end();
        resolve(r);
      } catch {
        /* keep buffering until the JSON is complete */
      }
    });
    s.on('timeout', () => {
      s.destroy();
      reject(new Error('ableton timeout'));
    });
    s.on('error', reject);
  });
}

interface RawScene {
  index?: number;
  name?: string;
}
interface RawCue {
  index?: number;
  name?: string;
  time?: number;
}

/**
 * Snapshot the connected Live set's named scenes + locators. Named-only (unnamed
 * scenes/locators are skipped). Falls back to the ADE_Sleuth fixture on any error.
 */
export async function snapshotAbleton(opts: SnapshotOptions): Promise<AbletonSnapshot> {
  if (opts.forceFixture) {
    logger.info('snapshot: fixture (forced)');
    return ADE_SLEUTH_SNAPSHOT;
  }
  try {
    const resp = await abletonGet('get_scene_info', opts.abletonPort);
    const si = resp.result as { scenes?: RawScene[]; cue_points?: RawCue[]; set_name?: string } | undefined;
    if (si && typeof si === 'object') {
      const scenes = (Array.isArray(si.scenes) ? si.scenes : [])
        .map((s, i) => ({ index: typeof s.index === 'number' ? s.index : i, name: String(s.name ?? '') }))
        .filter((s) => s.name.length > 0);
      const locators = (Array.isArray(si.cue_points) ? si.cue_points : [])
        .map((c, i) => ({
          index: typeof c.index === 'number' ? c.index : i,
          name: String(c.name ?? ''),
          time: Number(c.time ?? 0),
        }))
        .filter((c) => c.name.length > 0);
      if (scenes.length || locators.length) {
        const setName = typeof si.set_name === 'string' && si.set_name ? si.set_name : 'Live Set';
        logger.info('ableton snapshot', {
          summary: `${scenes.length} scenes · ${locators.length} locators · ${setName}`,
        });
        return { setName, scenes, locators };
      }
    }
    logger.warn('snapshot: get_scene_info empty/odd — using fixture');
  } catch (err) {
    logger.warn('snapshot: Ableton unreachable — using fixture', { error: String(err) });
  }
  return ADE_SLEUTH_SNAPSHOT;
}
