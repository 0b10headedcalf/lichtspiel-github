"""Audio descriptor + embedding extraction (Phases 6–7).

Stub. Phase 6: RMS/activity, onset density, spectral centroid, chroma from a
clip's audio file (when the path is accessible). Phase 7: a pretrained
music-audio embedding (MERT/MuLan-style) for semantic retrieval. Everything is
cached (see cache.py); only the selected/playing clip is computed at runtime.
"""

from __future__ import annotations

from typing import Any


def audio_descriptors(audio_file_path: str) -> dict[str, Any]:  # noqa: ARG001
    raise NotImplementedError("audio descriptors — Phase 6")


def embed_audio(audio_file_path: str):  # noqa: ANN201, ARG001
    raise NotImplementedError("audio embedding — Phase 7")
