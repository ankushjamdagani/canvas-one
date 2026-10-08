import { describe, it, expect } from 'vitest';
import { evaluateAssertion, evaluateAssertions } from './assertions';
import type { Assertion } from '../model';
import type { RunSummary, TraceEvent } from './types';
import { emptyCycleSummary } from './cycles';

describe('assertions: evaluateAssertion', () => {
  const dummySummary: RunSummary = {
    mode: 'logical',
    cycles: emptyCycleSummary(),
    consumedInputs: 2,
    rootCounts: {
      generated: 2,
      succeeded: 1,
      rejected: 1,
      failed: 0,
      expired: 0,
      inFlight: 0,
    },
    messageCounts: {
      generated: 0,
      succeeded: 0,
      rejected: 0,
      failed: 0,
      expired: 0,
      inFlight: 0,
    },
    elementMetrics: [],
    finalStates: [
      {
        elementId: 'el-1',
        stateId: 'state-succ',
        context: { active: null, items: [{ sku: 'A', quantity: 1 }] },
      },
    ],
    outputs: [
      {
        port: { elementId: 'el-1', portId: 'port-out' },
        values: [{ reqId: 'r1' }, { reqId: 'r2' }],
      },
    ],
    coverage: {
      includedElementIds: ['el-1'],
      excludedElementIds: [],
    },
    processedEvents: 10,
    elapsedMs: null,
    rowOutcomes: [],
  };

  const dummyEvents: TraceEvent[] = [
    {
      id: 'run:0',
      sequence: 0,
      rootId: 'root#0',
      journeyId: 'j1',
      parentId: null,
      elementId: 'el-1',
      portId: 'port-in',
      kind: 'state',
      code: 'order-command',
      payloadRef: null,
      atMs: null,
      outcome: null,
    },
    {
      id: 'run:1',
      sequence: 1,
      rootId: 'root#0',
      journeyId: 'j1',
      parentId: null,
      elementId: 'el-1',
      portId: 'port-in',
      kind: 'state',
      code: 'order-command',
      payloadRef: null,
      atMs: null,
      outcome: null,
    },
  ];

  it('evaluates final-state subject with equals operator', () => {
    const a1: Assertion = {
      id: 'a1',
      label: 'check final state',
      subject: { kind: 'final-state', elementId: 'el-1' },
      operator: 'equals',
      expected: 'state-succ',
    };
    expect(evaluateAssertion(a1, dummySummary, dummyEvents)).toEqual({
      assertionId: 'a1',
      status: 'passed',
      actual: 'state-succ',
      reason: null,
    });

    const a2: Assertion = {
      id: 'a2',
      label: 'check wrong final state',
      subject: { kind: 'final-state', elementId: 'el-1' },
      operator: 'equals',
      expected: 'state-fail',
    };
    const res2 = evaluateAssertion(a2, dummySummary, dummyEvents);
    expect(res2.status).toBe('failed');
  });

  it('evaluates context subject and handles missing paths', () => {
    const a1: Assertion = {
      id: 'a1',
      label: 'check context active is null',
      subject: { kind: 'context', elementId: 'el-1', path: ['active'] },
      operator: 'equals',
      expected: null,
    };
    expect(evaluateAssertion(a1, dummySummary, dummyEvents)).toEqual({
      assertionId: 'a1',
      status: 'passed',
      actual: null,
      reason: null,
    });

    const aMissing: Assertion = {
      id: 'a-missing',
      label: 'check missing path',
      subject: { kind: 'context', elementId: 'el-1', path: ['doesNotExist'] },
      operator: 'equals',
      expected: 'anything',
    };
    expect(evaluateAssertion(aMissing, dummySummary, dummyEvents).status).toBe('error');
  });

  it('evaluates output subject indexed by path', () => {
    const a1: Assertion = {
      id: 'a1',
      label: 'check first output',
      subject: {
        kind: 'output',
        port: { elementId: 'el-1', portId: 'port-out' },
        path: [0, 'reqId'],
      },
      operator: 'equals',
      expected: 'r1',
    };
    expect(evaluateAssertion(a1, dummySummary, dummyEvents)).toEqual({
      assertionId: 'a1',
      status: 'passed',
      actual: 'r1',
      reason: null,
    });
  });

  it('evaluates count subject for root scope', () => {
    const a1: Assertion = {
      id: 'a1',
      label: 'root generated count',
      subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'generated' },
      operator: 'equals',
      expected: 2,
    };
    expect(evaluateAssertion(a1, dummySummary, dummyEvents)).toEqual({
      assertionId: 'a1',
      status: 'passed',
      actual: 2,
      reason: null,
    });

    const aAtMost: Assertion = {
      id: 'a-at-most',
      label: 'root generated at most 5',
      subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'generated' },
      operator: 'at-most',
      expected: 5,
    };
    expect(evaluateAssertion(aAtMost, dummySummary, dummyEvents)).toEqual({
      assertionId: 'a-at-most',
      status: 'passed',
      actual: 2,
      reason: null,
    });

    // Element scope count is unevaluated in logical mode
    const aElem: Assertion = {
      id: 'a-elem',
      label: 'element scope',
      subject: { kind: 'count', scope: 'element', elementId: 'el-1', outcome: 'generated' },
      operator: 'equals',
      expected: 2,
    };
    expect(evaluateAssertion(aElem, dummySummary, dummyEvents).status).toBe('unevaluated');
  });

  it('evaluates trace-count subject', () => {
    const a1: Assertion = {
      id: 'a1',
      label: 'order-command count',
      subject: { kind: 'trace-count', elementId: 'el-1', code: 'order-command' },
      operator: 'equals',
      expected: 2,
    };
    expect(evaluateAssertion(a1, dummySummary, dummyEvents)).toEqual({
      assertionId: 'a1',
      status: 'passed',
      actual: 2,
      reason: null,
    });
  });

  it('returns unevaluated for metric subject in logical mode', () => {
    const aMetric: Assertion = {
      id: 'a-metric',
      label: 'check throughput',
      subject: { kind: 'metric', elementId: 'el-1', key: 'throughput' },
      operator: 'equals',
      expected: 100,
    };
    expect(evaluateAssertion(aMetric, dummySummary, dummyEvents)).toEqual({
      assertionId: 'a-metric',
      status: 'unevaluated',
      actual: null,
      reason: 'Logical runs have no timing, so metric checks are unavailable',
    });
  });

  it('evaluates a timed metric subject from the element metrics', () => {
    const metric = (key: 'p95LatencyMs' | 'throughput', value: number | null, available = true) => ({
      elementId: 'el-1', scope: 'element' as const, key, value, unit: 'ms' as const, available,
      reason: available ? null : 'No successful operations at this element', windowStartMs: 0, windowEndMs: 1000,
    });
    const timed: RunSummary = { ...dummySummary, mode: 'timed', elementMetrics: [metric('p95LatencyMs', 42)] };
    const check = (key: 'p95LatencyMs' | 'throughput', expected: number, summary = timed) =>
      evaluateAssertion({ id: 'm', label: 'm', subject: { kind: 'metric', elementId: 'el-1', key }, operator: 'at-most', expected }, summary, dummyEvents);

    expect(check('p95LatencyMs', 50)).toEqual({ assertionId: 'm', status: 'passed', actual: 42, reason: null });
    expect(check('p95LatencyMs', 40)).toMatchObject({ status: 'failed', actual: 42 });
    // Missing or unavailable: unevaluated, never zero.
    expect(check('throughput', 10)).toMatchObject({ status: 'unevaluated', actual: null });
    const unavailable: RunSummary = { ...timed, elementMetrics: [metric('p95LatencyMs', null, false)] };
    expect(check('p95LatencyMs', 50, unavailable)).toEqual({
      assertionId: 'm', status: 'unevaluated', actual: null, reason: 'No successful operations at this element',
    });
  });

  it('returns error if numeric operators applied to non-numbers', () => {
    const aBad: Assertion = {
      id: 'a-bad',
      label: 'bad at-most',
      subject: { kind: 'final-state', elementId: 'el-1' },
      operator: 'at-most',
      expected: 'state-succ',
    };
    const res = evaluateAssertion(aBad, dummySummary, dummyEvents);
    expect(res.status).toBe('error');
  });

  it('evaluateAssertions maps all assertions', () => {
    const list: Assertion[] = [
      {
        id: '1',
        label: 'l1',
        subject: { kind: 'trace-count', elementId: 'el-1', code: 'order-command' },
        operator: 'equals',
        expected: 2,
      },
    ];
    const results = evaluateAssertions(list, dummySummary, dummyEvents);
    expect(results.length).toBe(1);
    expect(results[0].status).toBe('passed');
  });
});
