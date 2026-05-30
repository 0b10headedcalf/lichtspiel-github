# Hackathon demo script

Target: a tight, repeatable 3–4 minute demo that lands the wedge — *session-aware
semantic visual mapping, played with monome* — and never breaks on stage.

## One-liner

> "Lichtspiel reads the musical structure of your Live Set and proposes p5 visual
> code-scenes you play with monome — near or far, locked or morphing — instead of
> a fixed VJ clip."

## Minimum impressive demo

1. Open the Live Set; load `LichtspielHub.amxd`; open the p5 runtime full-screen.
2. Launch a **percussive** clip → tunnel scene appears (retrieval).
3. Grab the **arc**: encoder 0 = semantic distance (near→far), encoder 1 = mutation.
4. **Lock** the visual (grid hold / `space`).
5. Launch a **pad/chord** clip → unlock → a *semantically different* scene
   (torusField) is suggested.
6. Trigger a **mutation** → a related variation of the same scene.
7. Hit **surprise** for a deliberate far jump, then settle back.

## Fallback ladder (rehearse these)

| If this breaks… | Do this |
|---|---|
| Max / Live API unstable | Drive state from the CLI: `pnpm send state --clip "…" --tempo …` or keyboard. The M4L shell still logs state. |
| monome not detected | On-screen emulator (`g`) + keyboard mirror every mapping. |
| ML service down | Metadata retrieval + hand-authored descriptors; manual scene select always works. |
| jweb flaky | Run the p5 runtime in an external Chromium window. |
| Everything else | `minimalPulse` is the rock-solid low-CPU fallback scene. |

## Pre-flight checklist

- [ ] `pnpm dev:bridge` up; `/status` shows the p5 client connected.
- [ ] `pnpm dev:p5` full-screen; HUD hidden (`d`) for the clean look, FPS ≥ 30.
- [ ] monome detected (or emulator ready); arc rings show current values.
- [ ] Demo Live Set loaded with clearly-named clips (names drive retrieval).
- [ ] Apple Music / Spotify **closed** (macOS audio-device contention can mute output).
- [ ] One dry run end-to-end, including a deliberate fallback.

## What to say while demoing

- Name the wedge vs TDAbleton / Videosync / Zwobot: *code-native visuals +
  semantic session mapping + monome latent navigation* (see
  `competitive_positioning.md`).
- Emphasize it's a **Live-native instrument**, productizable as a Max for Live
  device — not an installation pipeline.
