#!/usr/bin/env python3
"""Build SAME scene anchors for Phase 7 embedding retrieval.

For each visual-scene descriptor, synthesize a representative clip from its
keywords with Stable Audio 3 (``small-music``, CPU-friendly, deterministic
seed), embed it with the SAME autoencoder (the same ``encode_waveform`` the live
retrieval path uses), and write a per-scene anchor vector to
``packages/visual-corpus/manifests/anchors.json``.

This is a **build-time, offline** step — it needs the ``embed`` extra (torch +
stable_audio_3) and a one-time HuggingFace weight download. It is intentionally
kept out of the commit gate; the resulting ``anchors.json`` is the committed
artifact the runtime consumes.

Run (from apps/ml-service):

    python scripts/build_anchors.py                 # all scenes, defaults
    python scripts/build_anchors.py --duration 12 --save-audio /tmp/anchors

Determinism: fixed seed (default 0) and CPU generation. Re-running reproduces
the same anchors.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

# Make `lichtspiel_ml` importable when run directly (scripts/ is a sibling of src/).
_ML_SERVICE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ML_SERVICE / "src"))

from lichtspiel_ml import embed_audio  # noqa: E402

_REPO_ROOT = Path(__file__).resolve().parents[3]
_MANIFESTS = _REPO_ROOT / "packages" / "visual-corpus" / "manifests"
_DESCRIPTORS_PATH = _MANIFESTS / "descriptors.json"
_ANCHORS_PATH = _MANIFESTS / "anchors.json"


def build_prompt(descriptor: dict) -> str:
    """Compose a text-to-audio prompt for a scene.

    Prefers an explicit ``anchorPrompt`` field on the descriptor (so a scene can
    override the auto prompt); otherwise joins its keywords.
    """
    explicit = descriptor.get("anchorPrompt")
    if explicit:
        return str(explicit)
    keywords = descriptor.get("keywords", [])
    return ", ".join(keywords) if keywords else descriptor["sceneId"]


def main() -> int:
    ap = argparse.ArgumentParser(description="Build SAME scene anchors (Phase 7).")
    ap.add_argument("--generator", default="small-music", help="SA3 text-to-audio model (CPU-friendly: small-music).")
    ap.add_argument("--duration", type=float, default=10.0, help="Seconds of audio to synthesize per scene.")
    ap.add_argument("--steps", type=int, default=8, help="Diffusion steps.")
    ap.add_argument("--seed", type=int, default=0, help="Fixed seed for reproducibility.")
    ap.add_argument("--descriptors", type=Path, default=_DESCRIPTORS_PATH)
    ap.add_argument("--out", type=Path, default=_ANCHORS_PATH)
    ap.add_argument("--save-audio", type=Path, default=None, help="Optional dir to also write the generated WAVs.")
    args = ap.parse_args()

    if not embed_audio.embedding_available():
        print(
            "ERROR: the embed extra is not installed "
            f"({embed_audio.import_error()}).\n"
            "Install it first:  uv pip install -e '.[embed]'  (or pip install -e <stable-audio-3>)",
            file=sys.stderr,
        )
        return 2

    # Heavy imports only after the availability check.
    import torch  # noqa: F401
    import torchaudio
    from stable_audio_3 import StableAudioModel

    descriptors = json.loads(args.descriptors.read_text(encoding="utf-8"))["descriptors"]
    encoder_model = embed_audio._SAME_MODEL  # the SAME variant encode_waveform will use

    print(f"[anchors] generator={args.generator} encoder={encoder_model} "
          f"duration={args.duration}s steps={args.steps} seed={args.seed}")
    gen = StableAudioModel.from_pretrained(args.generator)
    sr = int(gen.model.sample_rate)

    if args.save_audio:
        args.save_audio.mkdir(parents=True, exist_ok=True)

    anchors: dict[str, list[float]] = {}
    prompts: dict[str, str] = {}
    for d in descriptors:
        scene = d["sceneId"]
        prompt = build_prompt(d)
        prompts[scene] = prompt
        print(f"[anchors] {scene}: generating … prompt={prompt!r}")
        audio = gen.generate(prompt=prompt, duration=args.duration, steps=args.steps, seed=args.seed)
        wav = audio[0].detach().cpu()  # (C, T)

        if args.save_audio:
            out_wav = args.save_audio / f"{scene}.wav"
            torchaudio.save(str(out_wav), wav, sr)
            print(f"[anchors] {scene}: wrote {out_wav}")

        vec = embed_audio.encode_waveform(wav, sr)  # (256,) L2-normalized
        anchors[scene] = [float(x) for x in vec.tolist()]
        print(f"[anchors] {scene}: embedded dim={len(anchors[scene])}")

    payload = {
        "version": "0.1.0",
        "dim": embed_audio.EMBED_DIM,
        "model": {"generator": args.generator, "encoder": encoder_model},
        "generation": {"duration": args.duration, "steps": args.steps, "seed": args.seed},
        "prompts": prompts,
        "anchors": anchors,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"[anchors] wrote {len(anchors)} anchors → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
