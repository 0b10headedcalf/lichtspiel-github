/**
 * Lichtspiel p5 runtime — entry point. Wires the template registry, the
 * sketch host (with param smoothing), the keyboard fallback, the on-screen
 * monome emulator, the diagnostics HUD, and the optional live-bridge client.
 *
 * Runs fully in browser-only mode: no Ableton, no bridge, no ML needed.
 */

import './style.css';
import {
  type LedFramePayload,
  type NumericParamKey,
  type VisualParamVector,
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

// ── Bus wiring ───────────────────────────────────────────────────────
bus.on('scene.select', ({ sceneId }) => {
  const t = registry.get(sceneId);
  if (t) selectScene(t, false);
});

bus.on('params.patch', (patch) => host.setTargetParams(patch));

bus.on('live.state', (state) => {
  host.setLive(state);
  debug.setLive(state); // visible confirmation of the M4L → bridge → p5 path
  // Phase 5 will route Live state through retrieval to pick a scene.
});

bus.on('status', ({ connected }) => {
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
});

// ── Optional bridge connection ───────────────────────────────────────
// (bridge + wsUrl are created above so the twin + host can forward LED frames.)
bridge.connect();

// ── Boot ─────────────────────────────────────────────────────────────
const first = registry.at(0);
if (first) selectScene(first, true); // mount via the browser so the panel initializes
console.info(
  `[lichtspiel] p5 runtime up — ${registry.size} templates. ` +
    `Press 'd' HUD · 'g' monome twin · 'h' gestures · 'v/c/,/.' variants. ` +
    `Bridge: ${wsUrl} (optional).`,
);
