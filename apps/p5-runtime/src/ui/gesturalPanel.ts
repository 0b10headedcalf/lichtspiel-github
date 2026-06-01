/**
 * Gestural panel — the on-screen control map for the active template (what each
 * grid/arc gesture does) + a live variant readout. Adapted (not forked) from
 * windchime apps/web/src/ui/gesturalPanel.ts. Always present but **collapsed by
 * default** (compact: idiom name + variant line); `h` or a click on the header
 * expands it to the full control map.
 *
 * The control map prefers the LIVE, hardware-resolved map from the sketch's idiom
 * layer (`setControlMap`) over the static authored dictionary — so it always shows
 * the *connected* device + any coupling/paging (e.g. "enc 0 → size obj 0 + 2 ·
 * coupled" on an Arc 2), and re-renders on a hot-swap. Positioned down the LEFT
 * gutter (below the HUD), clear of the bottom-right monome twin.
 */

import type { GesturalControlMap, GesturalDictionary, GesturalEntry } from '@lichtspiel/schemas';
import type { VariantInfo } from '../mutations/variantBrowser.js';

export class GesturalPanel {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly hardwareEl: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private readonly gridEl: HTMLElement;
  private readonly arcEl: HTMLElement;
  private readonly variantEl: HTMLElement;
  private collapsed = true;
  private dict: GesturalDictionary | undefined;
  private live: GesturalControlMap | null = null;

  constructor(parent: HTMLElement = document.body) {
    this.root = el('div', 'gestural-panel collapsed');

    const header = el('div', 'gp-header');
    const caret = el('span', 'gp-caret');
    caret.textContent = '▸';
    this.titleEl = el('span', 'gp-title');
    header.append(caret, this.titleEl);
    header.addEventListener('click', () => this.toggle());

    this.variantEl = el('div', 'gp-variant');
    this.hardwareEl = el('div', 'gp-hardware');

    const body = el('div', 'gp-body');
    this.summaryEl = el('div', 'gp-summary');
    this.gridEl = el('div', 'gp-section');
    this.arcEl = el('div', 'gp-section');
    body.append(this.summaryEl, this.gridEl, this.arcEl);

    this.root.append(header, this.variantEl, this.hardwareEl, body);
    parent.appendChild(this.root);
  }

  /** Expand ↔ collapse (the `h` key + the header click). */
  toggle(): void {
    this.collapsed = !this.collapsed;
    this.root.classList.toggle('collapsed', this.collapsed);
  }

  /** Anchor the panel's top below `px` pixels (cleared of the HUD), capping its height. */
  setTopPx(px: number): void {
    this.root.style.top = `${px}px`;
    this.root.style.maxHeight = `calc(100vh - ${px + 52}px)`; // leave room for the bottom-left badge
  }

  /** Set the active template's authored control map (name/summary + fallback gestures). */
  setDictionary(dict: GesturalDictionary | undefined): void {
    this.dict = dict;
    this.render();
  }

  /** Set the LIVE hardware-resolved control map (preferred over the static dict). */
  setControlMap(map: GesturalControlMap | null): void {
    this.live = map;
    this.render();
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

  private render(): void {
    if (!this.dict && !this.live) {
      this.titleEl.textContent = '— global column-fader';
      this.hardwareEl.textContent = '';
      this.summaryEl.textContent = 'No gestural map for this scene (legacy mapping).';
      this.gridEl.innerHTML = '';
      this.arcEl.innerHTML = '';
      return;
    }
    this.titleEl.textContent = this.dict?.name ?? 'Control map';
    this.summaryEl.textContent = this.dict?.summary ?? '';
    // Live map (hardware-accurate) wins; fall back to the authored dictionary.
    this.hardwareEl.textContent = this.live ? `▶ ${this.live.hardware}` : '';
    const grid = this.live?.grid ?? this.dict?.grid ?? [];
    const arc = this.live?.arc ?? this.dict?.arc ?? [];
    this.renderSection(this.gridEl, 'grid', grid);
    this.renderSection(this.arcEl, 'arc', arc);
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
