/**
 * Build the two halves of the Lichtspiel desktop app into ./build:
 *
 *   build/renderer/        the p5 runtime, built for file:// (Vite base './')
 *   build/bridge/bridge.cjs  the live-bridge bundled to a single CJS file
 *   build/bridge/*.schema.json  the schemas the bridge readFileSync()s at runtime
 *
 * Run before `electron .` or `electron-builder`.
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url)); // apps/desktop/scripts
const desktop = resolve(here, '..'); //                 apps/desktop
const repo = resolve(desktop, '..', '..'); //           repo root

const p5 = join(repo, 'apps', 'p5-runtime');
const bridgeEntry = join(repo, 'apps', 'live-bridge', 'src', 'index.ts');
const schemasSrc = join(repo, 'packages', 'schemas', 'src');

const buildDir = join(desktop, 'build');
const rendererDir = join(buildDir, 'renderer');
const bridgeDir = join(buildDir, 'bridge');

console.log('[prepare] cleaning build/');
rmSync(buildDir, { recursive: true, force: true });
mkdirSync(rendererDir, { recursive: true });
mkdirSync(bridgeDir, { recursive: true });

console.log('[prepare] building p5 renderer (vite, base ./) …');
execSync('pnpm exec vite build --base=./', { cwd: p5, stdio: 'inherit' });
cpSync(join(p5, 'dist'), rendererDir, { recursive: true });

console.log('[prepare] bundling live-bridge → build/bridge/bridge.cjs …');
await esbuild.build({
  entryPoints: [bridgeEntry],
  outfile: join(bridgeDir, 'bridge.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // ws's optional native speedups — left external; absent at runtime ws uses its
  // JS fallback (the require is wrapped in try/catch inside ws).
  external: ['bufferutil', 'utf-8-validate'],
  // CJS output drops `import.meta.url` (used by the schema loader to find its
  // *.schema.json next to itself). Shim it to this file's own URL so the loader
  // resolves the JSON we copy into build/bridge/ below.
  banner: { js: "const importMetaUrl = require('url').pathToFileURL(__filename).href;" },
  define: { 'import.meta.url': 'importMetaUrl' },
  logLevel: 'info',
});

console.log('[prepare] copying schema JSON next to the bridge bundle …');
for (const f of readdirSync(schemasSrc).filter((f) => f.endsWith('.schema.json'))) {
  cpSync(join(schemasSrc, f), join(bridgeDir, f));
}

console.log('[prepare] done → ' + buildDir);
