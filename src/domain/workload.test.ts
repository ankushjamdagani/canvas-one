import { describe, expect, it } from 'vitest';
import { nextArrivalTime } from './workload';

describe('nextArrivalTime ramp with holdFinalRate', () => {
  const settings = { traffic: 10, duration: 2, profile: { kind: 'ramp' as const, endRate: 30 }, holdFinalRate: true };

  it('keeps arriving at the end rate after the ramp ends', () => {
    expect(nextArrivalTime(settings, 5, 3)).toBeCloseTo(5 + 3 / 30, 9);
  });

  it('spans the ramp end when the hazard outlasts the ramp', () => {
    // from t=1: rate 20, slope 10, 1 s left => mass 25; hazard 28 leaves 3 at 30/s
    expect(nextArrivalTime(settings, 1, 28)).toBeCloseTo(2 + 3 / 30, 9);
  });

  it('still ends a ramp that does not hold', () => {
    expect(nextArrivalTime({ ...settings, holdFinalRate: false }, 1, 28)).toBe(Infinity);
  });
});
