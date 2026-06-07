"""Embedding cache (Phases 6–7).

Memoizes per-clip embedding vectors keyed by a stable file identity
(absolute path + mtime + size) so only the selected/playing clip is ever
encoded, and never re-encoded. Vectors are stored as ``.npy`` under
``LICHTSPIEL_ML_CACHE_DIR`` and written atomically (temp + ``os.replace``).

Every operation is best-effort: a miss or any error returns ``None`` / is a
no-op, so retrieval always degrades to "recompute" (or to metadata) and never
crashes on a cache problem.
"""

from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path

try:
    import numpy as np

    _HAVE_NUMPY = True
except Exception:
    _HAVE_NUMPY = False

CACHE_DIR = Path(os.environ.get("LICHTSPIEL_ML_CACHE_DIR", "apps/ml-service/.cache"))


def cache_path(key: str) -> Path:
    return CACHE_DIR / f"{key}.npy"


def file_key(audio_file_path: str):
    """Stable identity for a file from abspath + mtime + size; ``None`` if missing."""
    try:
        st = os.stat(audio_file_path)
    except OSError:
        return None
    raw = f"{os.path.abspath(audio_file_path)}|{int(st.st_mtime)}|{st.st_size}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def get(key: str):
    """Return the cached vector for ``key``, or ``None`` on miss/error."""
    if not _HAVE_NUMPY or not key:
        return None
    p = cache_path(key)
    try:
        if p.exists():
            return np.load(p, allow_pickle=False)
    except Exception:
        return None
    return None


def put(key: str, value) -> None:
    """Cache ``value`` (a numpy array) under ``key``. No-op on any error."""
    if not _HAVE_NUMPY or not key or value is None:
        return
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(CACHE_DIR), suffix=".npy")
        try:
            with os.fdopen(fd, "wb") as f:
                np.save(f, value, allow_pickle=False)
            os.replace(tmp, cache_path(key))
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
    except Exception:
        return
