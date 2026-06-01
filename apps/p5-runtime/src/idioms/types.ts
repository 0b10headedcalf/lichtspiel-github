/**
 * The monome idiom layer — the "underlying representation" of Lichtspiel's
 * controller vocabulary. An idiom is a small, capability-aware, executable unit
 * that maps grid/arc events → semantic values AND renders caps-aware LED
 * feedback, adapting to whatever device is connected. It is a pure control/LED
 * layer: NO p5 drawing, NO knowledge of the visual it drives.
 *
 * This generalizes what was previously copy-pasted per sketch (windchime's
 * per-family gestural dictionaries) and what Lichtspiel hard-coded in
 * `monomeMapping.ts` (the grid column-fader) + `monomeFeedback.ts` (the LED
 * policies). A sketch composes a few idioms (e.g. faderBank + arcMacros), folds
 * their `values()` into its VisualParamVector, and lets them own LED feedback.
 *
 * Because every idiom takes an `IdiomProfile` and reshapes on `setProfile`, the
 * same sketch adapts across a Grid 64/Arc 2 and a Grid 128/Arc 4 with no
 * re-wiring — the foundation the corpus (Part 3) is built on.
 */

import {
  type ArcDeltaEvent,
  type ArcKeyEvent,
  type GridKeyEvent,
  type LedFrame,
  type MonomeSetup,
  ARC_RING_LEDS,
} from '@lichtspiel/schemas';

/**
 * The capability summary an idiom needs to lay out events + LEDs. Derived from
 * the active `MonomeSetup` via `profileFromSetup`. An absent device reads as
 * zero rows/cols/encoders, so an idiom whose device isn't connected simply
 * produces no events and an empty frame.
 */
export interface IdiomProfile {
  /** Grid rows (0 if no grid). */
  rows: number;
  /** Grid cols (0 if no grid). */
  cols: number;
  /** Arc encoders (0 if no arc). */
  encoders: number;
  /** LEDs per arc ring (64). */
  arcRingLeds: number;
  /** Hardware shows per-key 0..15 (else monobright; levels are logical). */
  gridVaribright: boolean;
  /** Has one shared /grid/led/intensity dimmer. */
  globalIntensity: boolean;
  /** Each encoder has its own /enc/key (else treat only enc0's press as real). */
  pushPerEncoder: boolean;
}

/**
 * A capability-aware control/LED idiom.
 *
 * @typeParam V - the shape of the semantic values this idiom exposes (a sketch
 *   folds these into its VisualParamVector). Defaults to `unknown` so a list of
 *   heterogeneous idioms can be held together (see `composeIdioms`).
 */
export interface Idiom<V = unknown> {
  /** Optional human label for the gestural dictionary / debug. */
  readonly name?: string;
  onGridKey?(e: GridKeyEvent): void;
  onArcDelta?(e: ArcDeltaEvent): void;
  onArcKey?(e: ArcKeyEvent): void;
  /** Write this idiom's grid LED feedback into `frame.grid` (sized to profile). */
  renderGrid(frame: LedFrame, profile: IdiomProfile): void;
  /** Write this idiom's arc LED feedback into `frame.arc` (sized to profile). */
  renderArc(frame: LedFrame, profile: IdiomProfile): void;
  /**
   * Desired global grid intensity 0..15 (the monobright dimmer), or undefined
   * to leave it untouched. Only meaningful when `profile.globalIntensity`.
   */
  gridIntensity?(): number | undefined;
  /** The idiom's current semantic values. */
  values(): V;
  /** Reshape internal state to a new device profile (hot-swap, no re-mount). */
  setProfile(profile: IdiomProfile): void;
  /** Reset to initial state (optional). */
  reset?(): void;
}

/** Derive an IdiomProfile from the active monome setup. */
export function profileFromSetup(setup: MonomeSetup): IdiomProfile {
  const g = setup.grid;
  const a = setup.arc;
  return {
    rows: g?.rows ?? 0,
    cols: g?.cols ?? 0,
    encoders: a?.encoders ?? 0,
    arcRingLeds: a?.ringLeds ?? ARC_RING_LEDS,
    gridVaribright: g?.caps.varibright ?? false,
    globalIntensity: g?.caps.globalIntensity ?? false,
    pushPerEncoder: a?.caps.pushPerEncoder ?? false,
  };
}

/** An empty profile (nothing connected) — handy as a default before first attach. */
export const EMPTY_PROFILE: IdiomProfile = Object.freeze({
  rows: 0,
  cols: 0,
  encoders: 0,
  arcRingLeds: ARC_RING_LEDS,
  gridVaribright: false,
  globalIntensity: false,
  pushPerEncoder: false,
});
