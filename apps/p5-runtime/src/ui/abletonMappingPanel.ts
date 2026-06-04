/**
 * Ableton mapping panel (Phase 5b) — the performer's scene/locator → animation
 * assignment surface. Top-right, collapsible (toggle `a`), collapsed by default
 * so it never covers the canvas during a show. Two tables (Arrangement locators,
 * Session scenes); each row pins a Template (random + every registered template)
 * and a Variant policy (canonical/random), with an enable toggle, a ▶ preview
 * that fires that row's event locally, and a "last triggered" readout.
 *
 * Pure view + intent: it holds the working AbletonMapping, renders it, and calls
 * back on edits / refresh / save / load / preview. main.ts owns the resolver +
 * storage. Mirrors the GesturalPanel DOM/CSS conventions (`el()`, collapsed class).
 */

import type { AbletonMapping, MappingPresetInfo, MappingRow, VariantMode } from '@lichtspiel/schemas';
import type { AbletonEvent, EventSource, RetrievalMode } from '../live/abletonRetrieval.js';

export interface TemplateChoice {
  id: string;
  name: string;
}

export interface AbletonMappingPanelOptions {
  /** Every registered template (the Template dropdown options besides "random"). */
  templates: TemplateChoice[];
  /** Re-snapshot the set's scenes/locators (fixture in Part B; the bridge in Part C). */
  onRefresh(): void;
  /** Persist the current mapping under a name. */
  onSave(name: string): void;
  /** Load a saved mapping by name. */
  onLoad(name: string): void;
  /** Rename a saved preset. */
  onRename(name: string, newName: string): void;
  /** Delete a saved preset. */
  onDelete(name: string): void;
  /** Request the list of saved presets (to populate the Load dropdown). */
  onListRequest(): void;
  /** Fire a row's event locally (manual preview). */
  onPreview(evt: AbletonEvent): void;
  /** A row was edited — the (mutated) mapping is handed back for storage. */
  onEdit(mapping: AbletonMapping): void;
}

type RowKind = 'scene' | 'locator';

export class AbletonMappingPanel {
  private readonly root: HTMLElement;
  private readonly metaEl: HTMLElement;
  private readonly loadSel: HTMLSelectElement;
  private readonly locBody: HTMLElement;
  private readonly sceneBody: HTMLElement;
  private collapsed = true;
  private mapping: AbletonMapping | null = null;
  private source: EventSource = 'live';
  private fallback: RetrievalMode = 'mapped';
  private locked = false;
  /** Saved presets (for the set-aware Load list). */
  private presets: MappingPresetInfo[] = [];
  /**
   * Structural signature of the currently-OPEN Ableton set (from the last
   * snapshot). Match flags compare presets against THIS — not the loaded
   * mapping — so loading a preset built for a different set never relabels the
   * list or reorders it (which was breaking the picker).
   */
  private liveSig: string | undefined;
  /** A rebuild was requested while the Load popup was open; do it on blur. */
  private loadDirty = false;
  /** The preset currently loaded/saved — the target of Save / Rename / Delete. */
  private currentPresetName: string | null = null;
  /** row → its <tr> + last-cell, so markTriggered can flash without a full re-render. */
  private readonly rowEls = new Map<MappingRow, { tr: HTMLElement; last: HTMLElement }>();

  constructor(
    private readonly opts: AbletonMappingPanelOptions,
    parent: HTMLElement = document.body,
  ) {
    this.root = el('div', 'ableton-panel collapsed');

    const header = el('div', 'ap-header');
    const caret = el('span', 'ap-caret');
    caret.textContent = '▸';
    const title = el('span', 'ap-title');
    title.textContent = 'Ableton Mapping';
    header.append(caret, title);
    header.addEventListener('click', () => this.toggle());

    this.metaEl = el('div', 'ap-meta');

    const body = el('div', 'ap-body');

    const controls = el('div', 'ap-controls');
    const refreshBtn = button('Refresh', () => this.opts.onRefresh());
    // Save = overwrite the loaded preset (no prompt); Save As = always prompt.
    const saveBtn = button('Save', () => this.doSave(false));
    const saveAsBtn = button('Save As', () => this.doSave(true));
    this.loadSel = document.createElement('select');
    this.loadSel.className = 'ap-load';
    this.resetLoadOptions();
    // The list is refreshed on expand + after every op (and on connect), so it's
    // already fresh when opened — we deliberately DON'T rebuild on mousedown,
    // because replacing <option>s mid-open reorders them and drops the click. If a
    // rebuild is requested while the popup is open, defer it to blur.
    this.loadSel.addEventListener('blur', () => {
      if (this.loadDirty) this.renderLoadOptions();
    });
    this.loadSel.addEventListener('change', () => {
      const name = this.loadSel.value;
      this.loadSel.value = '';
      if (name) {
        this.currentPresetName = name;
        this.opts.onLoad(name);
        this.renderMeta();
      }
    });
    const renameBtn = button('Rename', () => {
      if (!this.currentPresetName) return window.alert('Load or save a preset first.');
      const next = window.prompt(`Rename "${this.currentPresetName}" to:`, this.currentPresetName);
      if (next && next.trim() && next.trim() !== this.currentPresetName) {
        const from = this.currentPresetName;
        this.currentPresetName = next.trim();
        this.opts.onRename(from, next.trim());
        this.renderMeta();
      }
    });
    const deleteBtn = button('Delete', () => {
      if (!this.currentPresetName) return window.alert('Load or save a preset first.');
      if (window.confirm(`Delete preset "${this.currentPresetName}"?`)) {
        this.opts.onDelete(this.currentPresetName);
        this.currentPresetName = null;
        this.renderMeta();
      }
    });
    controls.append(refreshBtn, saveBtn, saveAsBtn, this.loadSel, renameBtn, deleteBtn);

    const locLabel = el('div', 'ap-section-label');
    locLabel.textContent = 'Arrangement locators';
    const loc = this.makeTable('time');
    this.locBody = loc.tbody;

    const sceneLabel = el('div', 'ap-section-label');
    sceneLabel.textContent = 'Session scenes';
    const scene = this.makeTable('idx');
    this.sceneBody = scene.tbody;

    body.append(controls, locLabel, loc.table, sceneLabel, scene.table);
    this.root.append(header, this.metaEl, body);
    parent.appendChild(this.root);
    this.renderMeta();
  }

  toggle(): void {
    this.collapsed = !this.collapsed;
    this.root.classList.toggle('collapsed', this.collapsed);
    if (!this.collapsed) this.opts.onListRequest();
  }

  setMapping(m: AbletonMapping | null): void {
    this.mapping = m;
    this.render();
  }

  /** Populate the Load dropdown with saved presets, flagging the ones that match the current set. */
  setPresets(presets: MappingPresetInfo[]): void {
    this.presets = presets;
    this.renderLoadOptions();
  }

  /**
   * The structural signature of the currently-OPEN Ableton set (from the last
   * snapshot). Drives the 🟢/🔴 match flags — anchored to the live set, so loading
   * a preset for a different set doesn't relabel/reorder the Load list.
   */
  setLiveSignature(sig: string | undefined): void {
    this.liveSig = sig;
    this.renderLoadOptions();
    this.renderMeta();
  }

  /** Save: overwrite the loaded preset (no prompt). Save As (or no current preset): prompt for a name. */
  private doSave(asNew: boolean): void {
    let name = this.currentPresetName;
    if (asNew || !name) {
      const proposed = window.prompt('Save preset as:', name || this.mapping?.setName || 'mapping');
      if (!proposed || !proposed.trim()) return;
      name = proposed.trim();
    }
    this.currentPresetName = name;
    this.opts.onSave(name); // same name → overwrites the existing file (no duplicate)
    this.renderMeta();
  }

  /**
   * Set/clear the preset that Rename / Delete act on — e.g. after a successful
   * bridge load, or cleared when a set change replaced the rows (its preset no
   * longer applies).
   */
  setCurrentPreset(name: string | null): void {
    this.currentPresetName = name;
    this.renderMeta();
  }

  setSource(s: EventSource): void {
    this.source = s;
    this.renderMeta();
  }
  setFallback(m: RetrievalMode): void {
    this.fallback = m;
    this.renderMeta();
  }
  setLock(locked: boolean): void {
    this.locked = locked;
    this.renderMeta();
  }

  /** Flash the row matched by an event (name-first, then index) with a label. */
  markTriggered(evt: AbletonEvent, label: string): void {
    const rows = !this.mapping
      ? []
      : evt.kind === 'scene'
        ? this.mapping.session.scenes
        : this.mapping.arrangement.locators;
    const row =
      (evt.name ? rows.find((r) => r.name.toLowerCase() === evt.name.toLowerCase()) : undefined) ??
      rows.find((r) => r.index === evt.index);
    for (const refs of this.rowEls.values()) refs.tr.classList.remove('ap-active');
    if (!row) return;
    const refs = this.rowEls.get(row);
    if (refs) {
      refs.tr.classList.add('ap-active');
      refs.last.textContent = label;
      refs.last.title = label; // full text on hover when the cell still clips
    }
  }

  // ── rendering ──────────────────────────────────────────────────────
  private resetLoadOptions(): void {
    this.loadSel.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = 'Load ▾';
    this.loadSel.append(ph);
    this.loadSel.value = '';
  }

  /**
   * Rebuild the Load dropdown — presets matching the open set (🟢) float to the
   * top; presets for a different set are marked 🔴. Matching is against the LIVE
   * set signature, not the loaded mapping. Deferred while the popup is open (a
   * mid-open rebuild reorders the options and drops the click).
   */
  private renderLoadOptions(): void {
    if (document.activeElement === this.loadSel) {
      this.loadDirty = true;
      return;
    }
    this.loadDirty = false;
    this.resetLoadOptions();
    const matches = (p: MappingPresetInfo): boolean => !!this.liveSig && p.setSignature === this.liveSig;
    const ranked = [...this.presets].sort(
      (a, b) => Number(matches(b)) - Number(matches(a)) || a.name.localeCompare(b.name),
    );
    for (const p of ranked) {
      const m = matches(p);
      const o = document.createElement('option');
      o.value = p.name;
      o.textContent = `${m ? '🟢' : '🔴'} ${p.name}`;
      o.title = m ? 'matches the current set' : p.setName ? `for a different set: ${p.setName}` : 'for a different set';
      this.loadSel.append(o);
    }
  }

  private renderMeta(): void {
    let presetTag = '';
    if (this.currentPresetName) {
      // 🟢 the loaded preset is for the open set · 🔴 it's for a different set.
      const match = !!this.liveSig && this.mapping?.setSignature === this.liveSig;
      presetTag = `<span class="ap-preset">▸ ${escapeHtml(this.currentPresetName)} ${match ? '🟢' : '🔴'}</span>`;
    }
    this.metaEl.innerHTML =
      `<span>src <b>${this.source}</b></span>` +
      `<span>fallback <b>${this.fallback}</b></span>` +
      `<span>${this.locked ? '🔒 locked' : '🔓 live'}</span>` +
      presetTag +
      (this.mapping ? `<span class="ap-setname">${escapeHtml(this.mapping.setName || '—')}</span>` : '');
  }

  private makeTable(idxLabel: string): { table: HTMLElement; tbody: HTMLElement } {
    const table = el('table', 'ap-table');
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr><th></th><th>name</th><th>${idxLabel}</th><th>template</th><th>variant</th><th></th><th>last</th></tr>`;
    const tbody = document.createElement('tbody');
    table.append(thead, tbody);
    return { table, tbody };
  }

  private render(): void {
    this.rowEls.clear();
    this.renderRows(this.locBody, 'locator', this.mapping?.arrangement.locators ?? []);
    this.renderRows(this.sceneBody, 'scene', this.mapping?.session.scenes ?? []);
    this.renderLoadOptions(); // refresh set-match flags against the new signature
    this.renderMeta();
  }

  private renderRows(tbody: HTMLElement, kind: RowKind, rows: MappingRow[]): void {
    tbody.innerHTML = '';
    if (rows.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.className = 'ap-empty';
      td.textContent = `— no ${kind === 'locator' ? 'locators' : 'scenes'} — press Refresh`;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    for (const row of rows) {
      const tr = document.createElement('tr');
      if (row.stale) tr.classList.add('ap-stale');

      const enCell = document.createElement('td');
      const en = document.createElement('input');
      en.type = 'checkbox';
      en.checked = row.enabled;
      en.addEventListener('change', () => {
        row.enabled = en.checked;
        this.emitEdit();
      });
      enCell.appendChild(en);

      const nameCell = document.createElement('td');
      nameCell.className = 'ap-name';
      nameCell.title = row.name;
      nameCell.textContent = (row.stale ? '⚠ ' : '') + (row.name || `#${row.index}`);

      const idxCell = document.createElement('td');
      idxCell.className = 'ap-idx';
      idxCell.textContent =
        kind === 'locator' && row.time !== undefined ? String(row.time) : String(row.index);

      const tplCell = document.createElement('td');
      tplCell.appendChild(this.templateSelect(row));

      const varCell = document.createElement('td');
      varCell.appendChild(this.variantSelect(row));

      const prevCell = document.createElement('td');
      const prev = button('▶', () => this.opts.onPreview({ kind, index: row.index, name: row.name }));
      prev.classList.add('ap-prev');
      prevCell.appendChild(prev);

      const lastCell = document.createElement('td');
      lastCell.className = 'ap-last';

      tr.append(enCell, nameCell, idxCell, tplCell, varCell, prevCell, lastCell);
      tbody.appendChild(tr);
      this.rowEls.set(row, { tr, last: lastCell });
    }
  }

  private templateSelect(row: MappingRow): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.className = 'ap-tpl';
    const rnd = document.createElement('option');
    rnd.value = '*random*';
    rnd.textContent = 'random';
    sel.append(rnd);
    for (const t of this.opts.templates) {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.name;
      sel.append(o);
    }
    sel.value = row.templateMode === 'fixed' && row.templateId ? row.templateId : '*random*';
    sel.addEventListener('change', () => {
      if (sel.value === '*random*') {
        row.templateMode = 'random';
        delete row.templateId;
      } else {
        row.templateMode = 'fixed';
        row.templateId = sel.value;
      }
      this.emitEdit();
    });
    return sel;
  }

  private variantSelect(row: MappingRow): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.className = 'ap-var';
    for (const v of ['canonical', 'random'] as VariantMode[]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.append(o);
    }
    sel.value = row.variantMode;
    sel.addEventListener('change', () => {
      row.variantMode = sel.value as VariantMode;
      this.emitEdit();
    });
    return sel;
  }

  private emitEdit(): void {
    if (this.mapping) this.opts.onEdit(this.mapping);
    this.renderMeta();
  }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ap-btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c] ?? c);
}
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
