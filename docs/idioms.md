# The monome idiom layer — Lichtspiel's "underlying representation"

This is how Lichtspiel keeps the windchime / Processing sketches' crafted control
feel **and** runs them on any monome combo. A sketch declares its control
*intent* as logical **idioms**; the idiom layer maps that intent onto whatever
hardware is connected — **1:1 when the hardware matches the sketch's original
build, and FOLDED for similar reactivity when it's smaller**. You port a sketch's
intent once; the 4→2 / 128→64 adaptation is automatic. No per-sketch, per-hardware
branches.

Lives in `apps/p5-runtime/src/idioms/`. Pure control/LED — no p5, no drawing.

## The idioms

- **`faderBank`** — grid columns as vertical faders (continuous / select /
  toggle). Lanes = the sketch's logical faders. Generalizes `monomeMapping.ts`'s
  column-fader + windchime's per-panel fader grids.
- **`stepSequencer`** — rows×cols step matrix + playhead + loop/cut latch (from
  `monomeArcgridcombo`). `steps == cols` (16 on a Grid 128, 8 on a Grid 64).
- **`cellPaint`** — per-cell brightness cycle 0→15 + seeded idle flicker (from
  `patternGridWorld`); reshapes the cell grid on a hot-swap.
- **`arcMacros`** — encoders → values (`absolute` clamp / `relative` wrap) + press
  actions; ring LED policies `fill | comet | gauge | marker | segments | playhead
  | inverse`. Generalizes `ARC_AXES` + `perfArcLevel`.
- **`composeIdioms([...])`** — fans events to all idioms; composites their LED
  writes by `Math.max`; merges `values()`.
- **`ledPolicies.ts`** — the pure `(state) → level 0..15` helpers, so the digital
  twin's canvas and the hardware frame render from the SAME data (can't drift).
- **`types.ts`** — `Idiom<V>`, `IdiomProfile`, `profileFromSetup(setup)`.

## The adaptation doctrine (the important part)

A sketch is authored for its **original** hardware (e.g. a Grid 128 + Arc 4 sketch
= 16 fader lanes + 4 encoders). `profileFromSetup(setup)` gives the connected
hardware's `IdiomProfile`; the idioms then adapt:

**1. Hardware ≥ the sketch's needs → 1:1, original intact.**
Every logical control maps to its own physical control (Grid 128 / Arc 4). Nothing
changes from the original build.

**2. Hardware smaller → FOLD, for "similar reactivity".**
Every logical control stays *reachable*, distributed across the fewer physical ones:
- **`arcMacros` press-folding** — physical encoder `p` covers logical encoders
  `{p, p+P, p+2P, …}` (P = physical count); each **press cycles** through the
  covered actions (skipping no-ops). All logical press-actions reachable by
  repeated presses. *(e.g. a 4-object regenerate on an Arc 2: enc0 cycles
  obj0→obj2, enc1 obj1→obj3.)*
- **`faderBank` grid-folding** (`spread:false`, lanes > cols) — physical column
  `x` drives logical lanes `{x, x+cols, x+2cols, …}`, all set together. All lanes
  reachable, in pairs. *(e.g. 16 fader lanes on a Grid 64: cols 0–3 → objects 0+2's
  X/Y/Z/osc, cols 4–7 → 1+3.)*
- Turn + LED stay 1:1 with the physical control's **primary** logical (the LED
  shows the primary). Held-boost is per physical control.

**3. Wider grid → spread / spare columns.**
`faderBank` `spread:true` lays lanes into multi-column panels. With `spread:false`
and lanes ≤ cols, the extra columns are free — e.g. a Grid 128's cols 8–15 do
scene-select via `ctx.controls.selectSceneIndex` (the Opus III hero).

The folding lives **entirely in the idiom layer**, so every sketch — current and
future — inherits it. **A new sketch just declares its logical idioms; you never
write a per-hardware branch.**

**Capabilities also adapted** (from `IdiomProfile`): monobright vs varibright (the
bridge binarizes to on/off + global intensity; the twin/idiom still track logical
0–15), per-encoder push vs a single shared button (`arcMacros` gates non-enc0
presses only when the device is *known* to lack per-encoder push; a `press(i)`
keyboard fallback always works), tilt, global intensity, ring-LED count.

## Variants — the structural layer

Distinct from the continuous `VisualParamVector` axes (the performer rides those
live): variants re-roll a sketch's STRUCTURE (palette mode, shape set, arrangement,
…) and re-mount.

- **`mutations/familyVariants.ts`** — `makeVariantFactory({ axis: { canonical,
  options } })`, the windchime `canonical / generate(rng, seed, divergence)`
  pattern. **Declare the sketch's FULL variant space** — the exact option pools
  from the windchime `<family>/params.ts` (palettes, shapes, etc.). Config flows
  to the sketch via `MountContext.config`; read it with `cfg(ctx.config, key, fallback)`.
- **`mutations/variantBrowser.ts`** — `v` new variant (random seed @ divergence
  0.6) · `c` canonical · `,` / `.` step (deterministic seed enumeration). Live-only
  (no persistence yet — that's the Phase-8 mutation lab). Re-mounts via `host.mount`.
- **Gestural dictionary** (`GesturalDictionary` in `@lichtspiel/schemas`) — each
  sketch declares its control map (grid/arc `area · action · effect`), shown in the
  on-screen **gestural panel** (`h`; collapsed-by-default, right side).

## Porting recipe (for the batch + any new sketch)

To bring a windchime sketch-family in faithfully:

1. **Visual core** — port `windchime <family>/index.ts`'s `draw()` + helper
   geometry/palette functions, keeping the crafted detail + windchime's own perf
   guards. Reuse `templates/lib/shapes3d.ts` + `lib/palettes.ts`. Provenance header.
2. **Full variant space** — `makeVariantFactory({…})` with the EXACT option pools
   from `windchime <family>/params.ts`. Read via `cfg()`.
3. **Gestural dictionary** — port the windchime `gestural` content.
4. **Control + LED via the idioms** — build the idioms (`faderBank` /
   `stepSequencer` / `cellPaint` / `arcMacros`) + `composeIdioms`; fold each
   `idiom.values()` with the matching `VisualParamVector` axis; `renderGrid` /
   `renderArc` into `ctx.ledOut` each frame; `setProfile(setup)` forwards profile
   changes. **Never hardcode 16×8 / 4×64 — the idioms adapt.**
5. Declare `hardwareTarget` + `idioms` + `gestural`; one self-contained file.

**Reference templates:** `pasArcgrid.ts` (fader-bank), `patternGridWorld.ts`
(cell-paint), `monomeArcgridcombo.ts` (step-seq), `lichtspielOpus.ts` (the hero).

## Don't

- **Don't simplify the visuals or shrink the variant space.** (The lesson from the
  first pass: a "concept-adapt freely, fidelity not the priority" instruction lost
  exactly what makes the sketches good. Port *faithfully*.)
- **Don't hardcode hardware dimensions in a sketch** — declare logical idioms and
  let them fold.
- **Don't depend on a windchime package** — borrow concepts into fresh files with
  a provenance header (per `AGENTS.md`).

## Verify

`pnpm smoke:p5` runs the structural template smoke + the headless **idioms-smoke**
(`scripts/idioms-smoke.ts`, via tsx): instantiates every idiom under a Grid 64/Arc
2 AND a Grid 128/Arc 4 profile, fires synthetic events, and asserts `values()`
change, correctly-sized/lit frames, push-gating, compose-overlap, **and the
folding** (arc presses cycle; faderBank columns fold). Keep it green — it's the
proof the underlying representation adapts without a browser or hardware.

## Remaining

Faithfully re-port the six still on their first-pass simplified versions:
`upfAvTest`, `monomeArc4Shapes`, `itoBox` (fader-bank + arcMacros),
`monomeArcgridcombo`, `parquetDeformation`, `pasHalloween` (step-seq + arcMacros).
`itoBox` needs an `arcMacros` **velocity mode** (encoder delta → damped angular
velocity) for its roulette physics. Then add the deferred smoke check that every
`idioms`-declaring template also declares a `gestural` dictionary.
