# Lichtspiel Desktop

Native binary for Lichtspiel — the Ableton Live + p5 audiovisual composition assistant.

## Quick Start

### Building

```bash
# Install Rust toolchain (once)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Build the desktop binary
pnpm install
pnpm build:desktop
```

### Development

```bash
# Terminal 1: p5 dev server
pnpm dev:p5

# Terminal 2: Tauri dev mode (hot-reload webview + Rust)
pnpm dev:desktop
```

### Output

| Platform | Binary | Size |
|----------|--------|------|
| Linux (x64) | `lichtspiel` | ~13MB |
| Linux | `Lichtspiel_0.1.0_amd64.deb` | — |
| Linux | `Lichtspiel-0.1.0-1.x86_64.rpm` | — |
| macOS | `Lichtspiel.app` + `.dmg` | ~15MB |
| Windows | `Lichtspiel.exe` + `.msi` | ~15MB |

**Note:** macOS and Windows builds must be run on those platforms (cross-compilation is possible but not configured yet).

## Architecture

```
┌─────────────────────────────────────────────┐
│  Tauri App (native binary, ~13MB)            │
│                                              │
│  ┌──────────────┐    ┌────────────────────┐  │
│  │  Rust Backend │◄──►│  WebView            │  │
│  │              │    │  (p5.js runtime)    │  │
│  │ • spawn node │    │  • templates        │  │
│  │ • IPC bridge │    │  • idioms           │  │
│  │ • file I/O   │    │  • monome twin      │  │
│  └──────────────┘    └────────────────────┘  │
└─────────────────────────────────────────────┘
         │                        │
         ▼                        ▼
  Node live-bridge          Ableton Live (M4L)
  (spawned child)           OSC → UDP 7400
  serialosc → monome
```

## How It Works

1. **Tauri shell** wraps the existing p5.js runtime as a webview
2. **Rust backend** spawns the Node live-bridge as a child process
3. **IPC layer** replaces WebSocket with Tauri commands/events
4. **Same rendering** — all 14 templates, idioms, monome controls work identically

## Standalone Mode

The app works with **zero external dependencies** (except Node.js for the bridge):
- No Ableton Live needed
- No monome needed
- Keyboard controls + digital twin work out of the box

Optional integrations activate when present:
- **Ableton Live** → M4L device sends OSC → Rust receives → visuals respond
- **Monome** → serialosc running → Rust discovers → grid/arc control

## Template Manifests

Templates are described in `packages/visual-corpus/manifests/templates.json` — a
language-neutral JSON format that enables:
- Rust backend to reason about templates (retrieval, catalog)
- p5 runtime to load template metadata
- Future native renderers (wgpu, WebGL2) to read the same definitions

Generate: `pnpm generate:manifests`

## Building for macOS / Windows

Run `pnpm build:desktop` on the target platform:

```bash
# macOS (requires Xcode)
pnpm build:desktop
# Output: src-tauri/target/release/bundle/macos/Lichtspiel.app
#         src-tauri/target/release/bundle/dmg/Lichtspiel_0.1.0_universal.dmg

# Windows (requires Visual Studio Build Tools)
pnpm build:desktop
# Output: src-tauri/target/release/bundle/msi/Lichtspiel_0.1.0_x64_en-US.msi
#         src-tauri/target/release/bundle/nsis/Lichtspiel_0.1.0_x64-setup.exe
```
