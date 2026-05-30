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

A keyboard fallback mirrors all of this (see `docs/setup.md`).

## Detection & adaptation

The active `MonomeSetup` (grid + arc profile) drives everything; the mapping
reads it on every event, so swapping devices needs no re-wiring.

- **Now (no hardware):** the on-screen emulator (`g`) has a Grid 64/128 + Arc
  2/4 switcher that emits `monome.setup`; the grid + rings re-render to the
  right dimensions and the mapping adapts live. Verified: switching to Grid 128
  shows 16 columns, Arc 4 shows 4 rings, and column-faders drive the mapped
  params.
- **Phase 4 (real hardware):** the bridge's serialosc layer sends
  `device.attached` (with rows/cols/encoders); `bridgeClient` routes it →
  `profileFromAttached()` resolves a profile → the active setup + emulator
  update via the same path.

## Diagnostics → connection dashboard (planned, Phase 4)

`windchime-animation/processing_corpus_g64arc2/monome_grid64_arc2_diagnostic1–7`
are hardware diagnostics (capability tests; v7 = full capability + fast parallel
LED sweep). These are the reference for a **connection/diagnostics dashboard**
UI element (à la windchime): show detected devices, per-cell/per-LED test
sweeps, and a live event monitor. Tracked in `ROADMAP.md` Phase 4.

## Signature template (planned)

`Lichtspiel_v3`'s Ruttmann tunnel visual is a strong candidate for a signature
`lichtspielOpus` template (morphing tunnel + interior sphere morphs + 2D rect
forms + film-grain damage). Noted in `ROADMAP.md` (Phase 1 backlog / Phase 8).
