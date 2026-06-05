/**
 * Headless smoke for the takeover clock (Phase 5b refinements, Part 2). Pure: inject
 * a virtual `now`, advance it, and assert the gesture cadence — ~1 encoder sweep per
 * beat, a downbeat press every bar, the isPlaying gate, the manual-BPM fallback, and
 * profile adaptation. No p5, no DOM, no bridge. Run via tsx; wired into `pnpm smoke:p5`.
 */

import { type MonomeEvent, type MonomeSetup, ARC_2, GRID_64 } from '@lichtspiel/schemas';
import { TakeoverClock } from '../src/live/takeoverClock.js';

let failures = 0;
let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

const g64a2: MonomeSetup = { grid: GRID_64, arc: ARC_2 };
const gridOnly: MonomeSetup = { grid: GRID_64 };
const arcOnly: MonomeSetup = { arc: ARC_2 };

/** Advance the clock from 0..toMs in stepMs increments, collecting all events. */
function run(clock: TakeoverClock, toMs: number, stepMs = 25): MonomeEvent[] {
  const all: MonomeEvent[] = [];
  for (let t = 0; t <= toMs; t += stepMs) all.push(...clock.tick(t));
  return all;
}
const count = (evs: MonomeEvent[], type: MonomeEvent['type']): number =>
  evs.filter((e) => e.type === type).length;

console.log('takeover clock — standalone (120 BPM = 500 ms/beat):');
{
  const clock = new TakeoverClock({ manualBpm: 120 });
  clock.setProfile(g64a2);
  clock.setEnabled(true);
  // 0..2100 ms → beats 0,1,2,3 (beat 4 lands at 2500). One downbeat (beat 0).
  const evs = run(clock, 2100);
  ok(count(evs, 'arc.delta') === 4, 'one encoder sweep per beat (4 beats in ~2 s)');
  ok(count(evs, 'arc.key') === 2, 'downbeat fires an arc press (tap = press+release)');
  ok(count(evs, 'grid.key') === 2, 'downbeat fires a grid press (tap = press+release)');
}

console.log('direction flips per bar:');
{
  const clock = new TakeoverClock({ manualBpm: 120, arcStep: 6 });
  clock.setProfile(g64a2);
  clock.setEnabled(true);
  const deltas = run(clock, 4100)
    .filter((e): e is Extract<MonomeEvent, { type: 'arc.delta' }> => e.type === 'arc.delta')
    .map((e) => e.delta);
  ok(deltas.some((d) => d > 0) && deltas.some((d) => d < 0), 'sweeps go up one bar, down the next');
}

console.log('isPlaying gate (live transport):');
{
  const clock = new TakeoverClock();
  clock.setProfile(g64a2);
  clock.setEnabled(true);
  clock.setTransport({ tempo: 120, isPlaying: false, beat: 0 });
  ok(run(clock, 3000).length === 0, 'transport stopped → no gestures');
  clock.setTransport({ tempo: 120, isPlaying: true, beat: 0 });
  // fresh time window after resume
  const evs: MonomeEvent[] = [];
  for (let t = 4000; t <= 6100; t += 25) evs.push(...clock.tick(t));
  ok(evs.length > 0, 'transport playing → gestures resume');
}

console.log('disabled / fallback:');
{
  const clock = new TakeoverClock({ manualBpm: 120 });
  clock.setProfile(g64a2);
  ok(run(clock, 3000).length === 0, 'disabled → no gestures');
  ok(clock.bpm() === 120 && !clock.hasTransport(), 'no transport → manual BPM fallback');
  clock.setManualBpm(100);
  ok(clock.bpm() === 100, 'setManualBpm updates the standalone tempo');
  clock.setTransport({ tempo: 140, isPlaying: true, beat: 0 });
  ok(clock.bpm() === 140 && clock.hasTransport(), 'live transport overrides the manual tempo');
}

console.log('profile adaptation:');
{
  const noArc = new TakeoverClock({ manualBpm: 120 });
  noArc.setProfile(gridOnly);
  noArc.setEnabled(true);
  const e1 = run(noArc, 2100);
  ok(count(e1, 'arc.delta') === 0 && count(e1, 'arc.key') === 0, 'no arc → no arc events');
  ok(count(e1, 'grid.key') > 0, 'grid-only still taps the grid on the downbeat');

  const noGrid = new TakeoverClock({ manualBpm: 120 });
  noGrid.setProfile(arcOnly);
  noGrid.setEnabled(true);
  const e2 = run(noGrid, 2100);
  ok(count(e2, 'grid.key') === 0, 'no grid → no grid events');
  ok(count(e2, 'arc.delta') > 0, 'arc-only still sweeps encoders');
}

console.log('phase re-anchor to Live bars:');
{
  const clock = new TakeoverClock();
  clock.setProfile(g64a2);
  clock.setEnabled(true);
  // Anchor at beat 7.5 → the very next beat crossing is beat 8 (a downbeat).
  clock.setTransport({ tempo: 120, isPlaying: true, beat: 7.5 });
  clock.tick(0); // anchor wall-clock
  const evs: MonomeEvent[] = [];
  for (let t = 25; t <= 300; t += 25) evs.push(...clock.tick(t)); // ~250 ms past half a beat
  ok(count(evs, 'arc.key') >= 2, 're-anchored beat 8 lands a downbeat press');
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} takeover check(s) failed`);
  process.exit(1);
}
