import { describe, expect, it, vi } from 'vitest';
import { PlaybackStore } from '@canvas-one/simulation-system-design/playback';
import { clampWindow, timeAtPosition } from '@canvas-one/playback/timeline';

vi.mock('react', () => { throw new Error('Recorded playback imported React'); });
vi.mock('dexie', () => { throw new Error('Recorded playback imported IndexedDB'); });
vi.mock('../../components/traffic/cells-and-lanes', () => { throw new Error('Recorded playback imported a presentation component'); });

describe('headless recording package consumer', () => {
  it('supports independent recorded stores and numeric timeline hosts without UI or storage', () => {
    const options = { connectionTargets: new Map([['edge', 'service']]), historyMs: null };
    const first = new PlaybackStore(options);
    const second = new PlaybackStore(options);
    first.ingestFlow([{ key: 'packet', connectionId: 'edge', phase: 'sent', atMs: 100, arriveAtMs: 200, outcome: null }]);
    expect(first.stateAt(150).legs).toHaveLength(1);
    expect(second.stateAt(150).legs).toHaveLength(0);
    const window = clampWindow({ startMs: -10, endMs: 90 }, { startMs: 0, endMs: 200 });
    expect(window).toEqual({ startMs: 0, endMs: 100 });
    expect(timeAtPosition(25, 0, 100, window)).toBe(25);
  });
});
