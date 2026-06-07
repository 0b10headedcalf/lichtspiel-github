"""Tests for the audio → vibe step (generative track G1).

Runs with stdlib unittest, no heavy deps: `python -m unittest discover -s tests`
from apps/ml-service. CLAP/librosa are optional — these assert the graceful
degradation + the text assembly without loading any model.
"""

from __future__ import annotations

import importlib.util
import unittest
from unittest import mock

from lichtspiel_ml import vibe as vibe_mod
from lichtspiel_ml.vibe import VIBE_VOCAB, Vibe, _describe, describe_audio

_HAS_CLAP = importlib.util.find_spec("laion_clap") is not None
_HAS_LIBROSA = importlib.util.find_spec("librosa") is not None


class VibeVocabTest(unittest.TestCase):
    def test_categories_present_and_nonempty(self):
        for cat in ("mood", "genre", "energy", "texture"):
            self.assertIn(cat, VIBE_VOCAB)
            self.assertTrue(VIBE_VOCAB[cat], f"{cat} vocab is empty")
            self.assertTrue(all(isinstance(p, str) and p for p in VIBE_VOCAB[cat]))


class DescribeTextTest(unittest.TestCase):
    def test_composes_from_tags_and_features(self):
        text = _describe(
            tags={"mood": ["a dark, brooding mood"], "genre": ["driving techno"], "energy": ["high-energy"]},
            feats={"tempo": 128.0, "key": "F", "scale": "minor"},
        )
        self.assertIn("dark, brooding", text)
        self.assertIn("driving techno", text)
        self.assertIn("128 BPM", text)
        self.assertIn("F minor", text)

    def test_empty_inputs_give_stub(self):
        self.assertIn("unknown", _describe({}, {}))


class DescribeAudioTest(unittest.TestCase):
    def test_assembles_from_stubbed_analyzers(self):
        # Stub both analyzers so no model loads / no file is read.
        with (
            mock.patch.object(vibe_mod, "_mir_features", return_value={"tempo": 90.0, "key": "A", "scale": "minor"}),
            mock.patch.object(vibe_mod, "_clap_tags", return_value={"mood": ["a calm mood"]}),
        ):
            v = describe_audio("ignored.wav")
        self.assertIsInstance(v, Vibe)
        self.assertEqual(set(v.sources), {"librosa", "clap"})
        self.assertIn("90 BPM", v.text)
        self.assertIn("calm", v.text)

    @unittest.skipIf(_HAS_CLAP or _HAS_LIBROSA, "deps installed → would load model / read file")
    def test_no_deps_returns_stub_without_crashing(self):
        v = describe_audio("/does/not/exist.wav")
        self.assertEqual(v.sources, [])
        self.assertIn("unknown", v.text)


if __name__ == "__main__":
    unittest.main()
