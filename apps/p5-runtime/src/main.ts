/**
 * Lichtspiel p5 runtime — entry point. Wires the template registry, the
 * sketch host (with param smoothing), the keyboard fallback, the on-screen
 * monome emulator, the diagnostics HUD, and the optional live-bridge client.
 *
 * Runs fully in browser-only mode: no Ableton, no bridge, no ML needed.
 */

import './style.css';
import {
  type AbletonMapping,
  type LedFramePayload,
  type NumericParamKey,
  type VisualParamVector,
  ADE_SLEUTH_SNAPSHOT,
  clamp01,
  describeSetup,
  wire,
} from '@lichtspiel/schemas';
import { createMonomeDevices } from './monomeDevices.js';
import { createBus } from './messageBus.js';
import { SketchHost } from './sketchHost.js';
import { TemplateRegistry } from './templateRegistry.js';
import { TEMPLATES } from './templates/index.js';
import { installKeyboard } from './keyboard.js';
import { createMonomeMapping } from './monomeMapping.js';
import { DebugPanel } from './ui/debugPanel.js';
import { MonomeTwin } from './ui/monomeTwin.js';
import { GesturalPanel } from './ui/gesturalPanel.js';
import { BridgeClient } from './transport/bridgeClient.js';
import { randomizeParams, mutateParams } from './mutations/paramMutation.js';
import { createVariantBrowser } from './mutations/variantBrowser.js';
import {
  type AbletonEvent,
  type EventSource,
  type RetrievalMode,
  resolveActivation,
} from './live/abletonRetrieval.js';
import { mergeSnapshot, parseMapping } from './live/abletonMappings.js';
import { AbletonMappingPanel } from './ui/abletonMappingPanel.js';
import { createRng, randomSeed } from './seededRng.js';
import type { VisualTemplate } from './visualTemplate.js';

// ── DOM handles ──────────────────────────────────────────────────────
const stage = document.getElementById('stage') as HTMLElement;
const hud = document.getElementById('hud') as HTMLElement;
const hudHelp = document.getElementById('hud-help') as HTMLElement;
const twinEl = document.getElementById('monome-twin') as HTMLElement;
const connEl = document.getElementById('conn') as HTMLElement;

// ── Core wiring ──────────────────────────────────────────────────────
const bus = createBus();
const registry = new TemplateRegistry();
registry.registerAll(TEMPLATES);

// Authoritative monome state: real hardware (device.attached/detached) always
// wins over the twin's manual simulation. Starts empty (greyed) — with no
// hardware, click a size in the twin to simulate one (browser-only dev).
const devices = createMonomeDevices();

const debug = new DebugPanel(hud, hudHelp);

// Bridge client (optional) — created early so the twin + sketch host can forward
// LED frames to it. The connection is opened at the very end, once every bus
// handler is registered. Forwarding a led.frame reaches real monome hardware via
// the bridge's serialosc layer (and is a no-op in browser-only mode).
const wsUrl = `ws://${__BIND_HOST__}:${__BRIDGE_WS_PORT__}`;
const bridge = new BridgeClient({ url: wsUrl, bus });
const sendLedFrame = (payload: LedFramePayload): void => bridge.send(wire('led.frame', payload));

const twin = new MonomeTwin(twinEl, bus, devices, sendLedFrame);

const host = new SketchHost({
  parent: stage,
  getSize: () => ({ width: window.innerWidth, height: window.innerHeight }),
  getSetup: () => devices.active(),
  // Hardware-driven scene/variant control for idiom sketches (e.g. the Opus III
  // hero's extra grid-128 columns → scene-select). selectScene/doVariant are
  // hoisted function declarations; host is assigned before any sketch calls these.
  controls: {
    selectSceneIndex: (i) => {
      const t = registry.at(i);
      if (t) selectScene(t, true);
    },
    nextScene: () => {
      const t = registry.neighbor(host.currentTemplateId(), 1);
      if (t) selectScene(t, true);
    },
    prevScene: () => {
      const t = registry.neighbor(host.currentTemplateId(), -1);
      if (t) selectScene(t, true);
    },
    variant: () => doVariant(),
  },
  onFrame: ({ fps, params, templateId }) => {
    debug.setTemplateName(registry.get(templateId)?.name ?? templateId);
    debug.updateFrame(fps, params);
    // Feed the live visual state to the twin so the monome LEDs mirror it
    // (grid column faders + arc rings) in performance mode.
    twin.setFeedback(params, registry.all().findIndex((t) => t.id === templateId), registry.size);
  },
  // Sketch ledOut → the twin, which is the single LED authority and flushes the
  // resulting frame (template LEDs, performance feedback, or a sweep) to hardware.
  onLedFrameDirty: (frame) => twin.reflect(frame),
});

let locked = false;

// ── Ableton auto-retrieval state (Phase 5a) ──────────────────────────
// Two on-screen toggles: retrieval mode (mapped ⇄ random, key `m`) and event
// source (live OSC ⇄ simulated UI events, key `e`).
let retrievalMode: RetrievalMode = 'mapped';
let eventSource: EventSource = 'live';
let lastAutoId: string | undefined; // last auto-loaded template id (random mode avoids repeats)
// Synthetic events for the `simulated` source mirror the ADE_Sleuth test set.
const SIM_SCENES = ['Scene1', 'Scene2'];
const SIM_LOCATORS = ['Intro', 'buildup', 'Drop', 'next', 'hats back', 'END'];
let simSceneN = 0;
let simLocN = 0;

// Saved scene/locator → animation mapping (Phase 5b). Held here for the resolver;
// the panel edits it; localStorage caches it across reloads. The bridge owns the
// authoritative JSON files from Part C; named Save/Load use localStorage in this
// part (Part C re-points them to the bridge).
const MAPPING_LS = 'lichtspiel.ableton.mapping';
const NAMES_LS = 'lichtspiel.ableton.names';
function saveLocalMapping(m: AbletonMapping | null): void {
  try {
    if (m) localStorage.setItem(MAPPING_LS, JSON.stringify(m));
  } catch {
    /* ignore quota */
  }
}
function loadLocalMapping(): AbletonMapping | null {
  try {
    const raw = localStorage.getItem(MAPPING_LS);
    return raw ? parseMapping(raw) : null;
  } catch {
    return null;
  }
}
function localNames(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(NAMES_LS) ?? '[]');
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}
function localSaveNamed(name: string, m: AbletonMapping): void {
  try {
    localStorage.setItem(`lichtspiel.ableton.map.${name}`, JSON.stringify(m));
    const names = localNames().filter((n) => n !== name);
    names.push(name);
    localStorage.setItem(NAMES_LS, JSON.stringify(names));
  } catch {
    /* ignore quota */
  }
}
function localLoadNamed(name: string): AbletonMapping | null {
  try {
    const raw = localStorage.getItem(`lichtspiel.ableton.map.${name}`);
    return raw ? parseMapping(raw) : null;
  } catch {
    return null;
  }
}
let abletonMap: AbletonMapping | null = loadLocalMapping();
let bridgeConnected = false; // drives bridge-vs-local for Refresh/Save/Load (Phase 5b)

// The gestural panel (control map + variant readout, toggled with `h`) and the
// variant browser (new / canonical / step through each template's structural
// space, live). The browser is the single template-mount authority: it re-mounts
// at the active variant + refreshes the panel.
const panel = new GesturalPanel();
// Keep the panel in the left gutter, just below the HUD — re-anchored whenever the
// HUD's height changes (async font reflow, or bridge/live state appearing) so it can
// never overlap the HUD, and on window resize. Clear of the bottom-right twin.
const layoutPanel = (): void => panel.setTopPx(Math.round(hud.getBoundingClientRect().bottom) + 12);
layoutPanel();
window.addEventListener('resize', layoutPanel);
new ResizeObserver(layoutPanel).observe(hud);

/** Performer-intent params preserved across a scene/variant re-mount. */
function keepParams(): Partial<VisualParamVector> {
  return host.current()
    ? {
        semanticDistance: host.targetParams().semanticDistance,
        mutationAmount: host.targetParams().mutationAmount,
      }
    : {};
}

const variants = createVariantBrowser({
  apply: (template, seed, config) => {
    host.mount(template, { seed, config, params: keepParams() });
    panel.setDictionary(template.gestural);
    panel.setControlMap(host.describeControls()); // hardware-accurate live map
  },
  onChange: (info) => panel.setVariant(info),
  divergence: 0.6,
});

/** Switch scenes. Manual selects always win; bridge/retrieval selects respect lock. */
function selectScene(template: VisualTemplate, manual: boolean): void {
  if (!manual && locked) return;
  variants.show(template); // mount at the family's current variant + refresh the panel
}

// Ableton mapping panel (Phase 5b) — top-right, toggle `a`. Edits `mapping`
// above; Refresh pulls a snapshot (Part B: the ADE_Sleuth fixture; Part C: the
// bridge). Preview ▶ fires a row's event locally through respond().
const mappingPanel = new AbletonMappingPanel({
  templates: registry.catalog().map((t) => ({ id: t.id, name: t.name })),
  onRefresh: () => {
    // Bridge → real Ableton snapshot (fixture fallback there); browser-only → local fixture.
    if (bridgeConnected) {
      bridge.send(wire('ableton.snapshotRequest', {}));
      return;
    }
    abletonMap = mergeSnapshot(abletonMap, ADE_SLEUTH_SNAPSHOT);
    mappingPanel.setMapping(abletonMap);
    saveLocalMapping(abletonMap);
  },
  onSave: (name) => {
    if (!abletonMap) return;
    abletonMap = { ...abletonMap, setName: name, updatedAt: new Date().toISOString() };
    saveLocalMapping(abletonMap); // local cache, always
    mappingPanel.setMapping(abletonMap);
    if (bridgeConnected) {
      bridge.send(wire('mapping.request', { op: 'save', name, mapping: abletonMap }));
    } else {
      localSaveNamed(name, abletonMap);
      mappingPanel.setNames(localNames());
    }
  },
  onLoad: (name) => {
    if (bridgeConnected) {
      bridge.send(wire('mapping.request', { op: 'load', name }));
      return;
    }
    const m = localLoadNamed(name);
    if (m) {
      abletonMap = m;
      mappingPanel.setMapping(abletonMap);
      saveLocalMapping(abletonMap);
    }
  },
  onListRequest: () => {
    if (bridgeConnected) bridge.send(wire('mapping.request', { op: 'list' }));
    else mappingPanel.setNames(localNames());
  },
  onPreview: (evt) => respond(evt),
  onEdit: (m) => {
    abletonMap = m;
    saveLocalMapping(m);
  },
});
mappingPanel.setMapping(abletonMap);
mappingPanel.setSource(eventSource);
mappingPanel.setFallback(retrievalMode);
mappingPanel.setLock(locked);

// ── Bus wiring ───────────────────────────────────────────────────────
bus.on('scene.select', ({ sceneId }) => {
  const t = registry.get(sceneId);
  if (t) selectScene(t, false);
});

bus.on('params.patch', (patch) => host.setTargetParams(patch));

bus.on('live.state', (state) => {
  host.setLive(state);
  debug.setLive(state); // visible confirmation of the M4L → bridge → p5 path
});

// Phase 5a — Ableton auto-retrieval. A Session scene launch or an Arrangement
// locator crossing loads a fresh random *variant* of a picked template (idioms
// stay live, so it's instantly monome-playable). Respects the on-screen lock —
// an auto-swap never overrides a locked performer. In `live` source these arrive
// from the M4L device via the bridge; in `simulated` source they're fired from
// the keyboard (k/l) through this same path.
function respond(evt: AbletonEvent): void {
  const d = resolveActivation(evt, abletonMap, retrievalMode, registry, lastAutoId);
  if (d.kind === 'none') return;
  if (locked) {
    // Event received, but the performer locked the visual — surface it, don't swap.
    debug.setAbletonEvent(evt, '(locked)', { suppressed: 'lock' });
    mappingPanel.markTriggered(evt, '🔒 locked');
    return;
  }
  if (d.kind === 'suppressed') {
    debug.setAbletonEvent(evt, '(row off)', { suppressed: 'disabled' });
    mappingPanel.markTriggered(evt, '— off');
    return;
  }
  lastAutoId = d.template.id;
  // Parent template → child variant: canonical (signature) or a fresh random one.
  if (d.variantMode === 'canonical') variants.canonical(d.template);
  else variants.newVariant(d.template);
  debug.setAbletonEvent(evt, d.template.name);
  mappingPanel.markTriggered(evt, d.template.name);
  bridge.send(
    wire('visual.activated', {
      kind: evt.kind,
      index: evt.index,
      name: evt.name,
      templateId: d.template.id,
      variantMode: d.variantMode,
      activatedAt: Date.now(),
    }),
  );
}

bus.on('scene.launched', (p) => {
  if (eventSource === 'live') respond({ kind: 'scene', index: p.index, name: p.name });
});
bus.on('locator.crossed', (p) => {
  if (eventSource === 'live') respond({ kind: 'locator', index: p.index, name: p.name });
});

// Phase 5b — snapshot + mapping persistence from the bridge.
bus.on('ableton.snapshot', (snap) => {
  abletonMap = mergeSnapshot(abletonMap, snap);
  mappingPanel.setMapping(abletonMap);
  saveLocalMapping(abletonMap);
});
bus.on('mapping.result', (r) => {
  if (r.op === 'list') {
    mappingPanel.setNames(r.names ?? []);
  } else if (r.op === 'load' && r.ok && r.mapping) {
    abletonMap = r.mapping;
    mappingPanel.setMapping(abletonMap);
    saveLocalMapping(abletonMap);
  } else if (r.op === 'save') {
    if (r.names) mappingPanel.setNames(r.names);
    if (!r.ok) console.warn('[lichtspiel] mapping save failed:', r.error);
  }
});

bus.on('status', ({ connected }) => {
  bridgeConnected = connected;
  debug.setConnected(connected);
  connEl.textContent = connected ? 'bridge connected' : 'browser-only';
  connEl.classList.toggle('live', connected);
});

// Monome (real or emulated) → the profile-aware column-fader idiom + per-sketch dispatch.
const mapping = createMonomeMapping(() => devices.active(), {
  setParam: (key, value) => host.setTargetParams({ [key]: value } as Partial<VisualParamVector>),
  nudgeParam: (key, delta) => adjustKey(key, delta),
  selectSceneIndex: (i) => {
    const t = registry.at(i);
    if (t) selectScene(t, true);
  },
  nextScene: () => {
    const t = registry.neighbor(host.currentTemplateId(), 1);
    if (t) selectScene(t, true);
  },
  surprise: () => doSurprise(),
});

// Idiom-vs-global-mapping gate: when the active template declares `idioms`, its
// sketch owns grid/arc events (via its idiom layer), so we SKIP the global
// column-fader mapping for them. The global mapping stays the fallback for the
// legacy visual-only templates that declare no idioms.
const usesIdioms = (): boolean => (host.current()?.idioms?.length ?? 0) > 0;
bus.on('monome.grid', (e) => {
  if (!usesIdioms()) mapping.onGrid(e);
  host.dispatchGridKey(e);
});
bus.on('monome.arcDelta', (e) => {
  if (!usesIdioms()) mapping.onArcDelta(e);
  host.dispatchArcDelta(e);
});
bus.on('monome.arcKey', (e) => {
  if (!usesIdioms()) mapping.onArcKey(e);
  host.dispatchArcKey(e);
  // A chord may have flipped the encoder page — refresh the panel (no-op if unchanged).
  panel.setControlMap(host.describeControls());
});

// Device detection → adapt. Real hardware (serialosc device.attached/detached)
// and the twin's manual switch (monome.setup → simulation) both flow through the
// authoritative `devices` model; real hardware always wins. One subscriber
// re-points everything when the *active* setup changes.
bus.on('device.attached', (d) => devices.attach(d));
bus.on('device.detached', (d) => devices.detach(d));
bus.on('monome.setup', (s) => devices.setSimulated(s));
devices.onChange((active, src) => {
  twin.setSetup(active);
  host.setProfile(active); // hot-swap: reshape the active sketch's idioms in place
  panel.setControlMap(host.describeControls()); // re-render the panel for the new hardware
  console.info(`[lichtspiel] monome (${src}) → ${describeSetup(active)}`);
});

// ── Keyboard handlers ────────────────────────────────────────────────
function adjustKey(key: NumericParamKey, delta: number): void {
  const cur = host.targetParams();
  host.setTargetParams({ [key]: clamp01(cur[key] + delta) } as Partial<VisualParamVector>);
}

function doRandomize(): void {
  const t = host.current();
  const rng = createRng(randomSeed());
  host.setTargetParams(randomizeParams(rng, { ranges: t?.safeParamRanges }));
}

function doSurprise(): void {
  // jump to a different scene + a bold mutation
  const cur = host.currentTemplateId();
  const others = registry.all().filter((t) => t.id !== cur);
  const rng = createRng(randomSeed());
  if (others.length) {
    const next = others[rng.int(others.length)] as VisualTemplate;
    selectScene(next, true);
  }
  host.setTargetParams(mutateParams(host.targetParams(), rng, { amount: 0.5 }));
}

/** New random structural variant of the current scene (via the variant browser). */
function doVariant(): void {
  const t = host.current();
  if (t) variants.newVariant(t);
}

installKeyboard({
  selectIndex: (i) => {
    const t = registry.at(i);
    if (t) selectScene(t, true);
  },
  next: () => {
    const t = registry.neighbor(host.currentTemplateId(), 1);
    if (t) selectScene(t, true);
  },
  prev: () => {
    const t = registry.neighbor(host.currentTemplateId(), -1);
    if (t) selectScene(t, true);
  },
  adjust: adjustKey,
  toggleLock: () => {
    locked = !locked;
    debug.setLock(locked);
    mappingPanel.setLock(locked);
  },
  randomize: doRandomize,
  surprise: doSurprise,
  variant: doVariant,
  canonical: () => {
    const t = host.current();
    if (t) variants.canonical(t);
  },
  stepVariant: (dir) => {
    const t = host.current();
    if (t) variants.step(t, dir);
  },
  toggleDebug: () => debug.toggle(),
  toggleEmulator: () => twin.toggle(),
  toggleGestural: () => panel.toggle(),
  toggleAbletonPanel: () => mappingPanel.toggle(),
  cycleRetrievalMode: () => {
    retrievalMode = retrievalMode === 'mapped' ? 'random' : 'mapped';
    debug.setRetrievalMode(retrievalMode);
    mappingPanel.setFallback(retrievalMode);
    console.info(`[lichtspiel] retrieval mode → ${retrievalMode}`);
  },
  cycleEventSource: () => {
    eventSource = eventSource === 'live' ? 'simulated' : 'live';
    debug.setEventSource(eventSource);
    mappingPanel.setSource(eventSource);
    console.info(`[lichtspiel] event source → ${eventSource}`);
  },
  simulateSceneLaunch: () => {
    if (eventSource !== 'simulated') {
      console.info('[lichtspiel] switch event source to "simulated" (e) to fire synthetic events');
      return;
    }
    const i = simSceneN++ % SIM_SCENES.length;
    respond({ kind: 'scene', index: i, name: SIM_SCENES[i] as string });
  },
  simulateLocator: () => {
    if (eventSource !== 'simulated') {
      console.info('[lichtspiel] switch event source to "simulated" (e) to fire synthetic events');
      return;
    }
    const i = simLocN++ % SIM_LOCATORS.length;
    respond({ kind: 'locator', index: i, name: SIM_LOCATORS[i] as string });
  },
});

// ── Optional bridge connection ───────────────────────────────────────
// (bridge + wsUrl are created above so the twin + host can forward LED frames.)
bridge.connect();

// ── Boot ─────────────────────────────────────────────────────────────
const first = registry.at(0);
if (first) selectScene(first, true); // mount via the browser so the panel initializes
console.info(
  `[lichtspiel] p5 runtime up — ${registry.size} templates. ` +
    `Press 'd' HUD · 'g' twin · 'h' gestures · 'a' Ableton mapping · 'v/c/,/.' variants. ` +
    `Bridge: ${wsUrl} (optional).`,
);
