# LichtspielBridge — Ableton Remote Script (no Max patch)

Streams the live Live-Set state to the Lichtspiel **live-bridge** as OSC, so you
get "live input" **without a Max for Live device**.

```
Ableton Live  ──(MIDI Remote Script, Python)──▶  OSC /lichtspiel/state <json>
                                                  udp 127.0.0.1:7400
                                                       │
                                                       ▼
                                          lichtspiel-run live-bridge  ──▶ p5 visuals
```

It is a **drop-in replacement** for the Max device's `live_api_helpers.js`: same
OSC address (`/lichtspiel/state`), same `LiveSessionState` JSON (validated against
`packages/schemas/LiveSessionState.schema.json`), same port (7400). **The bridge
needs zero changes.**

## Why a Remote Script and not the Ableton Extensions SDK?
The beta Extensions SDK exposes *structure* (tracks/scenes/clips/tempo) but **no
transport state** (`is_playing`, song position) and **no change observation** — so
it can't produce realtime "live input." Live's Python LOM has all of it
(`song.is_playing`, `current_song_time`, `tempo`, listeners), which is why this is
the correct no-Max path.

## Install
Copy the `LichtspielBridge/` folder into your Ableton **User Library → Remote Scripts**:

```
~/Music/Ableton/User Library/Remote Scripts/LichtspielBridge/
```

(The installer step in the chat already did this.)

## Activate
1. **Restart Ableton Live** (control surfaces are enumerated at startup).
2. Live → **Settings → Link/Tempo/MIDI**.
3. Under **Control Surface**, pick **LichtspielBridge** (leave Input/Output = None).
4. You'll see *"Lichtspiel: streaming Live state to bridge :7400"* and state begins flowing.

## Verify
With the bridge running, it logs `live.state` lines, and the p5 runtime reacts to
transport/clip changes. (`/status` `maxConnected` stays `false` — that flag only
tracks a WebSocket `max` client; this uses OSC, exactly like the Max device did.)

## Config (top of `LichtspielBridge/__init__.py`)
- `BRIDGE_PORT` — default `7400` (`LICHTSPIEL_OSC_MAX_TO_BRIDGE_PORT`).
- `EMIT_EVERY_N_TICKS` — `1` ≈ 10 Hz (Live's `update_display` cadence); `2` ≈ 5 Hz.

## Current scope / TODO
- Emits transport + selection + selected-clip detail. `devices` is `[]` and
  `midiSummary` is `null` for now (kept light/robust) — can be filled in later.
- **MRT2-ready:** the same `_build_state()` can additionally emit the
  `lichtspiel-mrt2-bridge` `AbletonTransport`/`AbletonSceneLaunched` shape when that
  bridge's ingress is ready — add a second emit target alongside the OSC send.
