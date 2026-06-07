#!/usr/bin/env bash
# Install dependencies, then run the Lichtspiel dev stack (bridge + p5 runtime).
set -euo pipefail
cd "$(dirname "$0")"

# --- install deps ---
command -v pnpm >/dev/null 2>&1 || { echo "error: pnpm not found (corepack enable, or npm i -g pnpm)"; exit 1; }
echo "==> pnpm install"
pnpm install

# --- verify install before launching ---
if [ ! -d node_modules ]; then
  echo "error: install failed (no node_modules)"; exit 1
fi

# --- check required ports are free ---
PORTS=(5273 7890 7891)   # Vite dev server, bridge WS, bridge HTTP
for port in "${PORTS[@]}"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "error: port $port already in use:"
    lsof -nP -iTCP:"$port" -sTCP:LISTEN
    exit 1
  fi
done

# --- run: bridge (WS :7890 / HTTP :7891) + p5 runtime (Vite :5273) + feeder ---
# The feeder is the adopted Ableton trigger path (scene launches + locator
# crossings -> bridge -> p5; see docs/ableton-integration.md). It needs the
# ableton-mcp Remote Script in Live (socket :9877); without it, the feeder idles
# and animations never react to the set. Warn loudly but keep the stack up.
if ! lsof -nP -iTCP:9877 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "WARNING: Ableton Remote Script socket :9877 not found — scene/locator"
  echo "         triggers will be dead. Start Live with the ableton-mcp Remote"
  echo "         Script enabled (the feeder will pick it up automatically)."
fi
echo "==> starting dev stack (ctrl-c to stop)"
trap 'kill 0' EXIT
pnpm dev:bridge &
pnpm dev:p5 &
pnpm dev:feeder &

# --- ml-service (Discover -> Sync/Dream), only if its venv exists -----------
# Setup: see apps/ml-service/README.md (venv + extras + ANTHROPIC_API_KEY in .env).
if [ -x apps/ml-service/.venv/bin/python ]; then
  if lsof -nP -iTCP:7892 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "note: ml-service already running on :7892 — not starting another"
  else
    pnpm dev:ml &
  fi
else
  echo "note: apps/ml-service/.venv missing — Discover (Sync/Dream) disabled."
  echo "      Setup: apps/ml-service/README.md"
fi
wait
