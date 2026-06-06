# Generative architecture — "Discovery → Generate" (planned)

> **Status: PLANNED (2026-06-05), not yet built. Execute in a fresh context.** This is the durable
> repo reference for the generative track. The full phased plan + the exact handoff live in
> `~/.claude/plans/snug-nibbling-quail.md` ("GENERATIVE TRACK"); the research basis is `context_docs/`
> (the `lichtspiel_agentic_coding_spec.md` Phases 8–9 + the deep-research markdowns) plus a 2026-06-05
> web-research pass. This **supersedes the latency track** as the next direction (latency is deprioritized).

## Vision
A UI **"Generate"** function that synthesizes NEW, musically-informed p5 **idioms** (a visual template +
its monome controls + a saveable preset), conditioned on the music. Two features:

- **Discovery — "learn the set":** a background pass that builds a persisted **"musical mental model"** of
  the set (v1: a master render; later: locator-bounded sections / scenes / clips) and notifies when done.
- **Generate:** that mental model (+ a text prompt OR "surprise") conditions an LLM that writes a new idiom
  on a **mutation ↔ novel divergence spectrum**; validated → loaded into the running app → saved as a preset.

## Locked decisions (user, 2026-06-05)
- **Generator = LLM codegen (Claude API), build-time only**, conditioned by an audio encoder. There is no
  pretrained model that emits p5 from audio (JEPA / CAV-MAE / CLAP are *encoders*, not generators); the
  project's own research warned against training an audio→code model.
- **Audio capture = both** loopback (BlackHole, automatic/background) **and** manual export-to-watched-folder
  (fallback). Ableton's Export is GUI-only / not scriptable; the LOM + AbletonOSC do **not** expose render.
- **"Musically informed" = style-conditioned at generation** (via the Discovery mental model) — *not* live
  audio-reactivity. The generated idiom performs on the existing param + live-tempo + monome controls.
- **Scope = a divergence spectrum** (mutation ↔ novel), **POC-first**. The POC conditions on
  **metadata + MIDI first** (data we already extract), then adds the CLAP/audio Discovery.
- **Runtime purity preserved** (AGENTS.md): generation is an **authoring** action. The performance runtime
  never calls an LLM / CLAP / network — it runs the validated, deterministic template (`seededRng` + monome).

## Chosen stack (reliable, well-maintained, Apple-Silicon)
| Layer | Choice | Notes |
|------|--------|-------|
| Audio embedding + zero-shot tags | **CLAP** (LAION-CLAP `laion_clap` or HF `transformers` CLAP) | MIT · ~600 MB · CPU/MPS · ~200 ms/clip |
| MIR features | **librosa** | ISC · tempo/beat/chroma/key/onset/spectral/RMS/HPSS |
| Music caption (optional) | **LP-MusicCaps** | MIT · natural-language "describe this music" |
| Loopback capture | **BlackHole** + `sounddevice` + `ffmpeg` | free/GPL · one-time Multi-Output Device setup |
| Code generation | **Claude** (`@anthropic-ai/sdk`, structured outputs) | build-time only; few-shot from our templates |
| Validation | **tsc** (strict) · **ESLint/@typescript-eslint** allowlist · **Playwright** headless smoke | + 2–3-pass self-repair loop |

Avoid: Essentia (AGPL), Madmom (slow TF on Mac), MS-CLAP (archived), Qwen-Audio-7B (too heavy for v1).

## Architecture (preserves the Max / Node / Python / p5 split)
```
Discovery:  p5 "Discover" → bridge → background job
              ├─ audio: BlackHole loopback (timed to scope)  OR  manual export → watched folder
              └─ Python ml-service: CLAP + librosa (+ caption) → musical-context JSON
                   ↳ persisted, keyed by the set structural fingerprint (reuse signatureOf; dedup)
                   ↳ WS progress + "done" notify

Generate:   brief = musical-context (or metadata+MIDI for POC) + prompt/surprise + divergence
                   + nearest-exemplar (CLAP-tag match to the tagged corpus)
              → Node generator: Claude structured-output codegen vs the template DSL
              → validate (tsc · eslint allowlist · Playwright smoke) + self-repair (2–3 passes)
              → load into the app → preview → accept → save preset
                   • low divergence  = param/submodule MUTATION (reuse the variant system)
                   • high divergence = NOVEL template
```
- **Python `ml-service`** owns audio analysis (CLAP/librosa/caption). **Node** owns orchestration +
  codegen + validation. **p5** owns rendering + the Discover/Generate UI. The **bridge** carries job
  progress + results over WS. `ANTHROPIC_API_KEY` is a build-time/authoring secret — never read at runtime.

## Contracts a generated idiom must satisfy
- **`VisualTemplate` + `VisualSketch`** (`apps/p5-runtime/src/visualTemplate.ts`): meta
  (`id/name/family/tags/defaultParams/renderer/idioms?/gestural?/hardwareTarget?`) + `create(ctx)` →
  `{ setup, update, draw, onGridKey?, onArcDelta?, onArcKey?, renderGrid?, renderArc?, controlMap?,
  setProfile?, dispose? }`. Only the 16-key **`VisualParamVector`** (`packages/schemas/src/visualParams.ts`)
  — no new fields. Browser-only, no `eval`/network.
- **Idiom layer** (`apps/p5-runtime/src/idioms/`): `composeIdioms([...])` of the built-ins
  (`faderBank`/`stepSequencer`/`cellPaint`/`arcMacros`); declare `idioms:[]` + ship `gestural:{}`
  (a smoke gate). Capability-folding (grid/arc adapt) is inherited.
- **Variants** (`apps/p5-runtime/src/mutations/familyVariants.ts` + `packages/schemas/src/variants.ts`):
  `makeVariantFactory(axes)`; `VariantRecord{templateId,seed,divergence,params}` is the lightweight
  **preset** for the mutation end.
- **Register / gate** for a committed novel template: `templateRegistry.ts` + `templates/index.ts` +
  `packages/visual-corpus/manifests/{templates,descriptors}.json` + `scripts/smoke.mjs` + `idioms-smoke.ts`.

## Persistence / provenance
- **Mutation end →** a `VariantRecord` **preset** (gitignored `config/`, reuses the variant browser +
  the Part-1 preset UI).
- **Novel end →** a generated `.ts` template in a **gitignored** `apps/p5-runtime/src/templates/generated/`
  + a local manifest; carries `sourceLineage`/provenance + the brief + seed. **"Promote to corpus"** (commit
  + add to `templates.json`/`index.ts`) is a deliberate human-curation step (Phase 9's human approval).

## Phases (POC-first)
- **G0 — POC (offline, no UI):** metadata+MIDI brief → Claude codegen one template → validate (+self-repair)
  → load manually. Proves generate → validate → load. No audio yet.
- **G1 — Discovery:** "Discover" button → background job → master audio (loopback + manual fallback) →
  CLAP + librosa (+ caption) → persisted musical-context JSON (dedup by fingerprint) → WS progress + notify.
- **G2 — Generate (mutation end):** divergence-low → CLAP-match → nearest template + mutation → preset.
- **G3 — Generate (novel end):** divergence-high → novel codegen + full validation/self-repair → preview →
  accept → preset/template + provenance. UI: prompt + surprise + divergence + status.
- **G4 — Per-section discovery + scoped generation:** locator-bounded / scene / clip capture (the harder
  part; deferred).

## New deps / setup
- **Python:** torch, `laion-clap`|`transformers`, librosa, soundfile, sounddevice (+ optional LP-MusicCaps,
  torchaudio); `ffmpeg`. **macOS one-time:** BlackHole 2ch + a Multi-Output Device.
- **Node:** `@anthropic-ai/sdk`, eslint + `@typescript-eslint`, `playwright` (+ browsers).
- **Secrets:** `ANTHROPIC_API_KEY` (build-time only).

## Honest notes / risks
- LLM-generated p5 ≈ 60–85% first-pass, ~90%+ after 2–3 self-repair passes → the validation gates + a human
  accept step are mandatory. Cache by prompt-hash + seed for cost/reproducibility.
- Loopback needs the one-time BlackHole setup + real-time playback (no faster-than-real-time render);
  manual export is the always-works fallback.
- The cloud LLM is a build-time dependency + cost — acceptable under the runtime-purity split (authoring only).
