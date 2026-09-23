import { describe, it, expect } from 'vitest';
import { traceEventId, rootId, PayloadTable, TraceRecorder, RunUpdateGuard, type TraceAppendInput } from './trace';
import type { RunUpdate, TraceEvent } from './types';

function input(overrides: Partial<TraceAppendInput> = {}): TraceAppendInput {
  return {
    rootId: 'root-1',
    journeyId: 'journey-1',
    parentId: null,
    elementId: 'element-1',
    portId: null,
    kind: 'dispatch',
    code: 'test-code',
    payload: null,
    atMs: null,
    outcome: null,
    ...overrides,
  };
}

describe('traceEventId / rootId', () => {
  it('is a stable, deterministic derivation from its inputs', () => {
    expect(traceEventId('run-1', 0)).toBe(traceEventId('run-1', 0));
    expect(traceEventId('run-1', 0)).not.toBe(traceEventId('run-1', 1));
    expect(traceEventId('run-1', 5)).not.toBe(traceEventId('run-2', 5));
  });

  it('rootId is deterministic and distinguishable from traceEventId', () => {
    expect(rootId('input-1', 0)).toBe(rootId('input-1', 0));
    expect(rootId('input-1', 0)).not.toBe(rootId('input-1', 1));
    expect(rootId('input-1', 0)).not.toBe(traceEventId('input-1', 0));
  });
});

describe('PayloadTable', () => {
  it('dedupes payloads that differ only in key order', async () => {
    const table = new PayloadTable();
    const refA = await table.put({ a: 1, b: 2 });
    const refB = await table.put({ b: 2, a: 1 });

    expect(refA).toBe(refB);
    expect(table.snapshot()[refA]).toEqual({ a: 1, b: 2 });
  });

  it('produces different refs for different payloads', async () => {
    const table = new PayloadTable();
    const refA = await table.put({ a: 1 });
    const refB = await table.put({ a: 2 });
    expect(refA).not.toBe(refB);
  });

  it('get() returns the stored value by ref', async () => {
    const table = new PayloadTable();
    const ref = await table.put({ x: 'y' });
    expect(table.get(ref)).toEqual({ x: 'y' });
    expect(table.get('sha256:doesnotexist')).toBeUndefined();
  });

  it('stores an independent, deep-frozen copy: mutating the original after put() does not change get(ref)', async () => {
    const table = new PayloadTable();
    const original: { nested: { value: number } } = { nested: { value: 1 } };
    const ref = await table.put(original);

    original.nested.value = 999;

    expect(table.get(ref)).toEqual({ nested: { value: 1 } });
    expect(Object.isFrozen(table.get(ref))).toBe(true);
    expect(Object.isFrozen((table.get(ref) as { nested: unknown }).nested)).toBe(true);
  });
});

describe('TraceRecorder: budgets', () => {
  it('stops at the row cap first when bytes are plentiful', async () => {
    const recorder = new TraceRecorder('run-1', { maxTraceRows: 2, maxTraceBytes: 1_000_000 });

    const first = await recorder.append(input());
    expect(first.ok).toBe(true);
    const second = await recorder.append(input());
    expect(second.ok).toBe(true);
    const third = await recorder.append(input());

    expect(third).toEqual({ ok: false, reason: 'trace-rows' });
    expect(recorder.status).toEqual({ stopped: true, reason: 'trace-rows', limit: 2, used: 2 });
  });

  it('stops at the byte cap first when rows are plentiful (small budget)', async () => {
    const recorder = new TraceRecorder('run-1', { maxTraceRows: 1_000_000, maxTraceBytes: 10 });

    const first = await recorder.append(input());
    // A single event's canonical JSON is already well over 10 bytes, so this must stop
    // immediately on the very first append.
    expect(first).toEqual({ ok: false, reason: 'trace-bytes' });
    expect(recorder.status).toMatchObject({ stopped: true, reason: 'trace-bytes', limit: 10 });
  });

  it('rejects every append after a stop, never silently dropping', async () => {
    const recorder = new TraceRecorder('run-1', { maxTraceRows: 1, maxTraceBytes: 1_000_000 });

    const first = await recorder.append(input());
    expect(first.ok).toBe(true);

    const second = await recorder.append(input());
    expect(second).toEqual({ ok: false, reason: 'trace-rows' });

    const third = await recorder.append(input());
    expect(third).toEqual({ ok: false, reason: 'trace-rows' });

    // Only the one successful append was ever recorded.
    expect(recorder.events.length).toBe(1);
  });

  it('does not leave an orphan payload in the table when the byte cap rejects the append', async () => {
    const recorder = new TraceRecorder('run-1', { maxTraceRows: 1_000_000, maxTraceBytes: 1 });
    const payload = { big: 'x'.repeat(100) };

    const result = await recorder.append(input({ payload }));
    expect(result).toEqual({ ok: false, reason: 'trace-bytes' });

    // Compute the ref independently (same derivation as PayloadTable.put) and confirm
    // the rejected payload never actually entered the recorder's table.
    const probe = new PayloadTable();
    const ref = await probe.put(payload);
    expect(recorder.payloadTable.has(ref)).toBe(false);
  });

  it("rejects an event that fails canonical-json-v1 validation as 'invalid-event', storing nothing", async () => {
    const recorder = new TraceRecorder('run-1', { maxTraceRows: 10, maxTraceBytes: 1_000_000 });

    const result = await recorder.append(input({ atMs: Number.POSITIVE_INFINITY }));

    expect(result).toEqual({ ok: false, reason: 'invalid-event' });
    expect(recorder.events.length).toBe(0);
    // An invalid event is a per-call rejection, not a budget stop.
    expect(recorder.status).toEqual({ stopped: false });
  });

  it('assigns monotonic sequences starting at 0', async () => {
    const recorder = new TraceRecorder('run-1', { maxTraceRows: 10, maxTraceBytes: 1_000_000 });
    const a = await recorder.append(input());
    const b = await recorder.append(input());
    const c = await recorder.append(input());
    expect(a.ok && a.event.sequence).toBe(0);
    expect(b.ok && b.event.sequence).toBe(1);
    expect(c.ok && c.event.sequence).toBe(2);
  });
});

describe('TraceRecorder: batches', () => {
  it('emits batch RunUpdates with contiguous firstSequence values', async () => {
    const recorder = new TraceRecorder('run-1', { maxTraceRows: 10, maxTraceBytes: 1_000_000 });

    await recorder.append(input());
    await recorder.append(input());
    const batch1 = recorder.drainBatch();
    expect(batch1.kind).toBe('batch');
    expect(batch1.firstSequence).toBe(0);
    expect(batch1.events.map((e: TraceEvent) => e.sequence)).toEqual([0, 1]);

    await recorder.append(input());
    const batch2 = recorder.drainBatch();
    expect(batch2.firstSequence).toBe(2);
    expect(batch2.events.map((e: TraceEvent) => e.sequence)).toEqual([2]);

    const batch3 = recorder.drainBatch();
    expect(batch3.events).toEqual([]);
    expect(batch3.firstSequence).toBe(3);
  });
});

describe('RunUpdateGuard', () => {
  const runId = 'run-1';

  function state(s: 'created' | 'validating' | 'running' | 'paused'): RunUpdate {
    return { kind: 'state', runId, state: s };
  }

  function batch(firstSequence: number, sequences: number[]): RunUpdate {
    return {
      kind: 'batch',
      runId,
      firstSequence,
      events: sequences.map((sequence) => ({
        id: traceEventId(runId, sequence),
        sequence,
        rootId: 'r',
        journeyId: 'j',
        parentId: null,
        elementId: 'e',
        portId: null,
        kind: 'dispatch',
        code: 'c',
        payloadRef: null,
        atMs: null,
        outcome: null,
      })),
      metrics: null,
    };
  }

  function terminal(status: 'completed' | 'invalid' | 'failed' | 'cancelled' | 'incomplete'): RunUpdate {
    return {
      kind: 'terminal',
      runId,
      status,
      checks: [],
      summary: {
        mode: 'logical',
        consumedInputs: 0,
        rootCounts: { generated: 0, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
        messageCounts: { generated: 0, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
        elementMetrics: [],
        finalStates: [],
        outputs: [],
        coverage: { includedElementIds: [], excludedElementIds: [] },
        processedEvents: 0,
        elapsedMs: null,
        rowOutcomes: [],
      },
      reason: null,
    };
  }

  it('accepts a valid stream: state, batches, terminal', () => {
    const guard = new RunUpdateGuard(runId);
    expect(guard.check(state('created')).kind).toBe('accepted');
    expect(guard.check(state('running')).kind).toBe('accepted');
    expect(guard.check(batch(0, [0, 1, 2])).kind).toBe('accepted');
    expect(guard.check(batch(3, [3, 4])).kind).toBe('accepted');
    expect(guard.check(terminal('completed')).kind).toBe('accepted');
  });

  it('rejects a second terminal message', () => {
    const guard = new RunUpdateGuard(runId);
    expect(guard.check(terminal('completed')).kind).toBe('accepted');
    const outcome = guard.check(terminal('completed'));
    expect(outcome.kind).toBe('violation');
  });

  it('rejects any update after the terminal message', () => {
    const guard = new RunUpdateGuard(runId);
    guard.check(terminal('completed'));
    expect(guard.check(state('running')).kind).toBe('violation');
    expect(guard.check(batch(0, [0])).kind).toBe('violation');
  });

  it('rejects a sequence gap across batches', () => {
    const guard = new RunUpdateGuard(runId);
    guard.check(batch(0, [0, 1]));
    const outcome = guard.check(batch(3, [3, 4]));
    expect(outcome.kind).toBe('violation');
  });

  it('rejects a terminal status inside a state update', () => {
    const guard = new RunUpdateGuard(runId);
    const bad: RunUpdate = { kind: 'state', runId, state: 'completed' as any };
    const outcome = guard.check(bad);
    expect(outcome.kind).toBe('violation');
  });

  it('flags updates for another runId as stale and ignores them', () => {
    const guard = new RunUpdateGuard(runId);
    const stale: RunUpdate = { kind: 'state', runId: 'other-run', state: 'running' };
    const outcome = guard.check(stale);
    expect(outcome).toEqual({ kind: 'stale', runId: 'other-run' });

    // The guard's own sequence/terminal tracking is unaffected by the stale update.
    expect(guard.check(batch(0, [0])).kind).toBe('accepted');
  });
});
