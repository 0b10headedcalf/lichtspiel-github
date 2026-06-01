# CLAUDE.md — Lichtspiel

Live-native AV composition assistant: Ableton Live + Max for Live → Node bridge →
p5.js visuals, played with monome grid + arc. Borrows-not-forks from
windchime-animation (`/Users/trent/windchime-animation`). See `README.md`,
`AGENTS.md` (build rules), `ROADMAP.md` (phased plan + live status), `docs/`.

## Current state (2026-06-01)

- **Phases 0–4 done + hardware-verified.** Phase 3 (Max device) done; Phase 4
  (monome) done across all 4 devices + continuous hot-swap.
- **Phase 4.5 — animation corpus + monome idiom layer (in progress).** Plans:
  `~/.claude/plans/delegated-foraging-cookie.md` (Parts 1–3) +
  `~/.claude/plans/polymorphic-growing-karp.md` (the fidelity rework, active).
  - **Part 1 (hardware foundation) ✅** — caps fixes, authoritative `monomeDevices`,
    auto-snap, reliable detach, LED diffing, self-healing serialosc.
  - **Part 2 (idiom library) ✅** — faderBank / stepSequencer / cellPaint /
    arcMacros + composeIdioms (`apps/p5-runtime/src/idioms/`) + headless idioms-smoke.
  - **Part 3 (corpus + variants) ✅ first pass** — 14 templates, the gestural panel
    + variant browser (`v`/`c`/`,`/`.`, `h`). THEN a **fidelity rework** (the active
    plan): faithfully re-port each windchime family's visual core + full variant
    space + gestural dict, with **capability folding** so 4-encoder / Grid-128
    sketches adapt to Arc 2 / Grid 64. **Calibrated + hardware-verified:
    `lichtspielOpus` (hero), `pasArcgrid`, `patternGridWorld`. Remaining: faithfully
    re-port the other 6** (upfAvTest, monomeArc4Shapes, itoBox, monomeArcgridcombo,
    parquetDeformation, pasHalloween).
- **Before porting/adapting any monome sketch, read `docs/idioms.md`** — the
  idiom layer, the 1:1-or-fold adaptation doctrine, and the porting recipe.
- The cross-chat source of truth is the memory note **`project_lichtspiel.md`**
  (under the windchime project's memory). Read it first.

## Gates (run before every commit)

```
pnpm -r typecheck && pnpm validate:schemas && pnpm smoke:p5 \
  && pnpm --filter @lichtspiel/live-bridge test \
  && pnpm --filter @lichtspiel/live-bridge test:osc \
  && pnpm --filter @lichtspiel/live-bridge test:serialosc \
  && pnpm --filter @lichtspiel/p5-runtime build
```

## Conventions

- pnpm workspaces + TS. Package names `@lichtspiel/*`. Shared contracts in
  `packages/schemas` (browser-safe root; Node loaders at `…/schemas/node`) — never
  duplicate them. Runtime must work browser-only (no Ableton/bridge/ML).
- **Borrow-not-fork** from windchime: fresh Lichtspiel code with a provenance header
  (source path + what changed); no dependency on a windchime package.
- Commit to `main` (solo Codeberg repo, `origin/main`). Co-author trailer on commits.
- Run the dev stack via `pnpm dev:bridge` + `pnpm dev:p5` (Vite :5273, bridge WS
  :7890 / HTTP :7891). The on-screen monome digital twin toggles with `g`.

## Monome hardware (critical, see docs/monome.md)

Two device classes, the app detects + adapts: Grid 64 (`m64_0175`, monobright) /
Arc 2 (`m0000174`), and Grid 128 (`m29496721`, **varibright, no tilt**) / Arc 4
(`m0000007`, **wood-panel FTDI clone, per-encoder push**). The Arc 4 clone is
finicky with serialosc — **never flush unchanged LED frames** (diff per ring/quad),
poll for discovery, and the bridge self-heals stuck enumeration by restarting the
serialosc daemon. Don't regress these.
