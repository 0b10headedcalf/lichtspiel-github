"""Audio descriptor + embedding extraction (Phases 6–7).

Phase 7 uses Stable Audio 3's **SAME** autoencoder (Semantic-Acoustic Music
Encoder) as a pretrained music-audio embedder: ``embed_audio(path)`` encodes a
clip to a 256-d semantic vector (mean-pooled latents, L2-normalized) suitable
for cosine retrieval against the scene anchors.

The heavy deps (numpy + torch + ``stable_audio_3``) are **optional**. They live
in the ``embed`` extra; if they're not installed, every entry point here returns
``None`` and the service stays in metadata mode. This honors AGENTS.md — the
runtime must degrade gracefully and never hard-depend on a model.
"""

from __future__ import annotations

import os
import threading
from typing import Any

# ── optional heavy deps (the `embed` extra) ────────────────────────────────
try:
    import numpy as np
    import torch
    import torchaudio
    from stable_audio_3 import AutoencoderModel

    _HAVE_SA3 = True
    _IMPORT_ERROR = ""
except Exception as err:  # ImportError or a partial/broken install
    _HAVE_SA3 = False
    _IMPORT_ERROR = repr(err)

# `same-s` is the lightweight CPU / Apple-Silicon SAME variant (latent_dim 256).
# Override with LICHTSPIEL_SAME_MODEL (e.g. "same-l" on a CUDA box).
_SAME_MODEL = os.environ.get("LICHTSPIEL_SAME_MODEL", "same-s")
EMBED_DIM = 256

_ae = None
_ae_lock = threading.Lock()


def embedding_available() -> bool:
    """True when numpy + torch + stable_audio_3 imported (the embed extra is in)."""
    return _HAVE_SA3


def import_error() -> str:
    """Repr of the import failure when the embed extra is missing (else '')."""
    return _IMPORT_ERROR


def _get_autoencoder():
    """Lazily load the SAME autoencoder once (thread-safe singleton)."""
    global _ae
    if _ae is None:
        with _ae_lock:
            if _ae is None:
                _ae = AutoencoderModel.from_pretrained(_SAME_MODEL)
    return _ae


def encode_waveform(waveform, sr: int):
    """Encode a (C, T) waveform tensor → L2-normalized float32 ``(256,)``.

    Shared with the anchor builder so generated and live audio land in the same
    embedding space. Raises if the embed deps are absent — guard with
    ``embedding_available()`` first.
    """
    ae = _get_autoencoder()
    latents = ae.encode(waveform, sr)  # (1, 256, latent_time)
    pooled = latents.mean(dim=-1).squeeze(0)  # (256,) — mean over time
    vec = pooled.detach().to(torch.float32).cpu().numpy()
    norm = float(np.linalg.norm(vec))
    if norm > 0.0:
        vec = vec / norm
    return vec.astype(np.float32)


def embed_audio(audio_file_path: str):
    """Return a 256-d semantic embedding for an audio file, or ``None``.

    ``None`` when the embed deps are absent or the file can't be read/encoded —
    the caller then falls back to metadata-only retrieval.
    """
    if not _HAVE_SA3:
        return None
    try:
        waveform, sr = torchaudio.load(audio_file_path)  # (C, T), int sr
        return encode_waveform(waveform, int(sr))
    except Exception:
        return None


def audio_descriptors(audio_file_path: str) -> dict[str, Any]:  # noqa: ARG001
    """Phase 6 — lightweight MIR descriptors (RMS, onset density, centroid, chroma)."""
    raise NotImplementedError("audio descriptors — Phase 6")
