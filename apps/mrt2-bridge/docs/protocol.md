# Protocol

Two protocols meet in this bridge: the bridge's **own rich envelope** (internal,
Zod‑validated) and **Lichtspiel's minimal wire** (the adapter down‑converts to
it). They are intentionally different.

## The bridge envelope (rich)

Defined in `src/schemas/wire.ts` as a Zod discriminated union. Every message:

| Field | Type | Notes |
| --- | --- | --- |
| `type` | string literal | the discriminator (13 types below) |
| `schemaVersion` | `1` | bumped on breaking changes |
| `seq` | int ≥ 0 | **monotonic per `source`** (one counter each) |
| `timestamp` | number | epoch ms (from the injected Clock) |
| `source` | `ableton`\|`mrt2`\|`lichtspiel`\|`monome`\|`core`\|`demo` | producer |
| `sourceInstanceId` | string | unique per adapter instance |
| `sessionId` | string | performance session |
| `causeId` | string | this message's lineage node |
| `parentCauseId` | string? | the message that caused this one |
| `transport` | `{bar,beat}`? | optional musical position |
| `payload` | per‑type | validated by the per‑type schema |

`makeMessage()` stamps the envelope and bumps the per‑source `seq`.
`parseMessage()` / `safeParseMessage()` validate at boundaries.
`causeId`/`parentCauseId` feed the `LineageTracker` for loop prevention.

### Message types

| `type` | payload | direction |
| --- | --- | --- |
| `magenta.state` | `{ ready, model, promptBlend }` | MRT2 → bridge |
| `magenta.prompt.update` | `{ promptBlend: PromptSlot[≤6], applyAt: 'immediate'\|'next_bar' }` | bridge → MRT2 |
| `magenta.params.update` | `{ temperature?, topK?, cfgMusiccoca?, cfgNotes?, cfgDrums?, unmaskWidth?, drumless? }` | bridge → MRT2 |
| `magenta.metrics` | see below | MRT2 → bridge |
| `magenta.transport` | `{ bar, beat, bpm, playing }` | MRT2 → bridge |
| `magenta.audio.features` | `{ rms, spectralCentroid, onsetRate }` (0..1; derived in the sidecar, not raw audio) | MRT2 → bridge |
| `av.state.transition` | `{ from, to, reason }` | bridge (internal) |
| `semantic.state` | the full `SemanticState` | bridge (internal) |
| `semantic.gesture` | `NormalizedGesture` | monome → bridge |
| `ableton.scene.launched` | `{ sceneName, sceneIndex, sceneId?, bar?, beat? }` | Ableton → bridge |
| `ableton.transport` | `{ bar, beat, bpm, playing }` | Ableton → bridge |
| `lichtspiel.visual.update` | `{ visualCluster, sceneLock, manualOverride, transitionMs, visualParamVector[16] }` | bridge → Lichtspiel |
| `system.health` | `{ ok, degraded, adapters: Record<string, 'up'\|'down'\|'mock'\|'disabled'>, detail? }` | bridge |

`magenta.metrics` payload (grounded in MRT2 `EngineMetrics`):
`{ transformerMs, totalMs, bufferAvailable, bufferCapacity, bufferOccupancy(0..1),
droppedFrames, underruns, rtf, transportFlags, connected, entropy? }`.
**`entropy` is optional** — synthesized by the mock, derived by the real adapter.

`SemanticState` (all numerics 0..1, vector length 16):
`{ semanticPosition:{x,y,z}, energy, density, mutation, certainty, exploration,
visualCluster:string, promptBlend:PromptSlot[], visualParamVector:number[16] }`.
`PromptSlot = { promptId?, text, weight }`.

`NormalizedGesture = { source:'grid'|'arc', targetX?, targetY?, explorationDelta?,
blendDelta?, label }` (deltas already bounded to [-1,1]).

## The Lichtspiel wire (minimal) — re‑declared

`src/schemas/lichtspiel.ts` mirrors Lichtspiel exactly: envelope
`{ v: 1, ts, type, payload }`; guard checks only `v===1 && typeof ts==='number'
&& typeof type==='string'`. Subset we use:

| `type` | payload |
| --- | --- |
| `hello` | `{ protocolVersion: 1, role: 'bridge' }` |
| `status` | `{ bridge, p5Clients, maxConnected, monomeConnected, mlConnected, lastError? }` |
| `params.update` | `Partial<VisualParamVector>` (`sceneId` + 15 numeric 0..1 keys) |
| `scene.launched` | `{ index, name }` |
| `monome.event` | `grid.key` \| `arc.delta` \| `arc.key` |

`VisualParamVector` numeric keys, in order:
`density, motion, turbulence, symmetry, strobe, cameraDepth, rotationX, rotationY,
rotationZ, palette, contrast, lineWeight, feedback, mutationAmount, semanticDistance`.

### Down‑conversion: `lichtspiel.visual.update` → `params.update`

The 16‑float `visualParamVector` indices 0..14 map **identity‑in‑order** onto the
15 `NUMERIC_PARAM_KEYS`; index 15 (`energyReserve`) is bridge‑internal and
dropped. `sceneId` comes from the visual cluster via a template LUT
(`sand-metal-organic → patternGridWorld`, `neon-grid-organic → lichtspielOpus`,
else `minimalPulse`). See `PromptMapper.vectorToLichtspielParams` /
`clusterToSceneId`.

Canonical vector index → meaning:

```
0 density   1 motion    2 turbulence 3 symmetry  4 strobe     5 cameraDepth
6 rotationX 7 rotationY 8 rotationZ  9 palette  10 contrast  11 lineWeight
12 feedback 13 mutationAmount 14 semanticDistance 15 energyReserve (internal)
```

## The safety pipeline (order)

`SafetyController.admit(msg)` runs, short‑circuiting on the first failure:

1. **stale** — `now - timestamp > staleMessageMs` → drop
2. **causal loop** — `LineageTracker.wouldLoop(cause, target)` → drop
3. **override / scene‑lock** — manual override pauses automatic semantic updates;
   scene lock drops the visual→audio (`magenta.params.update`) branch
4. **rate‑limit** — prompts ≤ 4/s, params ≤ 10/s (sliding window)
5. **deadband** — visual vector change `< 0.03` → drop
6. **smoothing** — EMA toward target over `smoothingMs` (mutates, never drops)
7. **mod‑depth** — `clampModulation` bounds visual→audio influence to ±0.15
8. **quantization** — a `next_bar` prompt mid‑bar is **deferred** and released by
   `tickQuantizer` at the downbeat

`emergencyBypass()` skips all of it and returns the deterministic
`DEFAULT_SEMANTIC_STATE`.

Defaults (asserted in tests): `{ maxPromptUpdatesPerSecond: 4,
maxParamUpdatesPerSecond: 10, deadband: 0.03, smoothingMs: 250,
staleMessageMs: 2000, maxVisualToAudioModDepth: 0.15,
quantizePromptChanges: 'next_bar' }`.

## Causal‑loop rule

Per cause we track the ordered `kinds` of sources traversed from the root.
`wouldLoop(cause, target)`:

- `target = audio-prompt` and lineage includes `mrt2` **or** `lichtspiel` → loop
- `target = audio-param` and lineage includes `mrt2` → loop
- `target = visual` and lineage includes `lichtspiel` ≥ 2× → loop
- `depth ≥ maxDepth` → loop

Net DAG: `external → {audio, visual}`, `metrics → visual only`, bounded terminal
`visual → audio param`.
