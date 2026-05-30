/**
 * On-screen monome emulator — an 8×8 grid + two arc rings rendered in the
 * DOM, so the monome mappings are demoable before (or instead of) hardware.
 * Toggle with `g`. Emits the same MonomeEvent shapes the real bridge will.
 *
 * It also reflects the host's LED frame so LED feedback (Phase 4) is visible
 * on screen.
 */

import {
  type ArcDeltaEvent,
  type GridKeyEvent,
  GRID_COLS,
  GRID_ROWS,
  type LedFrame,
} from '@lichtspiel/schemas';
import type { AppBus } from '../messageBus.js';

const GRID_ID = 'm64_0175';
const ARC_ID = 'm0000174';
const ARC_ENCODERS = 2;

export class MonomeEmulator {
  private readonly root: HTMLElement;
  private readonly bus: AppBus;
  private readonly cells: HTMLElement[][] = [];
  private readonly rings: HTMLCanvasElement[] = [];
  private visible = false;

  constructor(root: HTMLElement, bus: AppBus) {
    this.root = root;
    this.bus = bus;
    this.build();
  }

  private build(): void {
    const grid = document.createElement('div');
    grid.className = 'emu-grid';
    grid.style.gridTemplateColumns = `repeat(${GRID_COLS}, 1fr)`;
    for (let y = 0; y < GRID_ROWS; y++) {
      const row: HTMLElement[] = [];
      for (let x = 0; x < GRID_COLS; x++) {
        const cell = document.createElement('button');
        cell.className = 'emu-cell';
        cell.addEventListener('mousedown', () => this.emitGrid(x, y, 1));
        cell.addEventListener('mouseup', () => this.emitGrid(x, y, 0));
        cell.addEventListener('mouseleave', (ev) => {
          if ((ev as MouseEvent).buttons) this.emitGrid(x, y, 0);
        });
        grid.appendChild(cell);
        row.push(cell);
      }
      this.cells.push(row);
    }

    const arcs = document.createElement('div');
    arcs.className = 'emu-arcs';
    for (let e = 0; e < ARC_ENCODERS; e++) {
      const ring = document.createElement('canvas');
      ring.width = 96;
      ring.height = 96;
      ring.className = 'emu-ring';
      this.attachArcDrag(ring, e);
      arcs.appendChild(ring);
      this.rings.push(ring);
    }

    const label = document.createElement('div');
    label.className = 'emu-label';
    label.textContent = `grid ${GRID_ID} · arc ${ARC_ID} (emulated)`;

    this.root.appendChild(label);
    this.root.appendChild(grid);
    this.root.appendChild(arcs);
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
    const e: GridKeyEvent = { type: 'grid.key', deviceId: GRID_ID, x, y, state };
    this.bus.emit('monome.grid', e);
  }
  private emitArc(encoder: number, delta: number): void {
    const e: ArcDeltaEvent = { type: 'arc.delta', deviceId: ARC_ID, encoder, delta };
    this.bus.emit('monome.arcDelta', e);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.classList.toggle('hidden', !this.visible);
  }

  /** Reflect the host's LED frame (grid levels + arc rings). */
  reflect(frame: LedFrame): void {
    if (!this.visible) return;
    for (let y = 0; y < GRID_ROWS && y < frame.grid.length; y++) {
      const fr = frame.grid[y];
      const cr = this.cells[y];
      if (!fr || !cr) continue;
      for (let x = 0; x < GRID_COLS && x < fr.length; x++) {
        const level = fr[x] ?? 0;
        const cell = cr[x];
        if (cell) cell.style.setProperty('--lvl', String(level / 15));
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
      const rad = 40;
      const levels = frame?.arc[e];
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2 - Math.PI / 2;
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
