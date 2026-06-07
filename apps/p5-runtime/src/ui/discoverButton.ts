/**
 * Discover menu — the entry point to the generative track ("Discovery →
 * Generate", see docs/generative-architecture.md). The trigger reveals two modes:
 *
 *   • Sync  — audio → CLAP vibe → template. No prompt; the ml-service encodes the
 *             current working track and writes a matching visual.
 *   • Dream — natural-language → template. Clicking it reveals a text box; the
 *             typed description steers the generation.
 *
 * Pure view + intent (mirrors the GesturalPanel / AbletonMappingPanel
 * convention): it renders the trigger + the inline menu and fires `onSync()` /
 * `onDream(prompt)`. main.ts owns the actual generate call + template handoff.
 * The menu expands INLINE (not an absolute popover) because the rail clips
 * overflow.
 */

export interface DiscoverButtonOptions {
  /** Sync mode: generate from the current audio (no prompt). */
  onSync(): void;
  /** Dream mode: generate from a natural-language description. */
  onDream(prompt: string): void;
}

export class DiscoverButton {
  private readonly root: HTMLElement;
  private readonly trigger: HTMLButtonElement;
  private readonly promptInput: HTMLInputElement;
  private readonly status: HTMLElement;
  private busy = false;

  constructor(opts: DiscoverButtonOptions, parent: HTMLElement = document.body) {
    this.root = el('div', 'discover');

    this.trigger = el('button', 'ap-btn discover-btn') as HTMLButtonElement;
    this.trigger.textContent = '✶ Discover';
    this.trigger.addEventListener('click', () => this.toggleMenu());

    // Two-choice menu (revealed when the trigger is open).
    const menu = el('div', 'discover-menu');
    const sync = modeBtn('⟳ Sync', 'audio → visual template');
    const dream = modeBtn('☁ Dream', 'describe a visual in words');
    sync.addEventListener('click', () => {
      this.close();
      opts.onSync();
    });
    dream.addEventListener('click', () => this.openDream());
    menu.append(sync, dream);

    // Dream prompt row (revealed when Dream is chosen).
    const dreamRow = el('div', 'discover-dream');
    this.promptInput = el('input', 'chat-box discover-prompt') as HTMLInputElement;
    this.promptInput.type = 'text';
    this.promptInput.placeholder = 'Describe a visual…';
    const go = el('button', 'ap-btn discover-go') as HTMLButtonElement;
    go.textContent = '✶';
    go.title = 'Dream this';
    const submit = (): void => {
      const text = this.promptInput.value.trim();
      if (!text) return;
      this.close();
      opts.onDream(text);
    };
    go.addEventListener('click', submit);
    this.promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      else if (e.key === 'Escape') this.close();
    });
    dreamRow.append(this.promptInput, go);

    // Status line — kept OUTSIDE the collapsing menu so errors/progress stay
    // visible after the menu closes. Empty by default.
    this.status = el('div', 'discover-status');

    this.root.append(this.trigger, menu, dreamRow, this.status);
    parent.appendChild(this.root);
  }

  /** Show a progress / result / error line under the menu. Empty msg hides it. */
  setStatus(msg: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
    this.status.textContent = msg;
    this.status.className = msg ? `discover-status ${kind}` : 'discover-status';
  }

  private toggleMenu(): void {
    if (this.busy) return;
    const open = this.root.classList.contains('menu-open');
    this.close();
    if (!open) this.root.classList.add('menu-open');
  }

  private openDream(): void {
    this.root.classList.remove('menu-open');
    this.root.classList.add('dream-open');
    this.promptInput.focus();
  }

  private close(): void {
    this.root.classList.remove('menu-open', 'dream-open');
    this.promptInput.value = '';
  }

  /** Toggle the in-flight state (disables the trigger + collapses the menu). */
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.trigger.disabled = busy;
    this.trigger.textContent = busy ? '✶ Generating…' : '✶ Discover';
    if (busy) this.close();
  }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
function modeBtn(label: string, tip: string): HTMLButtonElement {
  const b = el('button', 'ap-btn discover-mode') as HTMLButtonElement;
  b.textContent = label;
  b.title = tip;
  b.setAttribute('data-tip', tip);
  return b;
}
