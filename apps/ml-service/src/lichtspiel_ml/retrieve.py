"""Phase 5 metadata retrieval — deterministic, dependency-free.

Scores each scene descriptor against the Live session state (clip/track/scene
name tokens + a coarse musical profile derived from tempo/clip type) and
returns the best scene, ranked alternatives, a reason string, and suggested
params. Never emits code — only a `visual_retrieval_result`.

Phase 6 adds MIDI/audio descriptors to the musical profile; Phase 7 blends in
embedding similarity. The output contract stays identical.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

RETRIEVAL_VERSION = "0.1.0"

# packages/visual-corpus/manifests/descriptors.json, found relative to repo root.
_REPO_ROOT = Path(__file__).resolve().parents[4]
_DESCRIPTORS_PATH = _REPO_ROOT / "packages" / "visual-corpus" / "manifests" / "descriptors.json"

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def load_descriptors(path: Path | None = None) -> list[dict[str, Any]]:
    p = path or _DESCRIPTORS_PATH
    data = json.loads(p.read_text(encoding="utf-8"))
    return data["descriptors"]


def _musical_profile(live: dict[str, Any]) -> dict[str, float]:
    """Coarse 0..1 musical descriptors derived from the (sparse) Live state.

    Phase 6 will replace the heuristics with real MIDI/audio features.
    """
    transport = live.get("transport", {})
    selection = live.get("selection", {})
    tempo = float(transport.get("tempo", 120) or 120)
    clip_type = selection.get("clipType", "unknown")

    fast = _clamp01((tempo - 90.0) / 80.0)
    return {
        "fast": fast,
        "percussive": 0.6 * fast + (0.2 if clip_type == "audio" else 0.0),
        "harmonic": 0.5 + (0.2 if clip_type == "midi" else 0.0) - 0.3 * fast,
        "dense": fast,
        "bright": 0.5,
        "sustained": 1.0 - fast,
    }


def _name_text(live: dict[str, Any]) -> str:
    sel = live.get("selection", {})
    parts = [sel.get("clipName", ""), sel.get("trackName", ""), sel.get("sceneName", "")]
    return " ".join(p for p in parts if p).lower()


def retrieve(live: dict[str, Any], descriptors: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    descs = descriptors if descriptors is not None else load_descriptors()
    text = _name_text(live)
    tokens = set(_TOKEN_RE.findall(text))
    profile = _musical_profile(live)

    scored: list[tuple[float, dict[str, Any]]] = []
    for d in descs:
        keywords = d.get("keywords", [])
        exact = len(tokens & set(keywords))
        substr = sum(1 for k in keywords if k in text)
        keyword_score = exact * 2.0 + substr * 1.0
        affinity = d.get("affinities", {})
        affinity_score = sum(profile.get(k, 0.0) * v for k, v in affinity.items())
        score = keyword_score + affinity_score
        scored.append((score, d))

    scored.sort(key=lambda s: s[0], reverse=True)
    top_score, top = scored[0]
    max_score = top_score if top_score > 0 else 1.0

    alternatives = [
        {"sceneId": d["sceneId"], "distance": round(1.0 - (s / max_score), 3)}
        for s, d in scored[1:4]
    ]

    matched = sorted(tokens & set(top.get("keywords", [])))
    reason = (
        f"name match on {matched}" if matched else f"musical profile (tempo→fast={profile['fast']:.2f})"
    )

    confidence = round(_clamp01(top_score / (max_score + 1.0)), 3)
    return {
        "type": "visual_retrieval_result",
        "version": RETRIEVAL_VERSION,
        "sceneId": top["sceneId"],
        "confidence": confidence,
        "distance": round(1.0 - confidence, 3),
        "reason": reason,
        "params": top.get("params", {}),
        "alternatives": alternatives,
    }


def _clamp01(x: float) -> float:
    return 0.0 if x < 0 else 1.0 if x > 1 else x
