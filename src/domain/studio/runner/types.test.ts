import { describe, it, expect } from 'vitest';
import { RUN_STATES, TERMINAL_STATUSES, ELEMENT_METRIC_KEYS, ELEMENT_METRIC_UNITS, RUN_BUDGET_LIMITS } from './types';

describe('runner/types constants (storage.md §6 run defaults/maxima)', () => {
  it('RUN_STATES and TERMINAL_STATUSES are disjoint', () => {
    for (const s of RUN_STATES) {
      expect(TERMINAL_STATUSES).not.toContain(s);
    }
  });

  it('ELEMENT_METRIC_KEYS matches the closed catalog in §9', () => {
    expect(ELEMENT_METRIC_KEYS).toEqual([
      'generated',
      'succeeded',
      'rejected',
      'failed',
      'expired',
      'inFlight',
      'acknowledged',
      'throughput',
      'meanLatencyMs',
      'p95LatencyMs',
      'utilization',
      'queued',
      'active',
      'cacheHits',
      'cacheMisses',
      'cacheEntries',
      'cacheEvictions',
      'cacheExpirations',
    ]);
  });

  it('ELEMENT_METRIC_UNITS matches §9', () => {
    expect(ELEMENT_METRIC_UNITS).toEqual(['count', 'ms', 'requests/s', 'ratio']);
  });

  it('RUN_BUDGET_LIMITS matches storage.md §6 run defaults/maxima', () => {
    expect(RUN_BUDGET_LIMITS.maxEvents).toEqual({ default: 100_000, max: 1_000_000 });
    expect(RUN_BUDGET_LIMITS.maxTraceRows).toEqual({ default: 10_000, max: 100_000 });
    expect(RUN_BUDGET_LIMITS.maxTraceBytes).toEqual({ default: 4 * 1024 * 1024, max: 16 * 1024 * 1024 });
    expect(RUN_BUDGET_LIMITS.maxScheduledEvents).toBe(100_000);
    expect(RUN_BUDGET_LIMITS.maxLiveRoots).toBe(10_000);
  });
});
