# AGENTS.md

You are building **Lichtspiel**, a standalone Ableton Live + Max for Live + p5
audiovisual composition assistant.

Do **not** fork Windchime. You may inspect Windchime / Live Muse code (at
`/Users/trent/windchime-animation` and sibling repos) and adapt selected
visual/control ideas, but the Lichtspiel repos must be standalone — no
dependency on, or copy of, a Windchime package.

Prioritize **working vertical slices** over broad incomplete systems. A first
slice that runs end-to-end (Live state → p5 scene → monome morph, degrading
gracefully when ML/hardware is absent) is worth more than a wide, fragile one.

## Build order

1. p5 runtime with manual scene switching.
2. Max for Live shell that reads basic Live state.
3. Node bridge between Max and p5.
4. Monome grid/arc mapping with LED feedback.
5. Retrieval from metadata/template descriptors.
6. MIDI/audio descriptors.
7. Embeddings.
8. Template mutation.
9. Constrained p5 code generation.

Do **not** begin embeddings until the p5 runtime, bridge, Max state probe, and
monome/keyboard controls work end-to-end.

## Core rules

- Use Max as a **thin shell**. Put complex logic in Node / Python / p5.
- **Never make the runtime depend on an LLM**, MCP server, or internet access.
  Use agentic tools for development, testing, refactoring, and documentation
  only — unless explicitly approved.
- Every visual template must expose a **stable parameter schema**
  (`VisualParamVector`) and must run in **browser-only mode** with no Ableton,
  no bridge, and no ML service.
- The ML/retrieval layer must **never output raw code** at performance time —
  only a scene id + parameter vector + alternatives + a reason string.
- Every generated or mutated p5 template must pass validation (typecheck, lint,
  no-network/no-dangerous-API scan, smoke render, FPS sanity) **before** it is
  available in performance mode. Runtime `eval` of generated code is a
  deliberate dev/"mutation lab" mode only.
- Keep the demo robust: every output of an experimental layer must reduce to a
  safe control message (scene index / param vector / morph target).

## Conventions

- Monorepo, pnpm workspaces. TS packages extend `tsconfig.base.json`.
- Package names: `@lichtspiel/<name>`. Shared types live in
  `packages/schemas`; never duplicate the contracts.
- Hardware/config defaults are in `.env.example` + `config/*.json`; serials
  must be configurable, never hard-coded. Current serials: grid `m64_0175`,
  arc `m0000174`. Treat `m29496721` / `m0000007` as historical only.
- Any file adapted from a Windchime/Processing source must carry a header
  noting the source path and what was changed (see existing template headers).
- Every layer produces readable logs with timestamp, source, target, type,
  payload summary, validation result, and error string.

## Human-in-the-loop

Ask for human input **only** at: milestone boundaries, hardware tests,
Ableton/Max GUI operations, an uninstallable dependency, a scope-changing
design decision, or when generated p5 code has passed automated checks and is
ready for human approval.

Do **not** ask for clarification before doing obvious setup work. Make
reasonable defaults and document them (in the relevant README/ROADMAP).
