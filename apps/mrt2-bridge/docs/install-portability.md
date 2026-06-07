# Install & portability

Portability is the top priority. The bridge is a self‑contained Node/TypeScript
package that runs on any OS for mock development and targets macOS Apple Silicon
for real MRT2.

## Principles

- **No global installs.** Everything (`tsx`, `vitest`, `tsc`) is a local
  devDependency, invoked through npm/pnpm scripts (both put `node_modules/.bin`
  on `PATH` for scripts).
- **No admin, no system services, no internet at runtime.** The demo binds only
  loopback sockets. No LLM/API calls during a performance.
- **Runs with no `.env`.** `loadConfig()` is pure over its `env` argument and
  applies safe defaults; `dotenv` is best‑effort. The **only** absolute path in
  the repo lives in `.env.example` (`MAGENTA_HOME`).
- **No build step required to run.** `tsx` executes the TypeScript directly
  (`pnpm demo`, `pnpm start`). `pnpm build` exists but is optional.

## npm / pnpm parity

Both work and the demo runs under either:

```bash
pnpm install && pnpm demo
npm  install && npm run demo
```

- We do **not** set `package.json#packageManager` — that would let corepack
  hard‑fail the other manager. The acceptance bar requires both.
- No `workspace:` protocols, only caret ranges.
- `pnpm-workspace.yaml` exists solely to allow esbuild's install script
  (`allowBuilds: esbuild: true`) — pnpm 11 moved that setting out of
  `package.json`. **npm ignores this file.** Without it pnpm prints
  `ERR_PNPM_IGNORED_BUILDS`; with it, esbuild (used by `tsx`/`vitest`) builds
  cleanly.

## Node version

`engines.node = ">=20"` (developed on Node 24). `.nvmrc` pins `22` to match the
Lichtspiel ecosystem. `tsx`, `vitest` 3, `zod` 3, `ws` 8, `pino` 9 all support
20–24.

## ESM + NodeNext

The package is ESM (`"type": "module"`) with `moduleResolution: NodeNext`.
**Relative imports must end in `.js`** even though the source is `.ts` (e.g.
`import { Clock } from './core/clock.js'`). `tsc`, `tsx`, and `vitest` all honor
this. `verbatimModuleSyntax` + `isolatedModules` surface any `import type`
mistakes at typecheck.

## Mock mode (the default)

The demo and `pnpm start` (no flags) run entirely on mocks — no Ableton, MRT2,
Max, or monome. This is the primary development surface and the CI surface.

## Apple Silicon deployment (real MRT2)

1. Install MRT2's `magenta_rt` (its repo uses `uv`); ensure model assets under
   `$MAGENTA_HOME/magenta-rt-v2/`.
2. `ENABLE_MRT2_REAL=true MRT2_SIDECAR_CMD="python3 sidecar/mrt2_sidecar.py" pnpm start`.
3. Control + telemetry cross via stdio JSON; audio stays in the sidecar. See
   `mrt2-integration.md`.

## Not modifying upstream

This project lives in its own sibling directory and never edits the Lichtspiel or
MRT2 repos. The live test against the real Lichtspiel bridge uses
`pnpm install --frozen-lockfile` in that repo so no tracked files change
(`node_modules` is gitignored upstream).

## Packaging / signing risks (future distribution)

- **pino‑pretty** is a real dependency (it loads a worker); a pruned
  `--omit=dev` install must keep it, or set `LOG_PRETTY=false`. A plain‑console
  fallback exists if the transport fails to construct.
- **esbuild native binary** is platform‑specific (`@esbuild/darwin-arm64`); a
  bundled distribution must include the right platform package (or compile with
  `pnpm build` and ship `dist/` + production deps).
- **Code signing / Gatekeeper** only matters if we later ship a packaged macOS
  app or a native MRT2 host; the Node bridge itself needs no signing.

## Future distribution plan

- Short term: run from source via `tsx` (current).
- Medium: `pnpm build` → `dist/` + `node dist/index.js`; pin a lockfile per
  target manager.
- Long term (optional): a small launcher that spawns the bridge + the MRT2
  sidecar + (optionally) the Lichtspiel stack, with health checks before
  performance.
