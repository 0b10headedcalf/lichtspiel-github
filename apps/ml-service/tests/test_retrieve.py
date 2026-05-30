"""Tests for Phase 5 metadata retrieval. Runs with stdlib unittest (no pytest
needed): `python -m unittest discover -s tests` from apps/ml-service."""

from __future__ import annotations

import unittest

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


if __name__ == "__main__":
    unittest.main()
