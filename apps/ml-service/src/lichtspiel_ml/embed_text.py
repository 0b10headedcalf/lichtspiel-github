"""Text-descriptor embedding (Phase 7, optional/light path).

Stub. A lightweight local text-embedding of template descriptors + clip names,
used when heavyweight audio models are too slow. Blends with the rule-based
score in `retrieve.py`.
"""

from __future__ import annotations


def embed_text(text: str):  # noqa: ANN201, ARG001
    raise NotImplementedError("text embedding — Phase 7")
