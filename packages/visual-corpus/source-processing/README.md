# Source provenance — Windchime / Processing corpus

Lichtspiel **borrows concepts, not code**. Per `AGENTS.md` and the spec, we do
not fork Windchime and we take no runtime dependency on it. Each Lichtspiel
visual template was written fresh against the `VisualTemplate` contract; the
table below records the Processing/Windchime lineage each one *draws ideas
from* so the provenance is auditable.

Source corpus (local, not vendored here):
`/Users/trent/windchime-animation/processing_corpus_test1/` and
`/Users/trent/windchime-animation/processing_corupus_full/`.

| Lichtspiel template | Renderer | Processing/Windchime lineage | What was adapted (concept only) |
|---|---|---|---|
| `minimalPulse` | p2d | — (original) | New low-CPU fallback; no external lineage. |
| `topographicTunnel` | p2d | `UPF_AV_Testv14.pde` | Infinite forward tunnel of noise-displaced contour rings; depth/scroll feel. |
| `gridWorld` | p2d | `PatternGridWorld_v11.pde` | Spatial cell field, activation waves, neighbor connection lines. |
| `parquetGlitch` | p2d | `Parquet_v3_glitch.pde` | Parquet deformation (rotation/scale gradient of tiles) + glitch slicing. |
| `torusField` | webgl | `monomearc4shapescontrolv12.pde` | Arc-controlled 3D object family: tori / spheres / wavy tori. |

## Phase 4.5 — Animation corpus (idiom-driven)

These templates route control + LED through the capability-aware **monome idiom
layer** (`apps/p5-runtime/src/idioms/` — faderBank / stepSequencer / cellPaint /
arcMacros + `composeIdioms`), so each adapts to whatever monome is connected and
declares its native `hardwareTarget`. The Opus III hero is hand-ported fresh from
the grid64/arc2 source; the 8 windchime families are **faithfully ported** from the
**windchime-animation** `packages/sketch-families/` sources — the full visual core +
the **exact `params.ts` variant space** + the gestural dictionary, rewiring *only*
control/LED through the idioms. Borrow-not-fork still holds (fresh files, no windchime
dependency, provenance header per file); within that, fidelity is preserved, not
simplified. (A first pass had simplified the visuals + shrunk the variant spaces; the
2026-06-01 fidelity rework re-ported each faithfully — see the note below the table.)

| Lichtspiel template | Renderer | Idioms | Native | Windchime/Processing lineage | Visual core + variant space (faithful) |
|---|---|---|---|---|---|
| `lichtspielOpus` | p2d | faderBank + arcMacros | grid64/arc2 | `Lichtspiel_v3.pde` (idiom master) | Ruttmann Opus III morphing tunnel + 2D rect forms + film grain; P3D→P2D manual projection; the canonical 8-fader + arc twist/aperture control map. (Processing port — not a windchime TS family.) |
| `monomeArcgridcombo` | webgl | stepSequencer + arcMacros | grid128/arc4 | `Monome_arcgridcombo.pde` | 4 spinning solid 3D objects + step-trigger scanlines. Variants: palette(5)·objectKinds(4)·arrangement(4)·stepTiming(4)·arcLed(5: comet/spot/sweep/bar/opposing). Arc = velocity-mode spin. |
| `patternGridWorld` | webgl | cellPaint + arcMacros | grid128/arc4 | `PatternGridWorld_v11.pde` | 3D cube field painted per-cell, flicker + connection lines + pulsing border. Variants: palette(6)·connections(4)·depth(3)·rotation(4)·flicker(5)·cube(4). |
| `pasArcgrid` | webgl | faderBank + arcMacros | grid128/arc4 | `pasArcgridv7` | 4 objects (icosa/sphere/torus/helix/möbius), faders = rotation freq + Z-osc, arc = size + regen. Variants: palette(5)·shapes(4)·bg(4)·arcLed(5). |
| `upfAvTest` | webgl | faderBank + arcMacros | grid128/arc4 | `UPF_AV_Testv14.pde` | 4 topographic plane meshes (swirl/disc/ridge/ripple) + forward noise tunnel. Variants: palette(5)·planes(5)·tunnel(4). |
| `monomeArc4Shapes` | webgl | faderBank + arcMacros | grid128/arc4 | `monomearc4shapescontrolv12.pde` | Orbiting tori/spheres + 4 fullscreen 2D strobe motifs (diagonal/spiral/hex/oval). Variants: palette(5)·strobes(6)·objects(3). |
| `itoBox` | webgl | faderBank + arcMacros | grid128/arc4 | `itoBoxV9` | Velocity-roulette cube (face-pair tints) + drifting bg-object field. Arc = **velocity-mode** (damped angular velocity, |vel| ring trail). Variants: palette(4)·bgShapes(4)·damping(3). |
| `parquetDeformation` | webgl | stepSequencer + arcMacros | grid128/arc4 | `Parquet_v3_glitch.pde` | Two stacked deforming Perlin meshes + 10 polyhedra; steps retrigger column-block params. Variants: palette(5)·density(3)·shape(3). |
| `pasHalloween` | p2d | stepSequencer + arcMacros | grid128/arc4 | `pasHalloweenV3` | 2D motion-trail spawner: steps set a column param + birth circle/triangle/square/star elements. Variants: palette(5)·trails(4)·shape(4). |

**Fidelity rework (2026-06-01).** Each windchime family above carries its FULL
windchime `params.ts` variant space (browse it live with `v` new / `c` canonical /
`,` `.` step) and its windchime gestural dictionary (shown in the on-screen gestural
panel, `h`). Two idiom additions made the faithful arc behaviour reachable:
`arcMacros` gained a **velocity mode** (a delta is an impulse into a damped angular
velocity the host integrates via `tick(dtMs)`; `damping` = free-wheel vs spin-down,
`integrate:'clamp'` for bounded zoom, `velocityTrail` for the |velocity| comet) — the
itoBox roulette + the monomeArcgridcombo spin — and `ledPolicies` gained the four
windchime monomeArcgridcombo arc-LED **phase-comet policies** (`spot`/`sweep`/`bar`/
`opposing`) so that family's `arcLed` variant ports exactly. A smoke check asserts
every `idioms`-declaring template also ships a gestural dictionary.

The **idiom layer itself** (`idioms/`) generalizes windchime's per-sketch gestural
dictionaries + Lichtspiel's `monomeMapping.ts` / `monomeFeedback.ts` into a reusable
capability-aware vocabulary; `ledPolicies.ts` preserves the hardware-verified
`perfGridLevel` / `perfArcLevel` + diagnostic7 LED aesthetics. Variants follow the
windchime `canonical / generate(divergence)` pattern via `mutations/familyVariants.ts`.

Utility lineage (adapted, fresh implementations):

- **Seeded RNG** (`apps/p5-runtime/src/seededRng.ts`) — mulberry32, adapted from
  the Windchime animation `seeded.ts`.
- **Instance-mode host loop** (`apps/p5-runtime/src/sketchHost.ts`) — pattern
  adapted from Windchime `createSketchHost`, retargeted to `VisualParamVector`
  + `LiveSessionState`.
- **Monome event / LED protocol** (`packages/schemas/src/monome.ts`) — shapes
  adapted from the Windchime animation `protocol` package, supporting **both**
  device classes (grid 64/128, arc 2/4) via `monomeProfiles.ts`.
- **serialosc bridge** (planned, `apps/live-bridge` Phase 4) — to be adapted
  from the Windchime animation Node `serialosc.ts` bridge.

## Grid 64 / Arc 2 corpus (`processing_corpus_g64arc2/`)

The user's newer **grid 64 + arc 2** sketches (the primary Lichtspiel target).
The corpus the original templates came from (UPF, PatternGridWorld, etc.) was
built on **grid 128 + arc 4**; this folder is grid64/arc2-native.

| Source | Role | Lichtspiel use |
|---|---|---|
| `Lichtspiel_v3` | **Idiom master** — Ruttmann *Opus III* tunnel; defines the canonical grid64/arc2 control map (8 column-faders + arc turn/press). | Source for `monomeMapping.ts` (column-fader idiom) + the planned `lichtspielOpus` signature template. |
| `Lichtspiel_v1`, `Lichtspiel_v2` | Earlier iterations of the idiom. | Reference. |
| `monome_grid64_arc2_diagnostic1–7` | Hardware diagnostics (capability tests; v7 = full + parallel LED sweep). | Adapted into the digital-twin dashboard (`ui/monomeTwin.ts`); v7 was the model. |
| `monome_capability_notes.md` | The user's verified capability notes (grid64/arc2 vs grid128/arc4: monobright vs varibright, global intensity, tilt, arc push, serialosc OSC contract, porting guidance). | Distilled into `docs/monome.md` + the `caps` model in `monomeProfiles.ts`. |

Rules going forward (see `AGENTS.md`):
1. Adapt concepts; do not copy files verbatim.
2. Every adapted file carries a header naming its source and what changed.
3. Audio is never ported (the Processing sources contain Minim/Sonic Pi sends —
   all dropped; Lichtspiel is visuals-only on the p5 side).
