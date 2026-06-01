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
import { monomeArcgridcombo } from './monomeArcgridcombo.js';
import { patternGridWorld } from './patternGridWorld.js';
import { pasArcgrid } from './pasArcgrid.js';
import { upfAvTest } from './upfAvTest.js';
import { monomeArc4Shapes } from './monomeArc4Shapes.js';
import { itoBox } from './itoBox.js';
import { parquetDeformation } from './parquetDeformation.js';
import { pasHalloween } from './pasHalloween.js';

export const TEMPLATES: readonly VisualTemplate[] = [
  minimalPulse,
  topographicTunnel,
  gridWorld,
  parquetGlitch,
  torusField,
  lichtspielOpus,
  monomeArcgridcombo,
  patternGridWorld,
  pasArcgrid,
  upfAvTest,
  monomeArc4Shapes,
  itoBox,
  parquetDeformation,
  pasHalloween,
];

export {
  minimalPulse,
  topographicTunnel,
  gridWorld,
  parquetGlitch,
  torusField,
  lichtspielOpus,
  monomeArcgridcombo,
  patternGridWorld,
  pasArcgrid,
  upfAvTest,
  monomeArc4Shapes,
  itoBox,
  parquetDeformation,
  pasHalloween,
};
