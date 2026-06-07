import { describe, it, expect, beforeEach } from 'vitest';
import { SafetyController } from '../core/safetyController.js';
import { LineageTracker } from '../core/lineageTracker.js';
import { MockClock } from '../core/clock.js';
import { SAFETY_DEFAULTS, type SafetyConfig } from '../config.js';
import { makeMessage, SeqCounter, type CauseRef, type MessageFor } from '../schemas/wire.js';
import { defaultSemanticState } from '../schemas/semantic.js';

const cfg: SafetyConfig = { ...SAFETY_DEFAULTS };
let clock: MockClock;
let lineage: LineageTracker;
let seq: SeqCounter;
let safety: SafetyController;

beforeEach(() => {
  clock = new MockClock(10_000);
  lineage = new LineageTracker(clock);
  seq = new SeqCounter();
  safety = new SafetyController(cfg, clock, lineage);
});

const vec = (val: number): number[] => new Array(16).fill(val);

function promptMsg(applyAt: 'immediate' | 'next_bar', cause: CauseRef = { causeId: 'x' }): MessageFor<'magenta.prompt.update'> {
  return makeMessage({
    type: 'magenta.prompt.update',
    source: 'core',
    sessionId: 's',
    sourceInstanceId: 'i',
    clock,
    seq,
    cause,
    payload: { promptBlend: [{ text: 'a', weight: 1 }], applyAt },
  });
}
function visualMsg(v: number[], cause: CauseRef = { causeId: 'v' }): MessageFor<'lichtspiel.visual.update'> {
  return makeMessage({
    type: 'lichtspiel.visual.update',
    source: 'core',
    sessionId: 's',
    sourceInstanceId: 'i',
    clock,
    seq,
    cause,
    payload: { visualCluster: 'x', sceneLock: false, manualOverride: false, transitionMs: 1200, visualParamVector: v },
  });
}
function paramMsg(cause: CauseRef = { causeId: 'p' }): MessageFor<'magenta.params.update'> {
  return makeMessage({
    type: 'magenta.params.update',
    source: 'core',
    sessionId: 's',
    sourceInstanceId: 'i',
    clock,
    seq,
    cause,
    payload: { temperature: 1.2 },
  });
}
function semMsg(cause: CauseRef = { causeId: 'sem' }): MessageFor<'semantic.state'> {
  return makeMessage({
    type: 'semantic.state',
    source: 'core',
    sessionId: 's',
    sourceInstanceId: 'i',
    clock,
    seq,
    cause,
    payload: defaultSemanticState(),
  });
}

describe('defaults', () => {
  it('SAFETY_DEFAULTS equals the spec exactly', () => {
    expect(SAFETY_DEFAULTS).toEqual({
      maxPromptUpdatesPerSecond: 4,
      maxParamUpdatesPerSecond: 10,
      deadband: 0.03,
      smoothingMs: 250,
      staleMessageMs: 2000,
      maxVisualToAudioModDepth: 0.15,
      quantizePromptChanges: 'next_bar',
    });
  });
});

describe('stale rejection (first stage)', () => {
  it('drops a message older than staleMessageMs', () => {
    const m = promptMsg('immediate');
    clock.advance(2_500);
    expect(safety.admit(m)).toMatchObject({ action: 'drop', reason: 'stale' });
  });
  it('accepts a fresh message', () => {
    const m = promptMsg('immediate');
    clock.advance(500);
    expect(safety.admit(m).action).toBe('emit');
  });
});

describe('rate limiting', () => {
  it('blocks excessive prompt updates (4/s) and recovers after the window', () => {
    const actions: string[] = [];
    for (let i = 0; i < 6; i++) actions.push(safety.admit(promptMsg('immediate')).action);
    expect(actions.filter((a) => a === 'emit')).toHaveLength(4);
    expect(actions[4]).toBe('drop');
    clock.advance(1_001);
    expect(safety.admit(promptMsg('immediate')).action).toBe('emit');
  });
});

describe('deadband', () => {
  it('ignores tiny visual changes (< deadband)', () => {
    expect(safety.admit(visualMsg(vec(0.5))).action).toBe('emit');
    clock.advance(300);
    const tiny = vec(0.5);
    tiny[0] = 0.51; // delta 0.01 < 0.03
    expect(safety.admit(visualMsg(tiny))).toMatchObject({ action: 'drop', reason: 'deadband' });
  });
  it('passes changes >= deadband', () => {
    expect(safety.admit(visualMsg(vec(0.5))).action).toBe('emit');
    clock.advance(300);
    const big = vec(0.5);
    big[0] = 0.6; // delta 0.1
    expect(safety.admit(visualMsg(big)).action).toBe('emit');
  });
});

describe('smoothing', () => {
  it('moves gradually toward the target, not instantly', () => {
    expect(safety.admit(visualMsg(vec(0))).action).toBe('emit');
    clock.advance(50); // alpha = 50/250 = 0.2
    const d = safety.admit(visualMsg(vec(1)));
    expect(d.action).toBe('emit');
    const out = (d.message as MessageFor<'lichtspiel.visual.update'>).payload.visualParamVector[0]!;
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(1);
    expect(out).toBeCloseTo(0.2, 1);
  });
});

describe('mod-depth clamp', () => {
  it('clamps visual->audio modulation to +/- maxVisualToAudioModDepth', () => {
    expect(safety.clampModulation(0.5)).toBeCloseTo(0.15, 6);
    expect(safety.clampModulation(-0.5)).toBeCloseTo(-0.15, 6);
    expect(safety.clampModulation(0.1)).toBeCloseTo(0.1, 6);
  });
});

describe('scene lock', () => {
  it('blocks visual->audio modulation when locked, allows when unlocked', () => {
    safety.setSceneLock(true);
    expect(safety.admit(paramMsg())).toMatchObject({ action: 'drop', reason: 'scene-lock' });
    safety.setSceneLock(false);
    expect(safety.admit(paramMsg()).action).toBe('emit');
  });
});

describe('manual override', () => {
  it('pauses automatic semantic updates and resumes', () => {
    safety.setManualOverride(true);
    expect(safety.admit(semMsg())).toMatchObject({ action: 'drop', reason: 'override' });
    safety.setManualOverride(false);
    expect(safety.admit(semMsg()).action).toBe('emit');
  });
});

describe('quantization to next bar', () => {
  it('defers a next_bar prompt mid-bar and releases it on the downbeat', () => {
    safety.setTransport({ bar: 2, beat: 1.5 });
    const d = safety.admit(promptMsg('next_bar'));
    expect(d.action).toBe('defer');
    expect(d.deferUntilBar).toBe(3);
    expect(safety.tickQuantizer({ bar: 2, beat: 3 })).toHaveLength(0);
    const released = safety.tickQuantizer({ bar: 3, beat: 0 });
    expect(released).toHaveLength(1);
    expect(released[0]!.type).toBe('magenta.prompt.update');
  });
  it('emits an immediate prompt without deferring', () => {
    safety.setTransport({ bar: 2, beat: 1.5 });
    expect(safety.admit(promptMsg('immediate')).action).toBe('emit');
  });
});

describe('causal loop prevention', () => {
  it('blocks an audio prompt derived from an MRT2 metrics lineage', () => {
    const root = lineage.newRoot('mrt2');
    const sem = lineage.derive(root, 'core');
    const promptCause = lineage.derive(sem, 'core');
    expect(safety.admit(promptMsg('immediate', promptCause))).toMatchObject({ action: 'drop', reason: 'loop' });
  });
  it('allows an audio prompt derived from a scene lineage', () => {
    const root = lineage.newRoot('ableton');
    const sem = lineage.derive(root, 'core');
    const promptCause = lineage.derive(sem, 'core');
    expect(safety.admit(promptMsg('immediate', promptCause)).action).toBe('emit');
  });
});

describe('emergency bypass', () => {
  it('returns the deterministic fallback state', () => {
    expect(safety.emergencyBypass()).toEqual(defaultSemanticState());
  });
});
