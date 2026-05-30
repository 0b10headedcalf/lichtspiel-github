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
export PYTHONPATH=src
python -m lichtspiel_ml.app          # http://127.0.0.1:7892

# try it:
curl localhost:7892/health
curl -s localhost:7892/retrieve -d '{"selection":{"clipName":"hard drums beat"},"transport":{"tempo":145}}'
```

## Test

```bash
cd apps/ml-service
PYTHONPATH=src python -m unittest discover -s tests
```
