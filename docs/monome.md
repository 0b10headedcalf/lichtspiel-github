# Monome — devices, idiom, detection & adaptation

Monome is Lichtspiel's signature performance interface (spec §10). This doc is
the source of truth for the device classes, the control idiom, and how the app
**detects which device is connected and adapts** the sketches + mappings.

## Device classes (the user owns both)

| Device | Serial | Dims | Role |
|---|---|---|---|
| **Grid 64** | `m64_0175` | 8×8 | Primary Lichtspiel target |
| **Arc 2** | `m0000174` | 2 encoders | Primary Lichtspiel target |
| **Grid 128** | `m29496721` | 8×16 | Built most of the windchime-animation corpus |
| **Arc 4** | `m0000007` | 4 encoders | Built most of the windchime-animation corpus |

None are "historical" — the app supports both classes. **Never hard-code grid
size or encoder count**; read it from the connected device. Profiles live in
`packages/schemas/src/monomeProfiles.ts` (`GRID_64`/`GRID_128`/`ARC_2`/`ARC_4`,
`profileFromAttached()`, `DEFAULT_SETUP`).

## Capabilities & limitations (categorized)

The classes differ in capabilities — sketches + mappings must **adapt**, not
assume. Each profile carries a typed `caps` object (`GridCaps` / `ArcCaps`):

| Capability | Grid 64 `m64_0175` | Grid 128 `m29496721` | Arc 2 `m0000174` | Arc 4 `m0000007` |
|---|---|---|---|---|
| cells / encoders | 64 (8×8) | 128 (8×16) | 2 enc | 4 enc |
| per-key binary on/off | ✓ | ✓ | — | — |
| per-key **varibright** 0–15 | ✗ monobright | ✓ (2022 edition) | — | — |
| **global** LED intensity 0–15 | ✓ | ✓ | — | — |
| LED-map quads (8×8) | 1 | 2 | — | — |
| tilt sensor | ✓ | ✗ (aluminium) | ✗ | ✗ |
| ring LEDs (varibright 0–15) | — | — | 64 ✓ | 64 ✓ |
| encoder push (`/enc/key`) | — | — | ~ best-effort | ✓ per-encoder (clone) |

**Capability facts (verified hardware + 2026-05 research):** The user's Grid 64
(`m64_0175`) is a ~2007–2010 *monobright* "series" grid — per-key LEDs are
**on/off only** with one shared **global intensity** (`/grid/led/intensity`
0–15); its 0–15 per-key levels are **logical** (the runtime + twin keep/show
them, but the bridge flushes on/off + a global dimmer). The Grid 128
(`m29496721`) is a **2022 edition: genuinely varibright** (per-key 0–15 via
`/grid/led/level/*`), global intensity, two 8×8 quads, **no tilt** (tilt was
dropped on the aluminium grids). Varibright grids still accept the monobright
commands, so the binary path stays a safe fallback. **Arc rings are varibright**
(true 0–15) on all arcs. The user's Arc 4 (`m0000007`) is a wood-panel clone
emulating the early-2010s arc → **per-encoder push** (`/enc/key 0..3`); the Arc 2
(`m0000174`) push is best-effort (`caps.pushPerEncoder` gates whether per-encoder
press is reliable; keyboard fallback covers any critical click).

**Porting / compiling Processing → p5 must be capability-aware.** Rather than
picking which sketches to port by the device they were authored on, every p5
template + mapping reads the active profile's `caps` and adapts (grid width →
fader count + scene buttons; encoder count → which arc params exist; varibright
vs monobright+global → per-key level feedback vs binary + global dimmer; quads →
LED-map batching). One codebase, either controller. **Don't port 1:1** from
grid128/arc4 → grid64/arc2 — compress: 16-step → 8-step/2 pages, 4 fader groups
→ 2 macros/page-switch, 4 arc objects → 2 macro groups, 4 playheads → 2.

**Porting / compiling Processing → p5 must be capability-aware.** Rather than
picking which sketches to port by the device they were authored on, every p5
template + mapping reads the active profile's `caps` and adapts (grid width →
fader count + scene buttons; encoder count → which arc params exist; varibright
→ level vs binary LED feedback; quads → LED-map batching). This keeps one
codebase working on either controller.

## The idiom master — `Lichtspiel_v3`

`windchime-animation/processing_corpus_g64arc2/Lichtspiel_v3/` is the **canonical
grid64/arc2 control idiom** — a Walter Ruttmann *Lichtspiel: Opus III*-inspired
performable abstract-film tunnel. Its control map:

**Grid 64 (8×8) — each column is a vertical fader** (press a cell → set that
column's level; LEDs fill below the chosen row):
| Col | v3 meaning |
|---|---|
| 0 | film / tunnel speed |
| 1 | tunnel radius / zoom |
| 2 | tube undulation amplitude |
| 3 | lobe frequency / contour complexity |
| 4 | internal sphere-morph density |
| 5 | 2D Ruttmann-form density |
| 6 | palette selector (one row per palette) |
| 7 | grain / vignette / contrast damage |

**Arc 2** — enc0 turn = tunnel twist / camera orbit, enc0 press = toggle bulge
field; enc1 turn = aperture / iris, enc1 press = advance palette + spawn burst.

## How Lichtspiel generalizes the idiom

The runtime mapping (`apps/p5-runtime/src/monomeMapping.ts`) keeps the
**column-fader** model but maps columns to the normalized `VisualParamVector`
axes (aligning col 6 → palette and col 7 → strobe with v3):

```
col:  0       1        2          3         4            5         6        7
axis: motion  density  turbulence symmetry  cameraDepth  contrast  palette  strobe
```

- **Grid 64:** 8 columns = the 8-axis fader bank.
- **Grid 128:** columns 0–7 = the fader bank; columns 8–15 = scene-select
  buttons (one column per template) — the extra width is used, not ignored.
- **Arc 2:** enc0 turn = semantic distance, enc1 turn = mutation amount;
  enc0 press = surprise, enc1 press = next scene.
- **Arc 4:** adds enc2 = motion, enc3 = palette.

> This global mapping is the fallback for the 5 legacy visual-only templates. The
> windchime / idiom corpus instead OWNS the grid + arc through the idiom layer
> (`faderBank` / `arcMacros`). There, a 64/2-native sketch's Grid 128 cols 8–15 + Arc 4
> enc 2–3 become **extended controls of that sketch** (more faders / knobs), *not*
> scene-select — see `docs/idioms.md` ("adapt up"). Scene nav for idiom sketches is
> keyboard / Ableton.

A keyboard fallback mirrors all of this (see `docs/setup.md`).

## Detection & adaptation

The active `MonomeSetup` (grid + arc profile) drives everything; the mapping
reads it on every event, so swapping devices needs no re-wiring.

- **Now (no hardware):** the on-screen emulator (`g`) has a Grid 64/128 + Arc
  2/4 switcher that emits `monome.setup`; the grid + rings re-render to the
  right dimensions and the mapping adapts live. Verified: switching to Grid 128
  shows 16 columns, Arc 4 shows 4 rings, and column-faders drive the mapped
  params.
- **Real hardware (Phase 4, ✅ done + verified on Grid 64 + Arc 2):** the
  bridge's serialosc layer (`apps/live-bridge/src/serialosc.ts`) discovers the
  device and sends `device.attached` (with rows/cols/encoders); `bridgeClient`
  routes it → `profileFromAttached()` resolves a profile → the active setup +
  twin update via the same path. Live discovery confirmed against serialoscd
  1.4.7 on the user's real `m64_0175` + `m0000174`.

## Digital-twin dashboard + LED feedback (built ✅)

`apps/p5-runtime/src/ui/monomeTwin.ts` is **one dashboard** + the **single LED
authority**: its canvas and the real hardware render from the *same* per-cell /
per-ring level functions (in `ui/monomeFeedback.ts`), so "what the twin shows"
always equals "what the LEDs show". It emits the current frame to the bridge at
~30 Hz regardless of dashboard visibility. Toggle the view with `g`. It:

- draws a **digital twin** of the connected hardware — grid cells with 0–15
  level readouts (scaled by the global dimmer) + 64-LED arc rings — adapting to
  the active profile (8×8 ↔ 16×8, 2 ↔ 4 rings);
- **Mirror (performance) mode** — the controller mirrors what you're doing:
  grid columns are **VU fader bars from the live `VisualParamVector`** (the
  `COLUMN_AXES` map; a held cell flashes; grid-128 cols 8–15 = scene buttons),
  and arc rings show each mapped param (`ARC_AXES`) as a **filled arc + a
  glowing comet head + every-8th orientation ticks + a press boost** (the
  `diagnostic7` `updateArcRing` aesthetic, driven by value). If a *template*
  writes a non-empty `ledOut`, that is mirrored instead.
- **diagnostic sweeps** (adapted from `diagnostic7`, dims-adaptive, looping):
  `Auto sweep` = sequential (gridBinary / varibright / **intensity** / row /
  col / map → arcGradient / brightness / ticks / range / pulse / spin) and
  `Fast ∥` = grid stages **in parallel with** arc stages. Plus quick one-shot
  tests: All on / Checker / Ramp / **Intensity** (global-dimmer breath) / Row /
  Col / Arc fill / Arc grad / Arc ticks. The active stage shows in the label.
- is **interactive** (click cells, drag rings, click ring centers) — emitting
  the same MonomeEvent shapes the bridge does, so it doubles as the no-hardware
  input device;
- shows a **capability panel** (cells/quads/varibright/tilt · encoders/push),
  a **seen-checklist** (grid.key / arc.delta / arc.key), and a live **event log**;
- has a **Grid 64/128 + Arc 2/4 switch** that simulates device detection.

The same LED frame flushes to the device over the bridge and real
`device.attached` / `grid.key` / `arc.*` events drive the twin — verified
end-to-end on the real Grid 64 + Arc 2 (2026-05-31). Source diagnostics for
reference: `processing_corpus_g64arc2/monome_grid64_arc2_diagnostic1–7`
(v7 = full capability + fast parallel sweep).

## serialosc OSC contract (implemented in `serialosc.ts` ✅)

Implemented in `apps/live-bridge/src/serialosc.ts` (pure-Node `dgram` + our
`oscCodec`, NO osc-js). The bridge talks **raw serialosc OSC** (higher-level
wrappers caused grid/arc routing conflicts in the source project — avoid them).
Inbound OSC is routed to the right device **by UDP source port** (not "guess by
kind"). Ports: serialosc on `12002` (`LICHTSPIEL_SERIALOSC_PORT`), the app binds
+ listens on `13333` (`LICHTSPIEL_OSC_APP_PORT`), with a chosen prefix
(`LICHTSPIEL_OSC_PREFIX`, e.g. `/lichtspiel`). A single ~30 Hz scheduler
(`LICHTSPIEL_LED_HZ`) coalesces arc deltas + throttles LED flushes; hot-plug is
handled (re-arm notify + periodic re-list + dedup). Verified by
`pnpm --filter @lichtspiel/live-bridge test:serialosc` (no hardware needed).

Discovery + per-device config:
```
→ /serialosc/list <host> <port>          # ask for devices
← /serialosc/device <id> <type> <port>   # one reply per device
→ /sys/host <host> ; /sys/port <appPort> ; /sys/prefix <prefix>
→ /sys/query ; /sys/size                 # confirm + read dimensions → device.attached
```

Input (device → bridge → bus `monome.event`):
```
/PREFIX/grid/key  x y s         # s = 1 down / 0 up   → grid.key
/PREFIX/enc/delta n d           # n = 0..enc-1, signed → arc.delta
/PREFIX/enc/key   n s           # optional             → arc.key
/PREFIX/tilt      n x y z       # if /tilt/set n 1 enabled → tilt (Phase 4+)
```

LED output (bus → bridge → device), chosen by `caps`:
```
# monobright grid (Grid 64): binary + global dimmer
/PREFIX/grid/led/set x y s    /PREFIX/grid/led/row x y d
/PREFIX/grid/led/col x y d    /PREFIX/grid/led/map x y d[8]
/PREFIX/grid/led/all s        /PREFIX/grid/led/intensity i      # i = 0..15
# varibright grid (if a sys query proves it): per-key levels
/PREFIX/grid/led/level/set|map|row|col …                       # 0..15
# arc rings (always varibright)
/PREFIX/ring/set n x a   /PREFIX/ring/all n a
/PREFIX/ring/map n d[64] /PREFIX/ring/range n x1 x2 a           # a = 0..15
```

Bridge implementation rules (from the source diagnostics): separate handlers
per subsystem (`handleGridKey` / `handleArcDelta` / `handleArcKey` /
`handleTilt`), **rate-limit** high-frequency output (~30 Hz for tilt→LED),
prefer batched `row`/`col`/`map`/`range`/`all` over many single-LED messages,
and never block the loop (`delay()`); use a `millis()` scheduler.

### Discovery robustness + the Arc 4 clone (learned the hard way, 2026-06-01)

The user's **Arc 4 is a wood-panel FTDI clone** that serialosc handles less
robustly than the production devices. Hard-won rules baked into `serialosc.ts`:

- **Never flush unchanged LED frames.** The twin emits at ~30 Hz; sending all 4
  arc rings every tick (~120 `/ring/map`/s) **overwhelmed the clone's serial link
  and made it disconnect**, which then drove an add/remove storm. Fix: **diff per
  ring/quad** — only send on change (idle arc = zero traffic). This is the single
  most important rule for arc stability.
- **Poll, don't trust the notify flood.** A flaky device makes serialosc emit a
  storm of `/serialosc/add|remove`; reacting with re-lists amplifies it. We poll
  `/serialosc/list` (~1.5 s) as the source of truth + arm notify only for a
  *debounced* fast-detect; **detach is reconcile-based** (a device missing from
  `DETACH_MISSES` consecutive polls is dropped — debounced so flicker doesn't thrash).
- **Self-heal stuck enumeration.** On re-plug, serialoscd intermittently leaves
  the clone present-at-USB-but-unlisted (its `tty.usbserial-m0000007` exists, even
  its `serialosc-device` runs, but `/serialosc/list` omits it). The bridge detects
  this (known serial's tty present but unattached for `STUCK_CYCLES`) and
  **restarts the serialosc daemon** (`brew services restart serialosc`, bounded to
  `MAX_RECOVERY_ATTEMPTS`/episode, then asks for a manual replug). The restart is
  daemon-wide, so all devices briefly blip — acceptable, refine later if possible.
  Env: `LICHTSPIEL_SERIALOSC_RECOVER` / `LICHTSPIEL_SERIALOSC_RESTART_CMD`.

## Tilt (grid only, Phase 4+)

Series grids have an accelerometer. Enable `/PREFIX/tilt/set 0 1`; incoming
`/PREFIX/tilt 0 x y z` (treat as uncalibrated continuous control, not physical
units). Good targets: camera drift / gravity vector / attractor position /
field bias / global modulation depth. It would map naturally to
`VisualParamVector` axes (e.g. tilt x/y → a 2-axis pad over motion+turbulence,
tilt z → cameraDepth). Not modeled as an input event yet — add a `tilt` event
+ `caps.tilt` gating when the serialosc layer lands.

## Role guidance (compressed for grid 64 + arc 2)

- **Grid 64** — discrete state, binary patterning, mode selection, spatial
  density, blink/animation, global intensity, + tilt. *Don't* encode meaning in
  per-key brightness (it's monobright).
- **Arc 2** — continuous + true varibright ring feedback: playhead/phase, loop
  range, parameter amount, A/B morph, global motion + density. enc0/enc1 are
  the two macros (vs four independent lanes on an Arc 4).

## Sources

- Grid editions — https://monome.org/docs/grid/editions/
- Arc editions — https://monome.org/docs/arc/editions/
- serialosc OSC reference — https://monome.org/docs/serialosc/osc/
- serialosc serial protocol — https://monome.org/docs/serialosc/serial.txt
- In-repo: [`packages/visual-corpus/source-processing/monome_capability_notes.md`](../packages/visual-corpus/source-processing/monome_capability_notes.md)
  — the user's verified capability notes this section is distilled from.

## Signature template (planned)

`Lichtspiel_v3`'s Ruttmann tunnel visual is a strong candidate for a signature
`lichtspielOpus` template (morphing tunnel + interior sphere morphs + 2D rect
forms + film-grain damage). Noted in `ROADMAP.md` (Phase 1 backlog / Phase 8).
