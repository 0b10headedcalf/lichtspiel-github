"""Audio → "vibe" descriptor (G1 Discovery, the audio path).

Pipeline: an exported audio clip → CLAP zero-shot tags (mood / genre / energy /
texture) + librosa MIR (tempo / key / brightness) → a short natural-language
"vibe" string + a structured tag dict. The vibe feeds codegen.py (the LLM brief).

All heavy deps (torch / transformers / librosa) are imported LAZILY so the base
ml-service stays stdlib-only and installable; if a dep is missing we degrade
(CLAP missing → MIR-only vibe; everything missing → a tempo-less stub) instead
of crashing. CLAP = transformers ClapModel (laion/larger_clap_general), weights
cached under the HF hub.

See docs/generative-architecture.md (CLAP = LAION-CLAP, MIR = librosa).
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any

# ── The vibe vocabulary ────────────────────────────────────────────────────
#
# CLAP scores the audio against each phrase in each category and keeps the
# top-scoring ones. This list literally defines what "vibe" the system can
# perceive — words not here can never be detected. Phrases work better than bare
# words for CLAP ("a dark brooding atmosphere" > "dark"), and the model was
# trained on captions, so write them like a human describing the track.
#
# Tuned for electronic/live-set material. Phrases (not bare words) score better
# with CLAP. Refine toward the genres you actually play — words not here can
# never be detected.
VIBE_VOCAB: dict[str, list[str]] = {
    "mood": [
        "a dark, brooding, ominous atmosphere",
        "an uplifting, euphoric, joyful feeling",
        "a calm, peaceful, meditative mood",
        "a tense, anxious, suspenseful energy",
        "a dreamy, nostalgic, melancholic haze",
        "a playful, quirky, lighthearted bounce",
        "an aggressive, intense, hard-hitting drive",
    ],
    "genre": [
        "driving techno",
        "ambient drone",
        "deep house groove",
        "glitchy IDM",
        "cinematic orchestral score",
        "lo-fi hip hop beat",
        "drum and bass breakbeat",
        "synthwave retro arpeggios",
    ],
    "energy": [
        "high-energy and frenetic",
        "mid-tempo and steady",
        "low-energy and sparse",
    ],
    "texture": [
        "warm and analog",
        "cold and metallic",
        "soft and organic",
        "harsh and distorted",
        "clean and crystalline",
        "gritty and lo-fi",
    ],
}

# How many top phrases to keep per category in the structured tags.
TOP_K_PER_CATEGORY = 2


@dataclass
class Vibe:
    """The musical-context result handed to codegen."""

    # Natural-language summary, the LLM's primary conditioning signal.
    text: str
    # Top CLAP phrases per category, e.g. {"mood": ["dark...", ...], ...}.
    tags: dict[str, list[str]] = field(default_factory=dict)
    # MIR scalars from librosa (tempo, key, scale, brightness 0..1, rms 0..1).
    features: dict[str, Any] = field(default_factory=dict)
    # Which analyzers actually ran (for honest UI / debugging).
    sources: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ── MIR (librosa) ───────────────────────────────────────────────────────────

_PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _mir_features(audio_path: str) -> dict[str, Any]:
    """Tempo / key / brightness / loudness via librosa. {} if librosa absent."""
    try:
        import librosa  # type: ignore
        import numpy as np  # type: ignore
    except ImportError:
        return {}

    y, sr = librosa.load(audio_path, sr=None, mono=True)
    if y.size == 0:
        return {}

    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
    key_idx = int(np.argmax(chroma))
    # crude major/minor guess: relative-minor third energy vs the tonic
    scale = "minor" if chroma[(key_idx + 3) % 12] > chroma[(key_idx + 4) % 12] else "major"
    centroid = float(librosa.feature.spectral_centroid(y=y, sr=sr).mean())
    rms = float(librosa.feature.rms(y=y).mean())

    return {
        "tempo": round(float(tempo), 1),
        "key": _PITCH_CLASSES[key_idx],
        "scale": scale,
        # normalize centroid (Hz) to a rough 0..1 "brightness"; sr/2 = Nyquist
        "brightness": round(min(1.0, centroid / (sr / 2)), 3),
        "rms": round(min(1.0, rms * 4.0), 3),
    }


# ── CLAP zero-shot tags ──────────────────────────────────────────────────────
#
# Backend: transformers' ClapModel (default `laion/larger_clap_general`, already
# cached under the HF hub) rather than the `laion_clap` package — laion_clap
# doesn't declare torch, downloads a separate ~2 GB .pt checkpoint on first use,
# and drags a fragile dep tree (torchlibrosa/webdataset/numpy<2 pins). The
# transformers route reuses the cached weights and the deps we install anyway.

# CLAP audio towers are trained on 48 kHz input.
_CLAP_SR = 48000
# Override via env to try other CLAP variants (e.g. laion/clap-htsat-unfused).
_CLAP_MODEL_ENV = "LICHTSPIEL_CLAP_MODEL"
_CLAP_MODEL_DEFAULT = "laion/larger_clap_general"

_clap = None  # module-level (model, processor) cache; loading the weights is slow


def _load_clap():
    global _clap
    if _clap is not None:
        return _clap
    try:
        import os

        from transformers import ClapModel, ClapProcessor  # type: ignore
    except ImportError:
        return None
    name = os.environ.get(_CLAP_MODEL_ENV, _CLAP_MODEL_DEFAULT)
    model = ClapModel.from_pretrained(name)
    model.eval()
    processor = ClapProcessor.from_pretrained(name)
    _clap = (model, processor)
    return _clap


def _clap_tags(audio_path: str) -> dict[str, list[str]]:
    """Zero-shot top phrases per VIBE_VOCAB category. {} if CLAP/torch absent."""
    loaded = _load_clap()
    if loaded is None:
        return {}
    try:
        import librosa  # type: ignore
        import numpy as np  # type: ignore
        import torch  # type: ignore
    except ImportError:
        return {}
    model, processor = loaded

    y, _ = librosa.load(audio_path, sr=_CLAP_SR, mono=True)
    if y.size == 0:
        return {}

    # transformers v5 returns a ModelOutput (joint 512-d embedding in
    # .pooler_output); v4 returned the projected tensor directly.
    def _embeds(out):  # noqa: ANN001, ANN202 - transformers version shim
        return out.pooler_output if hasattr(out, "pooler_output") else out

    with torch.no_grad():
        audio_in = processor(audio=[y], sampling_rate=_CLAP_SR, return_tensors="pt")
        audio_emb = _embeds(model.get_audio_features(**audio_in))[0].cpu().numpy()  # (D,)

        tags: dict[str, list[str]] = {}
        for category, phrases in VIBE_VOCAB.items():
            text_in = processor(text=phrases, return_tensors="pt", padding=True)
            text_emb = _embeds(model.get_text_features(**text_in)).cpu().numpy()  # (N, D)
            # cosine similarity (embeddings are ~unit-norm but normalize to be safe)
            a = audio_emb / (np.linalg.norm(audio_emb) + 1e-9)
            t = text_emb / (np.linalg.norm(text_emb, axis=1, keepdims=True) + 1e-9)
            scores = t @ a
            order = np.argsort(scores)[::-1][:TOP_K_PER_CATEGORY]
            tags[category] = [phrases[i] for i in order]
    return tags


# ── Vibe text assembly ───────────────────────────────────────────────────────


def _describe(tags: dict[str, list[str]], feats: dict[str, Any]) -> str:
    """Compose the human-readable vibe sentence from tags + MIR features."""
    parts: list[str] = []
    if tags.get("mood"):
        parts.append(tags["mood"][0])
    if tags.get("genre"):
        parts.append(f"leaning {tags['genre'][0]}")
    if tags.get("texture"):
        parts.append(tags["texture"][0])
    if feats.get("tempo"):
        parts.append(f"around {feats['tempo']:.0f} BPM")
    if feats.get("key"):
        parts.append(f"in {feats['key']} {feats.get('scale', '')}".strip())
    if tags.get("energy"):
        parts.append(tags["energy"][0])
    if not parts:
        return "an unknown musical vibe (no analyzers available)"
    return ", ".join(parts)


def describe_audio(audio_path: str) -> Vibe:
    """Run the full audio → vibe pipeline. Degrades gracefully per missing dep."""
    feats = _mir_features(audio_path)
    tags = _clap_tags(audio_path)
    sources = []
    if feats:
        sources.append("librosa")
    if tags:
        sources.append("clap")
    return Vibe(text=_describe(tags, feats), tags=tags, features=feats, sources=sources)


def describe_text(prompt: str) -> Vibe:
    """A vibe synthesized straight from a natural-language prompt (the "Dream"
    path — no audio, no CLAP). The prompt IS the conditioning text; codegen's
    USER DIRECTION line reinforces it. No tags/features, so the brief leans
    entirely on the user's words."""
    return Vibe(text=prompt.strip(), tags={}, features={}, sources=["prompt"])
