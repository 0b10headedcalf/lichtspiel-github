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
- **Adapt monome sketches through the idiom layer, faithfully** (see
  `docs/idioms.md`). A sketch declares its control intent as logical idioms
  (`apps/p5-runtime/src/idioms/`: faderBank / stepSequencer / cellPaint /
  arcMacros); the idioms map it **1:1** to matching hardware and **fold** it for
  fewer controls (Arc 2 / Grid 64) so all logical controls stay reachable. When
  porting a windchime/Processing sketch, **preserve the original visual fidelity +
  the full `params.ts` variant space + the gestural dictionary** — do NOT simplify
  it down — and **never hardcode grid size / encoder count in a sketch**; declare
  the idioms and let them adapt.

## Conventions

- Monorepo, pnpm workspaces. TS packages extend `tsconfig.base.json`.
- Package names: `@lichtspiel/<name>`. Shared types live in
  `packages/schemas`; never duplicate the contracts.
- Hardware/config defaults are in `.env.example` + `config/*.json`; serials
  must be configurable, never hard-coded. The user owns **two device classes**
  and the app must **detect which is connected and adapt** sketches + monome
  mappings:
  - **Grid 64** (8×8, `m64_0175`) + **Arc 2** (2 enc, `m0000174`) — primary
    Lichtspiel target; `Lichtspiel_v3` is the idiom master built for it.
  - **Grid 128** (8×16, `m29496721`) + **Arc 4** (4 enc, `m0000007`) — built
    most of the windchime-animation corpus the templates were adapted from.
  None of these are "historical" — support both. Never assume a fixed grid size
  or encoder count; read it from the connected device (`device.attached`).
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
