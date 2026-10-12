import type { TrackSource } from '@canvas-one/playback';
import type { PlaybackStore, StateAt, NodeAt } from './playback.js';

/** Plain-data query frame: original measured checkpoint values are carried unchanged. */
export type RecordingFrame = Omit<StateAt, 'nodes'> & {
  readonly nodes: readonly {readonly elementId: string; readonly activity: NodeAt}[];
};

/** Read-only adapter; does not seek, advance or replace the recording store's app clock. */
export function createRecordingTrackSource(options: {
  readonly recordingId: string;
  readonly store: Pick<PlaybackStore, 'windowStartMs' | 'computedMs' | 'endMs' | 'ended' | 'stateAt'>;
  /** Hosts bind recording arrival subscriptions, or call generic controller.refresh() manually. */
  readonly subscribe?: (listener: () => void) => () => void;
}): TrackSource<RecordingFrame> {
  if (!options.recordingId.trim()) throw new TypeError('Recorded tracks require a recording identifier');
  return {
    id: `recording/${options.recordingId}`, provenance: {kind: 'recorded', recordingId: options.recordingId},
    getWindow: () => ({retainedStartMs: options.store.windowStartMs, frontierMs: options.store.computedMs,
      durationMs: options.store.endMs, live: !options.store.ended, seekable: true}),
    read: timeMs => {
      if (!Number.isFinite(timeMs) || timeMs < options.store.windowStartMs || timeMs > options.store.computedMs) return null;
      const state = options.store.stateAt(timeMs);
      return {...state, nodes: [...state.nodes].map(([elementId, activity]) => ({elementId, activity}))};
    },
    subscribe: options.subscribe,
  };
}
