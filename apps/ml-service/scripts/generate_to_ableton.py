#!/usr/bin/env python3
"""The generative loop: SA3 text-to-audio → a clip in Ableton Live.

Generates audio from a text prompt with Stable Audio 3 (``small-music``), writes
a WAV, and inserts it into the running Live set via the **AudioInserter** Remote
Script (a local socket on 127.0.0.1:9129). The track is named after the prompt,
so the inserted clip flows back through Max → bridge → ml-service retrieval and
drives the p5 visual — closing the loop with no new runtime coupling.

One-time setup (human-in-the-loop): install the AudioInserter Remote Script and
enable it in Live (see docs / the stable-audio-3 ableton README), then:

    python scripts/generate_to_ableton.py --ping
    python scripts/generate_to_ableton.py --prompt "driving techno loop"

Requires the ``embed`` extra (torch + stable_audio_3) for generation. The
insertion side only needs Ableton + the Remote Script — no model.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import sys
import tempfile
from pathlib import Path

# Make `lichtspiel_ml` importable when run directly.
_ML_SERVICE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ML_SERVICE / "src"))

AUDIOINSERTER_HOST = os.environ.get("LICHTSPIEL_AUDIOINSERTER_HOST", "127.0.0.1")
AUDIOINSERTER_PORT = int(os.environ.get("LICHTSPIEL_AUDIOINSERTER_PORT", "9129"))
TIMEOUT = 5.0


def send_command(cmd: dict) -> dict:
    """Send one newline-framed JSON command to the AudioInserter; return its reply."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(TIMEOUT)
        s.connect((AUDIOINSERTER_HOST, AUDIOINSERTER_PORT))
        s.sendall((json.dumps(cmd) + "\n").encode("utf-8"))
        buf = b""
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            buf += chunk
            if b"\n" in chunk:
                break
        s.close()
        return json.loads(buf.decode("utf-8").strip())
    except ConnectionRefusedError:
        return {
            "ok": False,
            "error": "Cannot reach Ableton — open Live and enable AudioInserter in "
            "Preferences → MIDI → Control Surfaces.",
        }
    except Exception as err:
        return {"ok": False, "error": str(err)}


def insert_into_ableton(wav_path: str, track_name: str) -> bool:
    abs_path = os.path.abspath(wav_path)
    if not os.path.isfile(abs_path):
        print(f"✗ file not found: {abs_path}", file=sys.stderr)
        return False
    # AudioInserter also reads _SA3_LAST_PROMPT for its watch mode; set it for parity.
    os.environ["_SA3_LAST_PROMPT"] = track_name
    res = send_command({"action": "insert_audio", "file_path": abs_path, "track_name": track_name})
    if res.get("ok"):
        print(f"✓ inserted into Ableton: {res.get('message', abs_path)}")
        return True
    print(f"✗ {res.get('error', 'unknown error')}", file=sys.stderr)
    return False


def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (s or "clip")[:48]


def generate_wav(prompt: str, out_path: Path, *, generator: str, duration: float, steps: int, seed: int) -> str:
    from lichtspiel_ml import embed_audio  # availability check + shared model env

    if not embed_audio.embedding_available():
        print(
            f"ERROR: the embed extra is not installed ({embed_audio.import_error()}).\n"
            "Install it first:  uv pip install -e '.[embed]'",
            file=sys.stderr,
        )
        raise SystemExit(2)

    import torchaudio
    from stable_audio_3 import StableAudioModel

    gen = StableAudioModel.from_pretrained(generator)
    sr = int(gen.model.sample_rate)
    audio = gen.generate(prompt=prompt, duration=duration, steps=steps, seed=seed)
    wav = audio[0].detach().cpu()  # (C, T)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    torchaudio.save(str(out_path), wav, sr)
    print(f"✓ generated {duration:.0f}s @ {sr} Hz → {out_path}")
    return str(out_path)


def main() -> int:
    ap = argparse.ArgumentParser(description="SA3 generate → insert into Ableton (Lichtspiel generative loop).")
    ap.add_argument("--prompt", help="Text prompt to generate audio from.")
    ap.add_argument("--ping", action="store_true", help="Only check the AudioInserter connection.")
    ap.add_argument("--insert-only", type=Path, default=None, help="Skip generation; insert this existing WAV.")
    ap.add_argument("--generator", default="small-music", help="SA3 text-to-audio model (CPU-friendly: small-music).")
    ap.add_argument("--duration", type=float, default=10.0)
    ap.add_argument("--steps", type=int, default=8)
    ap.add_argument("--seed", type=int, default=-1, help="-1 = random each run.")
    ap.add_argument("--out", type=Path, default=None, help="Where to write the WAV (default: a temp file named from the prompt).")
    ap.add_argument("--no-insert", action="store_true", help="Generate only; do not insert into Ableton.")
    args = ap.parse_args()

    if args.ping:
        res = send_command({"action": "ping"})
        ok = bool(res.get("ok"))
        print("✓ Ableton AudioInserter ready" if ok else f"✗ {res.get('error', 'not connected')}")
        return 0 if ok else 1

    if args.insert_only is not None:
        return 0 if insert_into_ableton(str(args.insert_only), args.insert_only.stem) else 1

    if not args.prompt:
        ap.error("--prompt is required (or use --ping / --insert-only)")

    out = args.out or (Path(tempfile.gettempdir()) / "lichtspiel-sa3" / f"{_slug(args.prompt)}.wav")
    wav = generate_wav(
        args.prompt, out, generator=args.generator, duration=args.duration, steps=args.steps, seed=args.seed
    )

    if args.no_insert:
        return 0
    return 0 if insert_into_ableton(wav, args.prompt) else 1


if __name__ == "__main__":
    raise SystemExit(main())
