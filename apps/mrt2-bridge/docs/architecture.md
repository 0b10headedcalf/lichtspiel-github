# Architecture

## One instrument, one shared state

The bridge's premise: **one normalized semantic state drives both audio and
visuals.** Ableton scenes, monome gestures, and MRT2 telemetry all mutate the
same `SemanticState`; that state is then projected into MRT2 prompts (audio) and
a Lichtspiel visual vector (visuals). This is the opposite of "audio amplitude
drives visuals" — the coupling is at the *semantic* layer, not the signal layer.

```
 Ableton (scene/transport)        monome (gesture)         MRT2 (telemetry)
        │                              │                          │
        ▼                              ▼                          ▼
 ┌───────────────────────────── lichtspiel-mrt2-bridge ──────────────────────────┐
 │  inbound adapters → Bridge orchestrator → SemanticStateEngine (the math)       │
 │                                   │                                            │
 │                                   ▼                                            │
 │                          SafetyController (the gate)                           │
 │              stale · loop · override/lock · rate · deadband ·                   │
 │              smoothing · mod-depth · bar-quantization                          │
 │                                   │                                            │
 │            ┌──────────────────────┴───────────────────────┐                   │
 │            ▼                                               ▼                   │
 │   magenta.prompt.update (audio)                  lichtspiel.visual.update      │
 └────────────┼───────────────────────────────────────────────┼─────────────────┘
              ▼                                                 ▼
   MRT2 (prompts/params; audio stays here)        Lichtspiel bridge (params.update)
```

## Three paths, kept separate

- **Control path (JSON):** scene/gesture/param messages → bridge → MRT2 prompt
  control + Lichtspiel `params.update`. Low rate, safe to serialize.
- **Telemetry path (JSON):** MRT2 `EngineMetrics` → `magenta.metrics` → influences
  visuals (mutation/warnings). Low rate.
- **Audio path (NOT here):** MRT2 renders audio at 48 kHz inside its own process
  (sidecar / AUv3 / Max) and routes it to the audio device. **Audio never enters
  the bridge.**

### Why audio is never sent over a JSON WebSocket

48 kHz stereo float audio is ~384 KB/s per channel before JSON/base64 overhead;
JSON‑encoding it adds latency, GC pressure, and head‑of‑line blocking on the same
socket that carries control. It would also put the bridge in the realtime audio
path, where a GC pause or a slow consumer becomes an audible dropout. So the
bridge exchanges only **control + telemetry**; audio stays in MRT2. This is also
why the real MRT2 integration is a **sidecar** (stdio JSON for control/telemetry,
audio internal) rather than streaming samples to Node.

## Process boundaries

| Process | Owns | Talks to the bridge via |
| --- | --- | --- |
| Ableton + Max for Live | realtime scene/locator sensing | OSC → Lichtspiel live‑bridge → WS (future); mock adapter (now) |
| Ableton Extensions SDK | static set metadata (authoring) | exported JSON ingested by the bridge (stub) |
| MRT2 | audio generation + telemetry | Python sidecar over stdio (control+telemetry JSON) |
| Lichtspiel live‑bridge + p5 | visual rendering | WS `params.update` on `:7890` |
| monome | gestures | real events arrive via Lichtspiel `monome.event`; mock adapter otherwise |

## Where the Ableton SDK fits

The Extensions SDK is the **Live intelligence layer**, not a realtime or audio
path. It reads scenes/clips/locators/colors and exports a **set‑metadata JSON**
(scene → prompt blend → visual cluster) the bridge ingests for mapping. Realtime
triggers still come from the Max device → OSC → live‑bridge. The SDK has no
outbound network, so it cannot push events itself. See
`ableton-sdk-integration.md`.

## Why MRT2 is not embedded in Max for this prototype

MRT2's realtime engine is a C++/MLX `RealtimeRunner` with hard realtime
constraints (lock‑free ring buffer, 25 Hz frames). Embedding it in a Max external
and *also* driving it from the bridge would couple our control plane to the audio
thread and to Max's scheduler. For a portable prototype we keep MRT2 in its own
process and exchange only control + telemetry JSON via a sidecar — the bridge
stays OS‑portable and never blocks audio. The Max/AUv3 paths remain available for
performers who want MRT2 directly in the DAW; the bridge can target them later
through the same `Mrt2Engine` interface.

## Internal components

- **SemanticStateEngine** (`core/semanticState.ts`) — pure math: scene/gesture/
  metrics → clamped `SemanticState` + the 16‑float visual vector. No throttling.
- **PromptMapper** (`core/promptMapper.ts`) — scene→seed, position→blend,
  vector→Lichtspiel `params.update`, cluster→template id.
- **SafetyController** (`core/safetyController.ts`) — the only path from candidate
  to emitted message; enforces the pipeline (see `protocol.md`).
- **LineageTracker** (`core/lineageTracker.ts`) — causal‑loop prevention via
  `causeId`/`parentCauseId` and per‑cause source kinds.
- **Bridge** (`core/bridge.ts`) — wiring hub; enforces the directional DAG:
  `scene/gesture → {audio, visual}`, `metrics → visual only`, bounded terminal
  `visual → audio param`.
- **Clock** (`core/clock.ts`) — injectable; `SystemClock` for runtime, `MockClock`
  for deterministic tests.
- **StateStore** (`core/stateStore.ts`) — current state + scene‑lock / manual‑
  override / degraded flags + pub/sub.

## The directional DAG (loop safety)

```
external (ableton|monome) ──► core ──► audio prompt
                                  └──► visual
metrics  (mrt2)           ──► core ──► visual ONLY        (never an audio prompt)
visual   (lichtspiel)     ──► core ──► audio PARAM (bounded ≤ modDepth, terminal)
```

`LineageTracker.wouldLoop` rejects an audio prompt whose lineage passed through
MRT2 or Lichtspiel, and an audio param whose lineage passed through MRT2, and
breaks on runaway depth. This guarantees a DAG: telemetry can colour the visuals,
the visuals can nudge audio params within a bounded depth, but nothing can spiral.
