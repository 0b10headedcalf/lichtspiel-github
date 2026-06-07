/**
 * AudioPanel — the floating control surface for the audio-reactive distortion
 * (toggle with `f`). Enable/stop the input, pick an input device (mic, line-in,
 * or a loopback like BlackHole carrying Ableton's master), set sensitivity +
 * master distortion amount + style, toggle the distortion on/off, and watch live
 * level/band meters. Pure DOM + callbacks; main.ts owns the engine + overlay.
 */

import type { AudioFeatures } from '@lichtspiel/schemas';
import type { AudioInputInfo } from '../audio/audioEngine.js';
import {
  type DistortionStyle,
  DISTORTION_STYLES,
  STYLE_LABELS,
} from '../audio/audioMapping.js';

export interface AudioPanelCallbacks {
  /** Enable button while stopped → start capture (a user gesture). */
  onEnable(): void;
  /** Enable button while running → stop capture. */
  onDisable(): void;
  onDeviceChange(deviceId: string): void;
  onSensitivity(value: number): void;
  onAmount(value: number): void;
  onStyle(style: DistortionStyle): void;
  onDistortToggle(on: boolean): void;
  /** Toggle whether audio features are fed to templates (beat-synced reactivity). */
  onSceneReactToggle(on: boolean): void;
}

const METERS: ReadonlyArray<{ key: keyof AudioFeatures; label: string }> = [
  { key: 'level', label: 'lvl' },
  { key: 'bass', label: 'bass' },
  { key: 'mid', label: 'mid' },
  { key: 'treble', label: 'treb' },
];

export class AudioPanel {
  private readonly root: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly enableBtn: HTMLButtonElement;
  private readonly distortBtn: HTMLButtonElement;
  private readonly sceneBtn: HTMLButtonElement;
  private readonly deviceSel: HTMLSelectElement;
  private readonly styleSel: HTMLSelectElement;
  private readonly sensInput: HTMLInputElement;
  private readonly amountInput: HTMLInputElement;
  private readonly beatDot: HTMLElement;
  private readonly bars = new Map<keyof AudioFeatures, HTMLElement>();
  private visible = false;
  private running = false;

  constructor(parent: HTMLElement, cb: AudioPanelCallbacks) {
    const el = document.createElement('div');
    el.className = 'audio-panel';
    el.innerHTML = `
      <div class="ap-header">
        <span class="ap-title">AUDIO REACTIVE</span>
        <span class="ap-status">off</span>
        <span class="ap-beat" title="beat">●</span>
      </div>
      <div class="ap-row">
        <button class="ap-enable" type="button">Enable input</button>
      </div>
      <div class="ap-row">
        <button class="ap-distort" type="button">Distort: off</button>
        <button class="ap-scene" type="button">Scene: off</button>
      </div>
      <label class="ap-field"><span>Input</span><select class="ap-device"></select></label>
      <label class="ap-field"><span>Sensitivity</span>
        <input class="ap-sens" type="range" min="0" max="3" step="0.01" value="1" /></label>
      <label class="ap-field"><span>Distortion</span>
        <input class="ap-amount" type="range" min="0" max="1.5" step="0.01" value="0.7" /></label>
      <label class="ap-field"><span>Style</span><select class="ap-style"></select></label>
      <div class="ap-meters"></div>
      <div class="ap-hint">Route Ableton → BlackHole, pick it as Input · <b>f</b> panel · <b>x</b> distort · <b>b</b> scene</div>
    `;
    parent.appendChild(el);
    this.root = el;

    this.statusEl = el.querySelector('.ap-status') as HTMLElement;
    this.beatDot = el.querySelector('.ap-beat') as HTMLElement;
    this.enableBtn = el.querySelector('.ap-enable') as HTMLButtonElement;
    this.distortBtn = el.querySelector('.ap-distort') as HTMLButtonElement;
    this.sceneBtn = el.querySelector('.ap-scene') as HTMLButtonElement;
    this.deviceSel = el.querySelector('.ap-device') as HTMLSelectElement;
    this.styleSel = el.querySelector('.ap-style') as HTMLSelectElement;
    this.sensInput = el.querySelector('.ap-sens') as HTMLInputElement;
    this.amountInput = el.querySelector('.ap-amount') as HTMLInputElement;

    // Style options.
    for (const s of DISTORTION_STYLES) {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = STYLE_LABELS[s];
      this.styleSel.appendChild(o);
    }
    // Default device placeholder (real labels arrive after permission).
    this.setDevices([], null);

    // Meters.
    const metersEl = el.querySelector('.ap-meters') as HTMLElement;
    for (const m of METERS) {
      const row = document.createElement('div');
      row.className = 'ap-meter';
      row.innerHTML = `<span>${m.label}</span><span class="ap-bar"><i></i></span>`;
      metersEl.appendChild(row);
      this.bars.set(m.key, row.querySelector('i') as HTMLElement);
    }

    // Wiring.
    this.enableBtn.addEventListener('click', () => {
      if (this.running) cb.onDisable();
      else cb.onEnable();
    });
    this.distortBtn.addEventListener('click', () => {
      const on = !this.distortBtn.classList.contains('on');
      cb.onDistortToggle(on);
    });
    this.sceneBtn.addEventListener('click', () => {
      const on = !this.sceneBtn.classList.contains('on');
      cb.onSceneReactToggle(on);
    });
    this.deviceSel.addEventListener('change', () => cb.onDeviceChange(this.deviceSel.value));
    this.styleSel.addEventListener('change', () => cb.onStyle(this.styleSel.value as DistortionStyle));
    this.sensInput.addEventListener('input', () => cb.onSensitivity(Number(this.sensInput.value)));
    this.amountInput.addEventListener('input', () => cb.onAmount(Number(this.amountInput.value)));
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.classList.toggle('shown', this.visible);
  }
  show(): void {
    this.visible = true;
    this.root.classList.add('shown');
  }

  selectedDeviceId(): string {
    return this.deviceSel.value;
  }

  setRunning(on: boolean, status?: string): void {
    this.running = on;
    this.enableBtn.textContent = on ? 'Stop input' : 'Enable input';
    this.enableBtn.classList.toggle('on', on);
    this.statusEl.textContent = status ?? (on ? 'live' : 'off');
    if (!on) for (const bar of this.bars.values()) bar.style.width = '0%';
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  setDistort(on: boolean): void {
    this.distortBtn.textContent = `Distort: ${on ? 'on' : 'off'}`;
    this.distortBtn.classList.toggle('on', on);
  }

  setSceneReact(on: boolean): void {
    this.sceneBtn.textContent = `Scene: ${on ? 'on' : 'off'}`;
    this.sceneBtn.classList.toggle('on', on);
  }

  setDevices(list: AudioInputInfo[], selectedId: string | null): void {
    this.deviceSel.innerHTML = '';
    if (list.length === 0) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = 'Default input';
      this.deviceSel.appendChild(o);
    }
    for (const d of list) {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label;
      this.deviceSel.appendChild(o);
    }
    if (selectedId) this.deviceSel.value = selectedId;
  }

  setAmount(value: number): void {
    this.amountInput.value = String(value);
  }
  setSensitivity(value: number): void {
    this.sensInput.value = String(value);
  }
  setStyle(style: DistortionStyle): void {
    this.styleSel.value = style;
  }

  /** Update the live meters (called per audio frame; cheap DOM width writes). */
  setFeatures(f: AudioFeatures): void {
    if (!this.visible) return;
    for (const [key, bar] of this.bars) {
      bar.style.width = `${Math.round((f[key] as number) * 100)}%`;
    }
    this.beatDot.style.opacity = String(0.2 + 0.8 * f.beat);
  }
}
