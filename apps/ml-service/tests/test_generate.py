"""Tests for the generate orchestrator + the watched-folder resolution.

stdlib unittest, no heavy deps (vibe + codegen are stubbed).
"""

from __future__ import annotations

import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from lichtspiel_ml import generate as gen_mod
from lichtspiel_ml.codegen import GenerateResult
from lichtspiel_ml.generate import _latest_export, generate_visual
from lichtspiel_ml.vibe import Vibe


class LatestExportTest(unittest.TestCase):
    def test_picks_newest_audio_file(self):
        with TemporaryDirectory() as tmp:
            old = Path(tmp) / "old.wav"
            new = Path(tmp) / "new.wav"
            old.write_bytes(b"x")
            new.write_bytes(b"x")
            os.utime(old, (1, 1))  # force old < new mtime
            os.utime(new, (2, 2))
            with mock.patch.dict(os.environ, {"LICHTSPIEL_AUDIO_WATCH_DIR": tmp}):
                self.assertEqual(_latest_export(), str(new))

    def test_ignores_non_audio(self):
        with TemporaryDirectory() as tmp:
            (Path(tmp) / "notes.txt").write_bytes(b"x")
            with mock.patch.dict(os.environ, {"LICHTSPIEL_AUDIO_WATCH_DIR": tmp}):
                with self.assertRaises(FileNotFoundError):
                    _latest_export()

    def test_unset_watch_dir_raises(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ValueError):
                _latest_export()


class GenerateVisualTest(unittest.TestCase):
    def test_orchestration_wire_shape(self):
        fake_vibe = Vibe(text="a calm vibe", tags={}, features={"tempo": 90.0}, sources=["clap"])
        fake_gen = GenerateResult(
            template_id="genX",
            path="/tmp/genX.ts",
            code="export const genX",
            brief="brief",
            model="claude-test",
            valid=True,
            issues=[],
        )
        with (
            mock.patch.object(gen_mod, "describe_audio", return_value=fake_vibe) as d,
            mock.patch.object(gen_mod, "generate_template", return_value=fake_gen),
        ):
            out = generate_visual("clip.wav", prompt="neon", divergence=0.7)
        d.assert_called_once_with("clip.wav")
        self.assertTrue(out["ok"])
        for key in ("ok", "audioFilePath", "vibe", "templateId", "templatePath", "model", "issues", "code"):
            self.assertIn(key, out)
        self.assertEqual(out["templateId"], "genX")
        self.assertEqual(out["vibe"]["text"], "a calm vibe")

    def test_dream_mode_uses_prompt_not_audio(self):
        fake_gen = GenerateResult("dreamX", "/tmp/dreamX.ts", "code", "b", "m", True, [])
        with (
            mock.patch.object(gen_mod, "describe_audio") as audio,
            mock.patch.object(gen_mod, "_latest_export") as latest,
            mock.patch.object(gen_mod, "describe_text", return_value=Vibe(text="hand-typed")) as text,
            mock.patch.object(gen_mod, "generate_template", return_value=fake_gen),
        ):
            out = generate_visual(None, prompt="cosmic lattice", divergence=0.8, mode="dream")
        text.assert_called_once_with("cosmic lattice")
        audio.assert_not_called()  # dream never reads audio
        latest.assert_not_called()
        self.assertEqual(out["mode"], "dream")
        self.assertIsNone(out["audioFilePath"])

    def test_dream_mode_requires_prompt(self):
        with self.assertRaises(ValueError):
            generate_visual(None, prompt=None, mode="dream")

    def test_falls_back_to_watch_dir_when_no_path(self):
        fake_vibe = Vibe(text="v", tags={}, features={})
        fake_gen = GenerateResult("g", "/tmp/g.ts", "code", "b", "m", True, [])
        with (
            mock.patch.object(gen_mod, "_latest_export", return_value="/watched/newest.wav") as latest,
            mock.patch.object(gen_mod, "describe_audio", return_value=fake_vibe),
            mock.patch.object(gen_mod, "generate_template", return_value=fake_gen),
        ):
            out = generate_visual(None)
        latest.assert_called_once()
        self.assertEqual(out["audioFilePath"], "/watched/newest.wav")


if __name__ == "__main__":
    unittest.main()
