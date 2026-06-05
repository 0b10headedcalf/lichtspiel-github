/**
 * Monome digital-twin dashboard — combines the windchime virtual-monome panel
 * (mirrors the live LED frame) with the `monome_grid64_arc2_diagnostic7`
 * capability checks (test sweeps + a digital representation of the hardware).
 * Toggle with `g`.
 *
 * It is ONE dashboard that:
 *   - draws a digital twin of the connected grid (varibright cells + level
 *     readout) and arc (64-LED rings + position marker), adapting to the
 *     active profile (grid 64/128, arc 2/4);
 *   - mirrors the live LED frame when idle, or animates a test pattern;
 *   - is interactive: click cells / drag rings / click ring centers emit the
 *     same MonomeEvent shapes the bridge will (so it doubles as the no-hardware
 *     input device);
 *   - visualizes all incoming input + ticks a capability checklist;
 *   - shows the capability matrix so the grid64/arc2 vs grid128/arc4
 *     differences (varibright, tilt, quads, encoders, push) are explicit;
 *   - has a Grid 64/128 + Arc 2/4 switch that simulates device detection.
 *
 * With real hardware (Phase 4) the same LED frame flushes to the device over
 * the bridge and real device.attached/grid.key/arc.* events drive the twin.
 */

import {
  type ArcDeltaEvent,
  type GridKeyEvent,
  type LedFrame,
  type LedFramePayload,
  type MonomeSetup,
  type VisualParamVector,
  ARC_2,
  ARC_4,
  ARC_RING_LEDS,
  DEFAULT_PARAMS,
  GRID_64,
  GRID_128,
  LED_LEVEL_MAX,
  describeSetup,
} from '@lichtspiel/schemas';
import type { AppBus } from '../messageBus.js';
import type { MonomeDevices } from '../monomeDevices.js';
import {
  type PerfState,
  PERF_GRID_INTENSITY,
  breathIntensity,
  perfArcLevel,
  perfGridLevel,
  sweepArcLevel,
  sweepGridIntensity,
  sweepGridLevel,
  sweepStageLabel,
} from './monomeFeedback.js';

/** Steady cadence (≈30 Hz) at which the current LED frame is pushed to hardware. */
const LED_EMIT_MS = 33;

type TestMode =
  | null
  | 'all'
  | 'checker'
  | 'ramp'
  | 'intensity'
  | 'row'
  | 'col'
  | 'arcFill'
  | 'arcGrad'
  | 'arcTicks'
  | 'auto'
  | 'fast';

const TEST_BUTTONS: Array<{ id: Exclude<TestMode, null>; label: string }> = [
  { id: 'all', label: 'All on' },
  { id: 'checker', label: 'Checker' },
  { id: 'ramp', label: 'Ramp' },
  { id: 'intensity', label: 'Intensity' },
  { id: 'row', label: 'Row sweep' },
  { id: 'col', label: 'Col sweep' },
  { id: 'arcFill', label: 'Arc fill' },
  { id: 'arcGrad', label: 'Arc grad' },
  { id: 'arcTicks', label: 'Arc ticks' },
  { id: 'auto', label: 'Auto sweep' },
  { id: 'fast', label: 'Fast ∥' },
];

const PAD = 12;
const GAP = 4;
const RING_R = 40;

/** Callbacks the twin invokes for takeover mode (the clock + manual BPM live in main). */
export interface TwinHooks {
  /** MANUAL ⇄ TAKEOVER toggled — `on` = takeover (auto-drive the monome). */
  onTakeoverToggle?: (on: boolean) => void;
  /** The manual (standalone) BPM was nudged. */
  onManualBpm?: (bpm: number) => void;
}

export class MonomeTwin {
  private readonly root: HTMLElement;
  private readonly bus: AppBus;
  private readonly devices: MonomeDevices;
  private readonly onLedFrame: ((frame: LedFramePayload) => void) | undefined;
  private setup: MonomeSetup;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private label!: HTMLElement;
  private capsEl!: HTMLElement;
  private logEl!: HTMLElement;
  private checklistEl!: HTMLElement;
  private readonly gridBtns: Record<string, HTMLButtonElement> = {};
  private readonly arcBtns: Record<string, HTMLButtonElement> = {};
  private readonly testBtns: Partial<Record<string, HTMLButtonElement>> = {};

  // live state
  private held: boolean[][] = [];
  private arcPos: number[] = [];
  private arcHeld: boolean[] = [];
  private mirrorGrid: number[][] = [];
  private mirrorArc: number[][] = [];
  /** True while a template's ledOut is non-empty → mirror it instead of perf feedback. */
  private hostFrameActive = false;
  private testMode: TestMode = null;
  private testStart = 0;
  private seen = { grid: false, arcDelta: false, arcKey: false };
  private log: string[] = [];

  // performance-feedback inputs (the live visual state the LEDs mirror)
  private params: VisualParamVector = { ...DEFAULT_PARAMS };
  private sceneIndex = 0;
  private sceneCount = 0;

  private cell = 32;
  private gridOx = PAD;
  private gridOy = PAD;
  private arcCy = 0;
  private visible = false;
  private raf = 0;
  private pressed: { x: number; y: number } | null = null;

  // takeover mode (Part 2): MANUAL ⇄ TAKEOVER toggle + tempo readout.
  private takeoverBtn!: HTMLButtonElement;
  private takeoverReadout!: HTMLElement;
  private takeoverOn = false;
  private takeoverBpm = 120;
  private takeoverSource: 'live' | 'manual' = 'manual';
  private readonly hooks: TwinHooks;

  constructor(
    root: HTMLElement,
    bus: AppBus,
    devices: MonomeDevices,
    onLedFrame?: (frame: LedFramePayload) => void,
    hooks: TwinHooks = {},
  ) {
    this.root = root;
    this.bus = bus;
    this.devices = devices;
    this.setup = devices.active();
    this.onLedFrame = onLedFrame;
    this.hooks = hooks;
    this.buildShell();
    this.subscribe();
    this.rebuild();
    // The twin is the single LED authority: it pushes the current frame —
    // performance feedback, a diagnostic sweep, or a mirrored template ledOut —
    // to real hardware at a steady rate, independent of the dashboard being
    // visible. So "what the twin shows" always equals "what the hardware shows".
    // Lives for the session (the dashboard is never torn down).
    if (onLedFrame) setInterval(() => this.emitLeds(), LED_EMIT_MS);
  }

  /** Feed the live visual state the performance feedback mirrors (called per frame). */
  setFeedback(params: VisualParamVector, sceneIndex: number, sceneCount: number): void {
    this.params = params;
    this.sceneIndex = sceneIndex;
    this.sceneCount = sceneCount;
  }

  // ── DOM ──────────────────────────────────────────────────────────
  private buildShell(): void {
    this.label = el('div', 'twin-label');

    const sw = el('div', 'emu-switch');
    const mk = (
      bucket: Record<string, HTMLButtonElement>,
      key: string,
      text: string,
      on: () => void,
    ): void => {
      const b = document.createElement('button');
      b.className = 'emu-btn';
      b.textContent = text;
      b.addEventListener('click', on);
      sw.appendChild(b);
      bucket[key] = b;
    };
    mk(this.gridBtns, '64', 'Grid 64', () => this.setGrid(GRID_64));
    mk(this.gridBtns, '128', 'Grid 128', () => this.setGrid(GRID_128));
    mk(this.arcBtns, '2', 'Arc 2', () => this.setArc(ARC_2));
    mk(this.arcBtns, '4', 'Arc 4', () => this.setArc(ARC_4));

    // Takeover row (Part 2): MANUAL ⇄ TAKEOVER + tempo readout + manual-BPM nudge.
    const takeoverRow = el('div', 'twin-takeover');
    this.takeoverBtn = document.createElement('button');
    this.takeoverBtn.className = 'emu-btn takeover-btn';
    this.takeoverBtn.title = 'auto-drive the monome on a tempo clock (hands-free)';
    this.takeoverBtn.addEventListener('click', () => this.hooks.onTakeoverToggle?.(!this.takeoverOn));
    const bpmDown = document.createElement('button');
    bpmDown.className = 'emu-btn';
    bpmDown.textContent = '−';
    bpmDown.title = 'manual BPM −5 (standalone — live tempo overrides)';
    bpmDown.addEventListener('click', () => this.hooks.onManualBpm?.(this.takeoverBpm - 5));
    this.takeoverReadout = el('span', 'takeover-readout');
    const bpmUp = document.createElement('button');
    bpmUp.className = 'emu-btn';
    bpmUp.textContent = '+';
    bpmUp.title = 'manual BPM +5 (standalone — live tempo overrides)';
    bpmUp.addEventListener('click', () => this.hooks.onManualBpm?.(this.takeoverBpm + 5));
    takeoverRow.append(this.takeoverBtn, bpmDown, this.takeoverReadout, bpmUp);
    this.renderTakeover();

    this.capsEl = el('div', 'twin-caps');

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'twin-canvas';
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.attachCanvasInput();

    const testbar = el('div', 'twin-tests');
    const clear = document.createElement('button');
    clear.className = 'emu-btn';
    clear.textContent = 'Mirror';
    clear.title = 'stop tests, mirror the live LED frame';
    clear.addEventListener('click', () => this.setTest(null));
    testbar.appendChild(clear);
    for (const t of TEST_BUTTONS) {
      const b = document.createElement('button');
      b.className = 'emu-btn';
      b.textContent = t.label;
      b.addEventListener('click', () => this.setTest(t.id));
      testbar.appendChild(b);
      this.testBtns[t.id] = b;
    }

    this.checklistEl = el('div', 'twin-check');
    this.logEl = el('div', 'twin-log');

    this.root.append(this.label, sw, takeoverRow, this.capsEl, this.canvas, testbar, this.checklistEl, this.logEl);
  }

  /** Reflect the takeover clock's state (main owns the clock + tempo source). */
  setTakeoverState(s: { enabled: boolean; bpm: number; hasTransport: boolean }): void {
    this.takeoverOn = s.enabled;
    this.takeoverBpm = Math.round(s.bpm);
    this.takeoverSource = s.hasTransport ? 'live' : 'manual';
    this.renderTakeover();
  }

  private renderTakeover(): void {
    this.takeoverBtn.textContent = this.takeoverOn ? '◉ TAKEOVER' : 'MANUAL';
    this.takeoverBtn.classList.toggle('on', this.takeoverOn);
    this.takeoverReadout.textContent = `${this.takeoverBpm} BPM · ${this.takeoverSource}`;
  }

  // The manual switch only *simulates* (no-hardware mode). Real hardware always
  // wins; the resulting active-setup change comes back via devices.onChange →
  // setSetup, so the twin never mutates its own setup here (no divergence).
  private setGrid(p: typeof GRID_64): void {
    if (this.devices.isConnected('grid')) return; // locked to real hardware
    this.bus.emit('monome.setup', { ...this.devices.simulated(), grid: p });
  }
  private setArc(p: typeof ARC_2): void {
    if (this.devices.isConnected('arc')) return; // locked to real hardware
    this.bus.emit('monome.setup', { ...this.devices.simulated(), arc: p });
  }
  private setTest(mode: TestMode): void {
    this.testMode = mode;
    this.testStart = performance.now();
    for (const [id, b] of Object.entries(this.testBtns)) b?.classList.toggle('active', id === mode);
    // The steady emit picks up the new mode on its next tick; 'Mirror' (null)
    // returns to performance feedback or a mirrored template frame.
  }

  /** Externally drive the setup (real device.attached from the bridge). */
  setSetup(setup: MonomeSetup): void {
    this.setup = setup;
    this.rebuild();
  }

  private rebuild(): void {
    const grid = this.setup.grid;
    const arc = this.setup.arc;
    const rows = grid?.rows ?? 8;
    const cols = grid?.cols ?? 8;
    const enc = arc?.encoders ?? 0;

    this.held = mat(rows, cols, false);
    this.mirrorGrid = mat(rows, cols, 0);
    this.arcPos = new Array(enc).fill(0);
    this.arcHeld = new Array(enc).fill(false);
    this.mirrorArc = Array.from({ length: enc }, () => new Array<number>(ARC_RING_LEDS).fill(0));

    // size the canvas to the device
    this.cell = clamp(Math.floor(440 / Math.max(1, cols)) - GAP, 16, 38);
    const gridW = cols * (this.cell + GAP);
    const gridH = rows * (this.cell + GAP);
    this.gridOx = PAD;
    this.gridOy = PAD;
    const ringsW = enc * (RING_R * 2 + 24);
    const logicalW = Math.max(gridW, ringsW) + PAD * 2;
    this.arcCy = this.gridOy + gridH + PAD + RING_R;
    const logicalH = this.gridOy + gridH + (enc > 0 ? PAD + RING_R * 2 : 0) + PAD;
    this.sizeCanvas(logicalW, logicalH);

    this.label.textContent = `Digital twin — ${describeSetup(this.setup)}`;
    // Auto-snap the switch to the active setup; lock + grey the size buttons of
    // a kind that's driven by real hardware (you can't simulate over hardware).
    const gridConn = this.devices.isConnected('grid');
    const arcConn = this.devices.isConnected('arc');
    const style = (
      btns: Record<string, HTMLButtonElement>,
      activeSize: string | undefined,
      connected: boolean,
    ): void => {
      for (const [k, b] of Object.entries(btns)) {
        const isActive = activeSize === k;
        const locked = connected && !isActive;
        // green = real hardware of this size; blue = simulated selection; the
        // rest dim. When the kind isn't connected at all, nothing is green and
        // (with no sim selected) both read as greyed.
        b.classList.toggle('connected', connected && isActive);
        b.classList.toggle('active', !connected && isActive);
        b.classList.toggle('disabled', locked);
        b.disabled = locked;
      }
    };
    style(this.gridBtns, grid?.size, gridConn);
    style(this.arcBtns, arc?.size, arcConn);
    this.renderCaps();
    this.renderChecklist();
  }

  private sizeCanvas(w: number, h: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private renderCaps(): void {
    const g = this.setup.grid;
    const a = this.setup.arc;
    const tag = (kind: 'grid' | 'arc'): string =>
      this.devices.isConnected(kind) ? '● hardware' : '○ simulated';
    const bright = g
      ? g.caps.varibright
        ? 'varibright 0–15'
        : `monobright${g.caps.globalIntensity ? ' + global 0–15' : ''} (levels logical)`
      : '';
    const gline = g
      ? `grid ${tag('grid')}: ${g.cols}×${g.rows} (${g.caps.cells}) · ${g.caps.quads} quad${g.caps.quads > 1 ? 's' : ''} · ${bright} · tilt ${g.caps.tilt ? '✓' : '✗'}`
      : 'grid: none';
    const push = a ? (a.caps.push ? (a.caps.pushPerEncoder ? 'per-enc' : 'shared') : '✗') : '';
    const aline = a
      ? `arc ${tag('arc')}: ${a.caps.encoders} enc × ${a.caps.ringLeds} LED (varibright) · push ${push}`
      : 'arc: none';
    this.capsEl.textContent = `${gline}\n${aline}`;
  }

  private renderChecklist(): void {
    const mark = (ok: boolean): string => (ok ? '✓' : '·');
    this.checklistEl.textContent =
      `seen — grid.key ${mark(this.seen.grid)}  arc.delta ${mark(this.seen.arcDelta)}  arc.key ${mark(this.seen.arcKey)}`;
  }

  // ── bus ──────────────────────────────────────────────────────────
  private subscribe(): void {
    this.bus.on('monome.grid', (e) => {
      const row = this.held[e.y];
      if (row && e.x < row.length) row[e.x] = e.state === 1;
      if (e.state === 1) {
        this.seen.grid = true;
        this.pushLog(`grid (${e.x},${e.y}) ↓`);
        this.renderChecklist();
      }
    });
    this.bus.on('monome.arcDelta', (e) => {
      if (e.encoder < this.arcPos.length) {
        const next = (this.arcPos[e.encoder]! + e.delta) % ARC_RING_LEDS;
        this.arcPos[e.encoder] = (next + ARC_RING_LEDS) % ARC_RING_LEDS;
      }
      this.seen.arcDelta = true;
      this.pushLog(`arc enc${e.encoder} Δ${e.delta > 0 ? '+' : ''}${e.delta}`);
      this.renderChecklist();
    });
    this.bus.on('monome.arcKey', (e) => {
      if (e.encoder < this.arcHeld.length) this.arcHeld[e.encoder] = e.state === 1;
      if (e.state === 1) {
        this.seen.arcKey = true;
        this.pushLog(`arc enc${e.encoder} press`);
        this.renderChecklist();
      }
    });
  }

  private pushLog(s: string): void {
    this.log.unshift(s);
    if (this.log.length > 7) this.log.pop();
    this.logEl.textContent = this.log.join('\n');
  }

  /**
   * Mirror a template's host LED frame. If it carries content we show it (a
   * template is driving the LEDs); if it's empty we fall back to performance
   * feedback so an idle instrument still reflects its param state.
   */
  reflect(frame: LedFrame): void {
    let any = false;
    const rows = this.mirrorGrid.length;
    for (let y = 0; y < rows && y < frame.grid.length; y++) {
      const src = frame.grid[y];
      const dst = this.mirrorGrid[y];
      if (!src || !dst) continue;
      for (let x = 0; x < dst.length && x < src.length; x++) {
        const v = src[x] ?? 0;
        dst[x] = v;
        if (v > 0) any = true;
      }
    }
    for (let e = 0; e < this.mirrorArc.length && e < frame.arc.length; e++) {
      const src = frame.arc[e];
      const dst = this.mirrorArc[e];
      if (!src || !dst) continue;
      for (let i = 0; i < dst.length && i < src.length; i++) {
        const v = src[i] ?? 0;
        dst[i] = v;
        if (v > 0) any = true;
      }
    }
    this.hostFrameActive = any;
  }

  // ── unified level source (canvas + hardware read the SAME values) ──
  private elapsedMs(): number {
    return performance.now() - this.testStart;
  }
  private perfState(): PerfState {
    return {
      params: this.params,
      sceneIndex: this.sceneIndex,
      sceneCount: this.sceneCount,
      held: this.held,
      arcHeld: this.arcHeld,
    };
  }

  /** Level of grid cell (x,y) right now, whatever mode is active. */
  private gridLevelAt(x: number, y: number): number {
    const rows = this.setup.grid?.rows ?? 0;
    const cols = this.setup.grid?.cols ?? 0;
    const m = this.testMode;
    if (m === null) {
      if (this.hostFrameActive) return this.mirrorGrid[y]?.[x] ?? 0;
      return perfGridLevel(x, y, rows, this.perfState());
    }
    if (m === 'auto') return sweepGridLevel('normal', this.elapsedMs(), x, y, rows, cols);
    if (m === 'fast') return sweepGridLevel('fast', this.elapsedMs(), x, y, rows, cols);
    return this.testGridLevel(m, x, y, this.elapsedMs() / 1000, rows, cols);
  }

  /** Level of arc ring e, LED i right now, whatever mode is active. */
  private arcLevelAt(e: number, i: number): number {
    const rows = this.setup.grid?.rows ?? 0;
    const cols = this.setup.grid?.cols ?? 0;
    const enc = this.setup.arc?.encoders ?? 0;
    const m = this.testMode;
    if (m === null) {
      if (this.hostFrameActive) return this.mirrorArc[e]?.[i] ?? 0;
      return perfArcLevel(e, i, enc, this.perfState());
    }
    if (m === 'auto') return sweepArcLevel('normal', this.elapsedMs(), e, i, rows, cols, enc);
    if (m === 'fast') return sweepArcLevel('fast', this.elapsedMs(), e, i, rows, cols, enc);
    return this.testArcLevel(m, i, this.arcPos[e] ?? 0, this.elapsedMs() / 1000);
  }

  /** Global grid intensity right now (the dimmer sweep drives it; else full). */
  private gridIntensityNow(): number {
    const rows = this.setup.grid?.rows ?? 0;
    const cols = this.setup.grid?.cols ?? 0;
    if (this.testMode === 'intensity') return breathIntensity(this.elapsedMs());
    if (this.testMode === 'auto') return sweepGridIntensity('normal', this.elapsedMs(), rows, cols);
    if (this.testMode === 'fast') return sweepGridIntensity('fast', this.elapsedMs(), rows, cols);
    return PERF_GRID_INTENSITY;
  }

  /**
   * Snapshot the exact levels the twin is showing — performance feedback, a
   * diagnostic sweep, or a mirrored template frame — sized to the active
   * device. This same frame flushes to hardware, so the twin and the LEDs agree.
   */
  private computeFrame(): LedFramePayload {
    const grid = this.setup.grid;
    const arc = this.setup.arc;
    const rows = grid?.rows ?? 0;
    const cols = grid?.cols ?? 0;
    const enc = arc?.encoders ?? 0;
    const payload: LedFramePayload = {};
    if (rows > 0 && cols > 0) {
      const g: number[][] = [];
      for (let y = 0; y < rows; y++) {
        const row: number[] = [];
        for (let x = 0; x < cols; x++) row.push(this.gridLevelAt(x, y));
        g.push(row);
      }
      payload.grid = g;
      payload.gridIntensity = this.gridIntensityNow();
    }
    if (enc > 0) {
      const a: number[][] = [];
      for (let e = 0; e < enc; e++) {
        const ring: number[] = [];
        for (let i = 0; i < ARC_RING_LEDS; i++) ring.push(this.arcLevelAt(e, i));
        a.push(ring);
      }
      payload.arc = a;
    }
    return payload;
  }

  /** Steady-rate hardware push — the twin is the single LED authority. */
  private emitLeds(): void {
    this.onLedFrame?.(this.computeFrame());
  }

  // ── input ────────────────────────────────────────────────────────
  private attachCanvasInput(): void {
    const toLocal = (ev: MouseEvent): { x: number; y: number } => {
      const r = this.canvas.getBoundingClientRect();
      return { x: (ev.clientX - r.left) * (this.canvasW() / r.width), y: (ev.clientY - r.top) * (this.canvasH() / r.height) };
    };

    this.canvas.addEventListener('mousedown', (ev) => {
      const { x, y } = toLocal(ev);
      // grid hit?
      const grid = this.setup.grid;
      if (grid) {
        const cx = Math.floor((x - this.gridOx) / (this.cell + GAP));
        const cy = Math.floor((y - this.gridOy) / (this.cell + GAP));
        if (cx >= 0 && cx < grid.cols && cy >= 0 && cy < grid.rows) {
          this.pressed = { x: cx, y: cy };
          this.emitGrid(cx, cy, 1);
          return;
        }
      }
      // arc hit?
      const arc = this.setup.arc;
      if (arc) {
        for (let e = 0; e < arc.encoders; e++) {
          const cxp = this.ringCx(e);
          const d = Math.hypot(x - cxp, y - this.arcCy);
          if (d <= RING_R - 12) {
            this.emitArcKey(e, 1);
            const up = (): void => {
              this.emitArcKey(e, 0);
              window.removeEventListener('mouseup', up);
            };
            window.addEventListener('mouseup', up);
            return;
          }
          if (d >= RING_R - 12 && d <= RING_R + 14) {
            this.startRingDrag(e, cxp);
            return;
          }
        }
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.pressed) {
        this.emitGrid(this.pressed.x, this.pressed.y, 0);
        this.pressed = null;
      }
    });
  }

  private startRingDrag(encoder: number, cxp: number): void {
    let last: number | null = null;
    const angle = (ev: MouseEvent): number => {
      const r = this.canvas.getBoundingClientRect();
      const lx = (ev.clientX - r.left) * (this.canvasW() / r.width);
      const ly = (ev.clientY - r.top) * (this.canvasH() / r.height);
      return Math.atan2(ly - this.arcCy, lx - cxp);
    };
    const move = (ev: MouseEvent): void => {
      const a = angle(ev);
      if (last !== null) {
        let dA = a - last;
        if (dA > Math.PI) dA -= Math.PI * 2;
        if (dA < -Math.PI) dA += Math.PI * 2;
        const delta = Math.round((dA / (Math.PI * 2)) * ARC_RING_LEDS);
        if (delta !== 0) this.emitArc(encoder, delta);
      }
      last = a;
    };
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  private emitGrid(x: number, y: number, state: 0 | 1): void {
    this.bus.emit('monome.grid', {
      type: 'grid.key',
      deviceId: this.setup.grid?.serial ?? 'grid',
      x,
      y,
      state,
    } satisfies GridKeyEvent);
  }
  private emitArc(encoder: number, delta: number): void {
    this.bus.emit('monome.arcDelta', {
      type: 'arc.delta',
      deviceId: this.setup.arc?.serial ?? 'arc',
      encoder,
      delta,
    } satisfies ArcDeltaEvent);
  }
  private emitArcKey(encoder: number, state: 0 | 1): void {
    this.bus.emit('monome.arcKey', {
      type: 'arc.key',
      deviceId: this.setup.arc?.serial ?? 'arc',
      encoder,
      state,
    });
  }

  // ── render loop ──────────────────────────────────────────────────
  toggle(): void {
    this.visible = !this.visible;
    this.root.classList.toggle('hidden', !this.visible);
    if (this.visible) this.start();
    else this.stop();
  }
  private start(): void {
    if (this.raf) return;
    const loop = (): void => {
      this.draw();
      this.raf = window.requestAnimationFrame(loop);
    };
    this.raf = window.requestAnimationFrame(loop);
  }
  private stop(): void {
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private canvasW(): number {
    return parseFloat(this.canvas.style.width || '0');
  }
  private canvasH(): number {
    return parseFloat(this.canvas.style.height || '0');
  }
  private ringCx(e: number): number {
    return this.gridOx + RING_R + e * (RING_R * 2 + 24);
  }

  private draw(): void {
    const grid = this.setup.grid;
    const arc = this.setup.arc;
    const rows = grid?.rows ?? 0;
    const cols = grid?.cols ?? 0;
    const enc = arc?.encoders ?? 0;

    // reflect the current LED mode (performance / sweep stage / quick test) live
    const mode =
      this.testMode === null
        ? this.hostFrameActive
          ? 'template LEDs'
          : 'performance'
        : this.testMode === 'auto'
          ? `sweep — ${sweepStageLabel('normal', this.elapsedMs(), rows, cols)}`
          : this.testMode === 'fast'
            ? `sweep ∥ ${sweepStageLabel('fast', this.elapsedMs(), rows, cols)}`
            : `test — ${this.testMode}`;
    this.label.textContent = `Digital twin — ${describeSetup(this.setup)} · ${mode}`;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvasW(), this.canvasH());

    // The grid's global dimmer scales every cell's displayed brightness — so the
    // canvas breathes in lock-step with the monobright hardware (canvas == LEDs).
    const gi = this.gridIntensityNow() / LED_LEVEL_MAX;

    // grid — same level source as the hardware frame (gridLevelAt)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const level = this.gridLevelAt(x, y);
        const px = this.gridOx + x * (this.cell + GAP);
        const py = this.gridOy + y * (this.cell + GAP);
        ctx.fillStyle = ledColor(level * gi);
        roundRect(ctx, px, py, this.cell, this.cell, 5);
        ctx.fill();
        if (this.held[y]?.[x]) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
        if (this.cell >= 24) {
          ctx.fillStyle = level > 8 ? 'rgba(4,16,28,0.9)' : 'rgba(180,210,235,0.55)';
          ctx.font = '11px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(level), px + this.cell / 2, py + this.cell / 2);
        }
      }
    }

    // arc rings — same level source as the hardware frame (arcLevelAt)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let e = 0; e < enc; e++) {
      const cxp = this.ringCx(e);
      for (let i = 0; i < ARC_RING_LEDS; i++) {
        const level = this.arcLevelAt(e, i);
        const a = (i / ARC_RING_LEDS) * Math.PI * 2 - Math.PI / 2;
        const inner = RING_R - 8;
        const outer = RING_R + 8;
        ctx.strokeStyle = ledColor(level);
        ctx.lineWidth = level >= 15 ? 4 : 2; // emphasize the bright head
        ctx.beginPath();
        ctx.moveTo(cxp + Math.cos(a) * inner, this.arcCy + Math.sin(a) * inner);
        ctx.lineTo(cxp + Math.cos(a) * outer, this.arcCy + Math.sin(a) * outer);
        ctx.stroke();
      }
      ctx.fillStyle = this.arcHeld[e] ? '#8effc0' : 'rgba(180,210,235,0.7)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(`enc ${e}`, cxp, this.arcCy);
    }
  }

  /** Individual quick-test patterns (the small test buttons; sweeps + mirror handled in *At). */
  private testGridLevel(m: TestMode, x: number, y: number, t: number, rows: number, cols: number): number {
    switch (m) {
      case 'all':
        return 15;
      case 'checker':
        return (x + y) % 2 === 0 ? 15 : 0;
      case 'ramp':
        return Math.round((cols > 1 ? x / (cols - 1) : 1) * 15);
      case 'intensity':
        return 15; // all cells on; the global dimmer (gridIntensityNow) breathes
      case 'row': {
        const active = Math.floor(t * 4) % Math.max(1, rows);
        return y === active ? 15 : 2;
      }
      case 'col': {
        const active = Math.floor(t * 8) % Math.max(1, cols);
        return x === active ? 15 : 1;
      }
      default:
        return 1; // arc-focused tests leave the grid dim
    }
  }

  private testArcLevel(m: TestMode, i: number, pos: number, t: number): number {
    switch (m) {
      case 'arcGrad':
        return Math.round((i / (ARC_RING_LEDS - 1)) * 15);
      case 'arcFill': {
        const head = Math.floor(t * 32) % ARC_RING_LEDS;
        if (i === head) return 15;
        return i <= head ? 9 : 0;
      }
      case 'arcTicks': {
        const head = Math.floor(t * 40) % ARC_RING_LEDS;
        if (i === head) return 15;
        return i % 8 === 0 ? 6 : 0;
      }
      default: {
        // grid-focused tests: show the live encoder position marker
        const dist = Math.min((i - pos + ARC_RING_LEDS) % ARC_RING_LEDS, (pos - i + ARC_RING_LEDS) % ARC_RING_LEDS);
        if (dist === 0) return 15;
        if (dist === 1) return 9;
        return i % 8 === 0 ? 4 : 0;
      }
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────
function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}
function mat<T>(rows: number, cols: number, fill: T): T[][] {
  return Array.from({ length: rows }, () => new Array<T>(cols).fill(fill));
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function ledColor(level: number): string {
  const t = clamp(level, 0, 15) / 15;
  const r = Math.round(18 + t * 120);
  const g = Math.round(28 + t * 178);
  const b = Math.round(40 + t * 214);
  return `rgb(${r},${g},${b})`;
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
