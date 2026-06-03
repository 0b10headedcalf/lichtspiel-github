# Ableton → Lichtspiel integration (Phase 5a)

Two triggers in Ableton auto-load a fresh visual in Lichtspiel, instantly
monome-playable (the idiom layer stays live, so the swapped sketch is performable
immediately):

1. **Session scene launch** → load a fresh random variant of a picked template.
2. **Arrangement locator crossing** (playhead) → the same, hot-swapping per song
   section while the arrangement plays.

Both are deliberately *basic* communication — a foundation to iterate on
(name-based retrieval, richer rules, constrained generation come later).

## Signal path

```
Ableton Live ──(M4L LichtspielHub, outlet 1)──▶ /lichtspiel OSC :7400
   └─ scene launch  → /lichtspiel/scene/launch <index> <name>
   └─ locator cross → /lichtspiel/locator      <index> <name>
        │
   live-bridge (oscRouter → wire scene.launched / locator.crossed → WS → p5)
        │
   p5-runtime: pickTemplate(evt, mode) → variants.newVariant(template)
              (respects the on-screen lock; HUD shows event → chosen visual)
```

### M4L device — `max/js/live_api_helpers.js`

The existing `LichtspielHub` device is **extended**, not replaced. A **2nd `js`
outlet** carries full OSC addresses straight into the existing
`[udpsend 127.0.0.1 7400]` (no `[prepend]`). The verified `/state` path on outlet
0 is untouched. Assembly recipe: `max/docs/max_patch_notes.md` → **Test D** (one
outlet + one cord; human-in-the-loop).

- **Locator crossing**: reads `live_set cue_points` (time + name, refreshed every
  ~2 s) and fires when `current_song_time` crosses a cue. Forward-motion only — a
  rewind or a big jump (a seek, incl. the playhead jump a Session scene launch can
  cause) re-anchors without firing (`SEEK_GUARD_BEATS`).
- **Scene launch**: the LOM has no "playing scene" property and `is_triggered` is
  too brief to poll, so the signal is the **playing Session row** — the row of the
  first track with a playing clip (`track.playing_slot_index`; in a launched scene
  every track shares that row). Fires on change; clears on stop so the same scene
  re-fires next launch.
- **Session vs Arrangement** (mutually exclusive — Live's "Back to Arrangement"):
  the detector reads `back_to_arranger`. While Session clips override (=1) scene
  launches fire and locators are **suppressed**; in Arrangement (=0) locators fire
  and the playing-row scan is skipped. So a drifting arrangement playhead under a
  launched scene never triggers spurious locators.

### Bridge — `apps/live-bridge`

`oscRouter.ts` decodes the two addresses into `scene.launched` /
`locator.crossed` wire messages (`packages/schemas/src/wire.ts`); the name is
re-joined from all trailing args so a spaced locator like "hats back" survives.
`websocketServer.ts` broadcasts them to p5. `osc-selftest.ts` asserts both.
Headless senders:

```
pnpm --filter @lichtspiel/live-bridge cli scene.launch 1 Scene2
pnpm --filter @lichtspiel/live-bridge cli locator 2 Drop
```

### p5 runtime — `apps/p5-runtime`

`src/live/abletonRetrieval.ts` — pure `pickTemplate(evt, mode, registry, lastId)`:

- **`mapped`** — a curatable `MAPPED_TABLE` (name- or index-keyed → template id);
  empty by default ⇒ index-based fallback `registry.at(i % size)`. Curate e.g.
  `{ drop: 'lichtspielOpus' }`.
- **`random`** — a random template, avoiding an immediate repeat.

`main.ts` `respond()` calls `variants.newVariant(t)` and **respects the on-screen
lock** (an auto-swap never overrides a locked performer). Two on-screen toggles +
simulate keys:

| Key | Action |
|-----|--------|
| `m` | retrieval mode `mapped` ⇄ `random` |
| `e` | event source `live` (real OSC) ⇄ `simulated` (UI-fired) |
| `k` | (simulated source) fire a synthetic scene launch |
| `l` | (simulated source) fire a synthetic locator crossing |

The HUD shows `Ableton: <mode> · <source> · <last event> → <visual>`.

## ableton-mcp (testing accelerator — NOT a runtime dependency)

[`ahujasid/ableton-mcp`](https://github.com/ahujasid/ableton-mcp) lets the agent
drive + introspect Live (fire scenes, move the playhead) to exercise the full loop
without manual clicking. It is **complementary** to the M4L device: its own TCP
socket on **9877**, separate from our `/lichtspiel` OSC (7400) and the bridge
(7890). It is a build/test tool only — the runtime never depends on it.

**Install (done by the agent):**
- Repo cloned to `~/ableton-mcp` and **extended** beyond the stock build (the
  stock build can't fire a whole scene or move the playhead):
  - `fire_scene(scene_index)` — `Scene.fire()` (the scene-launch trigger).
  - `set_song_position(time)` — set `current_song_time` (for locator tests).
  - `back_to_arrangement()` — set `back_to_arranger = 0` (clear the Session override;
    needed to reach Arrangement mode in a test without clicking the button by hand).
  - `get_scene_info()` — read scenes + cue points + transport incl. `back_to_arranger`
    (LOM introspection).
  - (Both the Remote Script `__init__.py` and `MCP_Server/server.py` are extended.
    Editing the Remote Script needs a **full Ableton restart** to take effect — a
    Control-Surface toggle does not re-read the file.)
- Remote Script installed to
  `~/Music/Ableton/User Library/Remote Scripts/AbletonMCP/__init__.py` (Ableton's
  official third-party location; the folder name is the Control Surface entry).
- MCP server: isolated venv at `~/ableton-mcp/.venv` (editable install);
  registered with the Claude client via `claude mcp add ableton` (user scope).

**Two manual steps (user):**
1. Live → Settings/Preferences → **Link, Tempo & MIDI** → a free **Control
   Surface** dropdown → **AbletonMCP**, Input/Output → **None**. (Status bar:
   "AbletonMCP: Listening for commands on port 9877".)
2. Reconnect the Claude client (`/mcp`, or restart Claude Code) to load the
   `ableton` MCP tools into a session.

**Driving Live without the MCP reconnect** — `~/ableton-mcp/probe.py` talks to the
Remote Script socket directly from the shell (same JSON protocol):

```
python3 ~/ableton-mcp/probe.py get_scene_info
python3 ~/ableton-mcp/probe.py fire_scene '{"scene_index": 0}'
python3 ~/ableton-mcp/probe.py set_song_position '{"time": 38}'
python3 ~/ableton-mcp/probe.py start_playback
python3 ~/ableton-mcp/probe.py stop_playback
```

## Verifying the loop

- **Headless (no Ableton):** bridge `test:osc`; `pnpm send scene.launch|locator`
  → the p5 preview swaps template + variant; or flip event source to `simulated`
  (`e`) and press `k`/`l`.
- **In-Live:** assemble the M4L outlet/cord (Test D), then launch Scene1/Scene2
  and play the arrangement across the locators (or drive them via ableton-mcp /
  `probe.py`) → Lichtspiel hot-swaps each section; the monome stays performable.

## Known issues & refinement TODO (Phase 5a — revisit)

The loop is **functional and reliable** — every scene launch + locator crossing
fires, Session/Arrangement modes are cleanly separated (no stray locators), and the
p5 visual hot-swaps (verified in-Live). But on a **large/heavy Live set the
detection lags ~1–2 s** and can make Live itself feel laggy. Notes for the next pass:

- **Root cause — slow polling.** `live_api_helpers.js` polls the LOM on a 250 ms
  metro. On a 24-track set `LiveAPI.get` is slow enough that the per-tick work
  (transport reads + the playing-row scan) overruns the metro, so detection drifts
  late. The js is already lean (cached `live_set`, early-exit scan, throttled
  `readState` at `STATE_TICKS`, scan at `SCENE_SCAN_TICKS`, `current_song_time` read
  only in Arrangement mode), which helps but doesn't fully solve it.
- **The proper fix — event-driven observers.** Replace polling with `LiveAPI`
  observers (callbacks on `playing_slot_index` / transport change) so detection is
  near-instant with no per-tick scanning. This is the planned next step.
- **Editing the M4L js needs a clean device reload.** Max `autowatch` lags badly on
  a loaded/laggy set (the heavy js starves Max's scheduler, which also starves
  autowatch), so edits land a version or two late. After changing the js, fully
  reload the device (reopen the set, or remove + re-add it) — don't trust autowatch.
  The script is colocated next to the device at `…/Max Audio Effect/live_api_helpers.js`
  and kept in sync with `max/js/` + `max/patches/`.
- **Max `js` is ES5 + ASCII only.** No `const`/`let`/arrow/template-literals and no
  non-ASCII even in comments — the legacy engine fails to compile otherwise, and
  `node --check` won't catch it.
- **"No communication after an Ableton restart" (seen once).** After quitting +
  relaunching Live, the device→bridge→p5 path went silent (bridge + p5 were still
  up). To check on return: the device `js` loaded its script (colocated copy), the
  metro is running, the device is enabled, and `pnpm dev:bridge` + `pnpm dev:p5` are
  running; a clean device reload usually restores it.
- **Scene detection assumes "clean" scenes** (every track in a launched scene shares
  one row — true for ADE_Sleuth). For sets where a scene spans multiple rows, switch
  `detectScene` back to a dominant-row tally.
