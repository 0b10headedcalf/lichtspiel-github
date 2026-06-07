"""Minimal stdlib `.env` loader (no python-dotenv dep — the base service stays
stdlib-only, see pyproject).

Walks up from the cwd (and the package dir) to find the first `.env`, then sets
any keys NOT already present in the environment — so an explicitly-exported var
still wins, matching standard dotenv precedence. Authoring/dev convenience for
the generative track: ANTHROPIC_API_KEY + the LICHTSPIEL_* vars live in the
gitignored repo-root `.env`.
"""

from __future__ import annotations

import os
from pathlib import Path


def load_dotenv() -> Path | None:
    """Load the nearest `.env` into os.environ (setdefault). Returns its path."""
    for base in (Path.cwd(), Path(__file__).resolve().parent):
        for directory in (base, *base.parents):
            env_file = directory / ".env"
            if env_file.is_file():
                _apply(env_file)
                return env_file
    return None


def _apply(path: Path) -> None:
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :]
        key, sep, val = line.partition("=")
        if not sep:
            continue
        # Keep the value verbatim apart from surrounding whitespace + one pair of
        # matching quotes; do NOT strip "inline comments" (an API key may contain #).
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        os.environ.setdefault(key.strip(), val)
