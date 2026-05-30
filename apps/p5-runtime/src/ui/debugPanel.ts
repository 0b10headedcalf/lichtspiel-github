/**
 * Diagnostics HUD — FPS, current template, lock/connection state, and a live
 * readout of the key params. Toggle with `d`. DOM updates are throttled so
 * the panel never costs meaningful frame time.
 */

import type { LiveSessionState, VisualParamVector } from '@lichtspiel/schemas';
import { KEYBOARD_HELP } from '../keyboard.js';

const READOUT_KEYS: Array<keyof VisualParamVector> = [
  'density',
  'motion',
  'turbulence',
  'symmetry',
  'palette',
  'contrast',
  'strobe',
  'semanticDistance',
  'mutationAmount',
];

export class DebugPanel {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private visible = true;
  private frameCount = 0;
  private templateName = '';
  private locked = false;
  private connected = false;
  private liveSummary = '';
  private liveRx = 0;

  constructor(root: HTMLElement, help: HTMLElement) {
    this.root = root;
    this.body = root.querySelector('#hud-body') as HTMLElement;
    help.textContent = KEYBOARD_HELP;
  }

  setTemplateName(name: string): void {
    this.templateName = name;
  }
  setLock(locked: boolean): void {
    this.locked = locked;
  }
  setConnected(connected: boolean): void {
    this.connected = connected;
  }
  /** Show the latest Live state from Max — confirms the M4L → bridge → p5 path.
   *  The rx counter visibly ticks per message so "is it live?" is unambiguous. */
  setLive(s: LiveSessionState): void {
    const sel = s.selection;
    const label = sel.clipName || sel.trackName || sel.sceneName || '∅';
    this.liveRx++;
    this.liveSummary = `${s.transport.isPlaying ? '▶' : '⏸'} ${escape(label)} · ${s.transport.tempo.toFixed(0)}bpm · ${escape(sel.clipType)} · rx ${this.liveRx}`;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.classList.toggle('hidden', !this.visible);
  }

  /** Called every frame; renders ~10×/sec. */
  updateFrame(fps: number, params: VisualParamVector): void {
    if (!this.visible) return;
    if (this.frameCount++ % 6 !== 0) return;

    const lines: string[] = [];
    lines.push(
      `<div class="hud-row"><b>${escape(this.templateName || params.sceneId)}</b>` +
        `<span class="hud-fps">${fps.toFixed(0)} fps</span></div>`,
    );
    lines.push(
      `<div class="hud-row hud-meta">` +
        `${this.locked ? '🔒 locked' : '🔓 live'} · ` +
        `${this.connected ? '🔊 bridge' : '○ browser-only'}</div>`,
    );
    if (this.liveSummary) {
      lines.push(`<div class="hud-row hud-meta">Live: ${this.liveSummary}</div>`);
    }
    for (const k of READOUT_KEYS) {
      const v = params[k] as number;
      lines.push(
        `<div class="hud-param"><span class="hud-k">${k}</span>` +
          `<span class="hud-bar"><i style="width:${(v * 100).toFixed(0)}%"></i></span>` +
          `<span class="hud-v">${v.toFixed(2)}</span></div>`,
      );
    }
    this.body.innerHTML = lines.join('');
  }
}

function escape(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
