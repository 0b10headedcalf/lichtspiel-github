# lichtspiel-mrt2-bridge

A portable, isolated integration layer that lets **Lichtspiel** (p5 visuals) and
**Magenta RealTime 2 / MRT2** (generative audio) behave like one coherent
audiovisual instrument during an **Ableton Live** performance.

The core idea is **shared semantic state drives BOTH audio generation and
visuals** — not "audio amplitude drives visuals." One normalized state
(`semanticPosition`, `energy`, `density`, `mutation`, `exploration`, a prompt
blend, a 16‑float visual vector) is coordinated across Ableton scenes, MRT2
prompts + telemetry, Lichtspiel visuals, and monome gestures — with a safety
layer that rate‑limits, smooths, quantizes, bounds modulation, and prevents
feedback loops.

> Status: **prototype vertical slice.** It runs fully mocked on any machine and
> is wired to talk to the real Lichtspiel bridge and (via a Python sidecar) the
> real MRT2 on Apple Silicon.

## What it does

- A single **semantic state engine** + **prompt mapper** translating scenes,
  gestures, and telemetry into coordinated audio + visual control.
- A **safety controller** (rate limit, deadband, smoothing, bar‑quantization,
  bounded visual→audio mod depth, scene lock, manual override, stale‑message
  rejection, causal‑loop prevention, deterministic fallback).
- Adapters for **Lichtspiel** (real WS client + a byte‑compatible mock server),
  **MRT2** (mock + a real Python‑sidecar adapter), **Ableton** (mock + an SDK
  metadata stub), and **monome** (mock + real events via Lichtspiel).
- A **one‑command mock demo** of the full vertical slice with a readable trace.

## What it does NOT do yet

- No AUv3 plugin, no Max external, no MRT2 compilation — those stay in their own
  repos. This bridge never compiles or embeds them.
- No real audio crosses the bridge. Audio stays in MRT2 (sidecar / AUv3 / Max);
  only **control + telemetry** JSON crosses (see `docs/architecture.md`).
- The real MRT2 path is provided and documented but not auto‑run by the demo.
- The Ableton **Extensions SDK** adapter is a documented stub (the SDK has no
  outbound network; it is the authoring/metadata layer — see
  `docs/ableton-sdk-integration.md`).

## Install

Requires **Node ≥ 20** (developed on Node 24, Apple Silicon). No global installs.

```bash
# pnpm (recommended — matches the Lichtspiel ecosystem)
pnpm install
pnpm demo

# or npm (fully supported)
npm install
npm run demo
```

The app runs with **no `.env` file** — every value has a safe default. Copy
`.env.example` to `.env` only to override.

## Mock demo

`pnpm demo` (or `npm run demo`) starts a bundled mock Lichtspiel WS server, the
real Lichtspiel client (pointed at the mock — proving the Mode‑2 wire path), a
mock Ableton, and a mock MRT2, then scripts the slice:

1. launch scene **Desert Ritual**
2. schedule the MRT2 prompt blend for the next bar (quantized)
3. update shared semantic state
4. select + morph the Lichtspiel visual (a `params.update` reaches Lichtspiel)
5. stream MRT2 telemetry (~10s): entropy ↑ → visual mutation ↑; low buffer →
   calm visuals + freeze prompts; an underrun → cap chaos
6. a monome gesture moves the semantic space (over the Lichtspiel wire)
7. MRT2 disconnects → graceful fallback (hold last state, degraded mode)

See `docs/demo-script.md` for the step‑by‑step narration.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm demo` / `npm run demo` | the one‑command vertical slice (mock) |
| `pnpm test` | vitest unit + integration tests |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm start` | run the bridge (Modes 2/3, flag‑driven) |
| `pnpm dev` | run with watch‑reload |
| `pnpm health` | print a health snapshot and exit |
| `pnpm build` | emit JS to `dist/` (optional; the app runs from TS via tsx) |

## Environment variables

All optional; defaults shown. See `.env.example`.

| Var | Default | Purpose |
| --- | --- | --- |
| `BRIDGE_PORT` | `8787` | bridge's own health/telemetry endpoint (reserved) |
| `ENABLE_LICHTSPIEL_CLIENT` | `false` | connect to a real Lichtspiel bridge (Mode 2) |
| `LICHTSPIEL_WS_URL` | `ws://127.0.0.1:7890` | the real Lichtspiel bridge URL |
| `BRIDGE_MOCK_WS_HOST` / `BRIDGE_MOCK_WS_PORT` | `127.0.0.1` / `8765` | bundled mock Lichtspiel server (demo) |
| `ENABLE_MRT2_REAL` | `false` | use the real MRT2 Python sidecar (Mode 3) |
| `ENABLE_MOCK_MRT2` | `true` | use the mock MRT2 |
| `MAGENTA_HOME` | _(unset → `~/Documents/Magenta`)_ | MRT2 model root (real env var) |
| `MRT2_MODEL` | `mrt2_small` | model size; `mrt2_small` is real-time via the Python/MLX sidecar (`mrt2_base` needs the native C++ engine) |
| `MRT2_SIDECAR_CMD` | `python3 sidecar/mrt2_sidecar.py` | how to launch the real sidecar |
| `BRIDGE_BPM` / `BRIDGE_BEATS_PER_BAR` | `120` / `4` | transport clock (bar quantization) |
| `SAFETY_*` | spec defaults | safety controller tuning |
| `LOG_LEVEL` / `LOG_PRETTY` | `info` / `true` | structured logging |
| `SESSION_ID` | `demo-session` | session id stamped on messages |
| `PROMPT_MAP_FILE` | `./src/demo/prompt-map.example.json` | scene → prompt/cluster map |

## Portability

- Self‑contained; no global installs; no admin; no system services.
- Runs with no `.env`. The only absolute path in the repo is in `.env.example`.
- Works for mock development anywhere (the spec's "Windows mock dev" maps to
  "mock dev on any OS"). Real MRT2 inference targets **macOS Apple Silicon**.
- Both `pnpm` and `npm` work; we do **not** pin `packageManager` so neither is
  blocked. `pnpm-workspace.yaml` only allows esbuild's build script (npm ignores
  it). See `docs/install-portability.md`.

### Windows vs macOS Apple Silicon

- **Any OS (mock dev):** `pnpm install && pnpm demo`. No Ableton/MRT2/Max/monome
  needed.
- **macOS Apple Silicon (real MRT2):** install MRT2's `magenta_rt` package, point
  `MAGENTA_HOME` at the model assets, set `ENABLE_MRT2_REAL=true`. See
  `docs/mrt2-integration.md`.

## Connect to the real Lichtspiel later

The Lichtspiel live‑bridge runs on `ws://127.0.0.1:7890`. Start it from the
Lichtspiel repo (`pnpm dev:bridge`), then run this bridge with:

```bash
ENABLE_LICHTSPIEL_CLIENT=true LICHTSPIEL_WS_URL=ws://127.0.0.1:7890 pnpm start
```

This bridge connects as role `bridge`, sends a `hello`, and emits `params.update`
messages in Lichtspiel's exact `{v,ts,type,payload}` format — the same code the
demo exercises against the mock server. See `docs/protocol.md`.

A non-intrusive connectivity check (handshake + adapter connect, **no visual
injection**) is available — run it with the real bridge up:

```bash
pnpm live:check                 # safe against a live session
pnpm live:check -- --send-visual   # also broadcasts ONE neutral params.update (non-live bridges only)
```

## Connect to the real MRT2 later

Run the Python sidecar that wraps `magenta_rt` (`sidecar/mrt2_sidecar.py`) with
`ENABLE_MRT2_REAL=true`. Control + telemetry cross as JSON over stdio; audio
stays in the sidecar. See `docs/mrt2-integration.md` and `sidecar/README.md`.

## Troubleshooting

- **`pnpm demo` says it can't bind 8765** — a process is using the port (maybe a
  real Lichtspiel bridge). Set `BRIDGE_MOCK_WS_PORT` to a free port.
- **`ERR_PNPM_IGNORED_BUILDS` for esbuild** — already handled in
  `pnpm-workspace.yaml` (`allowBuilds: esbuild: true`); re‑run `pnpm install`.
- **MRT2 real adapter logs "unavailable"** — `python3` or the `magenta_rt` env
  isn't installed; the bridge falls back to degraded mode. Use the mock
  (`ENABLE_MRT2_REAL=false`) for development.
- **No colors / pino‑pretty errors** — set `LOG_PRETTY=false` for plain JSON
  logs.

## Layout

```
src/
  index.ts config.ts logging.ts
  schemas/   wire.ts semantic.ts magenta.ts ableton.ts lichtspiel.ts
  core/      semanticState.ts promptMapper.ts safetyController.ts lineageTracker.ts clock.ts stateStore.ts bridge.ts
  adapters/  lichtspielWsClient.ts lichtspielWsServerMock.ts mrt2Adapter.ts mrt2MockAdapter.ts
             abletonMockAdapter.ts abletonSdkAdapter.ts monomeMockAdapter.ts types.ts
  demo/      runVerticalSlice.ts fixtures.ts prompt-map.example.json
  tests/     *.test.ts
sidecar/     mrt2_sidecar.py (real MRT2 path)
docs/        architecture, install-portability, ableton-sdk-integration, mrt2-integration, protocol, demo-script
INSPECTION_NOTES.md
```

The existing **Lichtspiel** and **MRT2** repos are integration targets and are
never modified by this project.
