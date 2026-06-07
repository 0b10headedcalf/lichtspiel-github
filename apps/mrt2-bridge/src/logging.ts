/**
 * Structured logging (pino) + a human-readable event-trace helper.
 *
 * - `createLogger` builds the structured logger used by the bridge/adapters.
 *   pino-pretty is a real dependency (loaded in a worker), with a plain-console
 *   fallback if the transport fails to construct (portability/CI safety).
 * - `trace` prints the readable performance storyline the demo shows, e.g.
 *   `[bridge] Semantic state updated: x=0.42 y=0.67`.
 */
import pino, { type Logger } from 'pino';
import type { AppConfig } from './config.js';

export type { Logger };

export function createLogger(log: AppConfig['log']): Logger {
  if (log.pretty) {
    try {
      return pino({
        level: log.level,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      });
    } catch {
      // Pretty transport unavailable (e.g. pruned worker) — fall back to JSON.
    }
  }
  return pino({ level: log.level });
}

/** Tags used in the readable demo trace. */
export type TraceTag = 'demo' | 'bridge' | 'lichtspiel' | 'mrt2' | 'monome' | 'ableton' | 'safety' | 'health';

/** Print one readable storyline line to stdout (separate from structured logs). */
export function trace(tag: TraceTag, message: string): void {
  process.stdout.write(`[${tag}] ${message}\n`);
}
