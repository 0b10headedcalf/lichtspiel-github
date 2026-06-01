/**
 * Gestural panel — the on-screen control map for the active template (what each
 * grid/arc gesture does) + a live variant readout. Adapted (not forked) from
 * windchime apps/web/src/ui/gesturalPanel.ts. Always present but **collapsed by
 * default** (compact: idiom name + variant line); `h` or a click on the header
 * expands it to the full control map. Positioned down the left, clear of the HUD.
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
  private collapsed = true;

  constructor(parent: HTMLElement = document.body) {
    this.root = el('div', 'gestural-panel collapsed');

    const header = el('div', 'gp-header');
    const caret = el('span', 'gp-caret');
    caret.textContent = '▸';
    this.titleEl = el('span', 'gp-title');
    header.append(caret, this.titleEl);
    header.addEventListener('click', () => this.toggle());

    this.variantEl = el('div', 'gp-variant');

    const body = el('div', 'gp-body');
    this.summaryEl = el('div', 'gp-summary');
    this.gridEl = el('div', 'gp-section');
    this.arcEl = el('div', 'gp-section');
    body.append(this.summaryEl, this.gridEl, this.arcEl);

    this.root.append(header, this.variantEl, body);
    parent.appendChild(this.root);
  }

  /** Expand ↔ collapse (the `h` key + the header click). */
  toggle(): void {
    this.collapsed = !this.collapsed;
    this.root.classList.toggle('collapsed', this.collapsed);
  }

  /** Set the active template's control map (or clear it for a scene with none). */
  setDictionary(dict: GesturalDictionary | undefined): void {
    if (!dict) {
      this.titleEl.textContent = '— global column-fader';
      this.summaryEl.textContent = 'No gestural map for this scene (legacy mapping).';
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
      `<span class="gp-vrow">${escapeHtml(head)}</span>` +
      (diverged.length ? `<span class="gp-vaxes">${escapeHtml(diverged.join(' · '))}</span>` : '');
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
