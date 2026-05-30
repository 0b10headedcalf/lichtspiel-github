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

## Phase 3 — Max for Live Live API probe ✅ (verified in a real Live set)

Read real Live state and feed it to p5 over OSC. See `max/docs/max_patch_notes.md`.

- ✅ Bridge **OSC receiver** (`oscRouter.ts`, pure-Node dgram + OSC codec):
  `/lichtspiel/state|scene|param` on UDP 7400 → hub → p5. Verified end-to-end
  (`pnpm --filter @lichtspiel/live-bridge test:osc`).
- ✅ `js/live_api_helpers.js` — reads transport + selected track/scene/clip via
  `LiveAPI`, emits a `LiveSessionState` JSON symbol (guarded; degrades to default).
- ✅ Generated probe patch `patches/lichtspiel_probe.maxpat` (`build_patches.py`
  via MaxPyLang): loadbang/metro/`live.thisdevice` → js → prepend → udpsend.
- ✅ Assembled into a M4L device (Max Audio Effect) + **verified in the
  ADE_Sleuth set**: real tempo (123bpm), selected track name, transport (▶)
  stream to the p5 HUD (`rx` climbing). 2026-05-30.
- ⬜ Expose Live params (`live.dial`) → `/lichtspiel/param`; compact device UI.
- ⬜ Read arrangement playing-clip-per-track (probe currently does selected
  track + transport + session highlighted clip).

**Acceptance:** changing the selected clip / toggling transport updates the
bridge log · device loads without missing deps · M4L manual controls move p5
params · device works when ML service is offline.

## Phase 4 — Monome integration & device adaptation 🟡

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
- ⬜ serialosc layer in `live-bridge` (adapt windchime-animation `serialosc.ts`):
  discover devices, emit `device.attached/detached` + `grid.key`/`arc.delta`/
  `arc.key`, flush `led.*`/`ring.*` (twin test patterns → real hardware LEDs).
- ⬜ LED/ring feedback from templates (write `ledOut`; host flushes; width
  follows the active grid; honor varibright vs monobright `caps`).
- ⬜ Debounce/rate-limit so input flooding never freezes the patch/browser.

**Acceptance:** grid column-faders move params · grid press selects scenes ·
arc encoders morph continuously · LEDs reflect values · plugging in grid 64 vs
128 / arc 2 vs 4 adapts the surface · rapid input never freezes.

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

**`lichtspielOpus` signature template** — port `Lichtspiel_v3`'s Ruttmann
*Opus III* morphing tunnel (interior sphere morphs + 2D rect forms + film-grain
damage) as the hero scene; it already defines the canonical monome idiom. ·
Strudel audio co-generation · Hydra backend · TouchDesigner/Syphon/NDI handoff ·
fine-tuned mapping over a personal visual corpus · in-Live p5 editor ·
clip→visual preset saving in the Live Set · packaged M4L installer · the full
`umwelt` module (environment-aware visual ecology, evolving visual memory,
corpus-aware code mutation, performance-state history).

## Definition of done — first vertical slice

Live sends selected clip/track metadata → p5 receives it → p5 selects/updates a
template → monome or keyboard morphs the visual → the system does not crash when
ML is offline → a documented demo script exists → there is a clear path to
replace metadata retrieval with embeddings.
