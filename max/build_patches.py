#!/usr/bin/env python3
"""Generate the Lichtspiel Max patches with MaxPyLang (pip install maxpylang).

This produces a valid `.maxpat` for the Live-API → OSC probe so we don't
hand-author fragile patcher JSON. Run:

    max/.venv/bin/python max/build_patches.py

It emits `max/patches/lichtspiel_probe.maxpat`. The patch reads Live state via
`js live_api_helpers.js` (driven by loadbang + a metro heartbeat) and sends it
to the bridge as OSC:  js → [prepend /lichtspiel/state] → [udpsend 127.0.0.1 7400].

For Max for Live, see max/docs/max_patch_notes.md (add `live.thisdevice` +
device UI in the GUI — MaxPyLang doesn't carry the `live.*` object metadata).
"""
import os
import maxpylang as mp
from maxpylang.xlet import Inlet, Outlet

HERE = os.path.dirname(os.path.abspath(__file__))
JS_DIR = os.path.join(HERE, "js")
OUT = os.path.join(HERE, "patches", "lichtspiel_probe.maxpat")

# Run from the js folder so MaxPyLang can read live_api_helpers.js (inlets/outlets).
os.chdir(JS_DIR)

p = mp.MaxPatch(verbose=False)

loadbang = p.place("loadbang", starting_pos=[40, 40])[0]
start = p.place("message 1", starting_pos=[40, 100])[0]
metro = p.place("metro 250", starting_pos=[40, 160])[0]
# live.thisdevice bangs when the Live set is ready (Max for Live only; inert in
# standalone Max, where loadbang/metro still drive the patch for Test A).
live_dev = p.place("live.thisdevice", starting_pos=[260, 160])[0]
js = p.place("js live_api_helpers.js", starting_pos=[40, 240])[0]
prepend = p.place("prepend /lichtspiel/state", starting_pos=[40, 320])[0]
udpsend = p.place("udpsend 127.0.0.1 7400", starting_pos=[40, 380])[0]

# MaxPyLang doesn't carry xlet metadata for udpsend (and some others). Max
# re-derives real xlets on load; we just need valid Inlet/Outlet handles so the
# patchlines reference the right (objId, index). Populate any missing ones.
def ensure(obj, n_in, n_out):
    if not obj.ins:
        obj._ins = [Inlet(obj, i) for i in range(n_in)]
    if not obj.outs:
        obj._outs = [Outlet(obj, i) for i in range(n_out)]


ensure(js, 1, 1)
ensure(prepend, 1, 1)
ensure(udpsend, 1, 0)
ensure(live_dev, 0, 1)  # live.thisdevice: 1 outlet (bang on Live-set ready)


def out0(o):
    return o.outs[0]


def in0(o):
    return o.ins[0]


p.connect(
    [out0(loadbang), in0(start)],   # on load → "1"
    [out0(start), in0(metro)],      # "1" → start metro
    [out0(loadbang), in0(js)],      # on load → initial read
    [out0(metro), in0(js)],         # heartbeat → re-read
    [out0(live_dev), in0(js)],      # Live set ready (M4L) → read
    [out0(live_dev), in0(start)],   # Live set ready (M4L) → start metro
    [out0(js), in0(prepend)],       # JSON state → prepend address
    [out0(prepend), in0(udpsend)],  # OSC message → UDP to bridge
)

p.save(OUT, verbose=False, check=False)

# MaxPyLang serializes a `js` box's text as "js <ins> <outs> <file>", which Max
# would misread (the filename becomes the first number). Rewrite it to the
# canonical "js <file>"; xlet counts live in numinlets/numoutlets, not the text.
import json

with open(OUT) as f:
    doc = json.load(f)
for b in doc["patcher"]["boxes"]:
    bx = b["box"]
    fn = bx.get("saved_object_attributes", {}).get("filename")
    text = bx.get("text")
    if fn and isinstance(text, str) and text.split() and text.split()[0] in ("js", "v8"):
        bx["text"] = f"{text.split()[0]} {fn}"
with open(OUT, "w") as f:
    json.dump(doc, f, indent=1)

# Colocate the js next to the patch so Max finds it without a search-path edit
# (max/js holds the canonical source; this is a build copy).
import shutil

shutil.copy(os.path.join(JS_DIR, "live_api_helpers.js"), os.path.join(HERE, "patches", "live_api_helpers.js"))
print("wrote", OUT, "+ colocated live_api_helpers.js")


# ── 3a: controls patch — device knobs/buttons → p5 params/scene over OSC ──────
# live.dial(name) → [prepend /lichtspiel/param <name>] → [udpsend];
# scene message boxes → [prepend /lichtspiel/scene] → [udpsend].
# Paste this alongside the probe in the M4L device. NOTE: set the live.dials'
# range to 0.–1. in the inspector (select all → Range/Enum 0. to 1.).
CONTROLS = os.path.join(HERE, "patches", "lichtspiel_controls.maxpat")
PARAMS = ["density", "motion", "palette", "cameraDepth", "mutationAmount", "semanticDistance"]
SCENES = ["minimalPulse", "topographicTunnel", "gridWorld", "parquetGlitch", "torusField"]

c = mp.MaxPatch(verbose=False)
udp = c.place("udpsend 127.0.0.1 7400", starting_pos=[40, 520])[0]
ensure(udp, 1, 0)

conns = []
for i, name in enumerate(PARAMS):
    dial = c.place("live.dial", starting_pos=[40 + i * 110, 60])[0]
    ensure(dial, 1, 1)
    pre = c.place("prepend /lichtspiel/param " + name, starting_pos=[40 + i * 110, 160])[0]
    ensure(pre, 1, 1)
    conns.append([dial.outs[0], pre.ins[0]])
    conns.append([pre.outs[0], udp.ins[0]])

scene_pre = c.place("prepend /lichtspiel/scene", starting_pos=[40, 420])[0]
ensure(scene_pre, 1, 1)
conns.append([scene_pre.outs[0], udp.ins[0]])
for i, scene in enumerate(SCENES):
    msg = c.place("message " + scene, starting_pos=[40 + i * 150, 320])[0]
    ensure(msg, 1, 1)
    conns.append([msg.outs[0], scene_pre.ins[0]])

c.connect(*conns)
c.save(CONTROLS, verbose=False, check=False)
print("wrote", CONTROLS)
