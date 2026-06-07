import { describe, it, expect } from 'vitest';
import {
  isLichtspielWireMessage,
  lichtspielWire,
  PROTOCOL_VERSION,
} from '../schemas/lichtspiel.js';
import { makeMessage, parseMessage, safeParseMessage, SeqCounter } from '../schemas/wire.js';
import { MockClock } from '../core/clock.js';
import { defaultSemanticState } from '../schemas/semantic.js';

describe('Lichtspiel wire guard (must match the real bridge exactly)', () => {
  it('accepts a minimal valid wire message', () => {
    expect(isLichtspielWireMessage({ v: 1, ts: 1, type: 'params.update', payload: {} })).toBe(true);
  });
  it('rejects wrong protocol version', () => {
    expect(isLichtspielWireMessage({ v: 2, ts: 1, type: 'x', payload: {} })).toBe(false);
  });
  it('rejects missing ts', () => {
    expect(isLichtspielWireMessage({ v: 1, type: 'x', payload: {} })).toBe(false);
  });
  it('rejects non-string type', () => {
    expect(isLichtspielWireMessage({ v: 1, ts: 1, type: 5, payload: {} })).toBe(false);
  });
  it('rejects non-objects', () => {
    expect(isLichtspielWireMessage(null)).toBe(false);
    expect(isLichtspielWireMessage('hi')).toBe(false);
  });
  it('lichtspielWire stamps v + ts + type + payload', () => {
    const m = lichtspielWire('hello', { protocolVersion: PROTOCOL_VERSION, role: 'bridge' }, 123);
    expect(m).toEqual({ v: 1, ts: 123, type: 'hello', payload: { protocolVersion: 1, role: 'bridge' } });
  });
});

describe('Bridge rich envelope (Zod)', () => {
  const clock = new MockClock(1000);
  const seq = new SeqCounter();
  const base = { sessionId: 's', sourceInstanceId: 'i', clock, seq, cause: { causeId: 'c1' } };

  it('makeMessage produces a parseable semantic.state', () => {
    const m = makeMessage({ ...base, type: 'semantic.state', source: 'core', payload: defaultSemanticState() });
    expect(() => parseMessage(m)).not.toThrow();
    expect(m.schemaVersion).toBe(1);
    expect(m.source).toBe('core');
    expect(m.causeId).toBe('c1');
    expect(m.timestamp).toBe(1000);
  });

  it('per-source seq is monotonic and independent', () => {
    const s = new SeqCounter();
    expect(s.next('core')).toBe(0);
    expect(s.next('core')).toBe(1);
    expect(s.next('mrt2')).toBe(0);
  });

  it('accepts a well-formed magenta.metrics', () => {
    const m = makeMessage({
      ...base,
      type: 'magenta.metrics',
      source: 'mrt2',
      payload: {
        transformerMs: 8,
        totalMs: 12,
        bufferAvailable: 1000,
        bufferCapacity: 2048,
        bufferOccupancy: 0.5,
        droppedFrames: 0,
        underruns: 0,
        rtf: 0.3,
        transportFlags: 0,
        connected: true,
      },
    });
    expect(parseMessage(m).type).toBe('magenta.metrics');
  });

  it('rejects missing seq', () => {
    const bad = {
      type: 'system.health',
      schemaVersion: 1,
      timestamp: 1,
      source: 'core',
      sourceInstanceId: 'i',
      sessionId: 's',
      causeId: 'c',
      payload: { ok: true, degraded: false, adapters: {} },
    };
    expect(safeParseMessage(bad).success).toBe(false);
  });

  it('rejects wrong schemaVersion', () => {
    const m = makeMessage({
      ...base,
      type: 'system.health',
      source: 'core',
      payload: { ok: true, degraded: false, adapters: {} },
    });
    expect(safeParseMessage({ ...m, schemaVersion: 2 }).success).toBe(false);
  });

  it('rejects an unknown type', () => {
    expect(
      safeParseMessage({
        type: 'nope',
        schemaVersion: 1,
        seq: 0,
        timestamp: 1,
        source: 'core',
        sourceInstanceId: 'i',
        sessionId: 's',
        causeId: 'c',
        payload: {},
      }).success,
    ).toBe(false);
  });

  it('rejects a payload that fails its per-type schema', () => {
    const bad = {
      type: 'magenta.metrics',
      schemaVersion: 1,
      seq: 0,
      timestamp: 1,
      source: 'mrt2',
      sourceInstanceId: 'i',
      sessionId: 's',
      causeId: 'c',
      payload: { entropy: 5 }, // entropy out of [0,1] + missing required fields
    };
    expect(safeParseMessage(bad).success).toBe(false);
  });
});
