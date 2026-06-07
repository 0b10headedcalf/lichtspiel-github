/**
 * Injectable clock. Every time-sensitive component takes a `Clock` by
 * constructor so tests are deterministic (no wall-clock, no flaky timers).
 *
 * - `SystemClock` wraps real time + global timers (used by `index.ts` / demo).
 * - `MockClock` is manually advanced via `advance(ms)`, firing due timers in
 *   chronological order (used by every test).
 */

export type Cancel = () => void;

export interface Clock {
  /** Current time in epoch milliseconds (virtual for MockClock). */
  now(): number;
  setTimeout(fn: () => void, ms: number): Cancel;
  setInterval(fn: () => void, ms: number): Cancel;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
  setTimeout(fn: () => void, ms: number): Cancel {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  }
  setInterval(fn: () => void, ms: number): Cancel {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
}

interface MockTimer {
  id: number;
  at: number;
  fn: () => void;
  every?: number;
  cancelled: boolean;
}

export class MockClock implements Clock {
  private t: number;
  private nextId = 1;
  private timers: MockTimer[] = [];

  constructor(startMs = 0) {
    this.t = startMs;
  }

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): Cancel {
    const timer: MockTimer = { id: this.nextId++, at: this.t + Math.max(0, ms), fn, cancelled: false };
    this.timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  }

  setInterval(fn: () => void, ms: number): Cancel {
    const period = Math.max(1, ms);
    const timer: MockTimer = { id: this.nextId++, at: this.t + period, fn, every: period, cancelled: false };
    this.timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  }

  /**
   * Advance virtual time by `ms`, firing every due timer in chronological order.
   * Timers scheduled by a fired callback are honored within the same advance if
   * they fall at/before the window end. An iteration cap guards runaway loops.
   */
  advance(ms: number): void {
    const end = this.t + ms;
    const GUARD_MAX = 1_000_000;
    let guard = 0;
    while (guard++ < GUARD_MAX) {
      this.timers = this.timers.filter((x) => !x.cancelled);
      let next: MockTimer | undefined;
      for (const x of this.timers) {
        if (x.at <= end && (next === undefined || x.at < next.at)) next = x;
      }
      if (next === undefined) break;
      this.t = next.at;
      if (next.every !== undefined) {
        next.at += next.every;
      } else {
        const idx = this.timers.indexOf(next);
        if (idx >= 0) this.timers.splice(idx, 1);
      }
      next.fn();
    }
    this.t = end;
  }
}
