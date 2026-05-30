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
| `monome_grid64_arc2_diagnostic1–7` | Hardware diagnostics (capability tests; v7 = full + parallel LED sweep). | Reference for the Phase 4 connection/diagnostics dashboard. |

Rules going forward (see `AGENTS.md`):
1. Adapt concepts; do not copy files verbatim.
2. Every adapted file carries a header naming its source and what changed.
3. Audio is never ported (the Processing sources contain Minim/Sonic Pi sends —
   all dropped; Lichtspiel is visuals-only on the p5 side).
