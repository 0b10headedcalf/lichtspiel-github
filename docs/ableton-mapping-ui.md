# Ableton mapping UI (Phase 5b)

Pre-plan a show: **snapshot** a Live set's named Session scenes + Arrangement
locators, **assign** each one a p5 animation (a fixed template or "random") and a
variant policy (canonical or random), **save** the plan, then **perform** — real
(or simulated) Ableton events drive the planned visual while the monome stays live
and the on-screen lock still wins.

> *Open a set → snapshot its form → assign visuals per section → play.*

This is the product layer on top of Phase 5a's basic auto-retrieval. The
low-latency trigger path (feeder/Remote-Script work) and ML are **separate, later**
tracks — see `docs/ableton-integration.md`.

## The model: snapshot → map → perform

- **Snapshot** reads the set's **named-only** scenes + locators into an in-memory
  table — via the `Refresh` button, **or automatically when a different set loads**
  (see *Set-awareness* below). Runtime then reduces to: detect event → look up the
  row → activate. (Matches the research dossiers: structure-refresh is occasional,
  trigger detection is continuous + minimal.)
- **Map**: each scene/locator becomes an editable row.
- **Perform**: a `scene.launched` / `locator.crossed` event (from the M4L device or
  the feeder, or a `▶` preview) resolves against the table.

### Template (parent) → Variant (child)

Each row picks a **Template** and a **Variant policy**:

| Template | Variant | Result on trigger |
|----------|---------|-------------------|
| `random` | `random` | a fresh random template + a fresh random variant (max surprise) |
| `random` | `canonical` | a random template at its signature look |
| *fixed* (e.g. `lichtspielOpus`) | `random` | that template, re-rolled variant each time |
| *fixed* | `canonical` | that template's signature look (deterministic) |

> **Naming note.** "Template" here = the *animation* a row loads (lichtspielOpus,
> gridWorld, …). The research dossiers call this an "idiom"; in this codebase
> **idiom** already means the **monome control layer** (faderBank, stepSequencer),
> so the schema/UI use **`templateMode` / `templateId`** to avoid the collision.

## The panel

Top-right, collapsible, **toggle `a`** (collapsed by default so it never covers the
canvas). Header shows `src` (live/simulated) · `fallback` (mapped/random) · lock ·
current preset (`▸ name 🟢/🔴`) · set name. Controls: `Refresh` · `Save` · `Save As`
· `Load ▾` · `Rename` · `Delete`. Two tables — **Arrangement locators** and
**Session scenes** — each row:

```
enabled ☑ | name | time/idx | Template ▾ | Variant ▾ | ▶ preview | last-triggered
```

- `▶ preview` fires that row's event **locally** (works in any source), so you can
  rehearse a section's visual without Ableton.
- The `last` cell flashes the activated template (or `🔒 locked` / `— off` when
  suppressed) and the row highlights.

## Set-awareness + presets

A set is identified by a **structural fingerprint** — `signatureOf()` hashes its
scene + locator **names/times** (`packages/schemas/src/abletonMapping.ts`). The
bridge stamps every snapshot with this `signature`; a saved mapping remembers the
`setSignature` it was built for.

- **Auto-snapshot on set change.** The feeder computes the fingerprint on its
  existing 300 ms poll; when it changes (a *different* set opened/closed) it pokes
  the bridge (`ableton.snapshotRequest`) → the bridge re-snapshots + broadcasts →
  p5 **replaces** the rows with fresh all-random defaults. No new polling; the closed
  set's stale rows are discarded, never shown.
- **Replace vs merge** (`mergeSnapshot`): a snapshot whose `signature` differs from
  the current mapping **replaces** the rows (fresh defaults); the **same** signature
  **merges** — name-first match preserves the performer's edits, new rows get
  defaults, vanished rows are kept + flagged `stale`.
- **Presets.** Multiple **named** presets per set: `Save` / `Save As` / `Load ▾` /
  `Rename` / `Delete`. **Save** overwrites the loaded preset in place (same name →
  no duplicate); **Save As** prompts for a new name. Each preset carries its
  `setSignature`; the `Load` list flags each against the **open set** — **🟢 matches**
  (sorted to the top) vs **🔴 a different set** — so it's obvious which presets fit.
  The match is anchored to the live set, so loading a 🔴 preset never relabels or
  reorders the list. **A preset is never auto-loaded** — loading is always explicit.
  Default for any set is **all-random**.

## Resolver rules (`apps/p5-runtime/src/live/abletonRetrieval.ts`)

`resolveActivation(evt, mapping, fallbackMode, registry, lastId)`:

1. Find the row by **name first (case-insensitive), then index**.
2. Row found + **disabled** → *suppressed* (event received, no swap; HUD/row show it).
3. Row found + enabled → resolve **template** (fixed id, or random avoiding a repeat)
   then apply the **variant** policy.
4. **No matching row / no mapping** → fall back to the Phase-5a behavior
   (`pickTemplate(fallbackMode)` + a random variant). So the global `m` toggle
   becomes the **fallback** for un-mapped sections; nothing regresses.
5. **Lock** (`space`) suppresses every auto-swap (the performer wins) — the event is
   surfaced, not applied.

After activating, p5 emits `visual.activated` to the bridge (latency-metric
groundwork; logged for now).

## Persistence

The **bridge owns** the authoritative JSON files
(`config/ableton-mappings/<name>.json`, override `LICHTSPIEL_MAPPINGS_DIR`). The
panel's `Save` / `Load ▾` / `Rename` / `Delete` round-trip through the bridge
(`apps/live-bridge/src/mappingStore.ts`), which **ajv-validates** every mapping on
the way in/out and rejects path-traversal names. `listDetailed()` returns each
preset's `setSignature` so the panel can flag set matches.

Browser-only (no bridge) still works: the panel autosaves the working mapping to
**localStorage** (survives reloads) and `Save`/`Load` use local named slots. When
the bridge connects, those switch to the repo files; localStorage stays a cache.

Snapshot source: the bridge reads the **ableton-mcp Remote Script socket (9877)** —
the same `get_scene_info` the feeder uses — and falls back to the **ADE_Sleuth
fixture** when Ableton is unreachable or `LICHTSPIEL_SNAPSHOT_FIXTURE=1`. The last
snapshot is replayed to a freshly-connected p5 (like `device.attached`).

## Runtime vs authoring (architecture)

- **Runtime** trigger path stays thin + deterministic: event → resolver → activate.
  No MCP, no LLM in the hot path.
- **Authoring/testing** (snapshotting, firing scenes during tests, moving the
  playhead) is where MCP/`ableton_probe.py` belong. The snapshot *read* uses the
  Remote Script socket directly — a deliberate manual action, not the event bus.

## Event contract (`packages/schemas/src/wire.ts`)

| Message | Dir | Purpose |
|---------|-----|---------|
| `scene.launched` / `locator.crossed` | →p5 | the Phase-5a triggers (unchanged) |
| `ableton.snapshotRequest` | p5→ / feeder→ | ask the bridge to snapshot the set (manual Refresh, or the feeder on set change) |
| `ableton.snapshot` | →p5 | named scenes + locators + structural `signature` |
| `mapping.request` `{op:load\|save\|list\|rename\|delete}` | p5→ | persistence ops |
| `mapping.result` | →p5 | op result (mapping / set-aware `presets` / error) |
| `visual.activated` | p5→ | activation ack (metrics groundwork) |

## How to run + verify

```bash
# headless (no Ableton, no browser)
pnpm -r typecheck
pnpm validate:schemas
pnpm smoke:p5                                   # resolver + merge (mapping-smoke) + idioms
pnpm --filter @lichtspiel/live-bridge test:osc
pnpm --filter @lichtspiel/live-bridge test:mapping   # store + snapshot/mapping over WS

# browser (fixture, no Ableton needed)
pnpm dev:p5            # http://localhost:5273 → press `a`, Refresh, edit rows, ▶ preview,
                       # Save/Load/Rename/Delete presets

# live (Ableton drives it) — THREE processes:
pnpm dev:bridge        # set LICHTSPIEL_SNAPSHOT_FIXTURE=1 if Ableton's Remote Script is down
pnpm dev:p5
pnpm dev:feeder        # the trigger path — polls 9877, emits scene.launched/locator.crossed
```

## In-Live (your manual steps)

1. Open the **ADE_Sleuth** set (named scenes Scene1/Scene2; locators
   Intro@0 / buildup@40 / Drop@72 / next@144 / hats back@176 / END@216).
2. For a **real snapshot**: enable the **AbletonMCP** Control Surface (Preferences →
   Link, Tempo & MIDI; In/Out = None) so `get_scene_info` answers on 9877. *(Without
   it, the bridge serves the ADE_Sleuth fixture — fine for the demo.)*
3. Start the **three runtime processes**: `pnpm dev:bridge` · `pnpm dev:p5` ·
   **`pnpm dev:feeder`**. The **feeder is the trigger path** — it polls 9877 and emits the
   scene/locator events; *without it nothing fires* (the M4L device's 2nd outlet is the
   alternative, but its cord is fragile across restarts). Open `:5273`, press `a`, **Refresh**
   → rows populate. Assign templates/variants; **Save** as `ADE_Sleuth`.
4. Trigger from Live — launch Scene1/Scene2, or play across the locators. The feeder converts
   them → the mapped visual loads; the monome stays playable; `space` locks/suppresses.
5. If nothing swaps: confirm `pnpm dev:feeder` is running and the AbletonMCP Control Surface is
   on (status bar "Listening … on port 9877"); then copy back the bridge log + the browser console.
6. **Set-awareness:** with the feeder running, **swap to a different set** (e.g.
   `Super_Colitis_new3_mastered Project_v2` ⇄ ADE_Sleuth). The rows should
   **auto-replace** with the new set's scenes/locators (all-random) — never the closed
   set's data. Curate + `Save` a preset per set; `Load ▾` flags presets matching the
   open set with a `●`.
