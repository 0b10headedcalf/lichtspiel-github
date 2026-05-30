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
  type MonomeSetup,
  ARC_2,
  ARC_4,
  ARC_RING_LEDS,
  DEFAULT_SETUP,
  GRID_64,
  GRID_128,
  describeSetup,
} from '@lichtspiel/schemas';
import type { AppBus } from '../messageBus.js';

type TestMode =
  | null
  | 'all'
  | 'checker'
  | 'ramp'
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

export class MonomeTwin {
  private readonly root: HTMLElement;
  private readonly bus: AppBus;
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
  private testMode: TestMode = null;
  private testStart = 0;
  private seen = { grid: false, arcDelta: false, arcKey: false };
  private log: string[] = [];

  private cell = 32;
  private gridOx = PAD;
  private gridOy = PAD;
  private arcCy = 0;
  private visible = false;
  private raf = 0;
  private pressed: { x: number; y: number } | null = null;

  constructor(root: HTMLElement, bus: AppBus, setup: MonomeSetup = DEFAULT_SETUP) {
    this.root = root;
    this.bus = bus;
    this.setup = setup;
    this.buildShell();
    this.subscribe();
    this.rebuild();
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

    this.root.append(this.label, sw, this.capsEl, this.canvas, testbar, this.checklistEl, this.logEl);
  }

  private setGrid(p: typeof GRID_64): void {
    this.setup = { ...this.setup, grid: p };
    this.bus.emit('monome.setup', this.setup);
    this.rebuild();
  }
  private setArc(p: typeof ARC_2): void {
    this.setup = { ...this.setup, arc: p };
    this.bus.emit('monome.setup', this.setup);
    this.rebuild();
  }
  private setTest(mode: TestMode): void {
    this.testMode = mode;
    this.testStart = performance.now();
    for (const [id, b] of Object.entries(this.testBtns)) b?.classList.toggle('active', id === mode);
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

    this.label.textContent = `Digital twin — ${describeSetup(this.setup)} · emulated`;
    for (const [k, b] of Object.entries(this.gridBtns)) b.classList.toggle('active', grid?.size === k);
    for (const [k, b] of Object.entries(this.arcBtns)) b.classList.toggle('active', arc?.size === k);
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
    const gline = g
      ? `grid: ${g.cols}×${g.rows} (${g.caps.cells}) · ${g.caps.quads} quad${g.caps.quads > 1 ? 's' : ''} · ${g.caps.varibright ? 'varibright 0–15' : 'monobright'} · tilt ${g.caps.tilt ? '✓' : '✗'}`
      : 'grid: none';
    const aline = a
      ? `arc: ${a.caps.encoders} enc × ${a.caps.ringLeds} LED · push ${a.caps.push ? '✓' : '✗'}`
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

  /** Mirror the host LED frame (used when no test pattern is running). */
  reflect(frame: LedFrame): void {
    const rows = this.mirrorGrid.length;
    for (let y = 0; y < rows && y < frame.grid.length; y++) {
      const src = frame.grid[y];
      const dst = this.mirrorGrid[y];
      if (!src || !dst) continue;
      for (let x = 0; x < dst.length && x < src.length; x++) dst[x] = src[x] ?? 0;
    }
    for (let e = 0; e < this.mirrorArc.length && e < frame.arc.length; e++) {
      const src = frame.arc[e];
      const dst = this.mirrorArc[e];
      if (!src || !dst) continue;
      for (let i = 0; i < dst.length && i < src.length; i++) dst[i] = src[i] ?? 0;
    }
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
    const t = (performance.now() - this.testStart) / 1000;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvasW(), this.canvasH());

    // grid
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const level = this.gridLevel(x, y, t, rows, cols);
        const px = this.gridOx + x * (this.cell + GAP);
        const py = this.gridOy + y * (this.cell + GAP);
        ctx.fillStyle = ledColor(level);
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

    // arc rings
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let e = 0; e < enc; e++) {
      const cxp = this.ringCx(e);
      const pos = this.arcPos[e] ?? 0;
      for (let i = 0; i < ARC_RING_LEDS; i++) {
        const level = this.arcLevel(e, i, pos, t);
        const a = (i / ARC_RING_LEDS) * Math.PI * 2 - Math.PI / 2;
        const inner = RING_R - 8;
        const outer = RING_R + 8;
        ctx.strokeStyle = ledColor(level);
        ctx.lineWidth = i === pos ? 4 : 2;
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

  private gridLevel(x: number, y: number, t: number, rows: number, cols: number): number {
    const m = this.testMode;
    if (m === null) return this.mirrorGrid[y]?.[x] ?? 0;
    switch (m) {
      case 'all':
        return 15;
      case 'checker':
        return (x + y) % 2 === 0 ? 15 : 0;
      case 'ramp':
        return Math.round((cols > 1 ? x / (cols - 1) : 1) * 15);
      case 'row':
      case 'auto': {
        const active = Math.floor(t * 4) % rows;
        return y === active ? 15 : 2;
      }
      case 'col':
      case 'fast': {
        const active = Math.floor(t * 8) % cols;
        return x === active ? 15 : 1;
      }
      default:
        return 1; // arc-focused tests leave the grid dim
    }
  }

  private arcLevel(e: number, i: number, pos: number, t: number): number {
    const m = this.testMode;
    if (m === null) return this.mirrorArc[e]?.[i] ?? 0;
    switch (m) {
      case 'arcGrad':
        return Math.round((i / (ARC_RING_LEDS - 1)) * 15);
      case 'arcFill': {
        const head = Math.floor(t * 32) % ARC_RING_LEDS;
        if (i === head) return 15;
        return i <= head ? 9 : 0;
      }
      case 'arcTicks':
      case 'auto':
      case 'fast': {
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
