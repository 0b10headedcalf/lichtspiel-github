/**
 * REAL MRT2 adapter (Mode 3) — a Python-sidecar client.
 *
 * MRT2 has no built-in IPC server, so the realistic path is a thin Python
 * sidecar (sidecar/mrt2_sidecar.py) wrapping the `magenta_rt` package. This
 * adapter spawns it and exchanges newline-delimited JSON:
 *   - control OUT (stdin):  {cmd:'set_prompts'|'set_params'|...}
 *   - telemetry IN (stdout): {type:'ready'|'metrics'|'transport', ...}
 * AUDIO STAYS IN THE SIDECAR — only control + telemetry cross this boundary
 * (satisfying "no audio over JSON" + "MRT2 not in the bridge's audio path").
 *
 * Not exercised by the mock demo. If the sidecar/python is unavailable it
 * degrades gracefully: logs a clear pointer to docs/mrt2-integration.md and
 * emits a connected:false metric so the bridge enters degraded mode.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import type { MagentaMetrics, MagentaParams } from '../schemas/magenta.js';
import type { PromptSlot } from '../schemas/semantic.js';
import type { BridgeMessage } from '../schemas/wire.js';
import { emitFrom, shortId, type BridgeContext, type InboundAdapter, type MessageHandler, type OutboundAdapter } from './types.js';

export interface Mrt2Engine {
  setTextPrompts(blend: PromptSlot[]): void;
  setParams(params: MagentaParams): void;
  start(): void;
  stop(): void;
  reset(): void;
}

export interface Mrt2AdapterOptions {
  sidecarCmd: string;
  model: string;
  magentaHome: string;
}

const FALLBACK_METRICS: MagentaMetrics = {
  transformerMs: 0,
  totalMs: 0,
  bufferAvailable: 0,
  bufferCapacity: 2048,
  bufferOccupancy: 0,
  droppedFrames: 0,
  underruns: 0,
  rtf: 0,
  transportFlags: -1,
  connected: false,
};

export class Mrt2Adapter implements InboundAdapter, OutboundAdapter, Mrt2Engine {
  readonly name = 'mrt2-real';
  private readonly handlers: MessageHandler[] = [];
  private readonly instanceId = shortId('mrt2-real');
  private proc: ChildProcess | null = null;
  private rl: Interface | null = null;

  constructor(
    private readonly ctx: BridgeContext,
    private readonly opts: Mrt2AdapterOptions,
  ) {}

  on(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  start(): void {
    try {
      const parts = this.opts.sidecarCmd.split(/\s+/).filter(Boolean);
      const cmd = parts[0];
      if (!cmd) throw new Error('empty MRT2_SIDECAR_CMD');
      const args = parts.slice(1);
      const env: NodeJS.ProcessEnv = { ...process.env, MRT2_MODEL: this.opts.model };
      if (this.opts.magentaHome) env['MAGENTA_HOME'] = this.opts.magentaHome;

      const proc = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
      this.proc = proc;
      proc.on('error', (e) => this.onSpawnError(e));
      proc.on('exit', (code) => {
        this.ctx.logger.warn({ code }, 'mrt2 sidecar exited');
        this.emitFallback();
      });
      proc.stderr?.on('data', (d: Buffer) => this.ctx.logger.warn({ sidecar: String(d).trim() }, 'mrt2 sidecar stderr'));
      if (proc.stdout) {
        this.rl = createInterface({ input: proc.stdout });
        this.rl.on('line', (line) => this.onLine(line));
      }
      this.ctx.logger.info({ cmd: this.opts.sidecarCmd, model: this.opts.model }, 'mrt2 sidecar starting');
    } catch (e) {
      this.onSpawnError(e);
    }
  }

  stop(): void {
    this.rl?.close();
    this.rl = null;
    this.proc?.kill();
    this.proc = null;
  }

  reset(): void {
    this.write({ cmd: 'reset' });
  }

  setTextPrompts(blend: PromptSlot[]): void {
    this.write({ cmd: 'set_prompts', prompts: blend.map((p) => ({ text: p.text, weight: p.weight })) });
  }

  setParams(params: MagentaParams): void {
    this.write({ cmd: 'set_params', params });
  }

  /** OutboundAdapter: translate bridge control messages into sidecar commands. */
  send(m: BridgeMessage): void {
    if (m.type === 'magenta.prompt.update') this.setTextPrompts(m.payload.promptBlend);
    else if (m.type === 'magenta.params.update') this.setParams(m.payload);
  }

  private write(obj: unknown): void {
    if (!this.proc?.stdin?.writable) {
      this.ctx.logger.debug('mrt2 sidecar stdin not writable; dropping command');
      return;
    }
    this.proc.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      this.ctx.logger.debug({ line: trimmed }, 'mrt2 sidecar: non-JSON line');
      return;
    }
    const type = msg['type'];
    if (type === 'ready') {
      this.dispatch(
        emitFrom(this.ctx, 'mrt2', this.instanceId, 'magenta.state', {
          ready: true,
          model: String(msg['model'] ?? this.opts.model),
          promptBlend: [],
        }),
      );
    } else if (type === 'metrics') {
      this.dispatch(emitFrom(this.ctx, 'mrt2', this.instanceId, 'magenta.metrics', this.toMetrics(msg)));
    } else if (type === 'transport') {
      this.dispatch(
        emitFrom(this.ctx, 'mrt2', this.instanceId, 'magenta.transport', {
          bar: Number(msg['bar'] ?? 0),
          beat: Number(msg['beat'] ?? 0),
          bpm: Number(msg['bpm'] ?? 120),
          playing: Boolean(msg['playing'] ?? true),
        }),
      );
    }
  }

  private toMetrics(msg: Record<string, unknown>): MagentaMetrics {
    const n = (k: string, d = 0): number => {
      const v = Number(msg[k]);
      return Number.isFinite(v) ? v : d;
    };
    const bufferAvailable = n('bufferAvailable');
    const bufferCapacity = n('bufferCapacity', 2048) || 2048;
    const occ = msg['bufferOccupancy'] !== undefined ? n('bufferOccupancy') : bufferAvailable / bufferCapacity;
    const metrics: MagentaMetrics = {
      transformerMs: n('transformerMs'),
      totalMs: n('totalMs'),
      bufferAvailable,
      bufferCapacity,
      bufferOccupancy: Math.max(0, Math.min(1, occ)),
      droppedFrames: Math.max(0, Math.trunc(n('droppedFrames'))),
      underruns: Math.max(0, Math.trunc(n('underruns'))),
      rtf: n('rtf'),
      transportFlags: Math.trunc(n('transportFlags', -1)),
      connected: msg['connected'] !== false,
    };
    if (msg['entropy'] !== undefined) metrics.entropy = Math.max(0, Math.min(1, n('entropy')));
    return metrics;
  }

  private onSpawnError(e: unknown): void {
    this.ctx.logger.error(
      { err: String(e), sidecar: this.opts.sidecarCmd },
      'MRT2 real adapter unavailable — is python + the magenta_rt env installed? See docs/mrt2-integration.md. Falling back to degraded mode.',
    );
    this.emitFallback();
  }

  private emitFallback(): void {
    this.dispatch(emitFrom(this.ctx, 'mrt2', this.instanceId, 'magenta.metrics', { ...FALLBACK_METRICS }));
  }

  private dispatch(m: BridgeMessage): void {
    for (const h of this.handlers) h(m);
  }
}
