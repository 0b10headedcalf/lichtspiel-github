/**
 * JSON validation at the bridge boundary. Loads the canonical *.schema.json
 * artifacts from @lichtspiel/schemas/node and compiles ajv validators. The
 * bridge rejects malformed Live state / monome events with readable errors
 * instead of forwarding garbage to the p5 runtime.
 */

import Ajv, { type ValidateFunction } from 'ajv';
import { loadAllSchemas } from '@lichtspiel/schemas/node';

const ajv = new Ajv({ allErrors: true, strict: false });
const schemas = loadAllSchemas();

function compile(name: keyof typeof schemas): ValidateFunction {
  return ajv.compile(schemas[name] as object);
}

export const validators = {
  LiveSessionState: compile('LiveSessionState'),
  VisualParamVector: compile('VisualParamVector'),
  MonomeEvent: compile('MonomeEvent'),
  MutationRequest: compile('MutationRequest'),
  AbletonMapping: compile('AbletonMapping'),
} as const;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validate(name: keyof typeof validators, payload: unknown): ValidationResult {
  const fn = validators[name];
  if (fn(payload)) return { valid: true };
  return { valid: false, error: ajv.errorsText(fn.errors, { separator: '; ' }) };
}
