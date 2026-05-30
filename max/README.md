# max/

The Max for Live layer — the **thin Live-native shell** (spec §6.2). Max owns
Live API access, the device UI, and transport-aware state; it forwards a
normalized `LiveSessionState` to the Node `live-bridge` (over OSC) and applies
visual/param messages back. No retrieval or rendering logic lives here.

- `js/live_api_helpers.js` — reads the Live Object Model via `LiveAPI`, emits a
  `LiveSessionState` JSON symbol (canonical source).
- `js/message_formatters.js` — pure helpers / reference.
- `patches/lichtspiel_probe.maxpat` — generated probe patch (Live → OSC). Open
  it in Max, or assemble it into a M4L device. The colocated
  `patches/live_api_helpers.js` is a build copy so the patch finds the script.
- `build_patches.py` — regenerates the patches with **MaxPyLang** (run via
  `max/.venv`; see `docs/max_patch_notes.md`).
- `devices/` — `.amxd` devices, saved from the Max GUI.
- `docs/max_patch_notes.md` — **start here**: Test A (OSC, no Ableton) → Test B
  (real Live data as a M4L device) → build-out.

> `.amxd` packaging needs the Max GUI (human-in-the-loop). The probe patch +
> the bridge OSC receiver are done and the Max→bridge→p5 OSC path is verified
> (`pnpm --filter @lichtspiel/live-bridge test:osc`).
