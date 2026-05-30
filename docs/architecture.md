# Architecture

## Layers

```
Ableton Live Set
   │  Live Object Model (tracks, clips, devices, transport)
   ▼
LichtspielHub.amxd      ── Max for Live: the thin Live-native shell (Phase 3)
   │  Node for Max / OSC / WebSocket
   ▼
live-bridge (Node)      ── WebSocket hub, JSON validation, logging, OSC + serialosc routing
   ├──▶ p5-runtime       ── browser/jweb: rendering, registry, param smoothing, mutation
   ├──▶ ml-service       ── Python: metadata → MIR → embedding retrieval (Phases 5–7)
   └──▶ monome grid+arc  ── serialosc (or via the Max monome package)
```

**Design principle (locked):** Max is the Live-native *shell*, not the brain.
Live API + device UI in Max; everything stateful/networked/heavy in
Node/Python/p5. The performance runtime never depends on an LLM, MCP, or the
internet.

## Ownership

| Layer | Owns |
|---|---|
| Max for Live | Live API access, device UI, transport-aware state, safety fallback |
| Node bridge | WebSocket server, JSON normalization + validation, file watching, diagnostics, OSC |
| Python | embeddings, retrieval, nearest-neighbor, MIR/MIDI features, caching |
| p5 | rendering, template registry, param interpolation, mutation preview, perf mode |

## Contracts (`packages/schemas`)

The single source of truth. Browser-safe types at the package root; Node-only
schema loaders at `@lichtspiel/schemas/node`.

- **`VisualParamVector`** — 16 normalized (0..1) params + `sceneId`. The control
  surface every template understands.
- **`LiveSessionState`** — the snapshot Max emits about the Live Set (always the
  same shape, even when fields are unknown).
- **`VisualTemplateMeta`** — serializable template metadata (the p5-runtime
  extends it into the full `VisualTemplate` with setup/update/draw).
- **`MonomeEvent`** / **`LedFrame`** — grid/arc input + LED output.
- **`MutationRequest`**, **`VisualRetrievalResult`** — Phase 8 / Phase 5–7.
- **wire protocol** — versioned `{v, ts, type, payload}` messages on the
  bridge ⇄ {p5, max, cli} WebSocket channel.

## p5 runtime internals

- **`SketchHost`** owns the single p5 instance, mounts/swaps templates, smooths
  the param vector toward its target (exponential approach), tracks FPS, and
  dispatches monome events to the active sketch.
- **`VisualTemplate`** = metadata + a `create(MountContext) → VisualSketch`
  factory. The factory split (vs a plain object) gives each mount fresh state.
- Templates create their own canvas in `setup` (p2d or webgl), read the latest
  params in `update`, and render in `draw`. They route randomness through the
  seeded RNG so a seed reproduces a visual.
- **Inputs** (keyboard, on-screen monome emulator, bridge) all funnel through a
  tiny in-browser `Emitter` bus, then into `SketchHost` — so hardware and
  fallback paths are interchangeable.

## Degradation (why the demo stays up)

Every experimental layer reduces to a safe control message (scene id / param
vector / morph target). The p5 runtime runs fully **browser-only**: no Ableton,
no bridge, no ML. If the bridge appears, it auto-connects; if it drops, the
runtime keeps running and reconnects. See `docs/troubleshooting.md`.
