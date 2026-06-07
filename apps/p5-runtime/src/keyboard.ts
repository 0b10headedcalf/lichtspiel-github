/**
 * Keyboard fallback — full control of the runtime with no hardware. Mirrors
 * the monome mappings (Phase 4) so the demo always has a backup. Pure
 * key→intent mapping; main.ts implements the handlers.
 */

export interface KeyboardHandlers {
  /** Select template by 0-based registry slot (digit keys 1..N). */
  selectIndex(index: number): void;
  next(): void;
  prev(): void;
  /** Nudge a numeric param by delta (clamped by the handler). */
  adjust(key: 'semanticDistance' | 'mutationAmount' | 'motion' | 'density', delta: number): void;
  toggleLock(): void;
  randomize(): void;
  surprise(): void;
  /** New random structural variant of the current scene. */
  variant(): void;
  /** Reset the current scene to its canonical (signature) look. */
  canonical(): void;
  /** Step the current scene's variant cursor by ±1 (deterministic). */
  stepVariant(dir: 1 | -1): void;
  toggleDebug(): void;
  toggleEmulator(): void;
  /** Toggle the gestural control-map panel. */
  toggleGestural(): void;
  /** Toggle the Ableton scene/locator → animation mapping panel. */
  toggleAbletonPanel(): void;
  /** Cycle the Ableton retrieval mode: mapped ⇄ random. */
  cycleRetrievalMode(): void;
  /** Cycle the event source: live (real OSC) ⇄ simulated (UI-fired). */
  cycleEventSource(): void;
  /** Fire a synthetic Session scene-launch (simulated source only). */
  simulateSceneLaunch(): void;
  /** Fire a synthetic Arrangement locator-crossing (simulated source only). */
  simulateLocator(): void;
}

const STEP = 0.06;

export function installKeyboard(h: KeyboardHandlers): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // The dashboard's rails are full of focusable controls (selects, checkboxes,
    // buttons). Performance shortcuts must stay global, so we only stand down when
    // the user is genuinely typing into a text field — otherwise we handle the key
    // and preventDefault, so a focused <select>/checkbox can't also swallow it.
    const ae = document.activeElement as HTMLElement | null;
    const tag = ae?.tagName;
    const typing =
      ae?.isContentEditable ||
      tag === 'TEXTAREA' ||
      (tag === 'INPUT' && /^(text|search|number|email|password|url|tel)$/i.test((ae as HTMLInputElement).type));
    if (typing) return;
    // digits 1..9 → template slots
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 9) {
        h.selectIndex(n - 1);
        e.preventDefault();
        return;
      }
    }
    switch (e.code) {
      case 'ArrowRight':
        h.adjust('semanticDistance', STEP);
        break;
      case 'ArrowLeft':
        h.adjust('semanticDistance', -STEP);
        break;
      case 'ArrowUp':
        h.adjust('mutationAmount', STEP);
        break;
      case 'ArrowDown':
        h.adjust('mutationAmount', -STEP);
        break;
      case 'BracketRight':
        h.adjust('density', STEP);
        break;
      case 'BracketLeft':
        h.adjust('density', -STEP);
        break;
      case 'Equal':
        h.adjust('motion', STEP);
        break;
      case 'Minus':
        h.adjust('motion', -STEP);
        break;
      case 'Space':
        h.toggleLock();
        break;
      case 'KeyR':
        h.randomize();
        break;
      case 'KeyS':
        h.surprise();
        break;
      case 'KeyV':
        h.variant();
        break;
      case 'KeyC':
        h.canonical();
        break;
      case 'Comma':
        h.stepVariant(-1);
        break;
      case 'Period':
        h.stepVariant(1);
        break;
      case 'KeyH':
        h.toggleGestural();
        break;
      case 'KeyA':
        h.toggleAbletonPanel();
        break;
      case 'KeyN':
        h.next();
        break;
      case 'KeyP':
        h.prev();
        break;
      case 'KeyD':
        h.toggleDebug();
        break;
      case 'KeyG':
        h.toggleEmulator();
        break;
      case 'KeyM':
        h.cycleRetrievalMode();
        break;
      case 'KeyE':
        h.cycleEventSource();
        break;
      case 'KeyK':
        h.simulateSceneLaunch();
        break;
      case 'KeyL':
        h.simulateLocator();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

export const KEYBOARD_HELP = [
  '1–5 select scene · n/p next/prev',
  '← → semantic distance · ↑ ↓ mutation',
  '[ ] density · - = motion',
  'space lock · r randomize · s surprise',
  'v new variant · c canonical · , . step variant',
  'd debug · g monome twin · h gestures · a mapping',
  'm retrieval mode · e event source · k/l sim scene/locator',
].join('\n');
