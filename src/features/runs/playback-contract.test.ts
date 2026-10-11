import { describe, expect, it } from 'vitest';
import { advanceTime, normalizeRange, seekTime } from '@canvas-one/playback';

describe('headless timeframe boundaries', () => {
  const bounds = { startMs: 100, availableMs: 500, endMs: null };
  it('respects retained history, live availability and finalized end', () => {
    expect(seekTime(200, -1, bounds)).toBe(100);
    expect(seekTime(200, Infinity, bounds)).toBe(500);
    expect(seekTime(200, NaN, bounds)).toBe(200);
    expect(seekTime(200, 500, { ...bounds, endMs: 400 })).toBe(400);
  });
  it('pauses advancement at a selected end without going backwards', () => {
    expect(advanceTime(200, 100, 2, bounds, 350)).toBe(350);
    expect(advanceTime(400, 100, 2, bounds, 350)).toBe(400);
    expect(advanceTime(200, 100, 2, bounds)).toBe(400);
  });
  it('distinguishes invalid input from a cleared range', () => {
    expect(normalizeRange({ startMs: NaN, endMs: 500 }, bounds)).toBeUndefined();
    expect(normalizeRange({ startMs: 500, endMs: 100 }, bounds)).toBeNull();
    expect(normalizeRange({ startMs: 0, endMs: 900 }, bounds)).toEqual({ startMs: 100, endMs: 500 });
  });
});
