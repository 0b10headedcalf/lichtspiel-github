/**
 * Self-check: every *.schema.json compiles as a valid JSON Schema, and a
 * couple of canonical example payloads validate. Run via
 * `pnpm --filter @lichtspiel/schemas validate`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');
const ajv = new Ajv({ allErrors: true, strict: false });

const schemaFiles = readdirSync(srcDir).filter((f) => f.endsWith('.schema.json'));
let failures = 0;
const validators = {};

for (const file of schemaFiles) {
  try {
    const schema = JSON.parse(readFileSync(join(srcDir, file), 'utf8'));
    validators[file] = ajv.compile(schema);
    console.log(`✓ ${file} is a valid schema`);
  } catch (err) {
    failures++;
    console.error(`✗ ${file} failed to compile: ${err.message}`);
  }
}

// Example payloads that must validate against their schemas.
const examples = [
  [
    'VisualParamVector.schema.json',
    {
      sceneId: 'minimalPulse',
      density: 0.5,
      motion: 0.5,
      turbulence: 0.5,
      symmetry: 0.5,
      strobe: 0,
      cameraDepth: 0.5,
      rotationX: 0.5,
      rotationY: 0.5,
      rotationZ: 0.5,
      palette: 0.5,
      contrast: 0.5,
      lineWeight: 0.5,
      feedback: 0,
      mutationAmount: 0,
      semanticDistance: 0,
    },
  ],
  ['MonomeEvent.schema.json', { type: 'grid.key', deviceId: 'm64_0175', x: 3, y: 4, state: 1 }],
  ['MonomeEvent.schema.json', { type: 'arc.delta', deviceId: 'm0000174', encoder: 0, delta: -2 }],
  [
    'MutationRequest.schema.json',
    { type: 'mutation_request', version: '0.1.0', amount: 0.3, axes: ['palette', 'motion'] },
  ],
  [
    'AbletonMapping.schema.json',
    {
      version: '0.1.0',
      setName: 'ADE_Sleuth',
      setSignature: 'abc123',
      updatedAt: '2026-06-03T00:00:00.000Z',
      session: {
        scenes: [
          {
            index: 0,
            name: 'Scene1',
            enabled: true,
            templateMode: 'fixed',
            templateId: 'lichtspielOpus',
            variantMode: 'random',
          },
        ],
      },
      arrangement: {
        locators: [
          { index: 0, name: 'Intro', time: 0, enabled: true, templateMode: 'random', variantMode: 'canonical' },
        ],
      },
    },
  ],
];

for (const [file, payload] of examples) {
  const validate = validators[file];
  if (!validate) continue;
  if (validate(payload)) {
    console.log(`✓ example payload validates against ${file}`);
  } else {
    failures++;
    console.error(`✗ example payload failed ${file}:`, ajv.errorsText(validate.errors));
  }
}

if (failures > 0) {
  console.error(`\n${failures} schema check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${schemaFiles.length} schemas + ${examples.length} examples OK`);
