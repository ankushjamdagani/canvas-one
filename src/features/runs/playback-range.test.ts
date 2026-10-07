import { describe, expect, it } from 'vitest';
import { PlaybackStore } from './playback';

const make = (historyMs: number | null = null) => {
  const store = new PlaybackStore({ historyMs, connectionTargets: new Map() });
  store.setComputedEdge(10000);
  return store;
};

describe('playback range', () => {
  it('bounds history while live review is stationary, and follows the edge past a selected interval', () => {
    const store = make(1000);
    store.setSelection({ startMs: 0, endMs: 6000 });
    store.seek(2000); store.following = false; store.playing = true;
    store.advance(1000);
    expect(store.playheadMs).toBe(2000);
    store.retainThrough(6000);
    expect(store.windowStartMs).toBe(5000);
    expect(store.playheadMs).toBe(5000);
    expect(store.selection).toEqual({ startMs: 5000, endMs: 6000 });
    store.following = true; store.seek(7000); store.advance(1000);
    expect(store.playheadMs).toBe(8000);
    expect(store.windowStartMs).toBe(7000);
    expect(store.selection).toBeNull();
  });

  it('stops exactly at the selected end while inspection can seek outside', () => {
    const store = make();
    store.setEnded(10000);
    store.setSelection({ startMs: 2000, endMs: 4000 });
    store.seek(2000); store.playing = true; store.speed = 16;
    store.advance(1000);
    expect(store.playheadMs).toBe(4000);
    expect(store.atSelectionEnd()).toBe(true);
    expect(store.atEnd()).toBe(false);
    store.seek(7000);
    expect(store.playheadMs).toBe(7000);
    store.setSelection(null); store.advance(1000);
    expect(store.atEnd()).toBe(true);
  });

  it('clamps to computed/end bounds, rejects nonfinite values and clears collapsed intervals', () => {
    const store = make();
    store.setSelection({ startMs: -10, endMs: 12000 });
    expect(store.selection).toEqual({ startMs: 0, endMs: 10000 });
    store.setSelection({ startMs: NaN, endMs: Infinity });
    expect(store.selection).toEqual({ startMs: 0, endMs: 10000 });
    store.setEnded(8000);
    expect(store.selection?.endMs).toBe(8000);
    store.setSelection({ startMs: 8000, endMs: 4000 });
    expect(store.selection).toBeNull();
    store.setSelection({ startMs: 100, endMs: 100.5 });
    expect(store.selection).toBeNull();
  });

  it('keeps a stream selection inside retained history after eviction', () => {
    const store = make(1000);
    store.setSelection({ startMs: 0, endMs: 6000 });
    store.playing = true; store.advance(6000);
    expect(store.windowStartMs).toBe(5000);
    expect(store.selection).toEqual({ startMs: 5000, endMs: 6000 });
    store.seek(9000); store.advance(16);
    expect(store.selection).toBeNull();
  });
});
