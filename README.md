# Lichtspiel

**A Live-native audiovisual composition assistant.**
*Working title: `lichtspiel` · future module name: `umwelt` · built for the Ableton Hackathon, Boston, June 2026.*

Lichtspiel reads the musical structure of an Ableton Live Set — clips, scenes,
MIDI/audio content, device macros, transport — and uses it to **retrieve,
shape, and morph p5.js visual scenes**. The performer plays the relationship
between sound and image with a **monome grid + arc**, navigating a semantic
visual space: locking states, mutating parameters, and jumping to "near" or
"far" visual correspondences while continuing to perform in Live.

It is **not** "another VJ plugin." The wedge is *session-aware semantic mapping*
+ *code-native browser visuals* + *monome as the tactile latent-space
instrument* + a path toward *constrained p5 code mutation*. See
[`docs/competitive_positioning.md`](docs/competitive_positioning.md).

---

## Architecture at a glance

```
Ableton Live Set
   │  Live Object Model
   ▼
LichtspielHub.amxd  (Max for Live — the thin Live-native shell)
   │  Node for Max / OSC / WebSocket
   ▼
live-bridge  (Node — WebSocket server, JSON normalization, OSC, monome routing)
   ├──▶ p5-runtime  (browser / jweb — visual rendering, template registry, mutation)
   ├──▶ ml-service  (Python — embeddings, retrieval, MIR descriptors, cache)
   └──▶ monome grid + arc  (serialosc)
```

**Design principle:** Max is the Live-native *shell*, not the brain. Complex
logic lives in Node / Python / p5. The runtime never depends on an LLM or the
internet — agentic tooling is for *build time* only.

## Repo layout

| Path | What it is | Phase |
|---|---|---|
| `apps/p5-runtime/` | Browser p5 visual engine (Vite + TS, instance mode). The heart of the demo. | 1 ✅ |
| `apps/live-bridge/` | Node WebSocket/OSC bridge + CLI fake-state sender. | 2 ✅ |
| `apps/ml-service/` | Python retrieval sidecar (metadata → MIR → embeddings). | 5–7 |
| `max/` | Max for Live device + patches + JS Live API helpers. | 3 |
| `packages/schemas/` | Shared contracts: `LiveSessionState`, `VisualParamVector`, etc. | 0 ✅ |
| `packages/visual-corpus/` | Template manifests/descriptors + Processing→p5 conversion notes. | 1/5 |
| `demo/` | Ableton demo set, clips, capture scripts, hackathon script. | — |
| `docs/` | Concept, architecture, setup, troubleshooting, demo script. | — |

See [`ROADMAP.md`](ROADMAP.md) for the full phased plan and live status.

## Quickstart (browser-only, no Ableton needed)

```bash
nvm use            # Node 22
pnpm install
pnpm dev:p5        # opens the p5 runtime; shows the minimalPulse scene
```

Then drive it from the keyboard (no hardware required):

- `1`–`5` — select visual template
- `←/→` — semantic distance · `↑/↓` — mutation amount
- `space` — lock/unlock · `r` — randomize safe params · `d` — toggle debug panel
- `g` — toggle the on-screen monome emulator (with a Grid 64/128 + Arc 2/4 switcher)

The app **detects which monome is connected and adapts** — grid columns are
param faders (the `Lichtspiel_v3` idiom), and the surface scales to Grid 64/128
+ Arc 2/4. See [`docs/monome.md`](docs/monome.md).

Run the full local stack:

```bash
pnpm dev:bridge    # Node WebSocket bridge on :7890 (+ status on :7891)
pnpm dev:p5        # p5 runtime connects to the bridge automatically
pnpm send scene gridWorld      # CLI: change scene over the bridge
pnpm send state --tempo 140 --clip "dense perc loop"   # CLI: fake Live state
# then open Ableton Live and load max/devices/LichtspielHub.amxd
```

## Relationship to Windchime / Live Muse

Lichtspiel is a **standalone** project. It **references and adapts** selected
visual/control concepts from the Windchime / Live Muse animation work
(`/Users/trent/windchime-animation`) — the p5 instance-mode host loop, the
serialosc monome bridge shape, the LED/event wire protocol, the deterministic
RNG, and several Processing→p5 sketch ports — but it **does not fork or depend
on** any Windchime repo. Everything here is fresh, Lichtspiel-native code.
Provenance for each adapted concept is recorded in
[`packages/visual-corpus/source-processing/README.md`](packages/visual-corpus/source-processing/README.md)
and in per-file headers.

## Status

Bootstrapped 2026-05-30. Phases 0–2 in progress; see [`ROADMAP.md`](ROADMAP.md).

Private repo: `https://codeberg.org/Grashopr88/lichtspiel`.

> `context_docs/` (research PDFs + planning docs) is local-only and gitignored.
