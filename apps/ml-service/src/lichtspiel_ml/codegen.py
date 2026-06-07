"""Vibe → p5 VisualTemplate code generation (G3, the novel end).

Takes a Vibe (from vibe.py) + an optional user prompt + a divergence knob and
asks Claude to write ONE new p5 VisualTemplate `.ts` file that performs that
vibe. The file is written to apps/p5-runtime/src/templates/generated/ (gitignored)
after a static safety scan (the AGENTS.md no-eval / no-network gate).

This is a BUILD-TIME / authoring action — it calls the cloud LLM and is never on
the performance runtime path (runtime-purity split). ANTHROPIC_API_KEY is a
build-time secret.

Honest limits (docs/generative-architecture.md): LLM p5 is ~60-85% first-pass.
The static scan here is the *safety* gate, not a *correctness* gate — full tsc +
eslint allowlist + Playwright smoke + a 2-3 pass self-repair loop are the G3
validation gates and are stubbed below (validate_template / TODO).
"""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .vibe import Vibe

CODEGEN_MODEL = os.environ.get("LICHTSPIEL_CODEGEN_MODEL", "claude-sonnet-4-6")

# Repo-relative output dir for generated templates (gitignored).
_REPO_ROOT = Path(__file__).resolve().parents[4]
GENERATED_DIR = _REPO_ROOT / "apps" / "p5-runtime" / "src" / "templates" / "generated"

# Forbidden substrings — the runtime must be browser-only, deterministic, no
# network, no code-eval (AGENTS.md core rules). A hit fails validation.
_FORBIDDEN = [
    "eval(", "new Function", "fetch(", "XMLHttpRequest", "WebSocket",
    "import(", "require(", "localStorage", "document.cookie", "while (true)",
    "while(true)", "process.", "globalThis",
]

# The contract the LLM must satisfy, kept terse. The exemplar (minimalPulse,
# loaded from disk) carries the rest of the "house style" by example.
_CONTRACT = """\
You write ONE TypeScript file exporting a `VisualTemplate` for the Lichtspiel p5 runtime.

HARD RULES (validation rejects violations):
- Browser-only. NO network, NO eval/new Function/import()/require, NO DOM/window/document
  access, NO localStorage, NO infinite loops. Pure p5 drawing only.
- Import the type only: `import type { VisualTemplate } from '../../visualTemplate.js';`
  and you MAY `import { paletteColor, useHsb } from '../palette.js';`. Nothing else.
- `create(ctx)` returns `{ setup(p), update(params), draw({ p, width, height, dt, frame }) }`.
  setup() must call `p.createCanvas(ctx.width, ctx.height, p.P2D)` (or p.WEBGL).
- Read ONLY these animated params (all 0..1) off the params object: density, motion,
  turbulence, symmetry, strobe, cameraDepth, rotationX, rotationY, rotationZ, palette,
  contrast, lineWeight, feedback. Do NOT invent new param fields.
- `ctx.rng` is an object, NOT a function. Use `ctx.rng.random()` (0..1),
  `ctx.rng.range(a, b)`, `ctx.rng.int(n)`, or `ctx.rng.pick(arr)` for any
  randomness — never call `ctx.rng()` and never use Math.random / p5.random.
- Strict TypeScript (noUnusedLocals/Parameters): declare NO variable, import, or
  destructured field you don't use. Omit unused draw-ctx fields (e.g. `frame`).
- Meta fields required: id (camelCase, matches export name), name, family, description,
  tags (string[]), defaultParams (Partial<VisualParamVector>), renderer ('p2d'|'webgl'),
  sourceLineage: 'generated'.

Respond with ONLY one ```ts fenced code block. No prose.
"""


@dataclass
class GenerateResult:
    template_id: str
    path: str
    code: str
    brief: str
    model: str
    valid: bool
    issues: list[str]


def _exemplar() -> str:
    """minimalPulse as a few-shot example of the house style."""
    p = _REPO_ROOT / "apps" / "p5-runtime" / "src" / "templates" / "minimalPulse.ts"
    try:
        return p.read_text()
    except OSError:
        return ""


def build_brief(vibe: "Vibe", user_prompt: str | None, divergence: float) -> str:
    """Turn the musical vibe into a concrete VISUAL brief for the LLM.

    This is the creative heart of the feature: it decides HOW a sound becomes a
    picture. The vibe gives you words + numbers; you decide what they should look
    like. The LLM is good at p5 mechanics but needs you to set the aesthetic
    direction, or every generation drifts toward generic particle soup.

    `divergence` (0..1) is the mutation<->novel knob: low = stay close to a calm,
    familiar look; high = take bold structural risks.
    """
    feats = vibe.features
    lines: list[str] = [f"VIBE: {vibe.text}.", ""]

    # tempo -> motion / pulse rate
    tempo = feats.get("tempo")
    if tempo:
        if tempo < 90:
            lines.append(f"Tempo {tempo:.0f} BPM (slow): gentle drifting motion, long easing, no flicker.")
        elif tempo < 130:
            lines.append(f"Tempo {tempo:.0f} BPM (mid): steady pulse, motion that visibly tracks the beat.")
        else:
            lines.append(f"Tempo {tempo:.0f} BPM (fast): rapid motion, sharp transitions, occasional strobe.")

    # brightness -> palette warmth / glow / contrast
    bright = feats.get("brightness")
    if bright is not None:
        if bright < 0.33:
            lines.append("Dark spectrum: deep blues/violets, low contrast, soft glow, heavy trails (high feedback).")
        elif bright < 0.66:
            lines.append("Balanced spectrum: mid contrast, a coherent 2-3 color palette, moderate glow.")
        else:
            lines.append("Bright spectrum: warm whites/yellows, high contrast, crisp edges, minimal trails.")

    # key / scale -> emotional color family
    key, scale = feats.get("key"), feats.get("scale")
    if key:
        feel = "tense, cool, inward" if scale == "minor" else "open, warm, resolved"
        lines.append(f"Key {key} {scale or ''}: a {feel} color family; let it set the dominant hue.")

    # mood + texture -> form + line quality
    mood = (vibe.tags.get("mood") or [None])[0]
    texture = (vibe.tags.get("texture") or [None])[0]
    if mood:
        lines.append(f"Form should embody: {mood}.")
    if texture:
        lines.append(f"Line/surface quality: {texture} (e.g. clean strokes vs. grain/distortion).")

    # divergence -> how far from the safe house style to push
    if divergence < 0.34:
        lines.append("DIVERGENCE low: a calm, legible, low-CPU composition close to minimalPulse's spirit.")
    elif divergence < 0.67:
        lines.append("DIVERGENCE medium: a distinct structure (grid, flow field, lattice, particles) but readable.")
    else:
        lines.append("DIVERGENCE high: take a bold structural risk — an unusual geometry or layered system.")

    # user prompt wins
    if user_prompt:
        lines += ["", f"USER DIRECTION (overrides the above where they conflict): {user_prompt}"]

    return "\n".join(lines)


def _extract_code(text: str) -> str:
    m = re.search(r"```(?:ts|typescript)?\s*\n(.*?)```", text, re.DOTALL)
    return (m.group(1) if m else text).strip()


def _extract_id(code: str) -> str:
    m = re.search(r"export const (\w+)\s*:", code)
    return m.group(1) if m else f"generated{int(time.time())}"


def validate_template(code: str) -> list[str]:
    """Static safety scan (the no-eval/no-network gate). [] == clean.

    NOTE: safety only. tsc strict + eslint allowlist + Playwright smoke render
    are the correctness gates (G3) and belong here next — shell out to
    `pnpm --filter @lichtspiel/p5-runtime ...` once the file is registered, with
    a 2-3 pass self-repair loop feeding errors back to the model.
    """
    issues = [f"forbidden API: {bad}" for bad in _FORBIDDEN if bad in code]
    if "export const" not in code:
        issues.append("no `export const` template")
    if "createCanvas" not in code:
        issues.append("no createCanvas in setup")
    if "VisualTemplate" not in code:
        issues.append("does not reference the VisualTemplate type")
    return issues


# How many times to feed validation errors back to the model before giving up.
# LLM p5 is ~60-85% first-pass; a couple of repair passes lifts that a lot for
# the occasional slip (a stray import()/eval, a missing createCanvas, …).
MAX_REPAIR_PASSES = int(os.environ.get("LICHTSPIEL_CODEGEN_REPAIR_PASSES", "2"))


def generate_template(
    vibe: "Vibe",
    user_prompt: str | None = None,
    divergence: float = 0.6,
) -> GenerateResult:
    """Vibe -> Claude -> a written, safety-scanned generated template file.

    Runs a self-repair loop: if the static safety scan flags issues, the errors
    are fed back into the SAME conversation and the model is asked to return a
    corrected file, up to MAX_REPAIR_PASSES times. Keeps the chat context so the
    model fixes incrementally rather than regenerating from scratch.
    """
    import anthropic  # lazy: only an authoring dep

    brief = build_brief(vibe, user_prompt, divergence)
    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY
    messages: list[dict] = [
        {
            "role": "user",
            "content": (
                f"EXEMPLAR (house style — match it, do not copy it):\n"
                f"```ts\n{_exemplar()}\n```\n\n"
                f"BRIEF — generate a NEW template for this:\n{brief}"
            ),
        }
    ]

    code = ""
    issues: list[str] = []
    for _ in range(MAX_REPAIR_PASSES + 1):
        msg = client.messages.create(
            model=CODEGEN_MODEL,
            max_tokens=4096,
            system=_CONTRACT,
            messages=messages,
        )
        reply = msg.content[0].text
        code = _extract_code(reply)
        issues = validate_template(code)
        if not issues:
            break
        # Feed the failures back for a repair pass (same conversation context).
        messages.append({"role": "assistant", "content": reply})
        messages.append(
            {
                "role": "user",
                "content": (
                    f"Validation failed: {'; '.join(issues)}. Fix ONLY these and "
                    f"return the COMPLETE corrected file as one ```ts block, no prose."
                ),
            }
        )

    template_id = _extract_id(code)
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    out = GENERATED_DIR / f"{template_id}.ts"
    out.write_text(code)

    return GenerateResult(
        template_id=template_id,
        path=str(out),
        code=code,
        brief=brief,
        model=CODEGEN_MODEL,
        valid=not issues,
        issues=issues,
    )
