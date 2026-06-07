# @lichtspiel/ml-service

Python retrieval/ML sidecar. The performance runtime never depends on it — if
it's offline the bridge/p5 fall back to manual control. It only ever emits a
`visual_retrieval_result` (scene id + params + alternatives + reason), never code.

## Phases

- **Phase 5 (shipped):** deterministic metadata retrieval (`retrieve.py`) over
  `packages/visual-corpus/manifests/descriptors.json`. Zero heavy deps.
- **Phase 6:** MIDI/audio descriptors (`embed_midi.py`, `embed_audio.py`) feed
  the musical profile.
- **Phase 7:** pretrained embeddings (MERT/MuLan/ImageBind-style) + cache,
  blended with the rule-based score.

## Run

```bash
cd apps/ml-service
python3 -m venv .venv && source .venv/bin/activate    # or: uv venv && source .venv/bin/activate

# Install — pick per feature (pyproject.toml is the requirements source of truth):
pip install -e '.[dev]' anthropic    # base + tests + Dream (prompt → Claude codegen)
pip install -e '.[generate]'         # + Sync (audio → CLAP/librosa vibe; pulls torch, HEAVY)

# Dream/Sync also need ANTHROPIC_API_KEY in the repo-root .env (see .env.example).

export PYTHONPATH=src
python -m lichtspiel_ml.app          # http://127.0.0.1:7892
# (or from the repo root: pnpm dev:ml — expects the .venv above)

# try it:
curl localhost:7892/health
curl -s localhost:7892/retrieve -d '{"selection":{"clipName":"hard drums beat"},"transport":{"tempo":145}}'
```

## Test

```bash
cd apps/ml-service
PYTHONPATH=src python -m unittest discover -s tests
```
