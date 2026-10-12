import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('dexie', () => { throw new Error('Candidate execution imported Dexie'); });
vi.mock('react', () => { throw new Error('Candidate execution imported React'); });
import { startCandidateRun } from '@canvas-one/simulation-system-design/candidate-execution';
import { prepareScenario } from '@canvas-one/simulation-system-design/runner/compile';
import { runScenario } from '@canvas-one/simulation-system-design/runner/scenario-runner';
import { validateRunStartToken } from '@canvas-one/simulation-system-design/token';
import type { TerminalRunArtifact } from '@canvas-one/simulation-system-design/artifacts';
import type { Document } from '@canvas-one/system-design/studio/model';

describe('public candidate execution', () => {
  it('persists one immutable snapshot receipt even when candidate is superseded during execution', async () => {
    const document = JSON.parse(readFileSync('src/features/entry/examples/s01.json', 'utf8')) as Document;
    let superseded = false;
    const saveRun = vi.fn(async (token: unknown, terminal: TerminalRunArtifact) => {
      const binding = validateRunStartToken(token);
      expect(binding?.document).toBe(document);
      expect(binding?.snapshotId).toBe('snapshot');
      expect(Object.isFrozen(document)).toBe(true);
      return { status: 'applied' as const, runId: terminal.runId, run: { projectId: 'project', id: terminal.runId, snapshotId: 'snapshot', manifest: binding?.manifest, fingerprint: terminal.fingerprint, status: terminal.status, provenance: 'local' as const, checks: terminal.checks, summary: terminal.summary, traceState: 'complete' as const, createdAt: 0, completedAt: 1 } };
    });
    const result = await startCandidateRun({
      artifacts: { saveRun },
      getCandidate: () => ({ projectId: 'project', snapshotId: 'snapshot', superseded, document, conflictIds: [], issues: [] }),
      execution: { prepareScenario, runScenario: async (...params) => { const result = await runScenario(...params); superseded = true; return result; } },
    }, { candidateId: 'candidate', scenarioId: document.scenarios[0].id, runId: 'run' });
    expect(result).toMatchObject({ status: 'done', runId: 'run', superseded: true });
    expect(saveRun).toHaveBeenCalledOnce();
  });

  it('does not dispatch execution or artifacts for an unavailable candidate', async () => {
    const saveRun = vi.fn();
    expect(await startCandidateRun({ artifacts: { saveRun }, getCandidate: () => null }, { candidateId: 'missing', scenarioId: 'scenario', runId: 'run' })).toEqual({ status: 'missing', ids: ['missing'] });
    expect(saveRun).not.toHaveBeenCalled();
  });
});
