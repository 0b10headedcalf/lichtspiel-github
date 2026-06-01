/**
 * arcMacros — arc encoders as continuous macro controls with a press action.
 * Generalizes the Lichtspiel arc mapping (`monomeMapping.ts` ARC_AXES) +
 * `monomeFeedback.ts` perfArcLevel + the assorted per-sketch arc handlers in
 * windchime (pasArcgridv7, monomeArc4Shapesv12, itoBoxV9, …), unifying their
 * ring LED looks into the named policies in `ledPolicies.ts`.
 *
 * Each encoder turns a normalized value (absolute = clamp 0..1, relative =
 * wrap, e.g. a rotation phase) and can fire a press action. Presses are gated on
 * capability: with `pushPerEncoder` every encoder's click is real; otherwise only
 * encoder 0's (the shared button) is trusted and the rest rely on the keyboard
 * fallback (`press(i)`), so a critical action is never stranded on an arc that
 * can't report per-encoder clicks. Adapts 2 ↔ 4 encoders (extra specs lie
 * dormant on an Arc 2). Pure control/LED — owns no grid, draws nothing.
 */

import { type ArcDeltaEvent, type ArcKeyEvent, type LedFrame, clamp01 } from '@lichtspiel/schemas';
import type { Idiom, IdiomProfile } from './types.js';
import { EMPTY_PROFILE } from './types.js';
import { type ArcLedPolicy, arcRingLevel } from './ledPolicies.js';

export interface ArcEncoderSpec {
  name: string;
  /** 'absolute' clamps 0..1; 'relative' wraps 0..1 (a rotation phase). Default absolute. */
  mode?: 'absolute' | 'relative';
  /** ring LED policy (default 'comet'). */
  led?: ArcLedPolicy;
  /** ring LEDs per full 0..1 sweep (default = ring size, 64 → matches delta/64). */
  sensitivity?: number;
  /** initial value 0..1 (default 0.5 absolute / 0 relative). */
  initial?: number;
  /** press action — fired on a real per-encoder click or a keyboard fallback. */
  onPress?: () => void;
}

export interface ArcMacrosOptions {
  encoders: ArcEncoderSpec[];
}

export type ArcValues = Record<string, number>;

export interface ArcMacros extends Idiom<ArcValues> {
  /** Set an encoder's value programmatically (e.g. seed from params at mount). */
  set(name: string, value01: number): void;
  /** Fire an encoder's press action from a keyboard fallback (always allowed). */
  press(index: number): void;
}

interface EncState {
  spec: ArcEncoderSpec;
  mode: 'absolute' | 'relative';
  led: ArcLedPolicy;
  value: number;
  held: boolean;
}

const HELD_BOOST = 10; // perfArcLevel press flash

export function createArcMacros(opts: ArcMacrosOptions): ArcMacros {
  let profile: IdiomProfile = EMPTY_PROFILE;
  const encs: EncState[] = opts.encoders.map((spec) => {
    const mode = spec.mode ?? 'absolute';
    return {
      spec,
      mode,
      led: spec.led ?? 'comet',
      value: clamp01(spec.initial ?? (mode === 'relative' ? 0 : 0.5)),
      held: false,
    };
  });

  const fire = (i: number): void => {
    encs[i]?.spec.onPress?.();
  };

  return {
    name: 'arcMacros',

    onArcDelta(e: ArcDeltaEvent): void {
      // Trust the hardware: an event for encoder N means N exists. Bound only to
      // the configured specs — a stale/empty profile (an arc reconnect blip, or
      // the instant after a variant re-mount) must NOT silently drop input.
      if (e.encoder < 0 || e.encoder >= encs.length) return;
      const enc = encs[e.encoder];
      if (!enc) return;
      const sens = enc.spec.sensitivity ?? profile.arcRingLeds;
      const next = enc.value + e.delta / Math.max(1, sens);
      enc.value = enc.mode === 'relative' ? next - Math.floor(next) : clamp01(next);
    },

    onArcKey(e: ArcKeyEvent): void {
      if (e.encoder < 0 || e.encoder >= encs.length) return;
      const enc = encs[e.encoder];
      if (!enc) return;
      if (e.state !== 1) {
        enc.held = false;
        return;
      }
      // Only suppress non-enc0 presses when we KNOW the device has a single
      // shared button (no per-encoder push). On a stale/empty profile, trust the
      // event — both the Arc 2 and Arc 4 report per-encoder /enc/key.
      if (profile.encoders > 0 && !profile.pushPerEncoder && e.encoder !== 0) return;
      enc.held = true;
      fire(e.encoder);
    },

    press(index: number): void {
      fire(index); // keyboard fallback — always allowed
    },

    renderArc(frame: LedFrame, p: IdiomProfile): void {
      const ringLeds = p.arcRingLeds;
      const n = Math.min(encs.length, p.encoders);
      for (let e = 0; e < n; e++) {
        const enc = encs[e];
        const ring = frame.arc[e];
        if (!enc || !ring) continue;
        for (let i = 0; i < ringLeds; i++) {
          let lv = arcRingLevel(enc.led, i, enc.value, ringLeds);
          if (enc.held) lv = Math.max(lv, HELD_BOOST);
          ring[i] = lv;
        }
        frame.arcDirty[e] = true;
      }
    },

    renderGrid(): void {
      /* arcMacros owns no grid */
    },

    values(): ArcValues {
      const out: ArcValues = {};
      for (const enc of encs) out[enc.spec.name] = enc.value;
      return out;
    },

    set(name: string, value01: number): void {
      const enc = encs.find((x) => x.spec.name === name);
      if (!enc) return;
      enc.value = enc.mode === 'relative' ? value01 - Math.floor(value01) : clamp01(value01);
    },

    setProfile(p: IdiomProfile): void {
      profile = p;
    },

    reset(): void {
      for (const enc of encs) {
        enc.value = clamp01(enc.spec.initial ?? (enc.mode === 'relative' ? 0 : 0.5));
        enc.held = false;
      }
    },
  };
}
