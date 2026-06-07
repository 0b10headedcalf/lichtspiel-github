"""Tests for the vibe → code step (generative track G3).

No network / no anthropic install needed: the Anthropic client is faked via
sys.modules. Asserts the brief mapping, code extraction, the safety scan, and
that generate_template writes a file + reports validity.
"""

from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from lichtspiel_ml import codegen
from lichtspiel_ml.codegen import (
    _extract_code,
    _extract_id,
    build_brief,
    generate_template,
    validate_template,
)
from lichtspiel_ml.vibe import Vibe


def _vibe(tempo=128.0, brightness=0.2, key="F", scale="minor"):
    return Vibe(
        text="a test vibe",
        tags={"mood": ["a dark mood"], "texture": ["cold and metallic"]},
        features={"tempo": tempo, "brightness": brightness, "key": key, "scale": scale},
    )


class BuildBriefTest(unittest.TestCase):
    def test_tempo_bands(self):
        self.assertIn("slow", build_brief(_vibe(tempo=70), None, 0.5))
        self.assertIn("mid", build_brief(_vibe(tempo=110), None, 0.5))
        self.assertIn("fast", build_brief(_vibe(tempo=150), None, 0.5))

    def test_brightness_bands(self):
        self.assertIn("Dark spectrum", build_brief(_vibe(brightness=0.1), None, 0.5))
        self.assertIn("Bright spectrum", build_brief(_vibe(brightness=0.9), None, 0.5))

    def test_scale_feel(self):
        self.assertIn("tense", build_brief(_vibe(scale="minor"), None, 0.5))
        self.assertIn("open", build_brief(_vibe(scale="major"), None, 0.5))

    def test_divergence_bands(self):
        self.assertIn("DIVERGENCE low", build_brief(_vibe(), None, 0.1))
        self.assertIn("DIVERGENCE medium", build_brief(_vibe(), None, 0.5))
        self.assertIn("DIVERGENCE high", build_brief(_vibe(), None, 0.9))

    def test_prompt_overrides(self):
        b = build_brief(_vibe(), "neon grid", 0.5)
        self.assertIn("USER DIRECTION", b)
        self.assertIn("neon grid", b)

    def test_includes_vibe_text(self):
        self.assertIn("a test vibe", build_brief(_vibe(), None, 0.5))


class ExtractTest(unittest.TestCase):
    def test_extract_fenced_code(self):
        raw = "blah\n```ts\nexport const x = 1;\n```\ntrailing"
        self.assertEqual(_extract_code(raw), "export const x = 1;")

    def test_extract_falls_back_to_raw(self):
        self.assertEqual(_extract_code("export const x = 1;"), "export const x = 1;")

    def test_extract_id(self):
        self.assertEqual(_extract_id("export const fooBar: VisualTemplate = {"), "fooBar")


class ValidateTest(unittest.TestCase):
    _GOOD = (
        "import type { VisualTemplate } from '../../visualTemplate.js';\n"
        "export const ok: VisualTemplate = { id: 'ok', create(ctx) {\n"
        "  return { setup(p){ p.createCanvas(ctx.width, ctx.height, p.P2D); },\n"
        "    update(){}, draw(){} }; } };\n"
    )

    def test_clean_code_passes(self):
        self.assertEqual(validate_template(self._GOOD), [])

    def test_forbidden_api_flagged(self):
        issues = validate_template(self._GOOD + "\neval('x');")
        self.assertTrue(any("eval(" in i for i in issues))

    def test_missing_pieces_flagged(self):
        issues = validate_template("const nope = 1;")
        self.assertTrue(issues)


class GenerateTemplateTest(unittest.TestCase):
    def _fake_anthropic(self, code: str):
        """A stand-in `anthropic` module whose client returns `code` in a block."""
        block = types.SimpleNamespace(text=f"```ts\n{code}\n```")
        resp = types.SimpleNamespace(content=[block])

        class _Client:
            def __init__(self, *a, **k):
                self.messages = types.SimpleNamespace(create=lambda **kw: resp)

        return types.SimpleNamespace(Anthropic=_Client)

    def test_writes_file_and_reports_valid(self):
        code = (
            "import type { VisualTemplate } from '../../visualTemplate.js';\n"
            "export const genTest: VisualTemplate = { id: 'genTest', create(ctx) {\n"
            "  return { setup(p){ p.createCanvas(ctx.width, ctx.height, p.P2D); },\n"
            "    update(){}, draw(){} }; } };\n"
        )
        with TemporaryDirectory() as tmp:
            with (
                mock.patch.dict(sys.modules, {"anthropic": self._fake_anthropic(code)}),
                mock.patch.object(codegen, "GENERATED_DIR", Path(tmp)),
            ):
                res = generate_template(_vibe(), user_prompt=None, divergence=0.6)
            self.assertEqual(res.template_id, "genTest")
            self.assertTrue(res.valid, res.issues)
            self.assertTrue(Path(res.path).is_file())
            self.assertIn("export const genTest", Path(res.path).read_text())


if __name__ == "__main__":
    unittest.main()
