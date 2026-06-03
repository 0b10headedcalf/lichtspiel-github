# ableton-mcp extensions (for the feeder bypass)

The feeder bypass (`apps/live-bridge/demo-feeder.mjs`, run via `pnpm dev:feeder`) drives
Lichtspiel from Ableton via ahujasid/ableton-mcp (MIT). We extended ableton-mcp's Remote Script
+ MCP server with what the feeder/tests need:

- `get_scene_info` — also returns `playing_scene` (the playing Session row, fast Python
  early-exit scan) + `back_to_arranger`.
- `fire_scene(scene_index)` — `Scene.fire()`.
- `set_song_position(time)` — set `current_song_time`.
- `back_to_arrangement()` — set `back_to_arranger = 0`.

`extensions.patch` is the diff against a fresh `ahujasid/ableton-mcp` clone.

## Reproduce
1. `git clone https://github.com/ahujasid/ableton-mcp.git ~/ableton-mcp`
2. `git -C ~/ableton-mcp apply /path/to/extensions.patch`
3. Install per `docs/ableton-integration.md` (Remote Script -> User Library; venv; `claude mcp add`).
   Editing the Remote Script requires a full Ableton restart to take effect.
