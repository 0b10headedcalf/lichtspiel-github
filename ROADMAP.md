# Lichtspiel — Roadmap

Living plan. Derived from the agentic coding spec; updated as phases land.
Primary target: **Ableton Hackathon, Boston, June 2026.**

**Status legend:** ✅ done · 🟡 in progress · ⬜ not started · 🔭 stretch/backlog

The golden rule: a working vertical slice beats a broad fragile system. Build
in the order below; do not start embeddings until p5 + bridge + Max probe +
monome/keyboard work end-to-end.

---

## Phase 0 — Bootstrap 🟡 (this session)

Create the standalone repo and verify the local environment.

- ✅ Monorepo structure (`apps/`, `packages/`, `max/`, `demo/`, `docs/`).
- ✅ `README.md`, `AGENTS.md`, `ROADMAP.md`, `.env.example`, `.gitignore`.
- ✅ pnpm workspace + `tsconfig.base.json`.
- ✅ `packages/schemas` — shared contracts (+ ajv self-validation).
- ✅ Startup scripts: `pnpm dev:p5`, `pnpm dev:bridge`, `pnpm dev`, ml run cmd.
- ✅ Git init + Codeberg remote + first push.

**Acceptance:** `pnpm install` completes · `pnpm dev:p5` opens the runtime ·
runtime displays `minimalPulse` · no Ableton required.

## Phase 1 — p5 visual runtime ✅ (this session, browser-verified)

A standalone visual engine that runs in the browser with no Ableton.

- ✅ `VisualTemplate` contract + `VisualParamVector` (16 normalized params).
- ✅ Template registry + message bus + parameter interpolation (smoothing).
- ✅ Seeded RNG so visuals are reproducible.
- ✅ Manual scene switching + keyboard fallback (`1`–`5`, arrows, space, `r`).
- ✅ Debug/diagnostics panel (FPS, current template, live param readout).
- ✅ 5 initial templates: `minimalPulse`, `topographicTunnel`, `gridWorld`,
  `parquetGlitch`, `torusField` (adapted from the Processing corpus) — all
  verified rendering at 60fps.
- ✅ On-screen monome emulator panel (mirrors grid/arc events + LED reflect).

**Acceptance:** all templates run in-browser ✓ · params update smoothly ✓ ·
host catches per-frame throws (no crash) ✓ · FPS readout works (60fps) ✓.
Remaining: Playwright screenshot+FPS smoke (currently a structural smoke).

## Phase 2 — Node bridge ✅ (this session, self-test passing)

Message bus between Max and p5.

- ✅ WebSocket server (loopback by default) + p5 client connection.
- ✅ JSON validation against the schemas; invalid messages rejected with
  readable errors (verified: invalid `live.state` is dropped, not forwarded).
- ✅ Message logging + bridge status HTTP route (`/status`).
- ✅ Sample CLI sender (`pnpm send …`) for scene/params/state/retrieval.
- ✅ Reconnect with backoff (p5 client); OSC route stubs for Max (Phase 3/4).

**Acceptance:** CLI changes the p5 scene ✓ · CLI sends a fake `LiveSessionState` ✓ ·
p5 responds ✓ · reconnect works ✓ (bridge self-test green).

## Phase 3 — Max for Live Live API probe ✅ DONE

Read real Live state and feed it to p5 over OSC; let device controls move p5
params. See `max/docs/max_patch_notes.md`.

- ✅ Bridge **OSC receiver** (`oscRouter.ts`, pure-Node dgram + OSC codec):
  `/lichtspiel/state|scene|param` on UDP 7400 → hub → p5. Verified end-to-end
  (`pnpm --filter @lichtspiel/live-bridge test:osc`).
- ✅ `js/live_api_helpers.js` — reads transport + selected track/scene/clip via
  `LiveAPI`, emits a `LiveSessionState` JSON symbol (guarded; degrades to default).
- ✅ Generated probe patch `patches/lichtspiel_probe.maxpat` (`build_patches.py`
  via MaxPyLang): loadbang/metro/`live.thisdevice` → js → prepend → udpsend.
- ✅ Assembled into a M4L device (Max Audio Effect) + **read-path verified in the
  ADE_Sleuth set**: real tempo (123bpm), selected track name, transport (▶)
  stream to the p5 HUD (`rx` climbing). 2026-05-30.
- ✅ **(3a) Device controls → p5 params** — `LichtspielHub` device has 6
  `live.dial`s (Float, range 0.–1.) → `/lichtspiel/param` + 5 scene buttons →
  `/scene`. **Verified by the user**: turning a dial moves the matching p5 param
  in the HUD. Acceptance "manual controls move p5 params" met. 2026-05-30.
- ✅ **(3b) Device UI** — user built the Presentation-view device face by hand
  (Add to Presentation + Open in Presentation; steps in max_patch_notes.md).
  Auto-gen ruled out (maxmsp-mcp rejects live.dial; MaxPyLang emits it as text).
- ✅ **(3c) Playing-clip read** — `live_api_helpers.js` reads the selected
  track's session `playing_slot_index` clip, then the arrangement clip spanning
  the playhead (guarded; arrangement property names best-effort → verify in-set).
- ✅ **(3d) clip color + selected-track device names** (`readClip`/`readDevices`).
  MIDI content summary is Phase 6.

**Acceptance:** changing the selected clip / toggling transport updates the
bridge log ✅ · device loads without missing deps ✅ · M4L manual controls move
p5 params ⬜ (3a) · device works when ML service is offline ✅.

## Phase 4 — Monome integration & device adaptation ✅

Grid/arc control p5, **adapting to whichever device is connected**. The user
owns two device classes — Grid 64 (`m64_0175`) / Arc 2 (`m0000174`) and Grid 128
(`m29496721`) / Arc 4 (`m0000007`) — and the app detects + adapts. The canonical
control idiom is `Lichtspiel_v3` (the idiom master). See `docs/monome.md`.

- ✅ Device profile model + **capability matrix** (`schemas/monomeProfiles.ts`,
  `GridCaps`/`ArcCaps`: cells/quads/varibright/tilt, encoders/push) +
  `profileFromAttached()`.
- ✅ Profile-aware **column-fader** mapping (`monomeMapping.ts`) — the
  `Lichtspiel_v3` idiom generalized to `VisualParamVector`; adapts to grid width
  (grid-128 cols 8–15 → scene buttons) + arc encoder count (arc-4 adds enc2/3).
- ✅ **Digital-twin dashboard** (`ui/monomeTwin.ts`) — combines the windchime
  virtual-monome (LED mirror) + diagnostic7 capability tests: canvas twin
  (varibright cells + level readout + 64-LED rings), test sweeps, capability
  panel, seen-checklist, event log, interactive input, Grid 64/128 + Arc 2/4
  switch. Verified adapting live (8×8↔16×8, 2↔4 rings) + driving params.
- ✅ `device.attached`/`device.detached` routed bridge → bus → active setup → twin.
- ✅ serialosc layer in `live-bridge` (`serialosc.ts`, adapted from windchime-animation
  to pure-Node `dgram` + our `oscCodec`, NO osc-js): discovers devices via
  serialosc (list/notify + `/sys/port|host|prefix|info`), resolves profiles by
  serial, emits `device.attached/detached` + `grid.key`/`arc.delta`/`arc.key`
  (routed to the right device by UDP source port), and flushes `led.*`/`ring.*`
  caps-aware (monobright grid → binarized `grid/led/map` + global intensity;
  varibright → `level/map`; arc → `ring/map`). Robust hot-plug (re-arm notify +
  periodic re-list + dedup). Verified by `test:serialosc` (no hardware needed).
- ✅ Debounce/rate-limit: one ~30 Hz scheduler drains coalesced arc deltas
  (a fast spin sums into one event) and throttles LED flushes — input flooding
  can't freeze the browser/hardware.
- ✅ **Interactive LED feedback** (`ui/monomeFeedback.ts`): in Mirror mode the
  grid columns are **VU fader bars from the live params** (COLUMN_AXES; held
  cell flashes; grid-128 cols 8–15 = scene buttons) and the arc rings show each
  mapped param (ARC_AXES) as a **filled arc + diagnostic7 comet head + every-8th
  ticks + press boost**. The twin canvas and the hardware render from the *same*
  frame (the twin is the single LED authority), so they can't drift. Optional
  `gridIntensity` on the LED frame drives the monobright grid's global dimmer —
  a dedicated **Intensity** test breathes it 0→15→0, and the twin canvas scales
  cell brightness by it so the dimmer reads on the twin too.
- ✅ **Diagnostic sweeps** restored from diagnostic7: `Auto sweep` = sequential
  (binary/varibright/intensity/row/col/map → gradient/brightness/ticks/range/
  pulse/spin) and `Fast ∥` = grid stages ∥ arc stages, both dims-adaptive
  (grid 64/128, arc 2/4) and looping. A template can still drive its own
  `ledOut` (host path intact); the param-driven feedback covers it until one does.

**Acceptance:** grid column-faders move params ✅ · grid press selects scenes ✅ ·
arc encoders morph continuously ✅ · LEDs reflect values ✅ · plugging in grid 64
vs 128 / arc 2 vs 4 adapts the surface ✅ · rapid input never freezes ✅.
**Hardware-verified on the real Grid 64 + Arc 2 (2026-05-31):** live discovery,
input (grid.key/arc.delta/arc.key incl. coalesced deltas), performance feedback
(fader columns + arc comets), and the Fast ∥ sweep all confirmed end-to-end.

## Phase 4.5 — Animation corpus + monome idiom layer ✅ (hardware-verified, both hot-swap directions)

Bring the windchime-animation p5 sketch corpus into Lichtspiel as capability-aware,
hardware-adaptive templates with a reusable monome "idiom" abstraction + variant
system. Full plan: `~/.claude/plans/delegated-foraging-cookie.md` (approved).
Decisions: adapt windchime p5 + variants · hybrid control (uniform fader baseline
+ per-sketch idioms) · adaptive + tuned variants · all 10 sketches.

- ✅ **Part 1 — Hardware foundation (done + hardware-verified across all 4 devices,
  continuous hot-swap, 2026-06-01).** Corrected caps (grid128 varibright/no-tilt,
  arc4 per-encoder push); authoritative `monomeDevices` (connected vs simulated,
  hardware-wins); twin auto-snaps + greys out absent devices + replay-on-connect;
  reliable poll-based reconcile-detach (debounced); **LED diffing** (send-on-change,
  fixed the 30 Hz flush that crashed the Arc 4 clone); debounced notify (no storm);
  and **self-healing auto-recovery** (restarts serialoscd when a known device is
  present at USB but unlisted — recovers the Arc 4 FTDI clone on re-plug). Note:
  recovery is daemon-wide so it briefly blips all devices — refine later if wanted.
- ✅ **Part 2 — Idiom library** (`apps/p5-runtime/src/idioms/`): capability-aware
  `faderBank` / `stepSequencer` / `cellPaint` / `arcMacros` + `composeIdioms`, a pure
  control/LED layer generalizing `monomeMapping.ts` + `monomeFeedback.ts` + windchime's
  gestural dictionaries (`ledPolicies.ts` preserves the verified perfGrid/perfArc look).
  Headless `idioms-smoke` (tsx): **64 checks** under a Grid 64/Arc 2 AND a Grid 128/Arc 4
  profile (values change, sized/lit frames, push-gating, compose-overlap, capability
  folding, the velocity mode, and the phase-comet LED policies).
- ✅ **Part 3 — Sketch adaptation + variants**: contract additions (`hardwareTarget`,
  `idioms`, `altImpls`, `setProfile`, `MountContext.setup`+`controls`, `variants`,
  `VariantRecord`); host `getSetup`/`setProfile`/clear-LED-on-swap; the variant system
  (`familyVariants.ts`, `v`-key structural re-roll) + the idiom-vs-global mapping gate.
  **14 templates total**: the hand-ported **Opus III hero** (`lichtspielOpus`,
  grid64/arc2) + the 9 windchime families adapted onto the idioms — Wave A
  (`monomeArcgridcombo`, `patternGridWorld`) verified, Wave B (`pasArcgrid`,
  `upfAvTest`, `monomeArc4Shapes`, `itoBox`, `parquetDeformation`, `pasHalloween`) via
  a parallel per-sketch Workflow. Provenance in `visual-corpus/`.
- ✅ **Part 3 fidelity rework** (done 2026-06-01; plan `polymorphic-growing-karp.md`):
  the first-pass Wave A/B ports had lost windchime's visual fidelity + rich variant
  spaces. **All 9 windchime families are now faithfully re-ported** — full visual core
  + the exact `params.ts` variant space + the windchime gestural dictionary, with
  control/LED rewired through the idioms. Shipped: the **gestural panel** + **variant
  browser** (`v`/`c`/`,`/`.`, `h`); **capability folding** in the idiom layer so
  4-encoder / Grid-128 sketches adapt to Arc 2 / Grid 64 (arcMacros press-cycling +
  faderBank grid-folding — see `docs/idioms.md`); an `arcMacros` **velocity mode**
  (impulse → damped angular velocity, `tick()`-integrated, |vel| ring trail) for the
  itoBox roulette + monomeArcgridcombo spin; and the four windchime monomeArcgridcombo
  **phase-comet** arc-LED policies (`spot`/`sweep`/`bar`/`opposing`). Calibrated +
  Grid-64/Arc-2 hardware-verified: `lichtspielOpus`, `pasArcgrid`, `patternGridWorld`,
  `monomeArcgridcombo`. The batch (`upfAvTest`, `monomeArc4Shapes`, `itoBox`,
  `parquetDeformation`, `pasHalloween`) was re-ported via a strict-fidelity parallel
  Workflow + browser-verified (60/43/36 fps, no console errors, variant browse +
  twin LED mirror confirmed).
- ✅ **Coupling rework** (plan `jaunty-wobbling-simon.md`): the user's
  Grid-64/Arc-2 play surfaced that the GRID folds but the arc TURNS didn't (half the
  objects uncontrollable). Added **arc turn-coupling** (`fold:'couple'` — physical
  encoder drives logical {p,p+P,…} together; press cycle/all) + **paging**
  (`fold:'page'` — chord flips, for itoBox's distinct axes), **`fillNotched`** rings
  (dim notches, not blank-until-max), and a **repositioned + hardware-adaptive
  gestural panel** (left gutter; live `describe(profile)` map showing the connected
  device + coupling). Later: a live encoder-PAGE indicator + patternGridWorld expanded
  to 8 controls across 4 pages; page-mode presses fire on-press (Arc 2 reliability).
  81 idiom-smoke checks.
- ✅ **Stage 2 — faithful WEBGL hero re-port** (`lichtspielOpus`, p2d→webgl): restored
  the true 3D the P2D version flattened — the morphing tube (filled shells + contour
  rings + twisting strands + lobe undulation + noise + bulge field), interior noisy-
  sphere morphs, and volumetric 3D grain, inside the 2D film language (backplate, rect
  forms, bursts, film gate + sprocket holes + 4 grain types) layered by depth-test
  toggling. 8 faders + arc twist/aperture + 8 palettes + variants kept. Browser-verified
  at 60fps; variants re-roll palette/tunnel/forms.
- ✅ **Hero fidelity finish (2026-06-02, user-accepted).** Re-read `Lichtspiel_v3.pde`
  side-by-side + matched the original: HEIGHT-relative framing (mouth +0.286·H toward the
  camera — the immersive scale the earlier port had halved), the `rotateY(arcTwist*0.9)`
  camera orbit, the ~4.2-rad helical strand twist, faithful forward travel (~9.6 rings/s·
  filmSpeed), the bulge field's breathing + depth/angle swim, the dense 4-type film grain
  (speckle/dust beds + weave bands restored), and the full Ruttmann composition (moving
  bars + panels + iris aperture + rotating diagonal). **p5-WEBGL perf:** stroking a filled
  `TRIANGLE_STRIP` rebuilds line geometry per-frame on the CPU (a 16fps cliff), so the tube
  became every-ring stroked loops + 16 strands (the original's dense mesh approximated
  within a ~4000-segment/60fps budget; no stroked fill shells) — solid 60fps. Grid-64/
  Arc-2 hardware-verified.
- ✅ **Adapt-up — 64/2-native sketches expand onto bigger hardware (2026-06-02, both
  directions hardware-verified).** The idiom layer gained `faderBank.extendedLanes` +
  `arcMacros.extendedEncoders`: a sketch NATIVE to small hardware declares BONUS controls
  that light up only when there's room (a Grid 128's cols 8–15, an Arc 4's enc 2–3) and
  stay DORMANT at a neutral default otherwise — so the small rig is byte-identical and the
  extras never couple into the native pair. The hero now extends to 16 faders (8 native +
  contrast/sway/strands/morph/vignette/bursts/flicker/glow) + 4 encoders (twist/aperture +
  orbit/grain); grid scene-select removed (nav → keyboard/Ableton); the opus wires
  `controlMap` so the panel is hardware-accurate. **93 idiom-smoke checks.** See
  `docs/idioms.md`. **🔭 Future:** close the recursion — fold/page the FULL native +
  extended set back onto a Grid 64 / Arc 2 so the extras are reachable there too (a note).

## Phase 5 — Metadata retrieval 🟡 (head start shipped)

Ableton state *suggests* visuals (rule-based, no model).

- ✅ `visual-corpus/manifests/descriptors.json` + name/type tokenizer +
  rule-based scoring → top result + alternatives + reason string, in
  `ml-service/retrieve.py` (5 unit tests green). Not yet wired into the bridge.
- ✅ Lock / manual override (in the p5 runtime); semantic-distance knob (arc/keys).
- ⬜ Wire `live.state` → ml-service `/retrieve` → `retrieval.result` through the bridge.

**Acceptance:** different clips yield different visual choices · lock prevents
auto-change · manual override always wins · result includes a reason.

### Phase 5a — Ableton → Lichtspiel: scene-launch + locator auto-retrieval ✅ working in-Live · ⚠️ perf refinement pending

The first on-the-fly AV trigger: a Session **scene launch** or an Arrangement
**locator crossing** auto-loads a fresh random variant of a template, instantly
monome-playable (idioms stay live), hot-swapping per song section.

- ✅ **M4L** (`max/js/live_api_helpers.js`): a 2nd `js` outlet emits
  `/lichtspiel/scene/launch <i> <name>` (dominant playing Session row) +
  `/lichtspiel/locator <i> <name>` (cue_points × current_song_time crossing,
  forward-only with a seek guard). Recipe: `max/docs/max_patch_notes.md` Test D.
- ✅ **Bridge**: `oscRouter` decodes both addresses → `scene.launched` /
  `locator.crossed` wire messages → broadcast to p5 (`websocketServer`);
  `osc-selftest` covers both; `pnpm send scene.launch|locator`.
- ✅ **p5**: `live/abletonRetrieval.ts` `pickTemplate(evt, mode, …)` →
  `variants.newVariant`; `main.ts` `respond()` respects the on-screen lock. Two
  toggles: **retrieval mode** `mapped` ⇄ `random` (`m`) and **event source**
  `live` ⇄ `simulated` (`e`); simulate keys `k`/`l`. HUD readouts.
- ✅ **ableton-mcp** (testing accelerator, NOT a runtime dep): `ahujasid/ableton-mcp`
  installed + extended (`fire_scene` / `set_song_position` / `get_scene_info`) so
  scenes/playhead can be driven + the LOM introspected. Socket 9877, separate from
  `/lichtspiel` OSC (7400). See `docs/ableton-integration.md`.
- ✅ Verified headless (bridge `test:osc` 5/5; `pnpm send` + the `simulated`
  toggle → preview swaps template + variant; lock suppression + live-source gating).
- ✅ Verified **in-Live** end-to-end (ADE_Sleuth): scene launches + locator crossings
  hot-swap the p5 visual through the real M4L device; Session/Arrangement modes are
  cleanly separated (driven via ableton-mcp). Reliable — every event fires.
- ⚠️ **Perf refinement pending:** on a heavy (24-track) set, detection lags ~1–2 s
  and Live can get laggy — `LiveAPI.get` polling is too slow there for the 250 ms
  metro. Planned fix = event-driven LiveAPI observers (no per-tick scanning). Full
  write-up in `docs/ableton-integration.md` → "Known issues & refinement TODO".
- 🔭 Deferred: name-based semantic retrieval as a 3rd mode (`ml-service/retrieve.py`
  already exists); richer Ableton rules; eventually constrained generation.

### Phase 5b — scene/locator → animation mapping UI ✅ DONE (in-Live verified) · ⚠️ refinements NEXT, then latency

Pre-plan/perform: snapshot a set's named scenes + locators, assign each a **Template**
(fixed/random) + **Variant** policy (canonical/random), save/load, and have events
drive the plan — monome stays live, the lock still wins. This was the **mapping-first**
slice (**Goal B** of the original 5b brief). Docs: `docs/ableton-mapping-ui.md`. Committed
in 4 parts (A schema+resolver · B panel · C bridge · D docs) + pushed.

- ✅ **Schema + resolver** (pure, tested): `packages/schemas/src/abletonMapping.ts`
  (`AbletonMapping`/`MappingRow` + JSON schema + `makeDefaultRow` + `ADE_SLEUTH_SNAPSHOT`);
  `live/abletonRetrieval.ts` `resolveActivation()` (name-first match; disabled→suppressed;
  no-row→Phase-5a fallback); `live/abletonMappings.ts` `mergeSnapshot()` (edit-preserving,
  stale-flagging). `scripts/mapping-smoke.ts` = 21 checks.
- ✅ **p5 panel** (`ui/abletonMappingPanel.ts`, toggle `a`): Arrangement + Session tables,
  Template + Variant dropdowns, ▶ preview, last-triggered, lock-suppressed HUD readout,
  localStorage cache. `main.ts` `respond()` rewritten to the resolver + variant policy.
- ✅ **Bridge persistence + snapshot**: `mappingStore.ts` (JSON under
  `config/ableton-mappings/`, ajv-validated, traversal-safe) + `abletonSnapshot.ts`
  (9877 `get_scene_info`, ADE_Sleuth fixture fallback); new wire types
  (`ableton.snapshot[Request]`, `mapping.request/result`, `visual.activated`); snapshot
  replay-on-connect. `test:mapping` = store round-trip + save/load/snapshot over WS.
- ✅ **In-Live verified (2026-06-04, ADE_Sleuth):** the **feeder** drives BOTH locator
  crossings (Drop/buildup/next/hats back/END) and scene launches (Scene1) → p5 hot-swaps,
  each acked by `visual.activated`. **The M4L 2nd-outlet path was dead** (its cord dropped on
  the restart — known-fragile); the feeder bypasses it. **Runtime = 3 procs:** `dev:bridge`
  + `dev:p5` + **`dev:feeder`** (+ AbletonMCP Control Surface on, for the 9877 snapshot/poll).

**▶ RESUME HERE — Phase 5b REFINEMENTS ⬜ (the user's priority, BEFORE latency; planned 2026-06-04)**

After the in-Live build, the user asked for three refinements first (latency → the back). Build in a
**FRESH context** (the planning one is long). The animation-bug fix below is already done + committed
(`464ecf0`).

- ✅ **Animation bug FIXED (committed `464ecf0`):** the global fallback mapping (`monomeMapping.ts`,
  legacy/non-idiom templates only) was switching templates on monome presses — arc enc0 press →
  random template, enc1 press → next template, Grid-128 cols 8–15 → scene-select. **Removed**; the
  fallback drives PARAMS only. **Rule: the monome NEVER switches templates** — scene/template nav is
  keyboard + Ableton. Idiom templates were never affected (the `usesIdioms()` gate skipped the
  fallback; their presses fire within-sketch actions only).

- ✅ **Mapping set-awareness + presets — DONE (in-Live verified 2026-06-05).**
  Full-stack: feeder + bridge + schema + p5. `signatureOf()` structural fingerprint
  (`packages/schemas/src/abletonMapping.ts`); `mergeSnapshot` replaces-vs-merges by signature; the
  bridge stamps every snapshot + gained `rename`/`remove`/`listDetailed`; the feeder pokes
  `ableton.snapshotRequest` on set change (no new polling); the panel gained Save/Save As,
  Rename/Delete + a set-aware Load list (🟢 matches the open set / 🔴 a different set, anchored to
  the live signature so loading a 🔴 preset never breaks the picker). Gates green (typecheck ·
  validate:schemas · smoke:p5 29 checks · test:osc · test:mapping incl. rename/delete/signature/
  overwrite · p5 build); verified live against real Ableton (set-swap auto-replaced the rows: a
  15-scene set ⇄ ADE_Sleuth's 2/6). **Decisions (locked):**
  **structural fingerprint** for set identity (a hash of scene + locator names/times; no Remote-Script
  change) · **default = ALL RANDOM, NEVER auto-load a preset** · **multiple NAMED presets per set,
  manual save / load / rename / delete** (never auto-loaded).
  - **Auto-snapshot on set CHANGE** (the core ask — *auto-update when a new set LOADS, not just on the
    manual Refresh*): the feeder (already polling `get_scene_info` every 300 ms) computes a fingerprint
    each tick; when it CHANGES (a different set opened/closed), it emits an `ableton.snapshot` (auto) →
    bridge → p5 **REPLACES** the rows with fresh defaults (all random), discarding the closed set's
    stale data. No new polling. Manual Refresh still works. (Schema: add `signature` to `AbletonSnapshot`
    + `setSignature` to `AbletonMapping`; `mergeSnapshot` **replaces** — not merges — when the signature
    differs; same signature → merge as today, preserving edits.)
  - **Presets**: each saved mapping carries its `setSignature` + a user `name`; panel gets Save /
    Load ▾ / **Rename** / Delete; the Load list flags presets matching the current set. `mappingStore`
    gains rename + delete. **No auto-load** — explicit only.
  - **Test sets** (self-contained Collect-All projects in `demo/ableton/`): **ADE_Sleuth** ⇄ the NEW
    **`Super_Colitis_new3_mastered Project_v2`** (`Super_Colitis_new3_mastered_v2.als`) — swap between
    them in Live; confirm the rows auto-replace on load and never show the closed set's data.

- 🟦 **Takeover / manual monome mode — BUILT + headless-verified (awaiting hardware checkpoint).**
  A clear **MANUAL ⇄ TAKEOVER toggle in the monome twin** (`ui/monomeTwin.ts`) + a tempo/source
  readout + a manual-BPM nudge. In TAKEOVER, a **local beat clock** (`live/takeoverClock.ts`, pure +
  smoke-tested, 15 checks) generates synthetic monome gestures (encoder sweeps on the beat, presses on
  the downbeat, walking grid taps) → emitted on the SAME bus real input uses → the CURRENT sketch's
  idioms react (never switches templates) → twin + real LEDs reflect it. Real input stays live
  (blended). **Tempo source (the resolved question):** the clock needs only BPM + isPlaying (+
  song-time to phase-align) — **NO constant pulse**. The **feeder forwards transport from its existing
  `get_scene_info` poll** (which already returns `tempo`/`is_playing`/`current_song_time` — verified
  live, real 120 BPM) via the existing `live.state` wire path (zero bridge/schema change); a
  manual/default-BPM fallback + the twin's −/+ make it demonstrable standalone. Gates green (typecheck ·
  smoke:p5 incl. takeover-smoke · build). Future: drive from more Ableton state (clip/scene/device).

**▶▶ NEXT DIRECTION (2026-06-05): GENERATIVE TRACK — "Discovery → Generate" ⬜ (planned; build in a
fresh context).** The user pivoted: the latency track below is **DEPRIORITIZED**; the next direction is
the original generative vision — a UI **"Generate"** that synthesizes new, musically-informed p5 idioms.
- **Discovery** ("learn the set"): a background pass → master audio (BlackHole loopback + manual-export
  fallback) → **CLAP** embedding + zero-shot tags + **librosa** MIR (+ optional **LP-MusicCaps** caption)
  → a persisted **"musical mental model"** JSON keyed by the set fingerprint.
- **Generate**: that model (+ a prompt or "surprise" + a divergence slider) conditions **Claude
  (structured-output codegen, build-time only)** to write a new idiom against our template DSL → validate
  (tsc + ESLint allowlist + Playwright smoke + 2–3-pass self-repair) → load → save as a preset. Low
  divergence = mutation (reuse the variant system); high = a novel template. **Runtime stays LLM-free.**
- **POC-first** (G0 offline: metadata+MIDI → generate→validate→load) → G1 Discovery → G2 mutation → G3
  novel → G4 per-section. **Full architecture + handoff:** `docs/generative-architecture.md` +
  `~/.claude/plans/snug-nibbling-quail.md` ("GENERATIVE TRACK") + [[project_lichtspiel]] memory.

**Phase 5b latency track 🔕 — DEPRIORITIZED (2026-06-05; superseded as "next" by the Generative track
above). Kept documented; resume only if generation stalls. Full plan + open scope question:
`~/.claude/plans/snug-nibbling-quail.md` ("Phase 5b — LATENCY TRACK").**

Two causes, don't conflate: scene-launch **quantization** (Live fires clips on the bar — a transport
setting, not a bug; lower global launch-quant for snappier) vs the **feeder poll** (~300 ms +
`get_scene_info` cost — the real code/perf target).

**Two findings from the 2026-06-05 exploration that reshaped the ranking below:**
- **Locators are the only latency-critical path** — scenes are quantization-bound (musical/intended).
- **Cue/locator crossings are NOT listenable in the LOM** (`current_song_time` isn't a listenable
  property; no cue-trigger callback). So **observers can't help locators** — they're poll-based in every
  path. ⇒ the locator win is a **light transport read polled fast**, NOT the observer rewrites.

**Recommended plan (option 1 of the open decision):**
1. ⬜ **Metrics harness first** (`max/tools/latency-harness.mjs`) — drive N locator crossings, measure
   event→`visual.activated` latency (`activatedAt − wire ts`, both already stamped) + a feeder-computed
   `detectedLagMs` (`(song_time − cue.time)/tempo`). Report p50/p95 + miss/dup. Targets: locator p95
   < 150 ms; 0 miss / 100. Baseline before, compare after.
2. ⬜ **Tighten the feeder** — add a light `get_transport` to the Remote Script (transport only, no
   scene/cue/track enumeration; **needs an Ableton restart**) and split `demo-feeder.mjs` into a fast
   ~50 ms loop (light read → locators + the `live.state` forward) + a slow ~300 ms loop (`get_scene_info`
   → scene detect + set-change snapshot). Falls back to `get_scene_info` if `get_transport` is absent.
- 🔕 **Deprioritized** (don't help locators): thin Remote-Script *observers*, the native M4L observer
  rewrite. **Evaluate later** only if option 1 underperforms: AbletonOSC adapter (`ideoforms/AbletonOSC`).
- A `docs/phase5b-latency.md` write-up lands with the work.
- 🔭 Also still open in Phase 5: **name-based semantic retrieval** as a 3rd mode
  (`ml-service/retrieve.py` exists) + richer Ableton rules. ML/codegen = Phases 6–9.

## Phase 6 — MIDI/audio descriptors ⬜

Musical structure influences visuals.

- ⬜ MIDI summary (note density, pitch range, register, rhythm, polyphony).
- ⬜ Audio fallback (RMS, onset density, spectral centroid, chroma).
- ⬜ Normalize into retrieval; cache; degrade gracefully on failure.

## Phase 7 — Embedding retrieval ⬜

Semantic retrieval beyond hand rules. One model path (MERT/MuLan-style audio,
ImageBind-style bridge, or light local text embeddings). Toggle on/off; cache
everything; manual mode still works when the ML service is offline.

## Phase 8 — Template mutation ⬜

Beyond retrieval into variability: safe param mutation + submodule mutation
(palette / geometry / motion / camera / texture-feedback), mutation history,
accept/revert/save-preset, monome-mapped mutation depth + semantic distance.

## Phase 9 — Constrained p5 code generation ⬜

Controlled, dev-mode-only codegen against a constrained template DSL.
Validate → lint/compile → smoke render → screenshot → **human approval**
before a template enters the performance registry. Failures produce actionable
logs, never a broken performance state.

---

## Backlog / stretch 🔭

**`lichtspielOpus` signature template** — ✅ shipped in Phase 4.5 (the Ruttmann
*Opus III* morphing tunnel + 2D rect forms + film-grain, faderBank+arcMacros on
grid64/arc2). · Strudel audio co-generation · Hydra backend · TouchDesigner/Syphon/NDI handoff ·
fine-tuned mapping over a personal visual corpus · in-Live p5 editor ·
clip→visual preset saving in the Live Set · packaged M4L installer · the full
`umwelt` module (environment-aware visual ecology, evolving visual memory,
corpus-aware code mutation, performance-state history).

## Definition of done — first vertical slice

Live sends selected clip/track metadata → p5 receives it → p5 selects/updates a
template → monome or keyboard morphs the visual → the system does not crash when
ML is offline → a documented demo script exists → there is a clear path to
replace metadata retrieval with embeddings.
