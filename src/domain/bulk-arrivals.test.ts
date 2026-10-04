import { describe, expect, it } from 'vitest';
import { bulkArrivalMs } from './bulk-arrivals';

describe('bulkArrivalMs', () => {
  it('sends every request at the start delay for instant', () => {
    for (let i = 0; i < 5; i++) expect(bulkArrivalMs(i, 5, 'instant', 250)).toBe(250);
  });

  it('spaces requests evenly over the spread, first at the delay', () => {
    const times = [0, 1, 2, 3].map((i) => bulkArrivalMs(i, 4, { spreadMs: 1000 }, 100));
    expect(times).toEqual([100, 350, 600, 850]);
  });

  it('ramp: the i-th arrival is at spread * sqrt(i / N)', () => {
    const t = (i: number) => bulkArrivalMs(i, 4, { ramp: { spreadMs: 1000 } }, 0);
    expect(t(0)).toBe(0);
    expect(t(1)).toBeCloseTo(500, 6);
    expect(t(3)).toBeCloseTo(1000 * Math.sqrt(3 / 4), 6);
  });

  it('keeps arrival times non-decreasing', () => {
    let prev = -1;
    for (let i = 0; i < 1000; i++) {
      const t = bulkArrivalMs(i, 1000, { ramp: { spreadMs: 5000 } }, 0);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });
});
