# Max for Live — patch notes (Phase 3)

Building `.amxd` devices and `.maxpat` patches needs the **Max GUI** — these
steps are **human-in-the-loop** (see `AGENTS.md`). This doc is the build recipe;
the JS in `../js/` is ready to drop into a `v8`/`js` object.

## Devices to build

- `devices/LichtspielHub.amxd` — main device (MIDI or audio track). UI sections:
  Status / Source / Visual / Macros / Diagnostics (collapsed). See spec §15.
- `devices/LichtspielMonome.amxd` — monome integration (Phase 4), optional split.

## Patches

- `patches/live_api_probe.maxpat` — minimal Live API observation harness.
- `patches/node_bridge.maxpat` — Node for Max (`node.script`) ⇄ live-bridge.
- `patches/monome_grid_arc.maxpat` — monome via the official Max package (Phase 4).

## Phase 3 build recipe

1. New M4L Audio/MIDI Effect → save as `LichtspielHub.amxd`.
2. Add a `v8` object → `v8 live_api_helpers.js`. It instantiates `LiveAPI`
   observers for transport + selected track/clip and `outlet`s a normalized
   `LiveSessionState` (via `message_formatters.js`).
3. Bridge to Node: either
   - `node.script node_bridge.js` running a tiny ws client to
     `ws://127.0.0.1:7890` (role `max`), forwarding the JSON; **or**
   - `udpsend 127.0.0.1 7400` (OSC) and let the bridge's OSC router decode it
     (Phase 3 of `live-bridge/oscRouter.ts`).
4. Expose Live params (`live.dial`/`live.text`): Enable, Auto Follow Clip,
   Scene Lock, Visual Scene, Mutation Amount, Semantic Distance, Density,
   Motion, Color, Camera, Reset, Surprise. Map them to `params.update` /
   `scene.select` wire messages.
5. Keep the patch **thin**: it observes + formats + forwards. No retrieval, no
   rendering logic in Max.

## Live API observation priority (spec §7.2)

transport (tempo, playing, beat/bar) → selection (track/scene/clip name, color,
type) → playing clip per track → clip content (MIDI summary, audio file path,
loop, warp) → devices/macros → control surfaces (minimal).

## Acceptance (Phase 3)

Changing the selected clip / toggling transport updates the bridge log; device
loads with no missing deps; M4L manual controls move p5 params; device works
with the ML service offline.
