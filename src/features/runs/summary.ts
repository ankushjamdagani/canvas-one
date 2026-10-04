import { emptyCycleSummary } from '../../domain/studio/runner/cycles';
import type { RunSummary } from '../../domain/studio/runner/types';

/** A zeroed RunSummary for a run that has produced no results yet. */
export function createEmptySummary(mode: 'logical' | 'timed' = 'logical'): RunSummary {
  return {
    mode,
    cycles: emptyCycleSummary(),
    consumedInputs: 0,
    rootCounts: {
      generated: 0,
      succeeded: 0,
      rejected: 0,
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
    finalStates: [],
    outputs: [],
    coverage: {
      includedElementIds: [],
      excludedElementIds: [],
    },
    processedEvents: 0,
    elapsedMs: null,
    rowOutcomes: [],
    trace: { recordedRows: 0, truncatedBy: null },
  };
}
