import { describe, it, expect } from 'vitest';
import { evidenceEntryFromTerminal } from './evidence';
import type { RunUpdate } from './types';
import { emptyCycleSummary } from './cycles';

function terminalUpdate(): Extract<RunUpdate, { kind: 'terminal' }> {
  return {
    kind: 'terminal',
    runId: 'run-1',
    status: 'completed',
    checks: [
      { assertionId: 'assertion-1', status: 'passed', actual: 1, reason: null },
      { assertionId: 'assertion-2', status: 'failed', actual: { nested: true }, reason: 'mismatch' },
    ],
    summary: {
      mode: 'logical',
      cycles: emptyCycleSummary(),
      consumedInputs: 2,
      rootCounts: { generated: 2, succeeded: 2, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
      messageCounts: { generated: 0, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
      elementMetrics: [],
      finalStates: [],
      outputs: [],
      coverage: { includedElementIds: ['el-1', 'el-2'], excludedElementIds: ['el-3'] },
      processedEvents: 5,
      elapsedMs: null,
      rowOutcomes: [],
    },
    reason: null,
  };
}

describe('evidenceEntryFromTerminal', () => {
  it('copies checks and scope unchanged, without mutating the input', () => {
    const update = terminalUpdate();
    const frozenUpdate = structuredClone(update);

    const entry = evidenceEntryFromTerminal('scenario-1', 'ss-run-v1:abc', update);

    expect(entry).toEqual({
      scenarioId: 'scenario-1',
      fingerprint: 'ss-run-v1:abc',
      runId: 'run-1',
      completion: 'completed',
      checks: update.checks,
      scope: {
        includedElementIds: ['el-1', 'el-2'],
        excludedElementIds: ['el-3'],
      },
    });

    // The input object is untouched.
    expect(update).toEqual(frozenUpdate);
  });

  it('returns arrays independent from the source (no aliasing of the mutable copies)', () => {
    const update = terminalUpdate();
    const entry = evidenceEntryFromTerminal('scenario-1', 'ss-run-v1:abc', update);

    // Mutating the returned entry's arrays must never affect the source update.
    (entry.checks as unknown as unknown[]).push({ assertionId: 'x', status: 'error', actual: null, reason: null });
    (entry.scope.includedElementIds as unknown as unknown[]).push('el-99');

    expect(update.checks.length).toBe(2);
    expect(update.summary.coverage.includedElementIds.length).toBe(2);
  });
});
