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

## Phase 4.5 — Animation corpus + monome idiom layer 🟡 (in progress)

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
  twin LED mirror confirmed). **Open:** the user's Grid-64/Arc-2 hardware pass on the
  batch + the grid128/arc4 hot-swap pass (browser-proven via the twin meanwhile).

## Phase 5 — Metadata retrieval 🟡 (head start shipped)

Ableton state *suggests* visuals (rule-based, no model).

- ✅ `visual-corpus/manifests/descriptors.json` + name/type tokenizer +
  rule-based scoring → top result + alternatives + reason string, in
  `ml-service/retrieve.py` (5 unit tests green). Not yet wired into the bridge.
- ✅ Lock / manual override (in the p5 runtime); semantic-distance knob (arc/keys).
- ⬜ Wire `live.state` → ml-service `/retrieve` → `retrieval.result` through the bridge.

**Acceptance:** different clips yield different visual choices · lock prevents
auto-change · manual override always wins · result includes a reason.

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
