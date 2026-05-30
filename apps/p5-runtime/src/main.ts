/**
 * Lichtspiel p5 runtime — entry point. Wires the template registry, the
 * sketch host (with param smoothing), the keyboard fallback, the on-screen
 * monome emulator, the diagnostics HUD, and the optional live-bridge client.
 *
 * Runs fully in browser-only mode: no Ableton, no bridge, no ML needed.
 */

import './style.css';
import {
  type ArcDeltaEvent,
  type GridKeyEvent,
  type VisualParamVector,
  clamp01,
} from '@lichtspiel/schemas';
import { createBus } from './messageBus.js';
import { SketchHost } from './sketchHost.js';
import { TemplateRegistry } from './templateRegistry.js';
import { TEMPLATES } from './templates/index.js';
import { installKeyboard } from './keyboard.js';
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

const debug = new DebugPanel(hud, hudHelp);
const emulator = new MonomeEmulator(emulatorEl, bus);

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

// Monome (real or emulated) → app-level mappings + per-sketch dispatch.
bus.on('monome.grid', (e: GridKeyEvent) => {
  // Grid page 1, top row: columns select scene families.
  if (e.state === 1 && e.y === 0 && e.x < registry.size) {
    const t = registry.at(e.x);
    if (t) selectScene(t, true);
  }
  host.dispatchGridKey(e);
});

bus.on('monome.arcDelta', (e: ArcDeltaEvent) => {
  const cur = host.targetParams();
  const step = e.delta / 64;
  if (e.encoder === 0) host.setTargetParams({ semanticDistance: clamp01(cur.semanticDistance + step) });
  else if (e.encoder === 1) host.setTargetParams({ mutationAmount: clamp01(cur.mutationAmount + step) });
  else if (e.encoder === 2) host.setTargetParams({ motion: clamp01(cur.motion + step) });
  else if (e.encoder === 3) host.setTargetParams({ palette: clamp01(cur.palette + step) });
  host.dispatchArcDelta(e);
});

bus.on('monome.arcKey', (e) => host.dispatchArcKey(e));

// ── Keyboard handlers ────────────────────────────────────────────────
function adjust(key: 'semanticDistance' | 'mutationAmount' | 'motion' | 'density', delta: number): void {
  const cur = host.targetParams();
  host.setTargetParams({ [key]: clamp01(cur[key] + delta) });
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
  adjust,
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
