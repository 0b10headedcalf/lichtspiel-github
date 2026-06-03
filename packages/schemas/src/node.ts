/**
 * Node-only helpers for loading the JSON Schema artifacts at runtime.
 * Import from `@lichtspiel/schemas/node` — NOT from the package root, which
 * must stay browser-safe (no Node built-ins).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the directory that holds the *.schema.json files. */
export const SCHEMA_DIR: string = fileURLToPath(new URL('.', import.meta.url));

export const SCHEMA_FILES = {
  LiveSessionState: 'LiveSessionState.schema.json',
  VisualParamVector: 'VisualParamVector.schema.json',
  VisualTemplate: 'VisualTemplate.schema.json',
  MonomeEvent: 'MonomeEvent.schema.json',
  MutationRequest: 'MutationRequest.schema.json',
  AbletonMapping: 'AbletonMapping.schema.json',
} as const;

export type SchemaName = keyof typeof SCHEMA_FILES;

/** Read and parse one schema by name. */
export function loadSchema(name: SchemaName): unknown {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, SCHEMA_FILES[name]), 'utf8'));
}

/** Read and parse every schema, keyed by name. */
export function loadAllSchemas(): Record<SchemaName, unknown> {
  const out = {} as Record<SchemaName, unknown>;
  for (const name of Object.keys(SCHEMA_FILES) as SchemaName[]) {
    out[name] = loadSchema(name);
  }
  return out;
}
