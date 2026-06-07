# INSPECTION_NOTES

Read‑only inspection of the integration targets on this machine (macOS 26.5.1,
Apple Silicon arm64; Node 24, pnpm 11). **Neither repo was modified.** This
records what was inspected, the load‑bearing symbols, the assumptions baked into
the adapters, and open questions.

## Targets located

| Target | Path | Notes |
| --- | --- | --- |
| Lichtspiel | `/Users/zacharyscheffler/Desktop/Hackathon/lichtspiel` | live integration target; `lichtspiel-run/` is a near‑duplicate mirror — ignore it |
| MRT2 source | `/Volumes/Mac-Storage/GitHub/magenta-realtime` | hybrid C++/MLX + Python `magenta_rt` |
| MRT2 weights | `~/Documents/Magenta/magenta-rt-v2/` | `MAGENTA_HOME` root; `models/mrt2_{base,small}.mlxfn`, MusicCoCa + Spectrostream resources |
| Ableton Extensions SDK | `/Users/zacharyscheffler/Desktop/Hackathon/extensions-sdk-1.0.0-beta.0` | TS SDK; `LichtspielEffect.maxpat` + a scaffolded `my-extension/` also present |

## Lichtspiel — files inspected

- `packages/schemas/src/wire.ts` — **`WireMessage` is a minimal envelope**
  `{ v: 1; ts: number; type: string; payload }`, `PROTOCOL_VERSION = 1`.
  `WireRole = 'p5' | 'max' | 'cli' | 'bridge'`. `HelloPayload =
  { protocolVersion, role }`. `SceneLaunchedPayload = { index, name }`.
  `isWireMessage` only checks `v === 1 && typeof ts === 'number' && typeof type
  === 'string'` (intentionally lax). Helper `wire(type, payload, now=Date.now())`.
- `packages/schemas/src/visualParams.ts` — `VisualParamVector = { sceneId } +`
  15 numeric `0..1` keys in this order: `density, motion, turbulence, symmetry,
  strobe, cameraDepth, rotationX, rotationY, rotationZ, palette, contrast,
  lineWeight, feedback, mutationAmount, semanticDistance` (`NUMERIC_PARAM_KEYS`).
  `sceneId` names a **p5 template** (default `'minimalPulse'`), not the Ableton
  scene. `clamp01` does NaN→0.
- `apps/live-bridge/src/websocketServer.ts` — `ws` server, plain JSON per frame.
  On `hello` it sets the client role and **replies with a `status` message**
  (our "connected" signal). `params.update` / `scene.launched` are logged and
  broadcast to `p5` **without** payload validation (only `live.state`,
  `monome.event`, `mutation.request` are ajv‑validated).
- `packages/schemas/src/{monome,liveSession,retrieval,abletonMapping}.ts` —
  `MonomeEvent = grid.key | arc.delta | arc.key`; `LiveSessionState.performance`
  carries `{ sceneLocked, manualOverride, semanticDistance, mutationAmount }`.
- `docs/ableton-integration.md`, `max/js/live_api_helpers.js`,
  `apps/live-bridge/src/oscRouter.ts` — realtime sensing is the **Max device**
  (`metro 250` → `js live_api_helpers.js`) emitting OSC `/lichtspiel/state`,
  `/lichtspiel/scene/launch`, `/lichtspiel/locator` to **UDP :7400**, which the
  live‑bridge converts to WireMessages on **WS :7890**.
- Tooling: pnpm workspaces, Node ≥ 22 (`.nvmrc`), TS 5.6, `ws` 8.18, `tsx`.
  `@lichtspiel/schemas` is **`private: true`, plain‑TS (no Zod), workspace‑only**.

### Integration assumptions (Lichtspiel)
- We **cannot import** `@lichtspiel/schemas` (private/workspace) → we re‑declare a
  compatible subset in `src/schemas/lichtspiel.ts` (keeps us standalone/portable).
- Our mock server replicates the lax guard byte‑for‑byte so the **same client**
  talks to the mock and the real bridge unchanged.
- We connect as role **`bridge`** and send only `params.update` (down‑converted
  from our `lichtspiel.visual.update`). We never put our rich envelope on the
  Lichtspiel socket.
- Port reconciliation: the spec's placeholder `8765` is used for our **demo mock
  server**; the **real** bridge default is **`7890`** (`LICHTSPIEL_WS_URL`).

## MRT2 — files inspected (`/Volumes/Mac-Storage/GitHub/magenta-realtime`)

- `core/include/magentart/realtime_runner.h` — `RealtimeRunner` (audio‑thread
  safe) wraps `MLXEngine`. Prompt control: `set_text_prompt`,
  `set_text_prompts(texts, weights)`, `set_blend_weight(i,w)`,
  `set_blend_weights(w[],n)`; `kMaxPrompts = 6`; PCA coeffs `set_pca_coeff`.
  Params: `set_temperature`, `set_top_k`, `set_cfg_musiccoca/notes/drums`,
  `set_unmask_width`, `set_seed_rotation`, `set_drumless`. Audio:
  `read_audio_stereo(...)`. Telemetry: **`EngineMetrics get_metrics()`**.
- `EngineMetrics` (≈ lines 63–70) = `{ transformer_ms, total_ms,
  buffer_available, buffer_capacity (8192), transport_flags, dropped_frames }`.
  `dropped_frames` is the **cumulative underrun** counter. **There is no
  `entropy` metric.**
- `core/include/magentart/mlx_engine.h` — `generate_frame(...)`,
  `reblend_musiccoca_tokens(...)`, status getters; 48 kHz, 1920‑sample frames,
  25 Hz, stereo; `kMusicCoCaEmbeddingDim = 768`, RVQ depth 12.
- `magenta_rt/__init__.py`, `magenta_rt/musiccoca.py`, `magenta_rt/paths.py` —
  Python package: `MagentaRT2Mlx` / `MagentaRT2Mlxfn` / `MagentaRT2System`
  with `embed_style()`, `tokenize_style()`, `generate(style, ..., frames)`, and
  mutable `temperature/top_k/cfg_*`. MusicCoCa: text/audio → 768‑dim style
  embedding → 12 RVQ tokens (`embed_batch_text`, `tokenize`). Paths resolve under
  `MAGENTA_HOME/magenta-rt-v2/` (default `~/Documents/Magenta`).
- `examples/{hello_mrt2, mrt2/auv3, mrt2/standalone, max, pd, sc}` — integration
  surfaces. The Max/PD/SC externals and the AUv3 use **in‑host messaging** (Max
  messages `prompt <N> "<text>" <weight>`, `temperature`, `cfg*`, …; AU param
  tree). **There is no built‑in network/IPC server** (only a dev‑server socket
  probe on `:62420` in the standalone for its React UI). Build: CMake (C++/MLX,
  macOS) + `uv`/flit (Python).

### Integration assumptions (MRT2)
- Since there's no IPC server, the realistic external path is a **Python sidecar**
  wrapping `magenta_rt`, exchanging **control + telemetry JSON over stdio**, with
  **audio staying in the sidecar**. This satisfies "no audio over JSON" and "MRT2
  not in the bridge's realtime audio path." Implemented in `src/adapters/mrt2Adapter.ts`
  + `sidecar/mrt2_sidecar.py`.
- Our `magenta.metrics` carries the **real** `EngineMetrics` fields
  (`transformerMs`, `totalMs`, `bufferAvailable/Capacity`, `bufferOccupancy`,
  `droppedFrames`, `underruns`, `rtf`, `transportFlags`). `entropy` is **optional**
  — synthesized by the mock and **derived** by the real adapter (from buffer
  starvation + RTF), because the engine emits none. The spec's "entropy → visual
  mutation" rule still holds via this proxy.
- Prompt control maps cleanly: our `promptBlend` (text+weight, ≤ 6 slots) →
  `set_text_prompts(texts, weights)`; params → the atomic setters.
- `MAGENTA_HOME` is the **real** env var; we use it (default `~/Documents/Magenta`).

## Ableton Extensions SDK — inspected

- TypeScript SDK exposing the Live Object Model (Song, Scene, Track, Clip,
  ClipSlot, Device, CuePoint) + command/UI registration. Extensions are
  **reactive LOM readers** — **no `fetch`/WebSocket/outbound network**. (There's
  no "playing scene" LOM property — Lichtspiel's Max device polls
  `playing_slot_index`.)

### Integration assumptions (Ableton)
- SDK role = **authoring / Live‑intelligence layer**: an extension reads scenes /
  clips / locators / colors and **exports a static set‑metadata JSON** (the
  prompt‑map shape) that the bridge ingests. It is **not** a realtime path and
  **not** in the audio path.
- Realtime scene/locator triggers come from the **Max device → OSC :7400 →
  live‑bridge**. Our `abletonSdkAdapter.ts` is a documented stub with a
  `launchFromMetadata()` entry point; `abletonMockAdapter.ts` simulates the
  realtime trigger path for the demo.

## Unresolved questions / follow‑ups

1. **MRT2 entropy.** No first‑class entropy metric exists. Is a better novelty
   signal available (token distribution, CFG, reblend rate)? Current proxy =
   `f(buffer starvation, RTF)`; revisit against the real runner.
2. **MRT2 transport.** `transport_flags` encodes DAW transport state; the exact
   bar/beat mapping for quantization from the real host is TBD (the demo uses the
   Ableton mock as the canonical transport).
3. **Sidecar audio routing.** Where does sidecar audio go in production (file /
   CoreAudio / AUv3 bus)? Out of scope here; documented in `sidecar/README.md`.
4. **Lichtspiel `sceneId` ↔ cluster.** We map visual‑cluster names →
   template ids via a small LUT (`patternGridWorld`, `lichtspielOpus`,
   `minimalPulse`). Confirm the intended template set with the Lichtspiel corpus.
5. **monome.event → semantic mapping.** Arc enc0 → exploration, enc1 → blend
   interpolation, grid → position target. Confirm against the desired
   performance idiom (`lichtspiel/docs/idioms.md`).
