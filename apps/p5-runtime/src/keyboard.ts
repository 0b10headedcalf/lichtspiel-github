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
  toggleDebug(): void;
  toggleEmulator(): void;
}

const STEP = 0.06;

export function installKeyboard(h: KeyboardHandlers): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
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
  'd debug · g monome twin',
].join('\n');
