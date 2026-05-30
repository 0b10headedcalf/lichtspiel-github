/**
 * Structured, readable logging. Every line carries timestamp, source,
 * type, a payload summary, and a validation/error note when relevant —
 * matching the logging contract in the spec (§17).
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  source?: string;
  target?: string;
  type?: string;
  summary?: string;
  valid?: boolean;
  error?: string;
}

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

export function log(level: LogLevel, msg: string, f: LogFields = {}): void {
  const parts = [`[${ts()}]`, level.toUpperCase().padEnd(5), msg];
  if (f.source) parts.push(`src=${f.source}`);
  if (f.target) parts.push(`dst=${f.target}`);
  if (f.type) parts.push(`type=${f.type}`);
  if (f.summary) parts.push(`· ${f.summary}`);
  if (f.valid === false) parts.push('· INVALID');
  if (f.error) parts.push(`· err=${f.error}`);
  const line = parts.join(' ');
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (m: string, f?: LogFields) => log('info', m, f),
  warn: (m: string, f?: LogFields) => log('warn', m, f),
  error: (m: string, f?: LogFields) => log('error', m, f),
};
