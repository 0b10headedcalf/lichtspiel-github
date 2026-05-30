# Troubleshooting

## p5 runtime

- **Blank/black canvas** — open DevTools console. The runtime logs
  `[lichtspiel] p5 runtime up — N templates` on boot. A template that throws in
  `draw` is caught by the host (logged `[host] sketch.draw threw`) and won't kill
  the loop. Press `1` for `minimalPulse` (the safe fallback).
- **Low FPS** — toggle the HUD (`d`) to read FPS. `torusField` (WEBGL) and
  high `density` are the heaviest; drop density (`[`) or switch scenes. Target
  ≥ 30 FPS on the demo machine.
- **Pill stuck on "browser-only"** — the bridge isn't running; that's fine for
  browser-only use. Start it with `pnpm dev:bridge` to connect.

## Bridge

- **`bridge not reachable`** from `pnpm send …` — start `pnpm dev:bridge` first;
  check `curl http://127.0.0.1:7891/status`.
- **Invalid messages dropped** — the bridge validates `live.state` /
  `monome.event` / `mutation.request` against the schemas and logs `INVALID`
  with the ajv error; it never forwards malformed payloads to p5.
- **Port in use** — override `LICHTSPIEL_BRIDGE_WS_PORT` /
  `LICHTSPIEL_BRIDGE_HTTP_PORT` in `.env`.

## macOS audio (installation)

- Having **Apple Music / Spotify** open can cause OS-level audio-device
  contention. Close them before a run.

## monome (Phase 4+)

- Not detected: confirm `serialosc` is running and the serials in `.env` match
  (`m64_0175`, `m0000174`). Use the on-screen emulator (`g`) as a fallback —
  it emits the same `MonomeEvent` shapes.

## Build / install

- **`Cannot find type definition file for 'node'`** — run `pnpm install`;
  `@types/node` is a devDep of the packages that use Node built-ins.
- **esbuild build script ignored** — approved in `pnpm-workspace.yaml`
  (`allowBuilds: esbuild: true`); re-run `pnpm install`.

## Collecting a bug report

Grab: bridge log tail, browser console errors, Max console notes, the current
`LiveSessionState` + `VisualParamVector`, and repro steps (spec §17).
