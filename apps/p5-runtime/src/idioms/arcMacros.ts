/**
 * arcMacros — arc encoders as continuous macro controls with a press action.
 * Generalizes the Lichtspiel arc mapping (`monomeMapping.ts` ARC_AXES) +
 * `monomeFeedback.ts` perfArcLevel + the assorted per-sketch arc handlers in
 * windchime (pasArcgridv7, monomeArc4Shapesv12, itoBoxV9, …), unifying their
 * ring LED looks into the named policies in `ledPolicies.ts`.
 *
 * Each LOGICAL encoder turns a normalized value (absolute = clamp 0..1, relative
 * = wrap e.g. a rotation phase, velocity = roulette physics) and can fire a press
 * action. A sketch declares the logical encoders it was designed for (often 4).
 * On hardware with FEWER physical encoders the controls **fold** (mirroring the
 * faderBank grid-fold), so a 4-encoder sketch stays fully controllable on an Arc 2:
 *
 *   • `fold: 'couple'` (default) — physical encoder `p` drives logical encoders
 *     {p, p+P, p+2P, …} (P = physical count) TOGETHER on TURN (all get the same
 *     delta), so e.g. enc0 scales objects 0 + 2 and enc1 scales 1 + 3 — no object
 *     is left unreachable. The PRESS then either `coupledPress: 'cycle'` (default —
 *     each press cycles through the covered logical actions, e.g. regenerate obj0
 *     then obj2) or `coupledPress: 'all'` (every covered action fires, e.g. stop
 *     both). The ring shows the primary logical (`p`).
 *   • `fold: 'page'` — for sketches whose encoders are DISTINCT axes that shouldn't
 *     be paired (itoBox yaw/pitch/roll/zoom). The P physical encoders map to one
 *     PAGE of logical at a time; a CHORD (press one encoder while another is held)
 *     flips to the next page. Single presses fire ON PRESS (reliable even when the
 *     Arc 2's best-effort push drops a release event) — so on a chord the first
 *     press fires its action and the second is the flip. All logical reachable
 *     across pages; turn + press + ring follow the current page.
 *
 * On an Arc 4 (P ≥ logical count) the mapping is 1:1 (original intact). Pure
 * control/LED — owns no grid, draws nothing.
 *
 * VELOCITY mode (windchime itoBoxV9 "roulette" + monomeArcgridcombo spin): a delta
 * is an IMPULSE into a damped angular velocity, not a direct value set. The host
 * integrates it each frame via `tick(dtMs)` — phase advances by the velocity and the
 * velocity decays by `damping` (1 = a free-spinning wheel that never stops until a
 * press resets it; <1 = a roulette wheel spinning down). The phase still drives the
 * ring (any policy), and `velocityTrail` renders the itoBox comet whose tail grows
 * with |velocity|. `integrate: 'clamp'` bounds the phase instead of wrapping (zoom).
 */

import { type ArcDeltaEvent, type ArcKeyEvent, type GesturalEntry, type LedFrame, clamp01 } from '@lichtspiel/schemas';
import type { Idiom, IdiomControlMap, IdiomProfile } from './types.js';
import { EMPTY_PROFILE } from './types.js';
import { type ArcLedPolicy, arcRingLevel, circDist, phaseHead } from './ledPolicies.js';

export interface ArcEncoderSpec {
  name: string;
  /** Human-readable description of what this logical encoder's TURN does (gestural panel). */
  label?: string;
  /** Human-readable description of what this logical encoder's PRESS does (gestural panel). */
  pressLabel?: string;
  /**
   * 'absolute' clamps 0..1; 'relative' wraps 0..1 (a rotation phase); 'velocity'
   * treats a delta as an impulse into a damped angular velocity the host integrates
   * via `tick()`. Default absolute.
   */
  mode?: 'absolute' | 'relative' | 'velocity';
  /** ring LED policy (default 'comet'). */
  led?: ArcLedPolicy;
  /** ring LEDs per full 0..1 sweep (default = ring size, 64 → matches delta/64). */
  sensitivity?: number;
  /** initial value 0..1 (default 0.5 absolute / 0 relative + velocity). */
  initial?: number;
  /** press action — fired on a real per-encoder click or a keyboard fallback. */
  onPress?: () => void;
  // ── velocity-mode tuning (ignored otherwise) ──────────────────────
  /** delta → angular-velocity gain (phase-turns per frame per delta unit). Default 0.004. */
  impulse?: number;
  /** per-60fps-frame velocity decay 0..1 (default 1 = never decays; <1 = spins down). */
  damping?: number;
  /** integrate the phase by 'wrap' (rotation, default) or 'clamp' (bounded, e.g. zoom). */
  integrate?: 'wrap' | 'clamp';
  /** ring shows a |velocity|-proportional comet (the itoBox roulette look). Default false. */
  velocityTrail?: boolean;
}

export interface ArcMacrosOptions {
  encoders: ArcEncoderSpec[];
  /**
   * How logical encoders fold onto fewer physical ones (see the module doc).
   * 'couple' (default): physical `p` drives logical {p, p+P, …} together on turn.
   * 'page': physical encoders map to one page of logical at a time; a chord flips.
   */
  fold?: 'couple' | 'page';
  /**
   * In 'couple' fold, a press either cycles through the covered logical actions
   * ('cycle', default — preserves variety like a per-object regenerate) or fires
   * every covered action at once ('all' — e.g. stop both coupled objects).
   */
  coupledPress?: 'cycle' | 'all';
}

export type ArcValues = Record<string, number>;

export interface ArcMacros extends Idiom<ArcValues> {
  /** Set an encoder's value (phase) programmatically (e.g. seed from params at mount). */
  set(name: string, value01: number): void;
  /** Fire a logical encoder's press action from a keyboard fallback (always allowed). */
  press(index: number): void;
  /** Integrate velocity-mode encoders by `dtMs` (phase advances, velocity decays). No-op for others. */
  tick(dtMs: number): void;
  /** A velocity-mode encoder's current signed angular velocity (phase-turns per 60fps frame). */
  velocity(name: string): number;
  /** Set a velocity-mode encoder's angular velocity (e.g. press → 0 to stop a spin). */
  setVelocity(name: string, vel: number): void;
  /** The live arc control map for the connected profile (couple/page-aware). */
  describe(profile: IdiomProfile): IdiomControlMap;
}

interface EncState {
  spec: ArcEncoderSpec;
  mode: 'absolute' | 'relative' | 'velocity';
  led: ArcLedPolicy;
  value: number;
  vel: number; // velocity mode only — phase-turns per 60fps frame
}

const HELD_BOOST = 10; // perfArcLevel press flash
const FRAME_MS = 1000 / 60; // velocity integration is normalized to 60fps frames
const DEFAULT_IMPULSE = 0.004; // delta → phase-turns/frame (a few detents ≈ a slow spin)
const VEL_TRAIL_GAIN = 6; // |vel| × ringLeds × this = velocity-comet tail length (LEDs)
const MAX_VEL_TRAIL = 18;

/** itoBox roulette ring — bright head at the phase + a tail that grows with |velocity|. */
function renderVelocityComet(
  ring: number[],
  phase: number,
  vel: number,
  ringLeds: number,
  held: boolean,
): void {
  const head = phaseHead(phase, ringLeds);
  const trail = 2 + Math.floor(Math.min(MAX_VEL_TRAIL, Math.abs(vel) * ringLeds * VEL_TRAIL_GAIN));
  for (let i = 0; i < ringLeds; i++) {
    const d = circDist(i, head, ringLeds);
    let lv = d === 0 ? 15 : d <= trail ? Math.max(1, 15 - d * 2) : 0;
    if (held) lv = Math.max(lv, HELD_BOOST);
    ring[i] = lv;
  }
}

export function createArcMacros(opts: ArcMacrosOptions): ArcMacros {
  let profile: IdiomProfile = EMPTY_PROFILE;
  const fold = opts.fold ?? 'couple';
  const coupledPress = opts.coupledPress ?? 'cycle';
  const encs: EncState[] = opts.encoders.map((spec) => {
    const mode = spec.mode ?? 'absolute';
    return {
      spec,
      mode,
      led: spec.led ?? 'comet',
      value: clamp01(spec.initial ?? (mode === 'absolute' ? 0.5 : 0)),
      vel: 0,
    };
  });
  const heldPhysical: boolean[] = []; // per physical encoder (for the LED boost)
  const pressCursor: number[] = []; // per physical encoder (cycles its covered presses)
  let page = 0; // 'page' fold — the active page of logical encoders

  const fire = (i: number): void => {
    encs[i]?.spec.onPress?.();
  };

  /** Physical encoder count: the device's, or the spec count when unknown (1:1). */
  const physicalCount = (): number => (profile.encoders > 0 ? profile.encoders : encs.length);

  /** Number of pages (only > 1 in 'page' fold on a device with fewer encoders). */
  const pagesTotal = (): number => Math.max(1, Math.ceil(encs.length / physicalCount()));

  /**
   * The logical encoders physical `p` currently drives (turn). 'couple' → the whole
   * column {p, p+P, …}; 'page' → just this page's single logical. Empty if out of range.
   */
  const coveredLogical = (p: number): number[] => {
    const P = physicalCount();
    if (p < 0 || p >= P) return p >= 0 && p < encs.length ? [p] : []; // stale profile → 1:1
    if (fold === 'page') {
      const l = (page % pagesTotal()) * P + p;
      return l < encs.length ? [l] : [];
    }
    const out: number[] = [];
    for (let l = p; l < encs.length; l += P) out.push(l);
    return out;
  };

  /** Of `coveredLogical(p)`, those with a press action (for couple-cycle / page press). */
  const coveredPressTargets = (p: number): number[] =>
    coveredLogical(p).filter((l) => encs[l]?.spec.onPress);

  /** The logical encoder whose value/LED a physical ring shows (the primary). */
  const primaryLogical = (p: number): number => coveredLogical(p)[0] ?? p;

  return {
    name: 'arcMacros',

    onArcDelta(e: ArcDeltaEvent): void {
      // Trust the hardware: an event for physical encoder N means N exists. Turn
      // FOLDS — the delta drives every logical encoder this physical one covers, so
      // a 4-encoder sketch stays fully controllable on an Arc 2 (no object stranded).
      if (e.encoder < 0) return;
      // Turning clears the held flag — self-heals a stale "held" left by a dropped
      // release event, so a later lone press isn't misread as a page-flip chord.
      heldPhysical[e.encoder] = false;
      for (const li of coveredLogical(e.encoder)) {
        const enc = encs[li];
        if (!enc) continue;
        if (enc.mode === 'velocity') {
          // A delta is an impulse into the angular velocity (the host integrates in tick()).
          enc.vel += e.delta * (enc.spec.impulse ?? DEFAULT_IMPULSE);
          continue;
        }
        const sens = enc.spec.sensitivity ?? profile.arcRingLeds;
        const next = enc.value + e.delta / Math.max(1, sens);
        enc.value = enc.mode === 'relative' ? next - Math.floor(next) : clamp01(next);
      }
    },

    onArcKey(e: ArcKeyEvent): void {
      if (e.encoder < 0) return;

      // Release — just clear the held flag. Single presses fire on PRESS (below), so
      // a flaky Arc 2 that drops a release never loses an action (the reliability fix).
      if (e.state !== 1) {
        heldPhysical[e.encoder] = false;
        return;
      }

      // Press. Suppress non-enc0 presses only when the device is KNOWN to lack
      // per-encoder push. On a stale/empty profile (or Arc 2/4, which have it), trust it.
      if (profile.encoders > 0 && !profile.pushPerEncoder && e.encoder !== 0) return;
      const otherHeld = heldPhysical.some((h, i) => h && i !== e.encoder);
      heldPhysical[e.encoder] = true;

      if (fold === 'page') {
        // A CHORD (this press while another encoder is held) flips the page. The other
        // encoder's single already fired on its own press; this press is the flip.
        if (pagesTotal() > 1 && otherHeld) {
          page = (page + 1) % pagesTotal();
          return;
        }
        for (const li of coveredPressTargets(e.encoder)) fire(li); // lone press → fire now
        return;
      }

      // 'couple' fold — fire the covered press action(s).
      const targets = coveredPressTargets(e.encoder);
      if (targets.length === 0) return;
      if (coupledPress === 'all') {
        for (const li of targets) fire(li);
        return;
      }
      const cur = (pressCursor[e.encoder] ?? 0) % targets.length;
      pressCursor[e.encoder] = cur + 1;
      const logical = targets[cur];
      if (logical !== undefined) fire(logical);
    },

    press(index: number): void {
      fire(index); // keyboard fallback — always allowed, targets the logical encoder
    },

    tick(dtMs: number): void {
      const frames = dtMs / FRAME_MS;
      if (!(frames > 0)) return;
      for (const enc of encs) {
        if (enc.mode !== 'velocity') continue;
        const next = enc.value + enc.vel * frames;
        enc.value =
          enc.spec.integrate === 'clamp' ? clamp01(next) : next - Math.floor(next); // wrap 0..1
        const damp = enc.spec.damping ?? 1;
        if (damp !== 1) enc.vel *= Math.pow(damp, frames);
      }
    },

    velocity(name: string): number {
      return encs.find((x) => x.spec.name === name)?.vel ?? 0;
    },

    setVelocity(name: string, vel: number): void {
      const enc = encs.find((x) => x.spec.name === name);
      if (enc) enc.vel = vel;
    },

    describe(p: IdiomProfile): IdiomControlMap {
      const P = Math.max(1, p.encoders > 0 ? p.encoders : encs.length);
      const turnLabel = (li: number): string => encs[li]?.spec.label ?? encs[li]?.spec.name ?? `enc ${li}`;
      const pressLabel = (li: number): string | undefined => encs[li]?.spec.pressLabel;
      const arc: GesturalEntry[] = [];

      if (fold === 'page' && pagesTotal() > 1) {
        const pages = pagesTotal();
        const cur = page % pages;
        const onPage: string[] = [];
        for (let ph = 0; ph < P; ph++) {
          const li = cur * P + ph;
          if (li < encs.length) onPage.push(`enc ${ph} = ${turnLabel(li)}`);
        }
        arc.push({ area: `enc 0–${P - 1}`, action: 'turn', effect: onPage.join(' · ') });
        arc.push({ area: 'both encoders', action: 'press together', effect: 'switch to the next page of encoder controls' });
        for (let ph = 0; ph < P; ph++) {
          const li = cur * P + ph;
          const pl = pressLabel(li);
          if (pl) arc.push({ area: `enc ${ph}`, action: 'press', effect: pl });
        }
        return { grid: [], arc, page: { index: cur, total: pages } };
      }

      for (let ph = 0; ph < P; ph++) {
        const covered = coveredLogical(ph);
        if (covered.length === 0) continue;
        const coupled = covered.length > 1;
        arc.push({
          area: `enc ${ph}`,
          action: 'turn',
          effect: covered.map(turnLabel).join(' + ') + (coupled ? ' · coupled' : ''),
        });
        const pressTargets = covered.filter((l) => encs[l]?.spec.onPress);
        if (pressTargets.length) {
          const labels = pressTargets.map((l) => pressLabel(l) ?? 'action');
          const eff =
            pressTargets.length > 1
              ? coupledPress === 'all'
                ? `${labels.join(' + ')} · both`
                : `${labels.join(' / ')} · cycles`
              : labels[0];
          arc.push({ area: `enc ${ph}`, action: 'press', effect: eff ?? 'action' });
        }
      }
      return { grid: [], arc, page: { index: 0, total: 1 } };
    },

    renderArc(frame: LedFrame, p: IdiomProfile): void {
      const ringLeds = p.arcRingLeds;
      // One ring per PHYSICAL encoder, showing the primary logical it drives (the
      // current page in 'page' fold; the coupled-column head in 'couple' fold).
      const nRings = Math.min(frame.arc.length, p.encoders > 0 ? p.encoders : encs.length);
      for (let ph = 0; ph < nRings; ph++) {
        const enc = encs[primaryLogical(ph)];
        const ring = frame.arc[ph];
        if (!enc || !ring) continue;
        if (enc.mode === 'velocity' && enc.spec.velocityTrail) {
          renderVelocityComet(ring, enc.value, enc.vel, ringLeds, heldPhysical[ph] ?? false);
        } else {
          for (let i = 0; i < ringLeds; i++) {
            let lv = arcRingLevel(enc.led, i, enc.value, ringLeds);
            if (heldPhysical[ph]) lv = Math.max(lv, HELD_BOOST);
            ring[i] = lv;
          }
        }
        frame.arcDirty[ph] = true;
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
      const clampPhase = enc.mode === 'absolute' || (enc.mode === 'velocity' && enc.spec.integrate === 'clamp');
      enc.value = clampPhase ? clamp01(value01) : value01 - Math.floor(value01);
    },

    setProfile(p: IdiomProfile): void {
      profile = p;
    },

    reset(): void {
      for (const enc of encs) {
        enc.value = clamp01(enc.spec.initial ?? (enc.mode === 'absolute' ? 0.5 : 0));
        enc.vel = 0;
      }
      heldPhysical.length = 0;
      pressCursor.length = 0;
      page = 0;
    },
  };
}
