/**
 * Template performance profiler — sweeps the catalog, mounts each template,
 * and records raw per-frame {frameMs, jsMs, fps} samples (via SketchHost's
 * sampler hook) to decide, per template, whether it is CPU-bound (p5's
 * immediate-mode geometry rebuild — a renderer swap fixes it), GPU-bound
 * (fill-rate / fragment cost — a swap barely helps), or simply has headroom.
 *
 * Run it from the browser console (`window.__lichtspielProfile()`) or by
 * loading the runtime with `?profile`. It prints a console table and offers a
 * CSV download. See docs/perf-profiling.md for the methodology.
 *
 * This is a dev/diagnostic tool: it is never imported by the performance path.
 */

import type { SketchHost } from '../sketchHost.js';
import type { TemplateRegistry } from '../templateRegistry.js';
import type { VisualTemplate } from '../visualTemplate.js';

export type Verdict = 'cpu-bound' | 'gpu-bound' | 'headroom' | 'unknown';

/** Aggregated stats for one template over the sampling window. */
export interface TemplateStats {
  id: string;
  name: string;
  renderer: string;
  frames: number;
  fpsP50: number;
  fpsP05: number; // 5th percentile fps = the worst frames (your stutter)
  frameMsP50: number;
  frameMsP95: number;
  jsMsP50: number;
  jsMsP95: number;
  /** jsMsP50 / frameMsP50 — the share of the frame spent in main-thread JS. */
  jsShare: number;
  verdict: Verdict;
}

export interface ProfileOptions {
  /** Discard this many ms after each mount (shader compile / JIT warmup). */
  warmupMs?: number;
  /** Collect samples for this long, per template, after warmup. */
  sampleMs?: number;
  /** A fixed seed so each template renders its canonical, reproducible state. */
  seed?: number;
}

const DEFAULTS: Required<ProfileOptions> = { warmupMs: 800, sampleMs: 3000, seed: 1234 };

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i] as number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Probe the display refresh rate (≈ the fps ceiling) by timing rAF deltas.
 * Used by classify() to tell "pinned at vsync" (headroom) from "below vsync".
 */
export async function probeRefreshHz(): Promise<number> {
  const deltas: number[] = [];
  let last = 0;
  await new Promise<void>((resolve) => {
    let n = 0;
    const tick = (t: number): void => {
      if (last) deltas.push(t - last);
      last = t;
      if (n++ < 30) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  deltas.sort((a, b) => a - b);
  const medianDelta = percentile(deltas, 50) || 1000 / 60;
  return Math.round(1000 / medianDelta);
}

/**
 * TODO(you): classify a template's measured stats into a Verdict.
 *
 * This is the whole point of the profiler — the verdict that tells you whether a
 * renderer rewrite would actually help this template. Inputs available on `s`:
 *   - s.fpsP50            median fps
 *   - s.fpsP05            worst-frames fps (the visible stutter)
 *   - s.jsShare           jsMsP50 / frameMsP50  (0..1; fraction of frame in main-thread JS)
 *   - s.jsMsP50 / P95     main-thread CPU cost per frame (ms)
 *   - s.frameMsP50 / P95  wall-clock frame interval (ms)
 *   - refreshHz           the display ceiling from probeRefreshHz()
 *
 * The three regimes (see docs/perf-profiling.md):
 *   • 'headroom'   — fps sits at/near refreshHz. Not bottlenecked; leave it.
 *   • 'cpu-bound'  — fps below refresh AND jsShare is high (JS dominates the frame).
 *                    p5 immediate-mode rebuild → a WebGL2/WebGPU rewrite directly helps.
 *   • 'gpu-bound'  — fps below refresh BUT jsShare is low (GPU/fill-rate, not JS).
 *                    A renderer swap barely helps; cut resolution/overdraw/shader cost.
 *
 * Pick the thresholds. Two judgment calls worth thinking about:
 *   1. How close to refreshHz counts as "headroom"? (a margin, e.g. 0.9×, since
 *      fps jitters and vsync is never a perfectly clean number)
 *   2. Where's the jsShare line between CPU- and GPU-bound? (0.5? 0.6? higher?
 *      — there's no physically "correct" value; it encodes how aggressively you
 *      want to attribute a slow frame to fixable JS vs harder-to-fix GPU work)
 */
function classify(s: TemplateStats, refreshHz: number): Verdict {
  // TODO(you): replace this stub with the real heuristic (≈6 lines).
  void s;
  void refreshHz;
  return 'unknown';
}

/** Profile one already-mounted template over the sampling window. */
async function profileOne(host: SketchHost, t: VisualTemplate, opts: Required<ProfileOptions>): Promise<TemplateStats> {
  host.mount(t, { seed: opts.seed });
  await sleep(opts.warmupMs);

  const frameMs: number[] = [];
  const jsMs: number[] = [];
  const fps: number[] = [];
  const detach = host.addSampler((sm) => {
    if (sm.templateId !== t.id) return;
    frameMs.push(sm.frameMs);
    jsMs.push(sm.jsMs);
    fps.push(sm.fps);
  });
  await sleep(opts.sampleMs);
  detach();

  frameMs.sort((a, b) => a - b);
  jsMs.sort((a, b) => a - b);
  fps.sort((a, b) => a - b);

  const frameMsP50 = percentile(frameMs, 50);
  const jsMsP50 = percentile(jsMs, 50);
  const stats: TemplateStats = {
    id: t.id,
    name: t.name,
    renderer: t.renderer ?? 'p2d',
    frames: frameMs.length,
    fpsP50: round(percentile(fps, 50)),
    fpsP05: round(percentile(fps, 5)),
    frameMsP50: round(frameMsP50),
    frameMsP95: round(percentile(frameMs, 95)),
    jsMsP50: round(jsMsP50),
    jsMsP95: round(percentile(jsMs, 95)),
    jsShare: round(frameMsP50 > 0 ? jsMsP50 / frameMsP50 : 0),
    verdict: 'unknown',
  };
  return stats;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Sweep every template, classify each, print a table, and offer a CSV download. */
export async function profileAll(
  host: SketchHost,
  registry: TemplateRegistry,
  options: ProfileOptions = {},
): Promise<TemplateStats[]> {
  const opts = { ...DEFAULTS, ...options };
  const refreshHz = await probeRefreshHz();
  console.info(`[profiler] display ≈ ${refreshHz}Hz · ${registry.size} templates · ` +
    `${opts.warmupMs}ms warmup + ${opts.sampleMs}ms sample each`);

  const rows: TemplateStats[] = [];
  for (const t of registry.all()) {
    const s = await profileOne(host, t, opts);
    s.verdict = classify(s, refreshHz);
    rows.push(s);
    console.info(`[profiler] ${s.id}: ${s.fpsP50}fps (p05 ${s.fpsP05}) · jsShare ${s.jsShare} · ${s.verdict}`);
  }

  console.table(
    rows.map((r) => ({
      template: r.id,
      renderer: r.renderer,
      fpsP50: r.fpsP50,
      fpsP05: r.fpsP05,
      jsMsP50: r.jsMsP50,
      jsShare: r.jsShare,
      verdict: r.verdict,
    })),
  );
  downloadCsv(rows, refreshHz);
  return rows;
}

function downloadCsv(rows: TemplateStats[], refreshHz: number): void {
  const header = ['id', 'name', 'renderer', 'refreshHz', 'frames', 'fpsP50', 'fpsP05',
    'frameMsP50', 'frameMsP95', 'jsMsP50', 'jsMsP95', 'jsShare', 'verdict'];
  const lines = rows.map((r) => [r.id, r.name, r.renderer, refreshHz, r.frames, r.fpsP50,
    r.fpsP05, r.frameMsP50, r.frameMsP95, r.jsMsP50, r.jsMsP95, r.jsShare, r.verdict].join(','));
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lichtspiel-profile-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
