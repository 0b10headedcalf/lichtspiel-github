/**
 * Headless smoke for the monome idiom library (Part 2). The idioms are a pure
 * control/LED layer — no p5, no DOM, no hardware — so unlike the visual
 * templates (covered by the structural smoke.mjs) they CAN be exercised in
 * plain Node: instantiate each idiom under a Grid 64/Arc 2 AND a Grid 128/Arc 4
 * profile, fire synthetic events, and assert that `values()` change and that
 * `renderGrid`/`renderArc` produce correctly-sized, lit frames for both.
 *
 * This is the first proof that the "underlying representation" adapts across
 * hardware. Run via tsx (the repo's TS-in-Node runner): wired into `pnpm smoke`.
 */

import {
  type ArcDeltaEvent,
  type ArcKeyEvent,
  type GridKeyEvent,
  type LedFrame,
  type MonomeSetup,
  ARC_2,
  ARC_4,
  GRID_64,
  GRID_128,
  createLedFrame,
} from '@lichtspiel/schemas';
import {
  type IdiomProfile,
  composeIdioms,
  createArcMacros,
  createCellPaint,
  createFaderBank,
  createStepSequencer,
  profileFromSetup,
} from '../src/idioms/index.js';

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

// ── synthetic event builders ──────────────────────────────────────
const gk = (x: number, y: number, state: 0 | 1): GridKeyEvent => ({
  type: 'grid.key',
  deviceId: 'smoke',
  x,
  y,
  state,
});
const ad = (encoder: number, delta: number): ArcDeltaEvent => ({
  type: 'arc.delta',
  deviceId: 'smoke',
  encoder,
  delta,
});
const ak = (encoder: number, state: 0 | 1): ArcKeyEvent => ({
  type: 'arc.key',
  deviceId: 'smoke',
  encoder,
  state,
});

// ── frame inspectors ──────────────────────────────────────────────
function gridSum(f: LedFrame, rows: number, cols: number): number {
  let s = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) s += f.grid[y]?.[x] ?? 0;
  return s;
}
/** Sum of any LED written outside the active rows×cols (must be 0 — the idiom adapts). */
function gridOutsideSum(f: LedFrame, rows: number, cols: number): number {
  let s = 0;
  for (let y = 0; y < f.grid.length; y++) {
    const row = f.grid[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) if (y >= rows || x >= cols) s += row[x] ?? 0;
  }
  return s;
}
function ringSum(f: LedFrame, e: number): number {
  return (f.arc[e] ?? []).reduce((a, b) => a + b, 0);
}

// ── per-profile idiom checks ──────────────────────────────────────
function checkProfile(tag: string, setup: MonomeSetup): void {
  const profile = profileFromSetup(setup);
  console.log(`\n[${tag}]  ${profile.rows}×${profile.cols} grid · ${profile.encoders} encoders`);

  // faderBank — continuous press sets the lane to the row value; LED adapts width.
  {
    const fb = createFaderBank({
      lanes: Array.from({ length: 8 }, (_, i) => ({ name: `f${i}` })),
    });
    fb.setProfile(profile);
    const before = fb.values().f0;
    fb.onGridKey(gk(0, 0, 1)); // top of lane 0 → value 1
    fb.onGridKey(gk(0, 0, 0));
    ok(fb.values().f0 === 1 && before !== 1, `faderBank press(top) → f0 = 1 (was ${before})`);
    const f = createLedFrame();
    fb.renderGrid(f, profile);
    ok(gridSum(f, profile.rows, profile.cols) > 0, 'faderBank renders a lit grid');
    ok(
      gridOutsideSum(f, profile.rows, profile.cols) === 0,
      `faderBank writes nothing outside ${profile.rows}×${profile.cols}`,
    );
  }

  // faderBank — toggle mode advances discrete steps (single-lane = whole width).
  {
    const tog = createFaderBank({ lanes: [{ name: 't', mode: 'toggle', steps: 4, initial: 0 }] });
    tog.setProfile(profile);
    tog.onGridKey(gk(0, 0, 1));
    tog.onGridKey(gk(0, 0, 0));
    ok(Math.abs(tog.values().t - 1 / 3) < 1e-9, 'faderBank toggle step 1 of 4 → 1/3');
  }

  // faderBank — spread:false confines the bank to lanes.length columns, leaving
  // the rest dark + input-free (e.g. a Grid 128's scene-select region).
  {
    const bank = createFaderBank({ spread: false, lanes: [{ name: 'a' }, { name: 'b' }] });
    bank.setProfile(profile);
    const f = createLedFrame();
    bank.renderGrid(f, profile);
    let beyond = 0;
    for (let y = 0; y < profile.rows; y++) for (let x = 2; x < profile.cols; x++) beyond += f.grid[y]?.[x] ?? 0;
    ok(beyond === 0, `faderBank spread:false leaves cols ≥ lanes dark (${profile.cols - 2} cols)`);
  }

  // faderBank — folds when lanes > cols: column x drives lanes {x, x+cols, …},
  // so a 16-lane sketch still reaches every lane on a Grid 64 (in pairs).
  {
    const wide = createFaderBank({
      spread: false,
      lanes: Array.from({ length: profile.cols * 2 }, (_, i) => ({ name: `w${i}`, initial: 0 })),
    });
    wide.setProfile(profile);
    wide.onGridKey(gk(0, 0, 1)); // press col 0, top row → value 1
    wide.onGridKey(gk(0, 0, 0));
    const v = wide.values();
    ok(
      v.w0 === 1 && v[`w${profile.cols}`] === 1,
      `faderBank folds col 0 → lanes 0 + ${profile.cols} (both reach 1)`,
    );
  }

  // stepSequencer — steps == cols (16 on Grid 128, 8 on Grid 64); toggle + advance.
  {
    const seq = createStepSequencer();
    seq.setProfile(profile);
    ok(seq.values().steps === profile.cols, `stepSeq steps == cols (${profile.cols})`);
    seq.onGridKey(gk(2, 0, 1));
    ok(seq.values().matrix[0]?.[2] === true, 'stepSeq toggles step (lane 0, step 2)');
    const ph0 = seq.values().playhead;
    seq.advance();
    ok(seq.values().playhead !== ph0, 'stepSeq advance moves the playhead');
    const f = createLedFrame();
    seq.renderGrid(f, profile);
    ok(gridSum(f, profile.rows, profile.cols) > 0, 'stepSeq renders a lit grid');
    ok(gridOutsideSum(f, profile.rows, profile.cols) === 0, 'stepSeq writes nothing out of bounds');
  }

  // cellPaint — a press raises the cell + the mean; LED mirrors it.
  {
    const cp = createCellPaint();
    cp.setProfile(profile);
    const mean0 = cp.values().mean;
    cp.onGridKey(gk(1, 1, 1));
    ok((cp.values().cells[1]?.[1] ?? 0) > 0, 'cellPaint press raises the cell');
    ok(cp.values().mean > mean0, 'cellPaint press raises the mean');
    const f = createLedFrame();
    cp.renderGrid(f, profile);
    ok((f.grid[1]?.[1] ?? 0) > 0, 'cellPaint renders the painted cell');
    ok(gridOutsideSum(f, profile.rows, profile.cols) === 0, 'cellPaint writes nothing out of bounds');
  }

  // arcMacros — turn raises value; rings past the encoder count stay dark.
  {
    let pressed = 0;
    const arc = createArcMacros({
      encoders: [
        { name: 'x', led: 'comet' },
        { name: 'y', led: 'fill', onPress: () => pressed++ },
        { name: 'z', led: 'gauge' },
        { name: 'w', led: 'playhead' },
      ],
    });
    arc.setProfile(profile);
    const x0 = arc.values().x;
    arc.onArcDelta(ad(0, 16));
    ok(arc.values().x > x0, 'arcMacros enc0 turn raises value');
    arc.onArcKey(ak(1, 1)); // ARC_2/ARC_4 both report per-encoder push → fires
    arc.onArcKey(ak(1, 0));
    ok(pressed === 1, 'arcMacros enc1 press fires (pushPerEncoder)');
    const f = createLedFrame();
    arc.renderArc(f, profile);
    ok(ringSum(f, 0) > 0, 'arcMacros lights ring 0');
    let darkBeyond = true;
    for (let e = profile.encoders; e < 4; e++) if (ringSum(f, e) !== 0) darkBeyond = false;
    ok(darkBeyond, `arcMacros leaves rings ≥ ${profile.encoders} dark`);
  }

  // composeIdioms — fans events, composites grid + arc, merges values().
  {
    const comp = composeIdioms([
      createFaderBank({ lanes: [{ name: 'fa' }] }),
      createArcMacros({ encoders: [{ name: 'ax', led: 'comet' }] }),
    ]);
    comp.setProfile(profile);
    comp.onGridKey(gk(0, 0, 1));
    comp.onArcDelta(ad(0, 8));
    const f = createLedFrame();
    comp.renderGrid(f, profile);
    comp.renderArc(f, profile);
    ok(gridSum(f, profile.rows, profile.cols) > 0, 'composite renders the grid idiom');
    ok(ringSum(f, 0) > 0, 'composite renders the arc idiom');
    const v = comp.values();
    ok('fa' in v && 'ax' in v, 'composite merges values() (fa + ax)');
  }

  // composeIdioms — Math.max on overlap: the brighter idiom wins the cell.
  {
    const lo = createCellPaint();
    const hi = createCellPaint();
    lo.setProfile(profile);
    hi.setProfile(profile);
    lo.onGridKey(gk(0, 0, 1)); // 1 press → level 1
    for (let k = 0; k < 8; k++) hi.onGridKey(gk(0, 0, 1)); // 8 presses → level 8
    const ov = composeIdioms([lo, hi]);
    ov.setProfile(profile);
    const f = createLedFrame();
    ov.renderGrid(f, profile);
    ok(f.grid[0]?.[0] === 8, `composite overlap takes the brighter cell (got ${f.grid[0]?.[0]})`);
  }
}

// ── profile-independent checks ────────────────────────────────────
function checkPushGating(): void {
  console.log('\n[push gating]');
  let e0 = 0;
  let e1 = 0;
  const arc = createArcMacros({
    encoders: [
      { name: 'a', onPress: () => e0++ },
      { name: 'b', onPress: () => e1++ },
    ],
  });
  // An arc that does NOT report per-encoder push: only enc0 (shared button) is real.
  const noPush: IdiomProfile = { ...profileFromSetup({ grid: null, arc: ARC_4 }), pushPerEncoder: false };
  arc.setProfile(noPush);
  arc.onArcKey(ak(0, 1));
  arc.onArcKey(ak(1, 1));
  ok(e0 === 1 && e1 === 0, 'only enc0 press fires when !pushPerEncoder');
  arc.press(1); // keyboard fallback is always allowed
  ok(e1 === 1, 'keyboard fallback fires the gated enc1');
}

// arcMacros press FOLDING — a 4-logical-encoder sketch on fewer physical encoders
// cycles each physical encoder through the logical presses it covers.
function checkArcFolding(): void {
  console.log('\n[arc press folding]');
  const mk = (sink: number[]) =>
    createArcMacros({ encoders: [0, 1, 2, 3].map((i) => ({ name: `e${i}`, onPress: () => sink.push(i) })) });

  const f0: number[] = [];
  const a = mk(f0);
  a.setProfile(profileFromSetup({ grid: null, arc: ARC_2 })); // 2 physical encoders
  for (let k = 0; k < 3; k++) {
    a.onArcKey(ak(0, 1));
    a.onArcKey(ak(0, 0));
  }
  ok(f0.join(',') === '0,2,0', `Arc 2: enc0 press cycles logical 0→2→0 (got ${f0.join(',')})`);

  const f1: number[] = [];
  const b = mk(f1);
  b.setProfile(profileFromSetup({ grid: null, arc: ARC_2 }));
  for (let k = 0; k < 2; k++) {
    b.onArcKey(ak(1, 1));
    b.onArcKey(ak(1, 0));
  }
  ok(f1.join(',') === '1,3', `Arc 2: enc1 press cycles logical 1→3 (got ${f1.join(',')})`);

  const f4: number[] = [];
  const c = mk(f4);
  c.setProfile(profileFromSetup({ grid: null, arc: ARC_4 })); // 4 physical → 1:1, no folding
  c.onArcKey(ak(0, 1));
  c.onArcKey(ak(0, 0));
  c.onArcKey(ak(0, 1));
  ok(f4.join(',') === '0,0', `Arc 4: enc0 stays 1:1 — always logical 0 (got ${f4.join(',')})`);
}

// ── run ───────────────────────────────────────────────────────────
console.log('idioms-smoke — capability-aware monome idiom library');
checkProfile('grid64/arc2', { grid: GRID_64, arc: ARC_2 });
checkProfile('grid128/arc4', { grid: GRID_128, arc: ARC_4 });
checkPushGating();
checkArcFolding();

if (failures > 0) {
  console.error(`\n${failures}/${checks} idiom check(s) failed`);
  process.exit(1);
}
console.log(`\nidioms-smoke OK — ${checks} checks across 2 hardware profiles`);
