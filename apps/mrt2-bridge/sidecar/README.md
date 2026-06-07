# MRT2 sidecar (real integration)

`mrt2_sidecar.py` is the **real-path** bridge between the Node `Mrt2Adapter` and
Magenta RealTime 2's `magenta_rt` Python package. It is **not** used by the mock
demo — it only runs when `ENABLE_MRT2_REAL=true`.

## Why a sidecar?

MRT2 ships no IPC server (only a C++ `RealtimeRunner`/`MLXEngine`, an AUv3, a Max
external, and the `magenta_rt` Python package). The cleanest external integration
is a thin Python process that:

- imports `magenta_rt`,
- receives **control** as newline-delimited JSON on stdin,
- emits **telemetry** as newline-delimited JSON on stdout,
- and keeps **audio entirely inside this process** (write to file / audio device /
  AUv3). Audio never crosses the JSON boundary, so it stays off the WebSocket and
  out of the bridge's realtime path.

## Protocol

Control in (stdin):

```json
{"cmd":"set_prompts","prompts":[{"text":"ceremonial percussion","weight":0.7}]}
{"cmd":"set_params","params":{"temperature":1.2,"topK":40,"cfgMusiccoca":3.0}}
{"cmd":"reset"}
```

Telemetry out (stdout):

```json
{"type":"ready","model":"mrt2_base"}
{"type":"metrics","transformerMs":9,"totalMs":14,"bufferAvailable":1638,"bufferCapacity":2048,"bufferOccupancy":0.8,"droppedFrames":0,"underruns":0,"rtf":0.35,"transportFlags":0,"connected":true}
```

## Running (Apple Silicon)

1. Install MRT2's `magenta_rt` package (see the MRT2 repo's README; `uv` based).
2. Ensure model assets exist under `$MAGENTA_HOME/magenta-rt-v2/` (default
   `~/Documents/Magenta`).
3. In the bridge:

   ```bash
   ENABLE_MRT2_REAL=true MRT2_SIDECAR_CMD="python3 sidecar/mrt2_sidecar.py" pnpm start
   ```

The stub emits synthetic telemetry (imports nothing from `magenta_rt`) so the
end-to-end JSON contract is testable before the model is installed. Replace the
marked sections with real `magenta_rt` calls — see the docstring in
`mrt2_sidecar.py` and `docs/mrt2-integration.md`.
