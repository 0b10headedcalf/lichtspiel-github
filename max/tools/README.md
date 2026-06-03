# Phase 5a test tools (ableton-mcp)

Dev/test helpers for the Ableton → Lichtspiel loop. They talk to the
**ableton-mcp Remote Script socket (localhost:9877)** and the **bridge WS
(localhost:7890)** — see `docs/ableton-integration.md` for the full setup +
known issues. These are build/test accelerators, NOT runtime dependencies.

- **`ableton_probe.py`** — drive/introspect Live from the shell:
  `python3 max/tools/ableton_probe.py get_scene_info`
  `python3 max/tools/ableton_probe.py fire_scene '{"scene_index": 0}'`
  (also: `set_song_position`, `back_to_arrangement`, `start_playback`, `stop_playback`)
- **`verify-phase5a.mjs`** — end-to-end harness: monitors the bridge for what the
  M4L emits while driving Live (Session scene switches, Arrangement locator
  crossings, mode switches). Run from the bridge pkg so `ws` resolves:
  `cp max/tools/verify-phase5a.mjs apps/live-bridge/_v.mjs && node apps/live-bridge/_v.mjs; rm apps/live-bridge/_v.mjs`

NB: the ableton-mcp install (Remote Script + venv + extensions) lives at
`~/ableton-mcp` and `~/Music/Ableton/User Library/Remote Scripts/AbletonMCP/`.
