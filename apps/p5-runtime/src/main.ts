/**
 * Lichtspiel p5 runtime — entry point. Wires the template registry, the
 * sketch host (with param smoothing), the keyboard fallback, the on-screen
 * monome emulator, the diagnostics HUD, and the optional live-bridge client.
 *
 * Runs fully in browser-only mode: no Ableton, no bridge, no ML needed.
 */

import './style.css';
import {
  type MonomeSetup,
  type NumericParamKey,
  type VisualParamVector,
  DEFAULT_SETUP,
  clamp01,
  describeSetup,
  profileFromAttached,
} from '@lichtspiel/schemas';
import { createBus } from './messageBus.js';
import { SketchHost } from './sketchHost.js';
import { TemplateRegistry } from './templateRegistry.js';
import { TEMPLATES } from './templates/index.js';
import { installKeyboard } from './keyboard.js';
import { createMonomeMapping } from './monomeMapping.js';
import { DebugPanel } from './ui/debugPanel.js';
import { MonomeEmulator } from './ui/monomeEmulator.js';
import { BridgeClient } from './transport/bridgeClient.js';
import { randomizeParams, mutateParams } from './mutations/paramMutation.js';
import { createRng, randomSeed } from './seededRng.js';
import type { VisualTemplate } from './visualTemplate.js';

// ── DOM handles ──────────────────────────────────────────────────────
const stage = document.getElementById('stage') as HTMLElement;
const hud = document.getElementById('hud') as HTMLElement;
const hudHelp = document.getElementById('hud-help') as HTMLElement;
const emulatorEl = document.getElementById('monome-emulator') as HTMLElement;
const connEl = document.getElementById('conn') as HTMLElement;

// ── Core wiring ──────────────────────────────────────────────────────
const bus = createBus();
const registry = new TemplateRegistry();
registry.registerAll(TEMPLATES);

// Active monome setup — defaults to the primary target (grid 64 + arc 2),
// updated by the emulator switcher or a real device.attached from the bridge.
let setup: MonomeSetup = DEFAULT_SETUP;

const debug = new DebugPanel(hud, hudHelp);
const emulator = new MonomeEmulator(emulatorEl, bus, setup);

const host = new SketchHost({
  parent: stage,
  getSize: () => ({ width: window.innerWidth, height: window.innerHeight }),
  onFrame: ({ fps, params, templateId }) => {
    debug.setTemplateName(registry.get(templateId)?.name ?? templateId);
    debug.updateFrame(fps, params);
  },
  onLedFrameDirty: (frame) => emulator.reflect(frame),
});

let locked = false;

/** Switch scenes. Manual selects always win; bridge/retrieval selects respect lock. */
function selectScene(template: VisualTemplate, manual: boolean): void {
  if (!manual && locked) return;
  const prev = host.current();
  // Preserve performer-intent params across scene switches.
  const keep: Partial<VisualParamVector> = prev
    ? {
        semanticDistance: host.targetParams().semanticDistance,
        mutationAmount: host.targetParams().mutationAmount,
      }
    : {};
  host.mount(template, { params: keep });
}

// ── Bus wiring ───────────────────────────────────────────────────────
bus.on('scene.select', ({ sceneId }) => {
  const t = registry.get(sceneId);
  if (t) selectScene(t, false);
});

bus.on('params.patch', (patch) => host.setTargetParams(patch));

bus.on('live.state', (state) => {
  host.setLive(state);
  // Phase 5 will route Live state through retrieval to pick a scene.
});

bus.on('status', ({ connected }) => {
  debug.setConnected(connected);
  connEl.textContent = connected ? 'bridge connected' : 'browser-only';
  connEl.classList.toggle('live', connected);
});

// Monome (real or emulated) → the profile-aware column-fader idiom + per-sketch dispatch.
const mapping = createMonomeMapping(() => setup, {
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

bus.on('monome.grid', (e) => {
  mapping.onGrid(e);
  host.dispatchGridKey(e);
});
bus.on('monome.arcDelta', (e) => {
  mapping.onArcDelta(e);
  host.dispatchArcDelta(e);
});
bus.on('monome.arcKey', (e) => {
  mapping.onArcKey(e);
  host.dispatchArcKey(e);
});

// Device detection → adapt. Emulator switcher emits 'monome.setup' now; the
// bridge's serialosc 'device.attached' drives the same path in Phase 4.
bus.on('monome.setup', (s) => {
  setup = s;
  console.info(`[lichtspiel] monome setup → ${describeSetup(s)}`);
});
bus.on('device.attached', (d) => {
  const prof = profileFromAttached(d);
  setup = prof.kind === 'grid' ? { ...setup, grid: prof } : { ...setup, arc: prof };
  emulator.setSetup(setup);
  console.info(`[lichtspiel] device attached → ${describeSetup(setup)}`);
});
bus.on('device.detached', (d) => {
  if (setup.grid?.serial === d.id) setup = { ...setup, grid: null };
  if (setup.arc?.serial === d.id) setup = { ...setup, arc: null };
  emulator.setSetup(setup);
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
  toggleDebug: () => debug.toggle(),
  toggleEmulator: () => emulator.toggle(),
});

// ── Optional bridge connection ───────────────────────────────────────
const wsUrl = `ws://${__BIND_HOST__}:${__BRIDGE_WS_PORT__}`;
const bridge = new BridgeClient({ url: wsUrl, bus });
bridge.connect();

// ── Boot ─────────────────────────────────────────────────────────────
const first = registry.at(0);
if (first) host.mount(first);
console.info(
  `[lichtspiel] p5 runtime up — ${registry.size} templates. ` +
    `Press 'd' for HUD, 'g' for the monome emulator. Bridge: ${wsUrl} (optional).`,
);
