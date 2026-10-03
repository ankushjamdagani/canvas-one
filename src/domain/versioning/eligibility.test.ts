import { describe, expect, it } from 'vitest';
import type { CheckResult, RunSummary, TerminalStatus } from '../studio/runner/types';
import { buildEvidenceManifest, evaluateCandidate, runQualifies } from './eligibility';
import type { CandidateScenario, RunCandidate, RunQualifiesExpected } from './types';

function createMockSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    mode: 'logical',
    consumedInputs: 1,
    rootCounts: {
      generated: 1,
      succeeded: 1,
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
    finalStates: [{ elementId: 'elem-1', stateId: 'succeeded', context: {} }],
    outputs: [],
    coverage: {
      includedElementIds: ['elem-1'],
      excludedElementIds: [],
    },
    processedEvents: 5,
    elapsedMs: null,
    rowOutcomes: [],
    ...overrides,
  };
}

function createMockRun(overrides: Partial<RunCandidate> = {}): RunCandidate {
  return {
    id: 'run-1',
    status: 'completed',
    provenance: 'local',
    fingerprint: 'ss-run-v1:abc1234',
    checks: [
      {
        assertionId: 'assert-1',
        status: 'passed',
        actual: 'succeeded',
        reason: null,
      },
    ],
    summary: createMockSummary(),
    manifest: {
      scenario: {
        id: 'scen-1',
        assertions: [
          {
            id: 'assert-1',
            subject: { kind: 'final-state', elementId: 'elem-1' },
            operator: 'equals',
            expected: 'succeeded',
          },
        ],
      },
      scope: {
        includedElementIds: ['elem-1'],
        excludedElementIds: [],
      },
    },
    completedAt: 1000,
    ...overrides,
  };
}

describe('runQualifies (§5 eligibility rules)', () => {
  const defaultExpected: RunQualifiesExpected = {
    scenarioId: 'scen-1',
    fingerprint: 'ss-run-v1:abc1234',
    compiledScopeElementIds: ['elem-1'],
  };

  it('qualifies a valid, local, completed run with passing checks and inputs', () => {
    const run = createMockRun();
    const result = runQualifies(run, defaultExpected);
    expect(result.qualifies).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  // Rule 1: status completed
  it('fails Rule 1 when status is not completed (e.g. failed, cancelled, incomplete)', () => {
    const run = createMockRun({ status: 'failed' as TerminalStatus });
    const result = runQualifies(run, defaultExpected);
    expect(result.qualifies).toBe(false);
    expect(result.reasons).toContain('status-not-completed');
  });

  // Rule 2: provenance local
  it('fails Rule 2 when provenance is imported-unverified (imported-unverified never qualifies)', () => {
    const run = createMockRun({ provenance: 'imported-unverified' });
    const result = runQualifies(run, defaultExpected);
    expect(result.qualifies).toBe(false);
    expect(result.reasons).toContain('provenance-not-local');
  });

  // Rule 3: fingerprint equal
  it('fails Rule 3 when fingerprint does not match expected', () => {
    const run = createMockRun({ fingerprint: 'ss-run-v1:different-fingerprint' });
    const result = runQualifies(run, defaultExpected);
    expect(result.qualifies).toBe(false);
    expect(result.reasons).toContain('fingerprint-mismatch');
  });

  // Rule 3b: scenario ID match
  it('fails Rule 3b when manifest scenario ID differs from expected', () => {
    const run = createMockRun({
      manifest: {
        scenario: { id: 'scen-other', assertions: [] },
      },
    });
    const result = runQualifies(run, defaultExpected);
    expect(result.qualifies).toBe(false);
    expect(result.reasons).toContain('scenario-mismatch');
  });

  // Rule 4: every check evaluated and passed
  it('fails Rule 4 when any check failed, unevaluated, or errored', () => {
    const failingCheck: CheckResult = {
      assertionId: 'assert-2',
      status: 'failed',
      actual: 'failed',
      reason: 'State did not match',
    };
    const run = createMockRun({
      checks: [createMockRun().checks[0], failingCheck],
    });
    const result = runQualifies(run, defaultExpected);
    expect(result.qualifies).toBe(false);
    expect(result.reasons).toContain('check-failed');
  });

  it('fails Rule 4 when a check is unevaluated', () => {
    const unevalCheck: CheckResult = {
      assertionId: 'assert-2',
      status: 'unevaluated',
      actual: null,
      reason: 'Metric unavailable',
    };
    const run = createMockRun({
      checks: [unevalCheck],
    });
    const result = runQualifies(run, defaultExpected);
    expect(result.qualifies).toBe(false);
    expect(result.reasons).toContain('check-failed');
  });

  // Rule 5: non-vacuous: >= 1 passing assertion
  it('fails Rule 5 when run has zero checks (zero-check run is ineligible)', () => {
    const run = createMockRun({ checks: [] });
    const result = runQualifies(run, defaultExpected);
    expect(result.qualifies).toBe(false);
    expect(result.reasons).toContain('no-passing-assertions');
  });

  // Rule 6: non-vacuous: >= 1 consumed input or workload root
  it('fails Rule 6 when consumed inputs = 0 and workload roots = 0', () => {
    const run = createMockRun({
      summary: createMockSummary({
        consumedInputs: 0,
        rootCounts: {
          generated: 0,
          succeeded: 0,
          rejected: 0,
          failed: 0,
          expired: 0,
          inFlight: 0,
        },
      }),
    });
    const result = runQualifies(run, defaultExpected);
    expect(result.qualifies).toBe(false);
    expect(result.reasons).toContain('no-consumed-inputs');
  });

  it('passes Rule 6 if workload root generated >= 1 even if consumedInputs is 0', () => {
    const run = createMockRun({
      summary: createMockSummary({
        consumedInputs: 0,
        rootCounts: {
          generated: 2,
          succeeded: 2,
          rejected: 0,
          failed: 0,
          expired: 0,
          inFlight: 0,
        },
      }),
    });
    const result = runQualifies(run, defaultExpected);
    expect(result.qualifies).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  // Rule 7: all assertion subjects in compiled scope
  it('fails Rule 7 when an assertion subject is outside compiled scope', () => {
    const run = createMockRun({
      manifest: {
        scenario: {
          id: 'scen-1',
          assertions: [
            {
              id: 'assert-1',
              subject: { kind: 'final-state', elementId: 'elem-out-of-scope' },
              operator: 'equals',
              expected: 'succeeded',
            },
          ],
        },
      },
    });
    const result = runQualifies(run, {
      ...defaultExpected,
      compiledScopeElementIds: ['elem-1'], // elem-out-of-scope is missing
    });
    expect(result.qualifies).toBe(false);
    expect(result.reasons).toContain('assertion-subject-out-of-scope');
  });

  // Modeled business failure qualifying test
  it('qualifies a modeled-failure run whose checks assert that failure', () => {
    const run = createMockRun({
      status: 'completed', // Modeled failure terminates completed, not failed
      checks: [
        {
          assertionId: 'assert-failure',
          status: 'passed',
          actual: 'failed',
          reason: null,
        },
      ],
      summary: createMockSummary({
        finalStates: [{ elementId: 'elem-1', stateId: 'failed', context: { error: 'invalid-cart' } }],
      }),
      manifest: {
        scenario: {
          id: 'scen-1',
          assertions: [
            {
              id: 'assert-failure',
              subject: { kind: 'final-state', elementId: 'elem-1' },
              operator: 'equals',
              expected: 'failed',
            },
          ],
        },
      },
    });
    const result = runQualifies(run, defaultExpected);
    expect(result.qualifies).toBe(true);
    expect(result.reasons).toEqual([]);
  });
});

describe('evaluateCandidate (§5 commit/publish eligibility)', () => {
  const scenarioA: CandidateScenario = {
    scenarioId: 'scen-A',
    fingerprint: 'ss-run-v1:fp-a',
    scope: { includedElementIds: ['elem-1'] },
  };

  const scenarioB: CandidateScenario = {
    scenarioId: 'scen-B',
    fingerprint: 'ss-run-v1:fp-b',
    scope: ['elem-2'],
  };

  it('returns not eligible when candidate has zero scenarios', () => {
    const result = evaluateCandidate([], []);
    expect(result.eligible).toBe(false);
    expect(result.scenarios).toEqual([]);
  });

  it('returns not eligible when one scenario is missing evidence', () => {
    const runA = createMockRun({
      id: 'run-a',
      fingerprint: 'ss-run-v1:fp-a',
      manifest: { scenario: { id: 'scen-A', assertions: [] } },
    });

    const result = evaluateCandidate([scenarioA, scenarioB], [runA]);
    expect(result.eligible).toBe(false);
    expect(result.scenarios).toHaveLength(2);
    expect(result.scenarios[0].evaluation.status).toBe('qualified');
    expect(result.scenarios[1].evaluation.status).toBe('missing');
  });

  it('blocks eligibility when a run is incomplete', () => {
    const runA = createMockRun({
      id: 'run-a',
      fingerprint: 'ss-run-v1:fp-a',
      status: 'incomplete' as TerminalStatus,
      manifest: { scenario: { id: 'scen-A', assertions: [] } },
    });

    const result = evaluateCandidate([scenarioA], [runA]);
    expect(result.eligible).toBe(false);
    expect(result.scenarios[0].evaluation.status).toBe('incomplete');
  });

  it('accepts evidence from another branch with matching fingerprint', () => {
    const runOtherBranch = createMockRun({
      id: 'run-other-branch',
      fingerprint: 'ss-run-v1:fp-a',
      provenance: 'local',
      manifest: { scenario: { id: 'scen-A', assertions: [] } },
    });

    const result = evaluateCandidate([scenarioA], [runOtherBranch]);
    expect(result.eligible).toBe(true);
    expect(result.scenarios[0].evaluation.status).toBe('qualified');
    if (result.scenarios[0].evaluation.status === 'qualified') {
      expect(result.scenarios[0].evaluation.runId).toBe('run-other-branch');
    }
  });

  it('invalidates eligibility when a scenario fingerprint changed (edited scenario)', () => {
    // Only a run with an old fingerprint exists
    const oldRun = createMockRun({
      id: 'run-old',
      fingerprint: 'ss-run-v1:old-fingerprint',
      manifest: { scenario: { id: 'scen-A', assertions: [] } },
    });

    const result = evaluateCandidate([scenarioA], [oldRun]);
    expect(result.eligible).toBe(false);
    expect(result.scenarios[0].evaluation.status).toBe('not-qualifying');
    if (result.scenarios[0].evaluation.status === 'not-qualifying') {
      expect(result.scenarios[0].evaluation.reasons).toContain('fingerprint-mismatch');
    }
  });

  it('makes a deterministic choice among multiple qualifying runs (latest completedAt, then id)', () => {
    const run1 = createMockRun({
      id: 'run-earlier',
      fingerprint: 'ss-run-v1:fp-a',
      completedAt: 1000,
      manifest: { scenario: { id: 'scen-A', assertions: [] } },
    });
    const run2 = createMockRun({
      id: 'run-latest',
      fingerprint: 'ss-run-v1:fp-a',
      completedAt: 3000,
      manifest: { scenario: { id: 'scen-A', assertions: [] } },
    });
    const run3 = createMockRun({
      id: 'run-middle',
      fingerprint: 'ss-run-v1:fp-a',
      completedAt: 2000,
      manifest: { scenario: { id: 'scen-A', assertions: [] } },
    });

    const result = evaluateCandidate([scenarioA], [run1, run2, run3]);
    expect(result.eligible).toBe(true);
    if (result.scenarios[0].evaluation.status === 'qualified') {
      expect(result.scenarios[0].evaluation.runId).toBe('run-latest');
    }

    // Tie-breaker on equal completedAt: id descending
    const runTieA = createMockRun({
      id: 'run-aaa',
      fingerprint: 'ss-run-v1:fp-a',
      completedAt: 5000,
      manifest: { scenario: { id: 'scen-A', assertions: [] } },
    });
    const runTieZ = createMockRun({
      id: 'run-zzz',
      fingerprint: 'ss-run-v1:fp-a',
      completedAt: 5000,
      manifest: { scenario: { id: 'scen-A', assertions: [] } },
    });

    const resultTie = evaluateCandidate([scenarioA], [runTieA, runTieZ]);
    if (resultTie.scenarios[0].evaluation.status === 'qualified') {
      expect(resultTie.scenarios[0].evaluation.runId).toBe('run-zzz');
    }
  });

  it('returns eligible: true when all candidate scenarios have qualifying runs', () => {
    const runA = createMockRun({
      id: 'run-a',
      fingerprint: 'ss-run-v1:fp-a',
      manifest: { scenario: { id: 'scen-A', assertions: [] } },
    });
    const runB = createMockRun({
      id: 'run-b',
      fingerprint: 'ss-run-v1:fp-b',
      manifest: { scenario: { id: 'scen-B', assertions: [] } },
    });

    const result = evaluateCandidate([scenarioA, scenarioB], [runA, runB]);
    expect(result.eligible).toBe(true);
    expect(result.scenarios[0].evaluation.status).toBe('qualified');
    expect(result.scenarios[1].evaluation.status).toBe('qualified');
  });
});

describe('buildEvidenceManifest', () => {
  it('builds an EvidenceManifest with full scenario inventory and entries', () => {
    const scenarioA: CandidateScenario = {
      scenarioId: 'scen-A',
      fingerprint: 'ss-run-v1:fp-a',
      scope: ['elem-1'],
    };
    const runA = createMockRun({
      id: 'run-a',
      fingerprint: 'ss-run-v1:fp-a',
      summary: createMockSummary({
        coverage: {
          includedElementIds: ['elem-1'],
          excludedElementIds: ['elem-2'],
        },
      }),
      manifest: { scenario: { id: 'scen-A', assertions: [] } },
    });

    const manifest = buildEvidenceManifest([scenarioA], [runA]);
    expect(manifest.scenarioIds).toEqual(['scen-A']);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]).toEqual({
      scenarioId: 'scen-A',
      fingerprint: 'ss-run-v1:fp-a',
      runId: 'run-a',
      completion: 'completed',
      checks: runA.checks,
      scope: {
        includedElementIds: ['elem-1'],
        excludedElementIds: ['elem-2'],
      },
    });
  });
});
