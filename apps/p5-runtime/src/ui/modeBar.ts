/**
 * Mode bar — the top-center PLAN / PERFORM / ARRANGE selector. Each mode is a
 * use case with its own UI theme + panel layout (wired in main.ts):
 *   PLAN    (silver) — composition: both rails open, full mapping tables.
 *   PERFORM (black)  — live Session playing: scenes table only; the left rail
 *                      auto-collapses when scenes start launching.
 *   ARRANGE (walnut) — Arrangement prep: locators table only.
 * All three chips are always present; the inactive ones are faded/transparent
 * but keep their identity color, so the active mode is unmistakable.
 */

export type UiMode = 'plan' | 'perform' | 'arrange';

export const UI_MODES: readonly UiMode[] = ['plan', 'perform', 'arrange'] as const;

const MODE_TITLE: Record<UiMode, string> = {
  plan: 'Plan — composition: all panels + full mapping tables',
  perform: 'Perform — Session scenes view; canvas opens up as scenes launch',
  arrange: 'Arrange — Arrangement locators view (prep)',
};

export class ModeBar {
  private readonly buttons = new Map<UiMode, HTMLButtonElement>();

  constructor(parent: HTMLElement, onSelect: (mode: UiMode) => void) {
    const root = document.createElement('div');
    root.className = 'mode-bar';
    for (const mode of UI_MODES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `mode-btn mode-${mode}`;
      b.textContent = mode;
      b.title = MODE_TITLE[mode];
      b.addEventListener('click', () => onSelect(mode));
      this.buttons.set(mode, b);
      root.appendChild(b);
    }
    parent.appendChild(root);
  }

  setActive(mode: UiMode): void {
    for (const [m, b] of this.buttons) b.classList.toggle('active', m === mode);
  }
}
