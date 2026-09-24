import { describe, it, expect } from 'vitest';
import { evaluateAssertion, evaluateAssertions } from './assertions';
import type { Assertion } from '../model';
import type { RunSummary, TraceEvent } from './types';

describe('assertions: evaluateAssertion', () => {
  const dummySummary: RunSummary = {
    mode: 'logical',
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
      reason: 'Metric assertions are unsupported in logical mode (§6)',
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
