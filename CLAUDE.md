# CLAUDE.md — Lichtspiel

Live-native AV composition assistant: Ableton Live + Max for Live → Node bridge →
p5.js visuals, played with monome grid + arc. Borrows-not-forks from
windchime-animation (`/Users/trent/windchime-animation`). See `README.md`,
`AGENTS.md` (build rules), `ROADMAP.md` (phased plan + live status), `docs/`.

## Current state (2026-06-01)

- **Phases 0–4 done + hardware-verified.** Phase 3 (Max device) done; Phase 4
  (monome) done across all 4 devices + continuous hot-swap.
- **Phase 4.5 in progress — the active plan.** Full approved plan:
  `~/.claude/plans/delegated-foraging-cookie.md`.
  - **Part 1 (hardware foundation) ✅ done** — caps fixes, authoritative
    `monomeDevices`, auto-snap/grey-out, reliable detach, LED diffing, self-healing
    serialosc auto-recovery. See `apps/live-bridge/src/serialosc.ts`,
    `apps/p5-runtime/src/{monomeDevices,ui/monomeTwin,main}.ts`,
    `packages/schemas/src/monomeProfiles.ts`.
  - **Part 2 (idiom library) + Part 3 (corpus adaptation + variants) ⬜ NEXT.**
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
