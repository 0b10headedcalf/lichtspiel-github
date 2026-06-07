# Demo script — the minimal vertical slice

Run it:

```bash
pnpm demo      # or: npm run demo
```

No Ableton, MRT2, Max, or monome required. The demo starts a **bundled mock
Lichtspiel WS server** and the **real `LichtspielWsClient`** pointed at it (so the
Mode‑2 wire path is exercised), plus a mock Ableton and a mock MRT2, then scripts
the slice and prints a readable trace. It exits 0.

## What happens, step by step

1. **Boot.** Start the mock Lichtspiel server on `127.0.0.1:8765`; start the
   bridge; the client connects and `hello`s as role `bridge`; the server replies
   `status`.
   - `[demo] Lichtspiel client connected to mock bridge on 127.0.0.1:8765`
2. **Scene launch — "Desert Ritual".** The mock Ableton emits
   `ableton.scene.launched`. The engine maps it (from `prompt-map.example.json`)
   to a prompt blend, visual cluster `sand-metal-organic`, seed position
   `(0.42, 0.67, 0.25)`, mutation `0.35`.
   - `[bridge] Semantic state updated: x=0.42 y=0.67 mutation=0.35`
   - `[lichtspiel] Visual cluster selected: sand-metal-organic`
3. **Prompt scheduled (quantized).** The MRT2 prompt blend is **deferred to the
   next bar** (quantize = `next_bar`).
   - `[bridge] Prompt blend scheduled for next bar (bar 2): ceremonial percussion 70%, dusty ambient electronics 30%`
4. **Visual reaches Lichtspiel.** The `lichtspiel.visual.update` is down‑converted
   to a minimal `params.update` and the mock server confirms receipt — proof the
   wire is byte‑compatible with the real bridge.
   - `[lichtspiel] received params.update: sceneId=patternGridWorld density=0.50 mutationAmount=0.35`
5. **Prompt applied on the downbeat.** When the transport crosses the bar
   boundary, the deferred prompt is released to MRT2.
   - `[bridge] Prompt blend applied at bar 2: ceremonial percussion 70%, dusty ambient electronics 30%`
6. **MRT2 telemetry (~10s).** A scripted timeline streams metrics:
   - steady → `entropy=0.72` bump → visual **mutation rises** (entropy → mutation)
   - `buffer=20%` → `[safety] Buffer low — calming visuals and freezing prompt changes`
   - an `underruns=1` glitch → `[safety] MRT2 underrun — capping visual chaos`
   - `[mrt2] Telemetry: entropy=… buffer=…% underruns=…` lines throughout
7. **monome gesture (over the wire).** The mock server injects an `arc.delta`;
   the client normalizes it to a bounded `semantic.gesture` that moves the
   semantic space.
   - `[monome] Gesture: arc enc0 +0.25`
   - `[bridge] Updated prompt blend and visual vector`
8. **MRT2 disconnect → graceful fallback.** The mock flips `connected=false`.
   - `[mrt2] Disconnected`
   - `[safety] Holding last semantic state; visual fallback active; audio control disabled`
9. **Done.** `[demo] Vertical slice complete. ✔` and the process exits 0.

## What each line proves

- `[bridge] Semantic state updated` — one shared semantic state, clamped/smoothed.
- `[lichtspiel] Visual cluster selected` / `received params.update` — semantic
  state → visuals, down‑converted to Lichtspiel's exact wire format.
- `[bridge] Prompt blend scheduled / applied` — major prompt changes quantize to
  bar boundaries.
- `[mrt2] Telemetry …` + `[safety] …` — telemetry colours the visuals; the safety
  controller reacts (freeze prompts, cap chaos) without touching the audio engine.
- `[monome] Gesture …` — bounded gesture modulation of the shared state.
- `[mrt2] Disconnected` + `[safety] Holding last semantic state …` — deterministic
  degraded mode; the show goes on.

## Tuning the demo

- `BRIDGE_MOCK_WS_PORT` — change if `8765` is taken (e.g. a real Lichtspiel
  bridge is running on `7890`; that won't collide, but another mock might).
- `BRIDGE_BPM` / `BRIDGE_BEATS_PER_BAR` — change how fast bars advance (affects
  when the quantized prompt releases).
- `LOG_PRETTY=false` — plain JSON structured logs (the readable `[tag]` trace is
  separate and always on).

## Verifying against the real Lichtspiel (optional)

Start the real bridge from the Lichtspiel repo (`pnpm dev:bridge`, WS `:7890`),
then run **this** bridge in Mode 2:

```bash
ENABLE_LICHTSPIEL_CLIENT=true LICHTSPIEL_WS_URL=ws://127.0.0.1:7890 pnpm start
```

It connects as role `bridge` and the same `params.update` messages appear in the
real bridge's logs (and broadcast to any connected p5 client). Optionally run
`pnpm dev:p5` in Lichtspiel to see the visuals react.
