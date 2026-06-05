# Ableton → Lichtspiel integration (Phase 5a)

Two triggers in Ableton auto-load a fresh visual in Lichtspiel, instantly
monome-playable (the idiom layer stays live, so the swapped sketch is performable
immediately):

1. **Session scene launch** → load a fresh random variant of a picked template.
2. **Arrangement locator crossing** (playhead) → the same, hot-swapping per song
   section while the arrangement plays.

Both are deliberately *basic* communication — a foundation to iterate on
(name-based retrieval, richer rules, constrained generation come later).

> **▶ Phase 5b builds the mapping UI on this foundation** — snapshot a set's named
> scenes/locators, assign each a **Template** (fixed/random) + **Variant**
> (canonical/random), save/load (bridge-owned JSON), and have events drive the plan
> (the lock still wins). The resolver `resolveActivation()` extends `pickTemplate`;
> un-mapped sections fall back to the Phase-5a behavior described here. Snapshotting
> is a deliberate manual action (not polling), and **MCP stays out of the runtime
> path** (authoring/testing only). Full doc: **`docs/ableton-mapping-ui.md`**.

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

## Trigger path: native M4L vs feeder bypass (architecture — key for future iterations)

Two ways to get Ableton scene/locator events to the bridge; both end at the same wire
messages (`scene.launched` / `locator.crossed`) → p5. Pick per deploy:

**A. Native M4L device** — `max/js/live_api_helpers.js` (the committed runtime path).
The device polls the LOM in Max's `js` and emits OSC on its 2nd outlet. **Self-contained**:
ships in the `.amxd`, only needs the bridge — no external process, no ableton-mcp. BUT
**laggy** on a heavy set (Max's legacy `js` LiveAPI + the per-tick playing-row scan) and
**fragile** (the 2nd-outlet cord drops on an Ableton restart unless saved; ES5/ASCII-only;
autowatch lags). Scene-launch + locator both verified working here (laggy).

**B. Feeder bypass** — `apps/live-bridge/demo-feeder.mjs` (run via `pnpm dev:feeder`). A Node
process polls Ableton via the **ableton-mcp Remote
Script socket (9877)** — `get_scene_info` returns transport + cue points + `back_to_arranger`
+ `playing_scene` in one call — and fires the wire messages to the bridge (7890), mirroring
the M4L's Session/Arrangement gate. **Less laggy** (Node engine + one light read vs Max's
slow per-tick scan) and **robust** (no Max cord/ES5/autowatch fragility; trivial to iterate).
BUT it makes ableton-mcp's Remote Script a **runtime dependency** (the plan treated it as a
testing accelerator only) and adds an external process to launch. (Uses the `playing_scene`
field added to the Remote Script's `get_scene_info` — loads on the next Ableton restart.)

> **Phase 5b — auto-snapshot on set change (set-awareness).** The feeder also computes a cheap
> structural fingerprint (scene + locator names/times) on its existing 300 ms poll; when it
> changes (a *different* set opened/closed) it sends `ableton.snapshotRequest` → the bridge
> re-snapshots + stamps the canonical `signature` + broadcasts `ableton.snapshot` → p5 replaces
> the mapping rows with fresh defaults. **No new polling**, no Remote-Script change — it reuses
> the read the feeder already does. See `docs/ableton-mapping-ui.md` (Set-awareness + presets).
>
> **Part 2 — transport forward (takeover mode).** The feeder also emits a `live.state` message each
> poll, carrying just the transport (`tempo`/`is_playing`/`current_song_time` → `beat`) from the same
> `get_scene_info` read (the rest is the canonical empty `LiveSessionState`). Reuses the existing
> `live.state` wire path (bridge validates + routes; no bridge/schema change) so the p5 **takeover
> clock** can follow Live's BPM with no constant pulse. (The dead M4L `/state` outlet was the only
> other `live.state` source; the feeder makes it flow in the adopted runtime + lights the HUD.)
> See `docs/monome.md` (Takeover mode).

**C. Native event-driven** (the ideal, not built). Rewrite the M4L `js` to use LiveAPI
**observers** (callbacks on change, no polling) → near-instant, self-contained, no
ableton-mcp. Best long-term — keeps A's self-containment without the lag. The planned refinement.

**Decision rule (per the user, 2026-06-03).** For now + iterations, prefer **B (the feeder)**
if it tests less-laggy for *both* modes — fastest + most robust way to keep developing. KEEP
**A** (the device + recipe) and **C** (the observer plan) documented as the **native,
self-contained, ableton-mcp-free** path to return to for a production/installation deploy that
must not depend on ableton-mcp running. Don't delete A — both stay; switch the *active* path
per context.

**Eval (2026-06-03, ADE_Sleuth — feeder is the better working path for both).** The feeder
handles BOTH modes reliably, cleanly separated. **Locators** snappy (~feeder poll, ~300 ms).
**Scene-launch** fires at the **launch-quantization bar boundary** — verified: the playing-row
flip lands on a bar (song_time ~12.0), so the ~1-2 s is **Live's launch quantization, NOT
detection lag** (the visual swaps in sync with the scene's audio; lower the set's global launch
quantization for snappier scene swaps). The M4L's *locator* lag was metro-starvation, which the
feeder avoids; scene timing is quantization-bound either way. -> Adopt the feeder as the working
trigger path; keep A + C for a self-contained deploy.

**Lag — TWO distinct causes (don't conflate):**
1. **Scene-launch latency (~1–2 s) is mostly Live's LAUNCH QUANTIZATION** — Session clips fire on
   the next bar, so the visual correctly swaps *in sync with the audio*. It's a Live transport
   setting (global launch-quantization dropdown → set 1/4 or None for snappier scene swaps), **not
   a code problem.** (Should have been checked first — noted.) Locator crossings have no
   quantization, so they're as snappy as the poll.
2. **The general polling lag IS a code/perf issue** (the M4L's was metro-starvation; the feeder
   cuts it a lot, but ~300 ms poll + `get_scene_info` cost remain). Lower it via a faster poll, a
   lighter `get_scene_info`, or the observer rewrite (C). Still some residual lag — "good for now,"
   target lower.

**Future — per-trigger animation assignment (fixed OR random per locator/scene).** Observed: in
Arrangement, replaying a section reloads the *same* p5 sketch — that's `mapped` mode **by design**
(deterministic template per locator/scene index + a fresh structural variant); `random` mode
(key `m`) picks a different template each time. Planned: a **curatable locator/scene →
{fixed template | random}** table (extends `MAPPED_TABLE` in `apps/p5-runtime/src/live/abletonRetrieval.ts`)
so the performer pins each scene/locator to a chosen animation or "surprise me." Key for future iterations.
