#!/usr/bin/env bash
# Convenience launcher for the local Lichtspiel stack (browser-only path needs
# only the p5 runtime; the bridge + ml are optional). Ctrl-C stops all.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "lichtspiel dev stack:"
echo "  bridge  → ws://127.0.0.1:${LICHTSPIEL_BRIDGE_WS_PORT:-7890} (status :${LICHTSPIEL_BRIDGE_HTTP_PORT:-7891}/status)"
echo "  p5      → http://127.0.0.1:${LICHTSPIEL_P5_DEV_PORT:-5273}"
echo

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

pnpm dev:bridge & pids+=($!)
pnpm dev:p5 & pids+=($!)
wait
