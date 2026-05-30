/**
 * On-screen monome emulator — a profile-aware grid + arc rendered in the DOM,
 * so the monome mappings are demoable without hardware. Toggle with `g`.
 *
 * A Grid 64 / Grid 128 / Arc 2 / Arc 4 switcher simulates plugging in a
 * different device: it re-renders the right dimensions and emits `monome.setup`
 * so the rest of the app adapts (the same path a real `device.attached` from
 * the bridge will drive). Grid/arc interaction emits the same MonomeEvent
 * shapes the bridge will.
 */

import {
  type ArcDeltaEvent,
  type ArcProfile,
  type GridKeyEvent,
  type GridProfile,
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

export class MonomeEmulator {
  private readonly root: HTMLElement;
  private readonly bus: AppBus;
  private setup: MonomeSetup;

  private label!: HTMLElement;
  private gridWrap!: HTMLElement;
  private arcWrap!: HTMLElement;
  private readonly gridBtns: Record<string, HTMLButtonElement> = {};
  private readonly arcBtns: Record<string, HTMLButtonElement> = {};
  private cells: HTMLElement[][] = [];
  private rings: HTMLCanvasElement[] = [];
  private visible = false;

  constructor(root: HTMLElement, bus: AppBus, setup: MonomeSetup = DEFAULT_SETUP) {
    this.root = root;
    this.bus = bus;
    this.setup = setup;
    this.buildShell();
    this.rebuild();
  }

  private buildShell(): void {
    this.label = el('div', 'emu-label');

    const sw = el('div', 'emu-switch');
    const mkBtn = (text: string, on: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = 'emu-btn';
      b.textContent = text;
      b.addEventListener('click', on);
      sw.appendChild(b);
      return b;
    };
    this.gridBtns['64'] = mkBtn('Grid 64', () => this.setGrid(GRID_64));
    this.gridBtns['128'] = mkBtn('Grid 128', () => this.setGrid(GRID_128));
    this.arcBtns['2'] = mkBtn('Arc 2', () => this.setArc(ARC_2));
    this.arcBtns['4'] = mkBtn('Arc 4', () => this.setArc(ARC_4));

    this.gridWrap = el('div', 'emu-gridwrap');
    this.arcWrap = el('div', 'emu-arcs');

    this.root.append(this.label, sw, this.gridWrap, this.arcWrap);
  }

  /** Switch the emulated grid/arc (simulates a different device being plugged in). */
  private setGrid(p: GridProfile): void {
    this.setup = { ...this.setup, grid: p };
    this.bus.emit('monome.setup', this.setup);
    this.rebuild();
  }
  private setArc(p: ArcProfile): void {
    this.setup = { ...this.setup, arc: p };
    this.bus.emit('monome.setup', this.setup);
    this.rebuild();
  }

  /** Externally drive the setup (e.g. a real device.attached from the bridge). */
  setSetup(setup: MonomeSetup): void {
    this.setup = setup;
    this.rebuild();
  }

  private rebuild(): void {
    this.label.textContent = `${describeSetup(this.setup)} · emulated`;
    for (const [k, b] of Object.entries(this.gridBtns)) b.classList.toggle('active', this.setup.grid?.size === k);
    for (const [k, b] of Object.entries(this.arcBtns)) b.classList.toggle('active', this.setup.arc?.size === k);
    this.buildGrid();
    this.buildArcs();
  }

  private buildGrid(): void {
    this.gridWrap.innerHTML = '';
    this.cells = [];
    const grid = this.setup.grid;
    if (!grid) return;
    const wrap = el('div', 'emu-grid');
    wrap.style.gridTemplateColumns = `repeat(${grid.cols}, 1fr)`;
    wrap.style.width = `${grid.cols * 26}px`;
    for (let y = 0; y < grid.rows; y++) {
      const row: HTMLElement[] = [];
      for (let x = 0; x < grid.cols; x++) {
        const cell = document.createElement('button');
        cell.className = 'emu-cell';
        cell.addEventListener('mousedown', () => this.emitGrid(x, y, 1));
        cell.addEventListener('mouseup', () => this.emitGrid(x, y, 0));
        cell.addEventListener('mouseleave', (ev) => {
          if ((ev as MouseEvent).buttons) this.emitGrid(x, y, 0);
        });
        wrap.appendChild(cell);
        row.push(cell);
      }
      this.cells.push(row);
    }
    this.gridWrap.appendChild(wrap);
  }

  private buildArcs(): void {
    this.arcWrap.innerHTML = '';
    this.rings = [];
    const arc = this.setup.arc;
    if (!arc) return;
    for (let e = 0; e < arc.encoders; e++) {
      const ring = document.createElement('canvas');
      ring.width = 84;
      ring.height = 84;
      ring.className = 'emu-ring';
      this.attachArcDrag(ring, e);
      this.arcWrap.appendChild(ring);
      this.rings.push(ring);
    }
    this.drawRings(null);
  }

  private attachArcDrag(ring: HTMLCanvasElement, encoder: number): void {
    let lastAngle: number | null = null;
    const angleAt = (ev: MouseEvent): number => {
      const r = ring.getBoundingClientRect();
      return Math.atan2(ev.clientY - (r.top + r.height / 2), ev.clientX - (r.left + r.width / 2));
    };
    const onMove = (ev: MouseEvent): void => {
      const a = angleAt(ev);
      if (lastAngle !== null) {
        let d = a - lastAngle;
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        const delta = Math.round((d / (Math.PI * 2)) * 64);
        if (delta !== 0) this.emitArc(encoder, delta);
      }
      lastAngle = a;
    };
    const onUp = (): void => {
      lastAngle = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    ring.addEventListener('mousedown', (ev) => {
      lastAngle = angleAt(ev);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  private emitGrid(x: number, y: number, state: 0 | 1): void {
    const e: GridKeyEvent = {
      type: 'grid.key',
      deviceId: this.setup.grid?.serial ?? 'grid',
      x,
      y,
      state,
    };
    this.bus.emit('monome.grid', e);
  }
  private emitArc(encoder: number, delta: number): void {
    const e: ArcDeltaEvent = {
      type: 'arc.delta',
      deviceId: this.setup.arc?.serial ?? 'arc',
      encoder,
      delta,
    };
    this.bus.emit('monome.arcDelta', e);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.classList.toggle('hidden', !this.visible);
  }

  /** Reflect the host's LED frame (grid levels + arc rings). */
  reflect(frame: LedFrame): void {
    if (!this.visible) return;
    const rows = this.cells.length;
    for (let y = 0; y < rows && y < frame.grid.length; y++) {
      const fr = frame.grid[y];
      const cr = this.cells[y];
      if (!fr || !cr) continue;
      for (let x = 0; x < cr.length && x < fr.length; x++) {
        const cell = cr[x];
        if (cell) cell.style.setProperty('--lvl', String((fr[x] ?? 0) / 15));
      }
    }
    this.drawRings(frame);
  }

  private drawRings(frame: LedFrame | null): void {
    for (let e = 0; e < this.rings.length; e++) {
      const canvas = this.rings[e];
      if (!canvas) continue;
      const g = canvas.getContext('2d');
      if (!g) continue;
      g.clearRect(0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const rad = 35;
      const levels = frame?.arc[e];
      for (let i = 0; i < ARC_RING_LEDS; i++) {
        const a = (i / ARC_RING_LEDS) * Math.PI * 2 - Math.PI / 2;
        const lvl = levels ? (levels[i] ?? 0) / 15 : 0.12;
        g.beginPath();
        g.strokeStyle = `rgba(120,200,255,${0.15 + lvl * 0.85})`;
        g.lineWidth = 3;
        g.moveTo(cx + Math.cos(a) * (rad - 5), cy + Math.sin(a) * (rad - 5));
        g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
        g.stroke();
      }
    }
  }
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}
