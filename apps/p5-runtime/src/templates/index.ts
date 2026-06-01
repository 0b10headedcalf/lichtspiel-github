/**
 * Template catalog. Order defines keyboard slots (1..N) and monome grid
 * columns (Phase 4). minimalPulse is first so it's the safe default scene.
 */

import type { VisualTemplate } from '../visualTemplate.js';
import { minimalPulse } from './minimalPulse.js';
import { topographicTunnel } from './topographicTunnel.js';
import { gridWorld } from './gridWorld.js';
import { parquetGlitch } from './parquetGlitch.js';
import { torusField } from './torusField.js';
import { lichtspielOpus } from './lichtspielOpus.js';

export const TEMPLATES: readonly VisualTemplate[] = [
  minimalPulse,
  topographicTunnel,
  gridWorld,
  parquetGlitch,
  torusField,
  lichtspielOpus,
];

export { minimalPulse, topographicTunnel, gridWorld, parquetGlitch, torusField, lichtspielOpus };
