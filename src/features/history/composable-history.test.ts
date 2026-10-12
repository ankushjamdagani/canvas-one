import { describe, expect, it, vi } from 'vitest';
import { VersioningService, PublicationService, evaluateCandidate, buildEvidenceManifest,
  type HistoryAuthoredCommand, type VersioningScope } from '@canvas-one/history';

vi.mock('dexie', () => { throw new Error('History imported IndexedDB'); });
vi.mock('react', () => { throw new Error('History imported React'); });
vi.mock('@canvas-one/simulation-system-design', () => { throw new Error('History imported a simulator'); });

type Result = { status: 'applied' | 'stale' | 'invalid' | 'failed'; issues?: readonly unknown[] };
const actor = { actorId: 'host-user', kind: 'human' };
const scope: VersioningScope = { projectId: 'project', branchId: 'draft', workingRevision: 4, isMain: false };

describe('composable version history', () => {
  it('builds scoped revision commands and reloads only after successful receipts', async () => {
    let next = 0;
    const commands: HistoryAuthoredCommand<typeof actor, { runId: string }>[] = [];
    const afterApplied = vi.fn();
    const execute = vi.fn(async (command: HistoryAuthoredCommand<typeof actor, { runId: string }>): Promise<Result> => {
      commands.push(command); return { status: 'applied' };
    });
    const service = new VersioningService({ getScope: () => scope, actor, mintId: () => `readable-${++next}`,
      execute, afterApplied, invalid: (issues): Result => ({ status: 'invalid', issues }), mapError: (): Result => ({ status: 'failed' }) });
    expect((await service.checkpoint('  Checkpoint  ')).status).toBe('applied');
    expect(commands[0]).toMatchObject({ commandId: 'history.checkpoint', actor, expectedWorkingRevision: 4,
      projectId: scope.projectId, branchId: scope.branchId, payload: { label: 'Checkpoint' } });
    expect(afterApplied).toHaveBeenLastCalledWith(scope, 'history.checkpoint');
    execute.mockResolvedValueOnce({ status: 'stale' });
    expect((await service.restore('prior-snapshot', 'Before restore')).status).toBe('stale');
    expect(afterApplied).toHaveBeenCalledTimes(1);
    const evidence = [{ runId: 'opaque-provider-run' }];
    await service.commit({ message: 'Commit', evidence, expectedHeadId: 'head', expectedWorkingRevision: 3 });
    expect(commands.at(-1)).toMatchObject({ commandId: 'history.commit', expectedWorkingRevision: 3,
      payload: { message: 'Commit', expectedHeadId: 'head', evidence } });
  });

  it('enforces branch and metadata rules without assuming a storage or evidence provider', async () => {
    const execute = vi.fn(async (): Promise<Result> => ({ status: 'applied' }));
    const service = new VersioningService({ getScope: () => ({ ...scope, isMain: true }), actor,
      mintId: () => 'id', execute, afterApplied: async () => {},
      invalid: (issues): Result => ({ status: 'invalid', issues }), mapError: (): Result => ({ status: 'failed' }) });
    expect((await service.restore('snapshot', 'Checkpoint')).status).toBe('invalid');
    expect((await service.commit({ message: 'Commit', expectedHeadId: null, evidence: [] })).status).toBe('invalid');
    expect(execute).not.toHaveBeenCalled();
    const publishCandidate = vi.fn(async (): Promise<Result> => ({ status: 'applied' }));
    const publisher = new PublicationService({ actor, mintId: () => 'id', publishCandidate,
      invalid: (issues): Result => ({ status: 'invalid', issues }) });
    const input = { candidateId: 'candidate', projectId: scope.projectId, sourceBranchId: scope.branchId,
      expectedProjectRevision: 2, expectedWorkingRevision: 4, evidence: [{ provider: 'custom' }],
      metadata: { version: { major: 1, minor: 0, patch: 0 }, title: 'Version', rationale: '', ticketUrl: null } };
    expect((await publisher.publish(input)).result.status).toBe('applied');
    expect(publishCandidate).toHaveBeenCalledWith(expect.objectContaining({ commandId: 'history.publish', actor,
      payload: expect.objectContaining({ expectedProjectRevision: 2, evidence: input.evidence }) }));
    expect((await publisher.publish({ ...input, metadata: { ...input.metadata, ticketUrl: 'javascript:alert(1)' } })).result.status).toBe('invalid');
    expect(publishCandidate).toHaveBeenCalledTimes(1);
  });

  it('qualifies supplied evidence summaries and delegates evidence artifact conversion', () => {
    const candidate = { scenarioId: 'scenario', fingerprint: 'fingerprint', scope: ['service'] };
    const run = { id: 'run', status: 'completed', provenance: 'local', fingerprint: 'fingerprint',
      checks: [{ status: 'passed', customProviderCheck: true }], summary: { consumedInputs: 1 },
      manifest: { scenario: { id: 'scenario', assertions: [] } }, completedAt: 1 };
    expect(evaluateCandidate([candidate], [run])).toMatchObject({ eligible: true });
    const convert = vi.fn((scenarioId: string, fingerprint: string, selected: typeof run) => ({ scenarioId, fingerprint, customArtifact: selected.id }));
    expect(buildEvidenceManifest([candidate], [run], convert)).toEqual({ scenarioIds: ['scenario'], entries: [{ scenarioId: 'scenario', fingerprint: 'fingerprint', customArtifact: 'run' }] });
    expect(convert).toHaveBeenCalledWith('scenario', 'fingerprint', run);
  });
});
