#!/usr/bin/env python3
"""
MRT2 sidecar — REAL `magenta_rt` integration (with a synthetic fallback).

Bridges the Node `Mrt2Adapter` to Magenta RealTime 2's `magenta_rt` package on
Apple Silicon. Exchanges newline-delimited JSON over stdio:

  control IN  (stdin):  {"cmd":"set_prompts","prompts":[{"text":"...","weight":0.7}, ...]}
                        {"cmd":"set_params","params":{"temperature":1.2,"topK":40,
                                                       "cfgMusiccoca":3.0,"cfgNotes":1.0,
                                                       "cfgDrums":1.0,"drumless":false}}
                        {"cmd":"reset"}   {"cmd":"quit"}
  telemetry OUT (stdout): {"type":"ready","model":"mrt2_small"}
                          {"type":"metrics","transformerMs":..,"totalMs":..,
                           "bufferAvailable":..,"bufferCapacity":..,"bufferOccupancy":..,
                           "droppedFrames":..,"underruns":..,"rtf":..,"transportFlags":0,
                           "connected":true}

AUDIO STAYS HERE. A background thread runs the continuous `generate(frames,state)`
loop and pushes 48 kHz stereo into a FIFO that a `sounddevice` output stream
drains in real time. Only control + telemetry cross stdio — never audio — so the
bridge's WebSocket and realtime path stay audio-free.

Model: defaults to `mrt2_small` (real-time via Python/MLX, ~38 steps/s on M3 Max;
`mrt2_base` is ~1.9x too slow this way — use the C++ engine for real-time base).
Assets resolve under $MAGENTA_HOME/magenta-rt-v2/ (default ~/Documents/Magenta).

If `magenta_rt` / `sounddevice` are unavailable, this falls back to emitting
synthetic telemetry so the end-to-end JSON contract still works without the model.
"""
import collections
import json
import os
import sys
import threading
import time

MODEL = os.environ.get("MRT2_MODEL", "mrt2_small")
SR = 48000
FRAME_SAMPLES = 1920          # MRT2: 1920 samples @ 48 kHz = 40 ms
FRAME_MS = 40.0               # 25 Hz frame rate
GEN_FRAMES = int(os.environ.get("MRT2_GEN_FRAMES", "10"))      # frames per generate() call (~400 ms)
BUFFER_TARGET_SEC = float(os.environ.get("MRT2_BUFFER_SEC", "2.0"))
PREBUFFER_SEC = float(os.environ.get("MRT2_PREBUFFER_SEC", "0.6"))
DEFAULT_PROMPT = os.environ.get("MRT2_DEFAULT_PROMPT", "warm ambient texture, soft pads")
AUDIO_DEVICE = os.environ.get("MRT2_AUDIO_DEVICE")  # sounddevice index/name; None = system default


def emit(obj):
    """Write one telemetry object to stdout (the ONLY thing allowed on stdout)."""
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def log(*a):
    print("[mrt2-sidecar]", *a, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- #
# Shared control state (written by stdin thread, read by generate thread)
# --------------------------------------------------------------------------- #
class Control:
    def __init__(self):
        self.lock = threading.Lock()
        self.style = None          # blended 768-dim np.ndarray, or None (unconditional)
        self.prompts = []          # last prompt slots (for logging)
        self.temperature = None    # None => use model default
        self.top_k = None
        self.cfg_musiccoca = None
        self.cfg_notes = None
        self.cfg_drums = None
        self.drums = None          # generate() drums conditioning: None | [0] | [1]
        self.reset = False


# --------------------------------------------------------------------------- #
# Thread-safe sample FIFO between the generate thread and the audio callback
# --------------------------------------------------------------------------- #
class AudioFifo:
    def __init__(self):
        self.lock = threading.Lock()
        self.blocks = collections.deque()
        self.n = 0                 # samples currently queued
        self.dropped = 0           # cumulative underrun events (callback starved)

    def push(self, samples):       # samples: (k, 2) float32
        with self.lock:
            self.blocks.append(samples)
            self.n += len(samples)

    def pop(self, frames):         # -> (frames, 2) float32, zero-padded on underrun
        import numpy as np
        out = np.zeros((frames, 2), dtype="float32")
        filled = 0
        with self.lock:
            while filled < frames and self.blocks:
                b = self.blocks[0]
                take = min(len(b), frames - filled)
                out[filled:filled + take] = b[:take]
                if take == len(b):
                    self.blocks.popleft()
                else:
                    self.blocks[0] = b[take:]
                filled += take
                self.n -= take
            if filled < frames:
                self.dropped += 1
        return out

    def buffered(self):
        with self.lock:
            return self.n


# --------------------------------------------------------------------------- #
# Real magenta_rt path
# --------------------------------------------------------------------------- #
def run_real():
    import logging
    logging.getLogger("magenta_rt").setLevel(logging.WARNING)
    import numpy as np
    import sounddevice as sd
    from magenta_rt import MagentaRT2Mlxfn

    log(f"loading model '{MODEL}' (MAGENTA_HOME={os.environ.get('MAGENTA_HOME', '~/Documents/Magenta')})...")
    system = MagentaRT2Mlxfn(size=MODEL)
    log("model loaded + warmed up")

    ctrl = Control()
    fifo = AudioFifo()
    stop = threading.Event()

    # --- prompt embedding (cached per text) ---
    emb_cache = {}

    def embed(text):
        if text not in emb_cache:
            e = np.asarray(system.embed_style(text), dtype="float32").reshape(-1)
            emb_cache[text] = e
        return emb_cache[text]

    def blend(prompts):
        slots = [(p["text"], float(p.get("weight", 1.0)))
                 for p in prompts if p.get("text")]
        if not slots:
            return None
        embs = np.stack([embed(t) for t, _ in slots])
        w = np.clip(np.array([wt for _, wt in slots], dtype="float32"), 0.0, None)
        if w.sum() <= 0:
            w = np.ones(len(slots), dtype="float32")
        w = w / w.sum()
        return (embs * w[:, None]).sum(axis=0).astype("float32")

    # seed an initial style so audio starts immediately
    with ctrl.lock:
        ctrl.style = blend([{"text": DEFAULT_PROMPT, "weight": 1.0}])
        ctrl.prompts = [{"text": DEFAULT_PROMPT, "weight": 1.0}]

    # --- shared timing stats for telemetry ---
    stats = {"total_ms": 0.0, "transformer_ms": 0.0}
    stats_lock = threading.Lock()

    # --- audio output stream ---
    def audio_cb(outdata, frames, time_info, status):
        outdata[:] = fifo.pop(frames)

    # --- generate loop ---
    def gen_loop():
        state = None
        target = BUFFER_TARGET_SEC * SR
        while not stop.is_set():
            with ctrl.lock:
                style = ctrl.style
                temperature = ctrl.temperature
                top_k = ctrl.top_k
                cfg_m, cfg_n, cfg_d = ctrl.cfg_musiccoca, ctrl.cfg_notes, ctrl.cfg_drums
                drums = ctrl.drums
                if ctrl.reset:
                    state = None
                    ctrl.reset = False
            if fifo.buffered() > target:        # backpressure: stay ~BUFFER_TARGET ahead
                stop.wait(0.01)
                continue
            try:
                t0 = time.perf_counter()
                wav, state = system.generate(
                    style=style, drums=drums,
                    cfg_musiccoca=cfg_m, cfg_notes=cfg_n, cfg_drums=cfg_d,
                    temperature=temperature, top_k=top_k,
                    frames=GEN_FRAMES, state=state,
                )
                gen_ms = (time.perf_counter() - t0) * 1000.0
                samples = np.clip(np.asarray(wav.samples, dtype="float32"), -1.0, 1.0)
                fifo.push(samples)
                with stats_lock:
                    stats["total_ms"] = gen_ms / GEN_FRAMES   # wall ms per 40 ms frame
                    stats["transformer_ms"] = gen_ms / GEN_FRAMES
            except Exception as e:                            # surface, don't die silently
                log(f"generate() failed: {e!r}")
                stop.set()
                break

    # --- telemetry loop (~1 Hz) ---
    def telemetry_loop():
        last_dropped = 0
        capacity = int(BUFFER_TARGET_SEC * SR)
        while not stop.is_set():
            with stats_lock:
                total_ms = stats["total_ms"]
                transformer_ms = stats["transformer_ms"]
            buffered = fifo.buffered()
            dropped = fifo.dropped
            underruns = max(0, dropped - last_dropped)
            last_dropped = dropped
            emit({
                "type": "metrics",
                "transformerMs": round(transformer_ms, 2),
                "totalMs": round(total_ms, 2),
                "bufferAvailable": int(buffered),
                "bufferCapacity": capacity,
                "bufferOccupancy": max(0.0, min(1.0, buffered / capacity)),
                "droppedFrames": int(dropped),
                "underruns": int(underruns),
                "rtf": round(total_ms / FRAME_MS, 3),    # <1 == faster than realtime
                "transportFlags": 0,
                "connected": True,
            })
            stop.wait(1.0)

    # --- prebuffer, then start audio + threads ---
    gen_t = threading.Thread(target=gen_loop, daemon=True)
    gen_t.start()
    deadline = time.time() + 15.0
    while fifo.buffered() < PREBUFFER_SEC * SR and time.time() < deadline and not stop.is_set():
        time.sleep(0.02)

    stream = sd.OutputStream(
        samplerate=SR, channels=2, dtype="float32",
        blocksize=1024, callback=audio_cb,
        device=(int(AUDIO_DEVICE) if (AUDIO_DEVICE or "").isdigit() else AUDIO_DEVICE) or None,
    )
    stream.start()
    log(f"audio stream started (device={AUDIO_DEVICE or 'default'}, {GEN_FRAMES} frames/gen)")
    emit({"type": "ready", "model": MODEL})

    tel_t = threading.Thread(target=telemetry_loop, daemon=True)
    tel_t.start()

    # --- stdin control loop (main thread) ---
    def apply_params(params):
        with ctrl.lock:
            if "temperature" in params: ctrl.temperature = _f(params["temperature"])
            if "topK" in params:        ctrl.top_k = _i(params["topK"])
            if "cfgMusiccoca" in params: ctrl.cfg_musiccoca = _f(params["cfgMusiccoca"])
            if "cfgNotes" in params:    ctrl.cfg_notes = _f(params["cfgNotes"])
            if "cfgDrums" in params:    ctrl.cfg_drums = _f(params["cfgDrums"])
            if "drumless" in params:    ctrl.drums = [0] if params["drumless"] else None

    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
            except json.JSONDecodeError:
                continue
            kind = cmd.get("cmd")
            if kind == "set_prompts":
                prompts = cmd.get("prompts") or []
                style = blend(prompts)
                with ctrl.lock:
                    ctrl.style = style
                    ctrl.prompts = prompts
                log(f"set_prompts {[p.get('text') for p in prompts]}")
            elif kind == "set_params":
                apply_params(cmd.get("params") or {})
                log(f"set_params {cmd.get('params')}")
            elif kind == "reset":
                with ctrl.lock:
                    ctrl.reset = True
                log("reset")
            elif kind == "quit":
                break
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        try:
            stream.stop(); stream.close()
        except Exception:
            pass
        time.sleep(0.05)


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _i(x):
    try:
        return int(x)
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------- #
# Synthetic fallback (no magenta_rt / no audio device) — preserves the contract
# --------------------------------------------------------------------------- #
def run_stub(reason):
    log(f"running SYNTHETIC stub ({reason}); install magenta_rt + sounddevice in the "
        f"sidecar's python for real audio. See docs/mrt2-integration.md")
    emit({"type": "ready", "model": MODEL})
    stop = threading.Event()

    def loop():
        while not stop.is_set():
            emit({
                "type": "metrics", "transformerMs": 9.0, "totalMs": 14.0,
                "bufferAvailable": 1638, "bufferCapacity": 2048, "bufferOccupancy": 0.8,
                "droppedFrames": 0, "underruns": 0, "rtf": 14.0 / FRAME_MS,
                "transportFlags": 0, "connected": True,
            })
            stop.wait(1.0)

    threading.Thread(target=loop, daemon=True).start()
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
            except json.JSONDecodeError:
                continue
            kind = cmd.get("cmd")
            if kind == "quit":
                break
            log(f"{kind} {cmd.get('prompts') or cmd.get('params') or ''}")
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        time.sleep(0.05)


def main():
    try:
        run_real()
    except ImportError as e:
        run_stub(f"import failed: {e}")
    except Exception as e:        # any setup failure (audio device, model assets) -> degrade
        log(f"real path failed ({e!r}); falling back to stub")
        run_stub(f"real path error: {e}")


if __name__ == "__main__":
    main()
