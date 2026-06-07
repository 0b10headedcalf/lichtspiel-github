"""Generate orchestrator + CLI — audio -> vibe -> p5 template, one call.

The single entry point the webui (via /generate) and the CLI both use:

    python -m lichtspiel_ml.generate /path/to/export.wav --prompt "neon, fast" --divergence 0.7

Wires vibe.describe_audio -> codegen.generate_template. Keeps no state; the
result dict is the wire shape returned over HTTP.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from .codegen import generate_template
from .vibe import describe_audio, describe_text

# Audio file extensions an Ableton export might produce.
_AUDIO_EXTS = {".wav", ".aif", ".aiff", ".flac", ".mp3", ".m4a", ".ogg"}


def _latest_export() -> str:
    """Newest audio file in LICHTSPIEL_AUDIO_WATCH_DIR (the manual-export folder)."""
    watch = os.environ.get("LICHTSPIEL_AUDIO_WATCH_DIR")
    if not watch:
        raise ValueError("no audioFilePath given and LICHTSPIEL_AUDIO_WATCH_DIR is unset")
    base = Path(watch).expanduser()
    if not base.is_absolute():
        # .env declares the watch dir relative to the repo root, but the service
        # runs with cwd=apps/ml-service — resolve against the .env's directory
        # (recorded by load_dotenv), falling back to cwd.
        root = os.environ.get("LICHTSPIEL_ENV_ROOT")
        candidates = [Path(root) / base] if root else []
        candidates.append(Path.cwd() / base)
        base = next((c for c in candidates if c.is_dir()), candidates[0])
    clips = [p for p in base.glob("*") if p.suffix.lower() in _AUDIO_EXTS]
    if not clips:
        raise FileNotFoundError(f"no audio clips in watch dir {base}")
    return str(max(clips, key=lambda p: p.stat().st_mtime))


def generate_visual(
    audio_file_path: str | None = None,
    prompt: str | None = None,
    divergence: float = 0.6,
    mode: str = "sync",
) -> dict[str, Any]:
    """Full pipeline. Returns a JSON-serializable result for the webui.

    Two modes:
      • "sync"  — audio → CLAP/MIR vibe → Claude codegen. `audio_file_path` None
                  ⇒ use the newest clip in the watched export folder. `prompt`
                  optionally steers on top of the detected vibe.
      • "dream" — natural-language prompt → Claude codegen. No audio; the prompt
                  is the entire brief.
    """
    if mode == "dream":
        if not prompt or not prompt.strip():
            raise ValueError("dream mode requires a prompt")
        vibe = describe_text(prompt)
        audio_file_path = None
    else:  # sync
        audio_file_path = audio_file_path or _latest_export()
        vibe = describe_audio(audio_file_path)

    gen = generate_template(vibe, prompt, divergence)
    return {
        "ok": gen.valid,
        "mode": mode,
        "audioFilePath": audio_file_path,
        "vibe": vibe.to_dict(),
        "templateId": gen.template_id,
        "templatePath": gen.path,
        "model": gen.model,
        "issues": gen.issues,
        "code": gen.code,
    }


def main() -> None:
    from .env import load_dotenv

    load_dotenv()  # so the CLI picks up ANTHROPIC_API_KEY from the repo-root .env
    ap = argparse.ArgumentParser(description="audio -> vibe -> p5 template")
    ap.add_argument(
        "audio",
        nargs="?",
        default=None,
        help="path to an exported audio clip; omit to use the newest in LICHTSPIEL_AUDIO_WATCH_DIR",
    )
    ap.add_argument("--prompt", default=None, help="optional steering prompt (required for --mode dream)")
    ap.add_argument("--divergence", type=float, default=0.6, help="0=mutation 1=novel")
    ap.add_argument("--mode", choices=("sync", "dream"), default="sync", help="sync=audio→template, dream=prompt→template")
    args = ap.parse_args()
    result = generate_visual(args.audio, args.prompt, args.divergence, args.mode)
    # code is large + already on disk; keep the CLI summary readable
    summary = {k: v for k, v in result.items() if k != "code"}
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
