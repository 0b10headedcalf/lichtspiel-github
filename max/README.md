# max/

The Max for Live layer — the **thin Live-native shell** (spec §6.2). Max owns
Live API access, the device UI, and transport-aware state; it forwards a
normalized `LiveSessionState` to the Node `live-bridge` and applies
visual/param messages back. No retrieval or rendering logic lives here.

- `devices/` — `.amxd` devices (built in the Max GUI; Phase 3).
- `patches/` — `.maxpat` patches (Live API probe, Node bridge, monome).
- `js/` — Live API + formatter JS for the `v8`/`js` object (ready to drop in).
- `docs/max_patch_notes.md` — the build recipe + acceptance criteria.

> Building `.amxd`/`.maxpat` requires the Max GUI — a human-in-the-loop step.
> The JS helpers here are correct skeletons; wire + test them in Max per the
> patch notes.
