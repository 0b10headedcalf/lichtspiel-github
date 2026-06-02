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

**2. Hardware smaller → FOLD ("coupling"), for "similar reactivity".**
The core adaptation methodology: when there are fewer physical controls, **couple**
logical controls onto them — never drop controllability. Every logical control stays
*reachable*, distributed across the fewer physical ones. This is symmetric across
grid and arc:
- **`faderBank` grid-folding** (`spread:false`, lanes > cols) — physical column
  `x` drives logical lanes `{x, x+cols, x+2cols, …}`, all set together. All lanes
  reachable, in pairs. *(e.g. 16 fader lanes on a Grid 64: cols 0–3 → objects 0+2's
  X/Y/Z/osc, cols 4–7 → 1+3.)*
- **`arcMacros` turn-coupling** (default `fold:'couple'`) — the analogue for the arc:
  physical encoder `p` drives logical encoders `{p, p+P, p+2P, …}` **together on
  turn**, so a 4-object sketch's every object still responds to rotation on an Arc 2
  (enc0 → obj0+obj2 size, enc1 → obj1+obj3). The PRESS folds via `coupledPress`:
  `'cycle'` (default — each press steps through the covered actions, e.g. regenerate
  obj0 then obj2) or `'all'` (every covered action fires, e.g. stop both). The ring
  shows the primary logical (`p`); held-boost is per physical encoder.
- **`arcMacros` paging** (`fold:'page'`) — for encoders that are *distinct axes* that
  shouldn't be averaged (itoBox yaw/pitch/roll/zoom). The P physical encoders cover
  one PAGE of logical at a time; a **chord** (press one encoder while another is held)
  flips to the next page. Single presses fire **on press** (reliable even when the
  Arc 2's best-effort push drops a release) — so on a chord the first press fires its
  action and the second is the flip; a turn clears a stale held flag so a dropped
  release can't cause a spurious flip. All logical reachable across pages; turn +
  press + ring follow the current page. Composes with velocity mode. The panel shows
  the active page ("ENCODER PAGE 1 / 2"), updated live on a flip.
- **Pick coupling vs paging** by whether the logical encoders are *homogeneous*
  (sizes/spins/alphas → couple) or *distinct essential axes* (→ page). When the GRID
  is the primary control and the arc is secondary tweaks with good defaults, plain
  coupling is plenty (that's why `parquetDeformation` adapted so cleanly).

**Notched LEDs.** Use `led:'fillNotched'` (not `'fill'`) for absolute-value knobs:
it keeps dim every-8th orientation notches in the un-lit region, so a ring reads as a
marked dial you fill toward rather than blank-until-max (the look the hero's arc LEDs
established). `comet`/`playhead`/the phase-comets already carry their own marks.

**3. Wider hardware → EXTENDED controls ("adapt up"), the mirror of folding.**
A sketch NATIVE to *small* hardware (the Opus III hero is Grid 64 / Arc 2) gets more
expressive on a bigger device by declaring **bonus** controls that light up only when
there's room — never a scene-switch, never coupled into the native pair:
- **`faderBank` `extendedLanes`** — bind to the columns just past the native block
  (a Grid 128's cols 8–15 become 8 more faders of the SAME sketch).
- **`arcMacros` `extendedEncoders`** — bind to the physical encoders past the native
  count (an Arc 4's enc 2–3 become 2 more knobs).

Extended controls are **dormant at a neutral default** when there's no room — so the
Grid 64 / Arc 2 build is *byte-identical* — and on an Arc 2 they never couple into the
native pair (clean twist + aperture; the extended orbit/grain stay asleep). Each
extended control's `initial` MUST reproduce the sketch's base look (it's the value read
when dormant). `describe()` marks them `· extended` so the gestural panel surfaces them
on the bigger rig. *(With `spread:true`, lanes still lay into multi-column panels.)*

**Pick fold-down vs extend-up by the sketch's NATIVE size.** Authored for BIG hardware
→ its many controls FOLD down (couple/page) so nothing's lost on a small device (point
2). Authored for SMALL hardware → it adds EXTENDED controls that appear on a big device
(point 3). A control that must always be reachable is *native*; bonus expressivity is
*extended*. Both directions live **entirely in the idiom layer**, so every sketch —
current and future — inherits them. **A 64/2-native sketch just lists `extendedLanes` /
`extendedEncoders`; you never write a per-hardware branch or steal the grid for nav.**

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
  sketch declares a static control map (name + summary + grid/arc `area · action ·
  effect`). The on-screen **gestural panel** (`h`; collapsed-by-default, LEFT gutter
  below the HUD, clear of the bottom-right twin) prefers a LIVE, hardware-accurate
  map (`VisualSketch.controlMap` → the composed idiom's `describe(profile)`) — so it
  shows the *connected* device ("▶ Grid 64 · Arc 2") + the coupling ("enc 0 → size
  obj 0 + 2 · coupled") and re-renders on a hot-swap. Give each idiom spec a `label`
  (+ arc `pressLabel`) so the live entries read well.

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
   changes. Give specs `label`/`pressLabel`; use `led:'fillNotched'` for value knobs;
   pick `fold:'couple'` (homogeneous) vs `fold:'page'` (distinct axes). **Never
   hardcode 16×8 / 4×64 — the idioms adapt.**
5. Expose `controlMap: (setup) => idioms.describe(profileFromSetup(setup))` so the
   panel matches the hardware. Declare `hardwareTarget` + `idioms` + `gestural`;
   one self-contained file.

**Reference templates:** `pasArcgrid.ts` (fader-bank), `patternGridWorld.ts`
(cell-paint), `monomeArcgridcombo.ts` (step-seq), `lichtspielOpus.ts` (the hero).

## Don't

- **Don't simplify the visuals or shrink the variant space.** (The lesson from the
  first pass: a "concept-adapt freely, fidelity not the priority" instruction lost
  exactly what makes the sketches good. Port *faithfully*.)
- **Don't hardcode hardware dimensions in a sketch** — declare logical idioms and
  let them fold.
- **Don't leave a control unreachable on smaller hardware** — that's what coupling
  is for. If turning an encoder leaves some objects frozen, you skipped the fold.
- **Don't steal the sketch's grid/encoders for scene-nav on bigger hardware.** A
  64/2-native sketch's spare cols/encoders on a Grid 128 / Arc 4 are for MORE of the
  SAME sketch — declare `extendedLanes` / `extendedEncoders` (each with a neutral
  `initial`), never route them to `selectScene`. Scene nav lives on the keyboard /
  Ableton. (And don't let extended controls couple into the native pair on small hw.)
- **Don't rewrite a native-hardware sketch — make VARIANTS.** When a sketch's
  original hardware matches the connected device (e.g. the Opus III hero on its
  native Grid 64/Arc 2), port it *faithfully* then layer windchime-style variants.
  A simplified rewrite throws away crafted fidelity + control; only the structural
  variant axes should differ from the original.
- **Don't depend on a windchime package** — borrow concepts into fresh files with
  a provenance header (per `AGENTS.md`).

## Verify

`pnpm smoke:p5` runs the structural template smoke + the headless **idioms-smoke**
(`scripts/idioms-smoke.ts`, via tsx): instantiates every idiom under a Grid 64/Arc
2 AND a Grid 128/Arc 4 profile, fires synthetic events, and asserts `values()`
change, correctly-sized/lit frames, push-gating, compose-overlap, **the folding**
(arc turn-coupling + press cycle/all + paging chord; faderBank columns fold), **the
adapt-up** (`extendedLanes` bind a Grid 128's cols 8–15 + `extendedEncoders` an Arc 4's
enc 2–3, both dormant + uncoupled on the small rig), the `fillNotched` ring, and the
live `describe()` control map (**93 checks**). Keep it green — it's the proof the
underlying representation adapts without a browser or hardware.

## Status + future

All 8 windchime families + the native **Opus III hero** (`lichtspielOpus`) are
faithfully ported. The hero's WEBGL re-port + 60fps tube + the **adapt-up** extended
controls are **user-verified on real hardware, both directions**: Grid 128 / Arc 4
expands to 16 faders + 4 encoders, and hot-swapping back to Grid 64 / Arc 2 collapses
to the native 8 + 2, byte-identical.

**Future — close the recursion (a note, not yet built).** Adapt-up currently leaves a
64/2-native sketch's extended controls *dormant* on the small rig. The loop closes by
letting the **same fold/page machinery** (point 2) collapse the FULL set — native +
extended (e.g. the hero's 16 faders + 4 encoders) — back onto a Grid 64 / Arc 2, so the
performer can reach the extras there too via coupling / a page or shift, instead of them
sleeping. Expansion (small → big) then folding (big → small) compose into one round
trip: any sketch, authored for any device, fully playable on any other.
