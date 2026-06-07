"""Phase 5 metadata retrieval + Phase 7 embedding blend.

Phase 5 (default): scores each scene descriptor against the Live session state
(clip/track/scene name tokens + a coarse musical profile from tempo/clip type)
and returns the best scene, ranked alternatives, a reason, and suggested params.

Phase 7 (`LICHTSPIEL_RETRIEVAL_MODE=embed`): when the playing clip has an audio
file and SAME scene anchors exist, the metadata score is convex-blended with the
cosine similarity between the clip's SAME embedding and each scene's anchor:

    final = (1 - W) * metadata_norm + W * cos01      # W = LICHTSPIEL_EMBED_WEIGHT

Either way the output is an identical `visual_retrieval_result` (sceneId +
params + alternatives + reason) — never code. Any missing piece (no audio, no
anchors, embed deps absent) degrades silently to the Phase-5 metadata path.
"""

from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path
from typing import Any

RETRIEVAL_VERSION = "0.1.0"

# packages/visual-corpus/manifests/{descriptors,anchors}.json, relative to repo root.
_REPO_ROOT = Path(__file__).resolve().parents[4]
_MANIFESTS = _REPO_ROOT / "packages" / "visual-corpus" / "manifests"
_DESCRIPTORS_PATH = _MANIFESTS / "descriptors.json"
_ANCHORS_PATH = _MANIFESTS / "anchors.json"

_TOKEN_RE = re.compile(r"[a-z0-9]+")

# Lazy, cached anchor table (sceneId -> list[float]); "UNSET" until first load.
_anchors_cache: Any = "UNSET"


def load_descriptors(path: Path | None = None) -> list[dict[str, Any]]:
    p = path or _DESCRIPTORS_PATH
    data = json.loads(p.read_text(encoding="utf-8"))
    return data["descriptors"]


def _load_anchors() -> dict[str, list[float]] | None:
    """Scene anchor vectors from anchors.json (sceneId -> list[float]), or None.

    Cached after first read. Monkeypatchable in tests. Pure stdlib (lists, not
    numpy) so the base service never needs the embed extra to read them.
    """
    global _anchors_cache
    if _anchors_cache != "UNSET":
        return _anchors_cache
    try:
        data = json.loads(_ANCHORS_PATH.read_text(encoding="utf-8"))
        anchors = {k: list(v) for k, v in data.get("anchors", {}).items()}
        _anchors_cache = anchors or None
    except Exception:
        _anchors_cache = None
    return _anchors_cache


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


def _embed_weight() -> float:
    try:
        return _clamp01(float(os.environ.get("LICHTSPIEL_EMBED_WEIGHT", "0.5")))
    except (TypeError, ValueError):
        return 0.5


def _cos01(vec, anchor) -> float:
    """Cosine similarity of two float sequences, remapped from [-1,1] to [0,1].

    Works on plain lists or numpy arrays (zip + scalar math), so retrieval stays
    numpy-free.
    """
    dot = 0.0
    nv = 0.0
    na = 0.0
    for x, y in zip(vec, anchor):
        x = float(x)
        y = float(y)
        dot += x * y
        nv += x * x
        na += y * y
    if nv <= 0.0 or na <= 0.0:
        return 0.0
    cos = dot / (math.sqrt(nv) * math.sqrt(na))
    return _clamp01((cos + 1.0) / 2.0)


def _blend_embed(live: dict[str, Any], scored: list[list[Any]]) -> dict[str, float] | None:
    """Blend embedding cosine into ``scored`` in place; return per-scene cos01.

    Returns None (leaving ``scored`` untouched) whenever the embed path can't run:
    no audio file, no anchors, embed deps absent, or the clip can't be encoded.
    """
    audio_path = (live.get("clip") or {}).get("audioFilePath")
    if not audio_path:
        return None
    anchors = _load_anchors()
    if not anchors:
        return None

    from . import cache as _cache  # lazy: keep metadata mode import-light
    from . import embed_audio as _embed

    if not _embed.embedding_available():
        return None

    key = _cache.file_key(audio_path)
    vec = _cache.get(key) if key else None
    if vec is None:
        vec = _embed.embed_audio(audio_path)
        if vec is None:
            return None
        if key:
            _cache.put(key, vec)

    weight = _embed_weight()
    max_meta = max((s[0] for s in scored), default=0.0)
    cos_by_scene: dict[str, float] = {}
    for entry in scored:
        meta, d = entry[0], entry[1]
        anchor = anchors.get(d["sceneId"])
        cos01 = _cos01(vec, anchor) if anchor is not None else 0.0
        cos_by_scene[d["sceneId"]] = cos01
        meta_norm = (meta / max_meta) if max_meta > 0 else 0.0
        entry[0] = (1.0 - weight) * meta_norm + weight * cos01
    return cos_by_scene


def retrieve(live: dict[str, Any], descriptors: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    descs = descriptors if descriptors is not None else load_descriptors()
    text = _name_text(live)
    tokens = set(_TOKEN_RE.findall(text))
    profile = _musical_profile(live)

    scored: list[list[Any]] = []
    for d in descs:
        keywords = d.get("keywords", [])
        exact = len(tokens & set(keywords))
        substr = sum(1 for k in keywords if k in text)
        keyword_score = exact * 2.0 + substr * 1.0
        affinity = d.get("affinities", {})
        affinity_score = sum(profile.get(k, 0.0) * v for k, v in affinity.items())
        score = keyword_score + affinity_score
        scored.append([score, d])

    # Phase 7: blend SAME-embedding cosine into the scores (in place) when enabled.
    cos_by_scene = None
    if os.environ.get("LICHTSPIEL_RETRIEVAL_MODE", "metadata") == "embed":
        cos_by_scene = _blend_embed(live, scored)

    scored.sort(key=lambda s: s[0], reverse=True)
    top_score, top = scored[0]
    max_score = top_score if top_score > 0 else 1.0

    alternatives = [
        {"sceneId": d["sceneId"], "distance": round(1.0 - (s / max_score), 3)}
        for s, d in scored[1:4]
    ]

    matched = sorted(tokens & set(top.get("keywords", [])))
    if cos_by_scene is not None:
        top_cos = cos_by_scene.get(top["sceneId"], 0.0)
        reason = f"audio cos {top_cos:.2f} → {top['sceneId']}"
        if matched:
            reason += f" + name {matched}"
        confidence = round(_clamp01(top_score), 3)
    else:
        reason = (
            f"name match on {matched}"
            if matched
            else f"musical profile (tempo→fast={profile['fast']:.2f})"
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
