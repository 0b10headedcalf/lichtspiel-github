# MRT2 integration

Grounded in the real MRT2 source at `/Volumes/Mac-Storage/GitHub/magenta-realtime`
(hybrid C++/MLX + the Python `magenta_rt` package). This build is **mock‑first**;
the real path is implemented and documented but not auto‑run by the demo.

## The real control + telemetry surface

`RealtimeRunner` (audio‑thread‑safe, wraps `MLXEngine`):

- **Prompts:** `set_text_prompt(text)`, `set_text_prompts(texts, weights)`,
  `set_blend_weight(i, w)`, `set_blend_weights(w[], n)` — up to `kMaxPrompts = 6`
  slots, reblended live; audio prompts via 768‑dim MusicCoCa embeddings.
- **Params:** `set_temperature`, `set_top_k`, `set_cfg_musiccoca/notes/drums`,
  `set_unmask_width`, `set_seed_rotation`, `set_drumless`.
- **Audio:** `read_audio_stereo(...)` (48 kHz, 1920‑sample / 40 ms / 25 Hz frames).
- **Telemetry:** `EngineMetrics get_metrics()` →
  `{ transformer_ms, total_ms, buffer_available, buffer_capacity, transport_flags,
  dropped_frames }`. `dropped_frames` is the **cumulative underrun** counter.

**There is no `entropy` metric.** MusicCoCa maps text/audio → a 768‑dim style
embedding → 12 RVQ tokens (Python: `embed_batch_text`, `tokenize`).

The Python package mirrors this: `MagentaRT2System` / `MagentaRT2Mlxfn` with
`embed_style()`, `tokenize_style()`, `generate(style, …, frames)`, and mutable
`temperature/top_k/cfg_*`. Model assets resolve under `$MAGENTA_HOME/magenta-rt-v2/`
(default `~/Documents/Magenta`).

## Why a Python sidecar (and not a socket / Max / AUv3)

MRT2 ships **no IPC server** — only a C++ `RealtimeRunner`, an AUv3 plugin, Max/PD/
SC externals (all in‑host messaging), and the `magenta_rt` Python package. The
most practical external integration is a **thin Python sidecar** that imports
`magenta_rt` and speaks newline‑delimited JSON over stdio:

```
control IN  (stdin):  {"cmd":"set_prompts","prompts":[{"text":"...","weight":0.7}]}
                      {"cmd":"set_params","params":{"temperature":1.2,"topK":40}}
                      {"cmd":"reset"}
telemetry OUT (stdout): {"type":"ready","model":"mrt2_base"}
                        {"type":"metrics", ...EngineMetrics fields...}
                        {"type":"transport","bar":..,"beat":..,"bpm":..,"playing":true}
```

**Audio stays in the sidecar** (write to file / CoreAudio / AUv3 bus). Only
control + telemetry cross the boundary — which is exactly the
"no‑audio‑over‑JSON" + "MRT2 not in the bridge's realtime audio path" rule.

The AUv3 / Max routes remain valid for performers who want MRT2 directly in the
DAW; the bridge can target them later through the same `Mrt2Engine` interface.

## How this bridge maps onto it

- `magenta.prompt.update.promptBlend` (text + weight, ≤ 6) → `set_text_prompts`.
- `magenta.params.update` → the atomic setters.
- `magenta.metrics` carries the real fields:
  `transformerMs, totalMs, bufferAvailable, bufferCapacity, bufferOccupancy,
  droppedFrames, underruns, rtf, transportFlags, connected`.
- **`entropy` is optional.** The mock synthesizes it; the real adapter **derives**
  a proxy from buffer starvation + RTF (`deriveEntropy`), so "entropy → visual
  mutation" still works. Replace with a better novelty signal if one is exposed.

Telemetry → visual rules (`SemanticStateEngine.fromMrt2Metrics`):

| Telemetry | Effect |
| --- | --- |
| higher entropy | more visual mutation |
| `underruns > 0` | warning + cap visual chaos |
| `bufferOccupancy` low (< 0.25) | calm visuals + freeze prompt changes |
| `connected = false` | hold last state, degraded mode |

## Adapter

`src/adapters/mrt2Adapter.ts` (`Mrt2Adapter implements Mrt2Engine,
InboundAdapter, OutboundAdapter`) spawns `MRT2_SIDECAR_CMD`, writes control JSON
to stdin, parses telemetry JSON from stdout into `magenta.*` messages. If
`python3` / the sidecar / `magenta_rt` is missing it **degrades gracefully**:
logs a pointer here and emits a `connected:false` metric so the bridge enters
degraded mode (visuals hold from the last state).

`Mrt2Engine`:

```ts
interface Mrt2Engine {
  setTextPrompts(blend: PromptSlot[]): void;
  setParams(params: MagentaParams): void;
  start(): void; stop(): void; reset(): void;
}
```

## Running for real (Apple Silicon)

```bash
# 1. install magenta_rt (see the MRT2 repo; uv-based) and confirm model assets
ls "$HOME/Documents/Magenta/magenta-rt-v2/models"
# 2. run the bridge against the sidecar
ENABLE_MRT2_REAL=true \
MAGENTA_HOME="$HOME/Documents/Magenta" \
MRT2_MODEL=mrt2_small \
MRT2_SIDECAR_CMD="python3 sidecar/mrt2_sidecar.py" \
pnpm start
```

> **Model choice (verified on this machine):** `mrt2_small` runs **real-time**
> via the Python/MLX path (~38 steps/s); `mrt2_base` is ~1.9× too slow that way
> and needs the **native C++ engine** (`RealtimeRunner`) for real-time. Default
> the sidecar to `mrt2_small`; reserve `mrt2_base` for a C++‑hosted runner. For
> Ableton routing, a virtual device like **BlackHole** carries the sidecar's
> audio into Live (audio stays out of the bridge either way).

`sidecar/mrt2_sidecar.py` ships as a runnable stub that emits synthetic telemetry
(imports nothing from `magenta_rt`) so the JSON contract is testable before the
model is installed. Replace the marked sections with real `magenta_rt` calls; see
its docstring and `sidecar/README.md`.

## Still needs Apple‑Silicon testing

- Real `magenta_rt` import + `embed_style` / `generate` wiring in the sidecar.
- Real `EngineMetrics` → telemetry mapping (and a real novelty/entropy signal).
- Audio output routing and end‑to‑end latency under load.
