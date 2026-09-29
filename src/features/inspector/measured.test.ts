import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../../domain/studio/runner/types';
import { selectMeasuredSection } from './measured';

function summary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    mode: 'timed',
    consumedInputs: 10,
    rootCounts: { generated: 10, succeeded: 10, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
    messageCounts: { generated: 0, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
    elementMetrics: [],
    finalStates: [],
    outputs: [],
    coverage: { includedElementIds: [], excludedElementIds: [] },
    processedEvents: 10,
    elapsedMs: 1000,
    rowOutcomes: [],
    ...overrides,
  };
}

describe('selectMeasuredSection', () => {
  it('no run yet -> "No run yet for <scenario>"', () => {
    const result = selectMeasuredSection('el-1', null, 'Checkout path', 'timed');
    expect(result.rows).toEqual([]);
    expect(result.emptyMessage).toBe('No run yet for Checkout path');
  });

  it('shows only rows for the given element, scope element', () => {
    const run = {
      summary: summary({
        elementMetrics: [
          { elementId: 'el-1', scope: 'element', key: 'throughput', value: 100.3, unit: 'requests/s', available: true, reason: null, windowStartMs: 0, windowEndMs: 1000 },
          { elementId: 'el-2', scope: 'element', key: 'throughput', value: 50, unit: 'requests/s', available: true, reason: null, windowStartMs: 0, windowEndMs: 1000 },
          { elementId: null, scope: 'root', key: 'generated', value: 10, unit: 'count', available: true, reason: null, windowStartMs: null, windowEndMs: null },
        ],
      }),
    };
    const result = selectMeasuredSection('el-1', run, 'Checkout path', 'timed');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].label).toBe('Throughput');
    expect(result.rows[0].valueText).toBe('100.3 req/s');
    expect(result.emptyMessage).toBeNull();
  });

  it('unavailable metric renders "Unavailable" with the reason kept separately', () => {
    const run = {
      summary: summary({
        elementMetrics: [
          { elementId: 'el-1', scope: 'element', key: 'utilization', value: null, unit: 'ratio', available: false, reason: 'not a resource element', windowStartMs: null, windowEndMs: null },
        ],
      }),
    };
    const result = selectMeasuredSection('el-1', run, 'Checkout path', 'timed');
    expect(result.rows[0].valueText).toBe('Unavailable');
    expect(result.rows[0].available).toBe(false);
    expect(result.rows[0].reason).toBe('not a resource element');
  });

  it('logical mode: throughput/latency keys are filtered even if present', () => {
    const run = {
      summary: summary({
        mode: 'logical',
        elementMetrics: [
          { elementId: 'el-1', scope: 'element', key: 'throughput', value: 10, unit: 'requests/s', available: true, reason: null, windowStartMs: 0, windowEndMs: 100 },
          { elementId: 'el-1', scope: 'element', key: 'meanLatencyMs', value: 5, unit: 'ms', available: true, reason: null, windowStartMs: 0, windowEndMs: 100 },
          { elementId: 'el-1', scope: 'element', key: 'p95LatencyMs', value: 8, unit: 'ms', available: true, reason: null, windowStartMs: 0, windowEndMs: 100 },
          { elementId: 'el-1', scope: 'element', key: 'generated', value: 3, unit: 'count', available: true, reason: null, windowStartMs: 0, windowEndMs: 100 },
        ],
      }),
    };
    const result = selectMeasuredSection('el-1', run, 'Logical scenario', 'logical');
    expect(result.rows.map((r) => r.key)).toEqual(['generated']);
  });

  it('run exists but nothing for this element -> "No measurements for this element"', () => {
    const run = { summary: summary({ elementMetrics: [] }) };
    const result = selectMeasuredSection('el-1', run, 'Checkout path', 'timed');
    expect(result.rows).toEqual([]);
    expect(result.emptyMessage).toBe('No measurements for this element');
  });
});
