"""Python-side mirrors of the shared contracts (packages/schemas).

Kept intentionally light — the JSON wire shapes are the source of truth; these
are convenience constructors/validators for the Python service.
"""

from __future__ import annotations

from typing import Any

RETRIEVAL_VERSION = "0.1.0"


def empty_live_state() -> dict[str, Any]:
    """A LiveSessionState with safe defaults (mirrors EMPTY_LIVE_STATE in TS)."""
    return {
        "type": "live_session_state",
        "version": "0.1.0",
        "timestampMs": 0,
        "transport": {"isPlaying": False, "tempo": 120.0, "beat": 0, "bar": 0},
        "selection": {
            "trackIndex": 0,
            "trackName": "",
            "sceneIndex": 0,
            "sceneName": "",
            "clipSlotIndex": 0,
            "clipName": "",
            "clipColor": "",
            "clipType": "unknown",
        },
        "clip": {
            "lengthBeats": 0,
            "loopStart": 0,
            "loopEnd": 0,
            "isLooping": True,
            "audioFilePath": None,
            "midiSummary": None,
        },
        "devices": [],
        "performance": {
            "sceneLocked": False,
            "manualOverride": False,
            "semanticDistance": 0,
            "mutationAmount": 0,
        },
    }
