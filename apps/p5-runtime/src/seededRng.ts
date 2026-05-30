/**
 * Mulberry32 — small, fast, deterministic PRNG. Templates route their
 * randomness through this (never Math.random or p5.random) so a given seed
 * reproduces the same visual — needed for variant saving + regression.
 *
 * Adapted from the Windchime animation `seeded.ts` utility.
 */

export interface SeededRng {
  /** float in [0, 1). */
  random(): number;
  /** float in [0, max) with one arg, [a, b) with two. */
  range(a: number, b?: number): number;
  /** int in [0, n). */
  int(n: number): number;
  /** uniform pick from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** the seed this RNG was created with. */
  readonly seed: number;
}

export function createRng(seed: number): SeededRng {
  let s = seed | 0 || 1;
  const next = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed,
    random: next,
    range: (a, b) => (b === undefined ? next() * a : a + next() * (b - a)),
    int: (n) => Math.floor(next() * n),
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('cannot pick from empty array');
      return items[Math.floor(next() * items.length)] as T;
    },
  };
}

/** A fresh random-ish seed for ad-hoc mounts (not for reproducible runs). */
export function randomSeed(): number {
  return (Math.random() * 1e9) | 0;
}
