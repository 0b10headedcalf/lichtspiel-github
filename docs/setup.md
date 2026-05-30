# Setup

## Prerequisites

- **Node 22** (`nvm use` reads `.nvmrc`) + **pnpm 11**.
- **Python 3.10–3.12** for the ML sidecar (later phases). `uv` optional; a plain
  venv works too.
- A **Chromium** browser for the p5 runtime.
- For the full installation: **Ableton Live Suite + Max for Live**, **serialosc**,
  a **monome grid + arc**, and the **monome Max package**. The app detects + adapts
  to either device class — Grid 64 (`m64_0175`) / Arc 2 (`m0000174`) or Grid 128
  (`m29496721`) / Arc 4 (`m0000007`); see `docs/monome.md`. None of this is needed
  for browser-only development (use the on-screen emulator's device switcher).

## Install

```bash
cd /Users/trent/lichtspiel
nvm use
pnpm install
```

> If pnpm warns about ignored `esbuild` build scripts, it's already approved in
> `pnpm-workspace.yaml` (`allowBuilds: esbuild: true`); re-run `pnpm install`.

## Run (browser-only — no Ableton)

```bash
pnpm dev:p5          # Vite dev server (default :5273); opens the p5 runtime
```

Keyboard control (mirrors the monome mappings):

| key | action |
|---|---|
| `1`–`5` | select template · `n`/`p` next/prev |
| `←` `→` | semantic distance · `↑` `↓` mutation amount |
| `[` `]` | density · `-` `=` motion |
| `space` | lock/unlock · `r` randomize safe params · `s` surprise |
| `d` | toggle diagnostics HUD · `g` toggle the monome digital twin (LED feedback + sweeps) |

## Run the full local stack

```bash
pnpm dev:bridge      # Node WebSocket bridge :7890 (+ HTTP status :7891/status)
pnpm dev:p5          # connects to the bridge automatically (pill turns "bridge connected")

# drive it without Ableton:
pnpm send scene gridWorld
pnpm send state --tempo 140 --clip "dense perc loop" --type midi --playing
pnpm send params --density 0.9 --motion 0.7 --palette 0.1
pnpm send retrieval parquetGlitch --reason "dense + fragmented" --density 0.9
```

Then open Ableton Live and load `max/devices/LichtspielHub.amxd` (Phase 3).

With **serialosc + a monome** plugged in, the bridge auto-discovers it (watch
for `monome attached …` in the bridge log) and `/status` shows
`monomeConnected:true`. Grid columns are param faders and the arc encoders morph
params; the grid/arc LEDs **mirror the performance** (fader bars + arc rings).
Press `g` to open the digital twin — its **Auto sweep** / **Fast ∥** /
**Intensity** buttons run the capability sweeps directly on the hardware.

## ML sidecar (later phases)

```bash
cd apps/ml-service
python3 -m venv .venv && source .venv/bin/activate   # or: uv venv && source .venv/bin/activate
python -m lichtspiel_ml.app        # stub HTTP service on :7892 (health + stub retrieve)
```

## Verify

```bash
pnpm -r typecheck
pnpm validate:schemas
pnpm smoke:p5
pnpm --filter @lichtspiel/live-bridge test            # WS hub self-test
pnpm --filter @lichtspiel/live-bridge test:osc        # Max→bridge→p5 OSC path
pnpm --filter @lichtspiel/live-bridge test:serialosc  # monome discovery/routing/LED flush (no hardware)
pnpm --filter @lichtspiel/p5-runtime build
```

## Config

All defaults live in code; `.env` overrides. Copy `.env.example` → `.env` and
set monome serials, ports, and canvas size. The bridge binds to `127.0.0.1`
by default — change `LICHTSPIEL_BIND_HOST` only on a trusted LAN.
