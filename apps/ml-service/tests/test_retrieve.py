"""Tests for retrieval. Runs with stdlib unittest (no pytest, no numpy, no model
weights): `python -m unittest discover -s tests` from apps/ml-service.

Covers Phase 5 metadata retrieval and the Phase 7 embedding blend (with the
embedder + anchor table mocked, so CI needs neither torch nor downloaded
weights), including graceful degradation back to metadata.
"""

from __future__ import annotations

import os
import unittest
from unittest import mock

from lichtspiel_ml import embed_audio as embed_mod
from lichtspiel_ml import retrieve as retrieve_mod
from lichtspiel_ml.retrieve import retrieve
from lichtspiel_ml.schemas import empty_live_state


def state_with(clip="", tempo=120.0, clip_type="unknown", track=""):
    s = empty_live_state()
    s["selection"]["clipName"] = clip
    s["selection"]["trackName"] = track
    s["selection"]["clipType"] = clip_type
    s["transport"]["tempo"] = tempo
    return s


class RetrieveTest(unittest.TestCase):
    """Phase 5 metadata path — must be unchanged by the embedding work."""

    def test_returns_contract_shape(self):
        r = retrieve(state_with(clip="drums loop", tempo=140))
        for key in ("type", "version", "sceneId", "confidence", "distance", "reason", "params", "alternatives"):
            self.assertIn(key, r)
        self.assertEqual(r["type"], "visual_retrieval_result")
        self.assertLessEqual(len(r["alternatives"]), 3)

    def test_percussive_name_picks_tunnel(self):
        r = retrieve(state_with(clip="hard drums beat", tempo=145))
        self.assertEqual(r["sceneId"], "topographicTunnel")

    def test_pad_name_picks_torus(self):
        r = retrieve(state_with(clip="warm chord pad", tempo=80, clip_type="midi"))
        self.assertEqual(r["sceneId"], "torusField")

    def test_glitch_name_picks_parquet(self):
        r = retrieve(state_with(clip="glitch noise fill"))
        self.assertEqual(r["sceneId"], "parquetGlitch")

    def test_different_clips_differ(self):
        a = retrieve(state_with(clip="ambient drone intro", tempo=70))
        b = retrieve(state_with(clip="fast drums", tempo=150))
        self.assertNotEqual(a["sceneId"], b["sceneId"])


# Orthogonal unit anchors so a clip embedding deterministically selects a scene.
ANCHORS = {
    "topographicTunnel": [1.0, 0.0, 0.0, 0.0],
    "torusField": [0.0, 1.0, 0.0, 0.0],
    "parquetGlitch": [0.0, 0.0, 1.0, 0.0],
    "minimalPulse": [0.0, 0.0, 0.0, 1.0],
    "gridWorld": [0.5, 0.5, 0.5, 0.5],
}


class EmbedBlendTest(unittest.TestCase):
    """Phase 7 embedding blend, with the embedder + anchors mocked."""

    def _retrieve_embed(self, clip_vec, env=None, state=None):
        environ = {"LICHTSPIEL_RETRIEVAL_MODE": "embed", "LICHTSPIEL_EMBED_WEIGHT": "1.0"}
        if env:
            environ.update(env)
        s = state if state is not None else empty_live_state()
        if state is None:
            s["clip"]["audioFilePath"] = "/fake/clip.wav"
        with mock.patch.dict(os.environ, environ, clear=False), mock.patch.object(
            retrieve_mod, "_load_anchors", return_value=ANCHORS
        ), mock.patch.object(embed_mod, "embedding_available", return_value=True), mock.patch.object(
            embed_mod, "embed_audio", return_value=clip_vec
        ):
            return retrieve(s)

    def test_audio_drives_scene_tunnel(self):
        r = self._retrieve_embed([1.0, 0.0, 0.0, 0.0])
        self.assertEqual(r["sceneId"], "topographicTunnel")
        self.assertIn("audio cos", r["reason"])

    def test_audio_drives_scene_torus(self):
        # Same neutral clip, different sound → different scene (the whole point).
        r = self._retrieve_embed([0.0, 1.0, 0.0, 0.0])
        self.assertEqual(r["sceneId"], "torusField")

    def test_contract_shape_preserved_in_embed(self):
        r = self._retrieve_embed([1.0, 0.0, 0.0, 0.0])
        for key in ("type", "version", "sceneId", "confidence", "distance", "reason", "params", "alternatives"):
            self.assertIn(key, r)
        self.assertEqual(r["type"], "visual_retrieval_result")
        self.assertLessEqual(len(r["alternatives"]), 3)

    def test_no_audio_path_degrades_to_metadata(self):
        # mode=embed but the clip has no audio file → metadata picks the scene.
        s = state_with(clip="hard drums beat", tempo=145)  # audioFilePath stays None
        r = self._retrieve_embed([1.0, 0.0, 0.0, 0.0], state=s)
        self.assertEqual(r["sceneId"], "topographicTunnel")
        self.assertNotIn("audio cos", r["reason"])

    def test_embed_unavailable_degrades_to_metadata(self):
        # mode=embed, audio present, but embed deps absent → metadata path.
        s = state_with(clip="warm chord pad", tempo=80, clip_type="midi")
        s["clip"]["audioFilePath"] = "/fake/clip.wav"
        with mock.patch.dict(os.environ, {"LICHTSPIEL_RETRIEVAL_MODE": "embed"}, clear=False), mock.patch.object(
            retrieve_mod, "_load_anchors", return_value=ANCHORS
        ), mock.patch.object(embed_mod, "embedding_available", return_value=False):
            r = retrieve(s)
        self.assertEqual(r["sceneId"], "torusField")
        self.assertNotIn("audio cos", r["reason"])


if __name__ == "__main__":
    unittest.main()
