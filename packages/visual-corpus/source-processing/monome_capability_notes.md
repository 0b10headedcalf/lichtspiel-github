# Monome Controller Capability Notes for Processing Sketches

This note summarizes the controller behavior verified in the current Processing diagnostic for the **Monome Grid 64 + Arc 2** setup, and compares it to the earlier **Grid 128 + Arc 4** setup used in other AV / Processing sketches.

Use this as implementation guidance for agentic coding tools when assigning visual/audio control responsibilities to the Monome devices.

---

## Current Device Set: Grid 64 + Arc 2

```java
String GRID_SERIAL = "m64_0175";
String ARC_SERIAL  = "m0000174";
```

### Likely hardware generation

Based on observed behavior and Monome’s edition notes:

- `m64_0175` appears to behave like a **2007–2010 “series” Grid 64**.
- This generation is **8 × 8**, **monobright**, bus-powered, and includes a **tilt sensor**.
- “Monobright” means the individual key LEDs are effectively **off/on only**.
- However, the Grid still appears to support **global LED intensity** via serialosc.

The Arc device `m0000174` behaves like an **Arc 2 with two encoder rings**. The diagnostic has shown encoder rotation, ring LED brightness, and apparent encoder key/click events. If key events are truly present, this may behave closer to the **2011 Arc generation**, since Monome’s edition notes describe 2011 arcs as having encoder keypresses and 2012 arcs as having no keypress. Trust live OSC behavior over the enclosure description.

---

## Confirmed / expected Grid 64 behavior

### Physical layout

```text
8 columns × 8 rows = 64 keys
x: 0–7
y: 0–7
```

### Inputs

Grid button input arrives as:

```text
/PREFIX/grid/key x y s
```

Where:

```text
x = column
 y = row
s = state, 1 down / 0 up
```

### LED output: binary per key

For this Grid 64, treat normal per-key LED control as binary:

```text
/PREFIX/grid/led/set x y s
/PREFIX/grid/led/all s
/PREFIX/grid/led/row x y d
/PREFIX/grid/led/col x y d
/PREFIX/grid/led/map x y d[8]
```

Recommended normal display path:

```java
sendOsc(gridAddr, PREFIX + "/grid/led/set", x, y, on ? 1 : 0);
```

or for efficient full-row / full-column updates:

```java
sendOsc(gridAddr, PREFIX + "/grid/led/row", 0, y, bitmask);
sendOsc(gridAddr, PREFIX + "/grid/led/col", x, 0, bitmask);
```

### LED output: global intensity

The Grid appears to support global brightness/intensity:

```text
/PREFIX/grid/led/intensity i
```

Where:

```text
i = 0–15
```

Important distinction:

```text
Per-key state:       off/on only
Global intensity:    one shared brightness value for all currently-on LEDs
```

So the Grid can do:

```text
binary spatial pattern + global dimmer
```

It likely cannot do:

```text
different brightness values per individual key
```

### LED output: per-key level messages

serialosc supports level messages:

```text
/PREFIX/grid/led/level/set x y i
/PREFIX/grid/led/level/all i
/PREFIX/grid/led/level/map x y d[32]
/PREFIX/grid/led/level/row x y d[8]
/PREFIX/grid/led/level/col x y d[8]
```

But on this Grid 64 these should be considered **diagnostic-only** unless future tests prove otherwise. In the current diagnostic, logical brightness values appear in Processing, but the physical Grid appears to collapse per-key brightness into off/on.

Recommended abstraction:

```java
int logicalLevel = 0..15;       // useful for internal sketch state
boolean physicalOn = level > 0; // what the Grid 64 can actually show per key
```

### Tilt sensor

The likely “series” Grid 64 includes a tilt sensor. Enable it with:

```text
/PREFIX/tilt/set n s
```

Usually:

```text
n = 0
s = 1 enable, 0 disable
```

Incoming tilt data:

```text
/PREFIX/tilt n x y z
```

The diagnostic normalizes `x`, `y`, and `z` as 8-bit-ish values. For sketch design, do not assume calibrated physical units; treat tilt as expressive continuous control.

Recommended tilt uses:

- global scene lean / camera drift
- gravity vector
- field bias
- particle flow direction
- noise offset
- crosshair / cursor / attractor position
- global modulation depth

Implementation note: live tilt-to-grid LED feedback should be rate-limited, for example to ~30 Hz, and should use row/column or map messages rather than spamming 64 individual LED messages every frame.

---

## Confirmed / expected Arc 2 behavior

### Physical layout

```text
2 encoders
64 LEDs per encoder ring
```

### Encoder rotation input

```text
/PREFIX/enc/delta n d
```

Where:

```text
n = encoder index, 0–1
d = signed delta
```

Recommended uses:

- continuous parameter control
- phase / rotation / orbit speed
- loop length or loop offset
- filter cutoff / resonance / density
- object size / zoom
- physics impulse / damping
- interpolation target control

### Encoder key input

```text
/PREFIX/enc/key n s
```

Where:

```text
n = encoder index
s = 1 down / 0 up
```

Observed behavior suggests this device may send key events. Still, because some Arc generations do not have encoder keypresses, sketches should degrade gracefully:

```java
boolean arcKeySeen = false;
```

Design pattern:

- Use encoder rotation for required controls.
- Use encoder clicks only for optional toggles, mode switches, or “nice to have” actions.
- Provide keyboard fallback for any critical click behavior.

### Ring LED output

Arc ring LEDs support 16 levels:

```text
/PREFIX/ring/set n x a
/PREFIX/ring/all n a
/PREFIX/ring/map n d[32]
/PREFIX/ring/range n x1 x2 a
```

Where:

```text
n = ring index, 0–1
x = LED index, 0–63
a = brightness, 0–15
```

Recommended ring display roles:

- playhead position
- phase visualization
- loop start/end/range
- parameter amount
- velocity/energy display
- selected mode indication
- gradient / trail / decay feedback

Because Arc ring LEDs support true 0–15 levels, the Arc should carry the richer brightness language that the older Grid 64 cannot display per key.

---

## Previous Device Set: Grid 128 + Arc 4

Earlier sketches in this project used a **Monome Grid 128 + Arc 4** configuration.

Historical project serials have included:

```java
String GRID128_SERIAL = "m2949672";   // sometimes seen/referenced with trailing digit ambiguity
String ARC4_SERIAL    = "m0000007";
```

Project memory also includes a newer convention for future sketches:

```java
String GRID64_SERIAL = "m64_0175";
String ARC2_SERIAL   = "m0000174";
```

### Grid 128 expected differences

A Grid 128 has:

```text
16 columns × 8 rows = 128 keys
x: 0–15
y: 0–7
```

Compared to the Grid 64:

- Twice the horizontal resolution.
- Better suited for sequencers, 16-step patterns, page layouts, and multiple fader columns.
- Existing project sketches used Grid 128 for step sequencing and grouped fader controls.
- Depending on edition, Grid 128 may or may not support per-key variable brightness. Do not assume without testing the specific hardware.

Recommended Grid 128 roles:

- 16-step sequencer lanes
- multiple vertical faders
- pattern matrix
- object assignment grid
- scene launcher
- performance mute/solo/toggle layer

Recommended Grid 64 roles:

- compact mode selector
- 8-step sequencer
- state toggles
- 4 × 4 or 8 × 8 macro map
- binary topology / cellular pattern map
- live tilt control companion

### Arc 4 expected differences

An Arc 4 has:

```text
4 encoders
64 LEDs per encoder ring
```

Compared to the Arc 2:

- Twice as many continuous controls.
- Better suited for direct one-knob-per-object or one-knob-per-axis mappings.
- Existing project sketches used Arc 4 heavily for multi-object control, playheads, loop lengths, roulette-like physics, and four independent animation lanes.

Recommended Arc 4 roles:

- four simultaneous object controllers
- four independent loop playheads
- four axes / layers / voices
- four independent visual engines
- one encoder per quadrant
- one encoder per audio stem or rhythmic voice

Recommended Arc 2 roles:

- two high-level macro controls
- A/B layer morphing
- dual-axis phase control
- global motion + global density
- foreground/background control pair
- two scene voices rather than four independent object channels

---

## Practical Mapping Guidance

### Use the Grid 64 for discrete state, not fine brightness

Because the current Grid 64 appears monobright per key, avoid assigning meaning to individual button LED brightness levels. Instead use:

- off/on state
- blink rate
- spatial density
- pattern shape
- global intensity
- row/column position
- temporal animation

Good mappings:

```text
button on/off         → enable/disable object, step, layer, mode
row position          → category or parameter bank
column position       → step index, fader-like value, or pattern coordinate
global intensity      → overall visual brightness / scene energy / UI intensity
tilt x/y              → camera drift, gravity vector, attractor position
tilt z                → depth, zoom, field pressure, global modulation depth
```

Avoid:

```text
per-button opacity
per-button velocity shown as brightness
multi-level fader LEDs using per-key brightness
```

Unless the sketch stores logical levels internally and displays them only in Processing.

### Use the Arc 2 for continuous and varibright feedback

The Arc 2 should carry high-resolution continuous interaction and real ring brightness feedback.

Good mappings:

```text
encoder 0 rotation    → phase, rotation speed, loop length, camera orbit
encoder 1 rotation    → density, zoom, reaction rate, feedback amount
encoder click         → optional toggle, reset, randomize, mode switch
ring brightness       → true 0–15 feedback
ring playhead         → loop phase / animation phase
ring range            → active region / loop window
ring trail            → inertia / decay / velocity
```

### If porting from Grid 128 + Arc 4 to Grid 64 + Arc 2

Do not port controls one-to-one. Compress the interaction model:

| Earlier Grid 128 + Arc 4 role | Grid 64 + Arc 2 replacement |
|---|---|
| 16-step grid sequencer | 8-step sequencer, two pages, or 8×8 state matrix |
| 4 vertical fader groups | 2 macro faders, page-switching, or grid-as-mode-selector |
| 4 independent Arc-controlled objects | 2 macro-controlled object groups |
| one Arc encoder per object | one Arc encoder per layer/category |
| per-key level feedback if available | binary LED state + global intensity only |
| Arc 4 four playheads | Arc 2 two playheads or two global phase clocks |

---

## Recommended Processing Architecture

### Use raw serialosc OSC discovery

This project previously had issues where Grid and Arc routing could conflict when using higher-level wrappers. Prefer raw serialosc routing:

```java
OscP5 osc;
NetAddress serialoscAddr;
NetAddress gridAddr;
NetAddress arcAddr;

final String PREFIX = "/pgtest";
final int SERIALOSC_PORT = 12002;
final int APP_PORT = 13333;
```

Discover devices with:

```text
/serialosc/list host port
```

Handle replies:

```text
/serialosc/device id type port
```

Then configure each device:

```text
/sys/host host
/sys/port appPort
/sys/prefix prefix
/sys/query
/sys/size
```

### Separate handlers by device subsystem

Recommended Processing function structure:

```java
void handleGridKey(int x, int y, int s) { ... }
void handleTilt(int n, int x, int y, int z) { ... }
void handleArcDelta(int n, int d) { ... }
void handleArcKey(int n, int s) { ... }
```

Avoid mixing Grid and Arc logic inside a generic event handler except for initial route dispatch.

### Rate-limit high-frequency output

Avoid sending too many OSC messages per frame, especially during tilt feedback or automated tests.

Recommended:

```java
// around 30 Hz for live tilt LED feedback
if (millis() - lastTiltGridUpdateMs < 33) return;
```

Prefer efficient messages:

```text
/grid/led/row
/grid/led/col
/grid/led/map
/ring/range
/ring/all
```

Instead of many individual LED messages when possible.

### Avoid blocking delay()

Do not use `delay()` for diagnostics or performance animation. It blocks Processing’s draw loop and can make OSC input appear frozen.

Use a non-blocking scheduler:

```java
if (millis() >= nextStepMs) {
  advanceTestStep();
  nextStepMs = millis() + interval;
}
```

---

## Capability Matrix

| Capability | Grid 64 `m64_0175` | Arc 2 `m0000174` | Grid 128 previous | Arc 4 previous |
|---|---:|---:|---:|---:|
| Main control type | buttons + tilt | encoders + rings | buttons | encoders + rings |
| Physical controls | 64 keys | 2 encoders | 128 keys | 4 encoders |
| Layout | 8×8 | 2 × 64 LED rings | 16×8 | 4 × 64 LED rings |
| Per-key / per-LED binary state | yes | n/a | yes | n/a |
| Per-key variable brightness | likely no | n/a | depends on edition | n/a |
| Global grid intensity | yes, 0–15 | n/a | likely yes if supported by serialosc | n/a |
| Ring LED brightness | n/a | yes, 0–15 | n/a | yes, 0–15 |
| Encoder rotation | n/a | yes | n/a | yes |
| Encoder key/click | n/a | observed, but design as optional | n/a | available if hardware sends `/enc/key` |
| Tilt | likely yes | no | depends on edition | no |
| Best role | binary state + tilt | continuous macro control | sequencer / matrix | multi-channel continuous control |

---

## Design Summary

For **Grid 64 + Arc 2** sketches:

```text
Grid 64 = discrete state, binary patterning, mode selection, tilt input, global intensity
Arc 2   = continuous control, phase/playhead feedback, true ring brightness, macro modulation
```

For **Grid 128 + Arc 4** sketches:

```text
Grid 128 = larger sequencing/matrix/fader surface
Arc 4    = four independent continuous control lanes
```

When adapting older Grid 128 + Arc 4 sketches to the current Grid 64 + Arc 2 setup, reduce the number of independent control lanes, move fine continuous control to the Arc, and use the Grid as a compact binary state surface plus tilt sensor.

---

## Source References

- Monome Grid editions: https://monome.org/docs/grid/editions/
- Monome Arc editions: https://monome.org/docs/arc/editions/
- serialosc OSC reference: https://monome.org/docs/serialosc/osc/
- serialosc serial protocol details: https://monome.org/docs/serialosc/serial.txt
