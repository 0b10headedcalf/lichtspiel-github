"""Embedding/descriptor cache (Phases 6–7).

Stub. Will memoize per-clip descriptors + embeddings keyed by a stable clip
identity (audio file hash or MIDI-content hash) so the demo computes only the
selected/playing clip and never re-infers. Backed by LICHTSPIEL_ML_CACHE_DIR.
"""

from __future__ import annotations

import os
from pathlib import Path

CACHE_DIR = Path(os.environ.get("LICHTSPIEL_ML_CACHE_DIR", "apps/ml-service/.cache"))


def cache_path(key: str) -> Path:
    return CACHE_DIR / f"{key}.json"


def get(key: str):  # noqa: ANN201 - Phase 6/7
    raise NotImplementedError("cache.get — Phase 6/7")


def put(key: str, value) -> None:  # noqa: ANN001 - Phase 6/7
    raise NotImplementedError("cache.put — Phase 6/7")
