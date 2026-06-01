/**
 * Gestural panel — the on-screen control map for the active template (what each
 * grid/arc gesture does) + a live variant readout. Adapted (not forked) from
 * windchime apps/web/src/ui/gesturalPanel.ts. Toggle with `h`. Self-mounts a
 * fixed panel; hidden by default so it never blocks the canvas.
 */

import type { GesturalDictionary, GesturalEntry } from '@lichtspiel/schemas';
import type { VariantInfo } from '../mutations/variantBrowser.js';

export class GesturalPanel {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private readonly gridEl: HTMLElement;
  private readonly arcEl: HTMLElement;
  private readonly variantEl: HTMLElement;
  private visible = false;

  constructor(parent: HTMLElement = document.body) {
    this.root = el('div', 'gestural-panel hidden');
    this.titleEl = el('div', 'gp-title');
    this.summaryEl = el('div', 'gp-summary');
    this.gridEl = el('div', 'gp-section');
    this.arcEl = el('div', 'gp-section');
    this.variantEl = el('div', 'gp-variant');
    this.root.append(this.titleEl, this.summaryEl, this.gridEl, this.arcEl, this.variantEl);
    parent.appendChild(this.root);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.classList.toggle('hidden', !this.visible);
  }

  /** Set the active template's control map (or clear it for a scene with none). */
  setDictionary(dict: GesturalDictionary | undefined): void {
    if (!dict) {
      this.titleEl.textContent = '—';
      this.summaryEl.textContent = 'No gestural map for this scene (global column-fader mapping).';
      this.gridEl.innerHTML = '';
      this.arcEl.innerHTML = '';
      return;
    }
    this.titleEl.textContent = dict.name;
    this.summaryEl.textContent = dict.summary ?? '';
    this.renderSection(this.gridEl, 'grid', dict.grid);
    this.renderSection(this.arcEl, 'arc', dict.arc);
  }

  /** Show the active variant: seed + the axes that diverged from canonical. */
  setVariant(info: VariantInfo | null): void {
    if (!info) {
      this.variantEl.innerHTML = '';
      return;
    }
    const diverged = Object.keys(info.config)
      .filter((k) => k !== 'seed' && stringify(info.config[k]) !== stringify(info.canonical[k]))
      .map((k) => `${k}=${String(info.config[k])}`);
    const head = info.divergence === 0 ? 'canonical' : `variant · seed ${info.seed}`;
    this.variantEl.innerHTML =
      '<div class="gp-section-label">variant</div>' +
      `<div class="gp-vrow">${escapeHtml(head)}</div>` +
      (diverged.length ? `<div class="gp-vaxes">${escapeHtml(diverged.join(' · '))}</div>` : '');
  }

  private renderSection(container: HTMLElement, label: string, entries: GesturalEntry[]): void {
    container.innerHTML = '';
    if (entries.length === 0) return;
    const heading = el('div', 'gp-section-label');
    heading.textContent = label;
    container.appendChild(heading);
    for (const e of entries) {
      const row = el('div', 'gp-entry');
      row.innerHTML =
        `<span class="gp-area">${escapeHtml(e.area)}</span>` +
        `<span class="gp-action">${escapeHtml(e.action)}</span>` +
        `<span class="gp-effect">${escapeHtml(e.effect)}</span>`;
      container.appendChild(row);
    }
  }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
function stringify(v: unknown): string {
  return JSON.stringify(v ?? null);
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c] ?? c);
}
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
