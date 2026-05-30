# Concept

**Lichtspiel is a Max for Live audiovisual composition assistant** that
understands Ableton clips, scenes, MIDI/audio structure, device macros, and
performance state, then proposes and morphs p5.js visual code-scenes that are
played tactilely with monome grid + arc.

It is built for the Ableton Hackathon (Boston, June 2026) as a **Live-native
instrument**, not an installation pipeline. The future module name is `umwelt`
(environment-aware visual ecology, evolving visual memory, corpus-aware code
mutation).

## The four pillars

1. **Session-aware** — reads the Live Object Model, not just an audio envelope.
2. **Semantic** — maps music/session descriptors to visual *states* (retrieve,
   don't just modulate).
3. **Code-generative** — p5 template retrieval → template mutation → constrained
   code generation (staged; codegen is dev-mode + human-approved only).
4. **Tactile** — monome is the instrument for navigating latent/semantic visual
   space: select, lock, morph, and pick "near" or "far" correspondences.

## What it is *not* (first build)

No ASR, no spoken prompts, no full CLAP pipeline, no Strudel, no TouchDesigner
dependency, no video-clip playback, no runtime LLM codegen without validation,
no model training, no custom Max external unless unavoidable. These are
backlog/stretch directions (see `ROADMAP.md`).

See `README.md` for the demo story and `competitive_positioning.md` for the
wedge against existing Ableton-visual tools.
