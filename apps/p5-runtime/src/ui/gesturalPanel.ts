/**
 * Gestural panel — the on-screen control map for the active template (what each
 * grid/arc gesture does) + a live variant readout. Adapted (not forked) from
 * windchime apps/web/src/ui/gesturalPanel.ts.
 *
 * Lives IN the left rail, directly under the monome twin, as a collapsible
 * caret menu (collapsed by default so it takes almost no space; `h` or a click
 * on the header expands it). Entries are compact and symbol-cued —
 * ◎ encoder · ▦ grid · ⟳ turn · ⊙ press · ⏺ hold — with the full original
 * wording available on hover, so it's terse but loses no information.
 *
 * The control map prefers the LIVE, hardware-resolved map from the sketch's
 * idiom layer (`setControlMap`) over the static authored dictionary — so it
 * always shows the *connected* device + any coupling/paging (e.g. "◎0⟳ size
 * obj 0+2" on an Arc 2), and re-renders on a hot-swap.
 */

import type { GesturalControlMap, GesturalDictionary, GesturalEntry } from '@lichtspiel/schemas';
import type { VariantInfo } from '../mutations/variantBrowser.js';

export class GesturalPanel {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly hardwareEl: HTMLElement;
  private readonly pageEl: HTMLElement;
  private readonly gridEl: HTMLElement;
  private readonly arcEl: HTMLElement;
  private readonly variantEl: HTMLElement;
  private readonly legendEl: HTMLElement;
  private collapsed = true;
  private dict: GesturalDictionary | undefined;
  private live: GesturalControlMap | null = null;
  private liveSig = '';

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
    this.pageEl = el('div', 'gp-page');

    const body = el('div', 'gp-body');
    this.gridEl = el('div', 'gp-section');
    this.arcEl = el('div', 'gp-section');
    this.legendEl = el('div', 'gp-legend');
    this.legendEl.textContent = '◎ enc  ▦ grid  ⟳ turn  ⊙ press  ⏺ hold';
    this.legendEl.title = 'symbol legend — hover any row for its full description';
    body.append(this.hardwareEl, this.pageEl, this.arcEl, this.gridEl, this.legendEl);

    this.root.append(header, this.variantEl, body);
    parent.appendChild(this.root);
    this.render();
  }

  /** Expand ↔ collapse (the `h` key + the header click). */
  toggle(): void {
    this.setExpanded(this.collapsed);
  }

  /** Force the expanded/collapsed state (e.g. PLAN mode opens everything). */
  setExpanded(expanded: boolean): void {
    this.collapsed = !expanded;
    this.root.classList.toggle('collapsed', this.collapsed);
  }

  /** Set the active template's authored control map (name/summary + fallback gestures). */
  setDictionary(dict: GesturalDictionary | undefined): void {
    this.dict = dict;
    this.render();
  }

  /** Set the LIVE hardware-resolved control map (preferred over the static dict). */
  setControlMap(map: GesturalControlMap | null): void {
    // Skip the DOM rebuild when nothing changed (this is polled after every arc key,
    // most of which don't flip the page) — so only a real change re-renders.
    const sig = map ? JSON.stringify([map.hardware, map.page, map.grid, map.arc]) : '';
    if (sig === this.liveSig) return;
    this.liveSig = sig;
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
      this.titleEl.textContent = '▦ global faders';
      this.titleEl.title = 'No gestural map for this scene (legacy column-fader mapping).';
      this.hardwareEl.textContent = '';
      this.pageEl.textContent = '';
      this.gridEl.innerHTML = '';
      this.arcEl.innerHTML = '';
      return;
    }
    this.titleEl.textContent = this.dict?.name ?? 'controls';
    // The verbose summary moves to a hover tooltip — informative, zero pixels.
    this.titleEl.title = this.dict?.summary ?? '';
    // Live map (hardware-accurate) wins; fall back to the authored dictionary.
    this.hardwareEl.textContent = this.live ? `▶ ${this.live.hardware}` : '';
    // Active encoder page (always shown when there's a live arc — "1 / 1" if no paging).
    const pg = this.live?.page;
    this.pageEl.textContent =
      pg && (this.live?.arc.length ?? 0) > 0 ? `◎ page ${pg.index + 1}/${pg.total}` : '';
    const grid = this.live?.grid ?? this.dict?.grid ?? [];
    const arc = this.live?.arc ?? this.dict?.arc ?? [];
    this.renderSection(this.arcEl, '◎', arc);
    this.renderSection(this.gridEl, '▦', grid);
  }

  private renderSection(container: HTMLElement, icon: string, entries: GesturalEntry[]): void {
    container.innerHTML = '';
    for (const e of entries) {
      const row = el('div', 'gp-entry');
      row.title = `${e.area} · ${e.action} → ${e.effect}`; // full wording on hover
      row.innerHTML =
        `<span class="gp-sym">${escapeHtml(symbolize(icon, e.area, e.action))}</span>` +
        `<span class="gp-effect">${escapeHtml(e.effect)}</span>`;
      container.appendChild(row);
    }
  }
}

/** "enc 0 · turn" → "◎0 ⟳" — compact symbol cue, full text stays in the tooltip. */
function symbolize(icon: string, area: string, action: string): string {
  return `${icon}${compactArea(area)} ${actionSym(action)}`.trim();
}

function compactArea(area: string): string {
  return area
    .toLowerCase()
    .replace(/encoders?|\benc\b|\barc\b/g, '')
    .replace(/columns?|\bcols?\b/g, 'c')
    .replace(/\brows?\b/g, 'r')
    .replace(/\bgrid\b|\bcells?\b|\bkeys?\b/g, '')
    .replace(/\s*([+&,/–-])\s*/g, '$1') // tighten ranges: "0 – 7" → "0–7"
    .replace(/\s+/g, ' ')
    .trim();
}

function actionSym(action: string): string {
  const a = action.toLowerCase();
  if (a.includes('chord')) return '⊙⊙';
  if (a.includes('hold')) return '⏺';
  if (/press|push|click|tap/.test(a)) return '⊙';
  if (/turn|rotate|spin|twist/.test(a)) return '⟳';
  return action; // unknown gesture: keep the original word rather than lose it
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
