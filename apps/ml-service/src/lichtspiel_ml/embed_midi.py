"""MIDI descriptor extraction (Phase 6).

Stub. Will turn a MIDI clip's note content into the MidiSummary fields the
contract defines: note density, pitch range, average register, rhythmic
density, polyphony, and a 12-bin pitch-class histogram. These feed the
musical profile in `retrieve.py`.
"""

from __future__ import annotations

from typing import Any


def summarize_midi(notes: list[dict[str, Any]]) -> dict[str, Any]:  # noqa: ARG001
    raise NotImplementedError("MIDI summary — Phase 6")
