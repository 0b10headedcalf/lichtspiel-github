/**
 * arcMacros — arc encoders as continuous macro controls with a press action.
 * Generalizes the Lichtspiel arc mapping (`monomeMapping.ts` ARC_AXES) +
 * `monomeFeedback.ts` perfArcLevel + the assorted per-sketch arc handlers in
 * windchime (pasArcgridv7, monomeArc4Shapesv12, itoBoxV9, …), unifying their
 * ring LED looks into the named policies in `ledPolicies.ts`.
 *
 * Each LOGICAL encoder turns a normalized value (absolute = clamp 0..1, relative
 * = wrap, e.g. a rotation phase) and can fire a press action. A sketch declares
 * the logical encoders it was designed for (often 4). On hardware with FEWER
 * physical encoders, the presses **fold**: physical encoder `p` covers logical
 * encoders {p, p+P, p+2P, …} (P = physical count) and each press cycles through
 * the covered ones that have an action — so a 4-encoder sketch keeps all four
 * press-actions reachable on an Arc 2 (each encoder cycles through its pair).
 * Turn + LED stay 1:1 with the physical encoder's primary logical. On an Arc 4
 * the mapping is 1:1 (original intact). Pure control/LED — owns no grid, draws nothing.
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
  /** Fire a logical encoder's press action from a keyboard fallback (always allowed). */
  press(index: number): void;
}

interface EncState {
  spec: ArcEncoderSpec;
  mode: 'absolute' | 'relative';
  led: ArcLedPolicy;
  value: number;
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
    };
  });
  const heldPhysical: boolean[] = []; // per physical encoder (for the LED boost)
  const pressCursor: number[] = []; // per physical encoder (cycles its covered presses)

  const fire = (i: number): void => {
    encs[i]?.spec.onPress?.();
  };

  /** Physical encoder count: the device's, or the spec count when unknown (1:1). */
  const physicalCount = (): number => (profile.encoders > 0 ? profile.encoders : encs.length);

  /** Logical encoders physical `p` covers that have a press action (for cycling). */
  const coveredPressTargets = (p: number): number[] => {
    const P = physicalCount();
    const out: number[] = [];
    for (let l = p; l < encs.length; l += P) if (encs[l]?.spec.onPress) out.push(l);
    return out;
  };

  return {
    name: 'arcMacros',

    onArcDelta(e: ArcDeltaEvent): void {
      // Trust the hardware: an event for encoder N means N exists. Bound only to
      // the configured specs — a stale/empty profile must NOT drop input.
      if (e.encoder < 0 || e.encoder >= encs.length) return;
      const enc = encs[e.encoder];
      if (!enc) return;
      const sens = enc.spec.sensitivity ?? profile.arcRingLeds;
      const next = enc.value + e.delta / Math.max(1, sens);
      enc.value = enc.mode === 'relative' ? next - Math.floor(next) : clamp01(next);
    },

    onArcKey(e: ArcKeyEvent): void {
      if (e.encoder < 0 || e.encoder >= encs.length) return;
      if (e.state !== 1) {
        heldPhysical[e.encoder] = false;
        return;
      }
      // Only suppress non-enc0 presses when the device is KNOWN to have a single
      // shared button (no per-encoder push). On a stale/empty profile, trust it.
      if (profile.encoders > 0 && !profile.pushPerEncoder && e.encoder !== 0) return;
      heldPhysical[e.encoder] = true;
      // Fold: cycle through the logical presses this physical encoder covers, so
      // a 4-encoder sketch keeps all its actions reachable on an Arc 2.
      const targets = coveredPressTargets(e.encoder);
      if (targets.length === 0) return;
      const cur = (pressCursor[e.encoder] ?? 0) % targets.length;
      pressCursor[e.encoder] = cur + 1;
      const logical = targets[cur];
      if (logical !== undefined) fire(logical);
    },

    press(index: number): void {
      fire(index); // keyboard fallback — always allowed, targets the logical encoder
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
          if (heldPhysical[e]) lv = Math.max(lv, HELD_BOOST);
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
      }
      heldPhysical.length = 0;
      pressCursor.length = 0;
    },
  };
}
