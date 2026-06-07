# Ableton SDK integration

## Product decision

Two distinct Ableton roles, kept separate:

- **Ableton Extensions SDK = the "Live intelligence" / authoring layer.** It
  reads the Live set's structure (scenes, clips, locators, track names, colors,
  devices) and produces **static set metadata** — which scene maps to which
  prompt blend and visual cluster. It does **not** generate audio and is **not**
  in the realtime path.
- **Max for Live (or the existing Lichtspiel live‑bridge) = realtime performance
  sensing.** The Max device polls the LOM (`metro 250`) and emits OSC
  (`/lichtspiel/state`, `/lichtspiel/scene/launch`, `/lichtspiel/locator`) to
  UDP `:7400`, which the Lichtspiel live‑bridge converts to WireMessages on WS
  `:7890`.

## What the SDK can and cannot do (verified)

The Extensions SDK (`extensions-sdk-1.0.0-beta.0`, a TypeScript SDK) exposes the
Live Object Model: `Song`, `Scene`, `Track`/`MidiTrack`/`AudioTrack`, `Clip`,
`ClipSlot`, `Device`, `CuePoint`, plus command/UI registration. It can read:

- scenes (list + index), clips (names, colors, types, loop points)
- locators (`CuePoint` time + name), track names/colors, device chains
- transport (tempo, `is_playing`), Session vs Arrangement (`back_to_arranger`)

It **cannot**:

- emit realtime events or make outbound network calls (no `fetch`/WebSocket/IPC)
- observe a "currently playing scene" (no such LOM property — the Max device
  infers it from `playing_slot_index`).

So an Extension is a **reactive reader + UI**, not a push source.

## How an Extension feeds this bridge

Because the SDK has no outbound network, the realistic flow is **file‑based
metadata export**:

```
Ableton Extension (reads LOM)
   → user curates scene → {promptBlend, visualCluster, mutation, seed position}
   → exports a set-metadata JSON (the prompt-map shape)
        │
        ▼
lichtspiel-mrt2-bridge ingests it (PROMPT_MAP_FILE / AbletonSdkAdapter.launchFromMetadata)
```

The exported JSON matches `src/demo/prompt-map.example.json`:

```json
{
  "scenes": [
    {
      "id": "scene-001",
      "name": "Desert Ritual",
      "index": 0,
      "promptBlend": [
        { "promptId": "ceremonial-percussion", "text": "ceremonial percussion", "weight": 0.7 },
        { "promptId": "dusty-ambient-electronics", "text": "dusty ambient electronics", "weight": 0.3 }
      ],
      "visualCluster": "sand-metal-organic",
      "semanticPosition": { "x": 0.42, "y": 0.67, "z": 0.25 },
      "mutation": 0.35, "energy": 0.6, "density": 0.5
    }
  ]
}
```

Point `PROMPT_MAP_FILE` at the exported file (or have the extension write to the
default path). Realtime scene launches then arrive via the Max/OSC path and are
matched to this metadata by name/index.

## The adapter

`src/adapters/abletonSdkAdapter.ts` is a **documented stub** implementing the
`InboundAdapter` contract:

- `start()` logs that it's a stub and points here.
- `launchFromMetadata(meta, index)` already turns ingested set metadata into an
  `ableton.scene.launched` message — the seam a future SDK‑driven UI command (or
  a file watcher) would call. It cannot push on its own because the SDK can't.

For the demo and for realtime triggers, use `AbletonMockAdapter` (which simulates
the scene‑launch path) or wire the Max → OSC → live‑bridge path.

## Preflight (future)

A natural SDK use is **preflight**: before a set, an Extension validates that every
Session scene has a prompt‑map entry and a visual cluster, surfacing missing
mappings in the Live UI. The bridge already validates the ingested JSON with Zod
(`PromptMapFileSchema`); the Extension would surface those errors at authoring
time.
