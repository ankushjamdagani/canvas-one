import { describe, expect, it, vi } from 'vitest';
vi.mock('dexie', () => { throw new Error('Candidate lifecycle imported Dexie'); });
vi.mock('react', () => { throw new Error('Candidate lifecycle imported React'); });
vi.mock('@canvas-one/simulation-system-design', () => { throw new Error('Candidate lifecycle imported simulation'); });
import { CandidateService, evaluateCandidateState, publishCandidate, mintPublishTicket, validatePublishTicket, type CandidateState, type HistoryPublishCommand } from '@canvas-one/history';
import { validatePublishTicket as validateHostTicket } from '../../persistence/studio/publish-ticket';

describe('generic candidate lifecycle', () => {
  it('gates evidence and publication on generic candidate state and verifies command scope before minting', async () => {
    const candidate: CandidateState<string> = { candidateId: 'candidate', projectId: 'project', sourceBranchId: 'draft', mainBranchId: 'main', expectedSourceRevision: 4, expectedSourceHeadId: 'head', expectedMainRevision: 2, expectedMainHeadId: null, mergeBase: { commitId: null, snapshotId: 'creation' }, snapshotId: 'snapshot', mergeState: 'note', superseded: false };
    const publish = vi.fn(async (ticket: unknown) => {
      expect(validatePublishTicket(ticket)?.document).toEqual({ note: 'note' });
      return { status: 'applied' as const };
    });
    const command: HistoryPublishCommand<{ id: string }, string> = { commandId: 'history.publish', operationId: 'operation', projectId: 'project', branchId: 'draft', expectedWorkingRevision: 4, actor: { id: 'human' }, payload: { candidateId: 'candidate', publicationId: 'publication', mergeCommitId: 'commit', metadata: { version: { major: 1, minor: 0, patch: 0 }, title: 'Version', rationale: 'Changes', ticketUrl: null }, evidence: [], expectedProjectRevision: 1 } };
    const ports = { getCandidate: () => candidate, conflictIds: () => [], issues: () => [], document: (note: string) => ({ note }), validateUuid: () => null, validateRevision: () => null, validateActor: () => null, publish };
    expect(await publishCandidate(ports, { ...command, projectId: 'wrong' })).toMatchObject({ status: 'invalid', issues: [{ path: ['projectId'] }] });
    expect(publish).not.toHaveBeenCalled();
    expect(await publishCandidate(ports, command)).toEqual({ status: 'applied' });
    expect(publish).toHaveBeenCalledOnce();
    const listRuns = vi.fn(async () => ['evidence']);
    const evaluate = vi.fn(() => ({ eligible: true }));
    const evaluation = { getCandidate: () => candidate, conflictIds: () => ['conflict'], issues: () => [], prepare: async () => ({ status: 'ready' as const, scenarios: ['note'] }), listRuns, evaluate };
    expect(await evaluateCandidateState(evaluation, 'candidate')).toMatchObject({ status: 'failed', code: 'conflict', eligible: false });
    expect(listRuns).not.toHaveBeenCalled();
    expect(await evaluateCandidateState({ ...evaluation, conflictIds: () => [] }, 'candidate')).toEqual({ status: 'done', eligible: true, evaluation: { eligible: true } });
    expect(evaluate).toHaveBeenCalledWith(['note'], ['evidence']);
  });

  it('prepares custom document merges through narrow version reads and rejects stale scope', async () => {
    type Merge = { readonly note: string; readonly conflicts: readonly string[] };
    const merge = vi.fn(async (base: string, ours: string, theirs: string): Promise<Merge> => ({ note: `${base}/${ours}/${theirs}`, conflicts: [] }));
    const service = new CandidateService<Merge, string>({ mintId: () => 'candidate', conflictIds: (value) => value.conflicts,
      resolve: async (value) => value, snapshotId: async (value) => `hash:${value.note}`, freeze: Object.freeze, resolutionError: () => null });
    const store = {
      loadProject: async () => ({ mainBranchId: 'main', initialSnapshotId: 'creation' }),
      loadBranch: async (_project: string, branch: string) => ({ id: branch, state: 'open', workingRevision: branch === 'main' ? 2 : 4, headCommitId: branch === 'main' ? null : 'head', workingSnapshotId: branch === 'main' ? 'creation' : 'source' }),
      loadCommit: async () => ({ id: 'head', parentIds: [], snapshotId: 'source' }),
      loadSnapshot: async (_project: string, snapshot: string) => ({ document: snapshot }),
    };
    const params = { projectId: 'project', sourceBranchId: 'draft', sourceRevision: 4, sourceHeadId: 'head', mainRevision: 2, mainHeadId: null };
    expect(await service.prepare({ store, merge }, { ...params, sourceRevision: 3 })).toEqual({ status: 'stale', scope: 'branch', expected: 3, actual: 4 });
    expect(merge).not.toHaveBeenCalled();
    expect(await service.prepare({ store, merge }, params)).toMatchObject({ status: 'done', value: { snapshotId: 'hash:creation/creation/source' } });
    expect(merge).toHaveBeenCalledWith('creation', 'creation', 'source');
    expect(service.get('candidate')).toMatchObject({ expectedSourceRevision: 4, expectedMainRevision: 2, mergeBase: { commitId: null, snapshotId: 'creation' } });
  });

  it('supersedes resolved candidates while preserving original content and branch tokens', async () => {
    type Merge = { readonly text: string; readonly conflicts: readonly string[] };
    const service = new CandidateService<Merge, string>({
      mintId: () => 'resolved', conflictIds: (merge) => merge.conflicts,
      resolve: async (_merge, _id, text) => ({ text, conflicts: [] }),
      snapshotId: async (merge) => `snapshot:${merge.text}`,
      freeze: Object.freeze, resolutionError: () => null,
    });
    const original: CandidateState<Merge> = {
      candidateId: 'original', projectId: 'project', sourceBranchId: 'draft', mainBranchId: 'main',
      expectedSourceRevision: 7, expectedSourceHeadId: 'draft-head', expectedMainRevision: 9, expectedMainHeadId: 'main-head',
      mergeBase: { commitId: 'base', snapshotId: 'base-snapshot' }, snapshotId: 'old-snapshot',
      mergeState: { text: 'old', conflicts: ['text'] }, superseded: false,
    };
    service.register(original);
    expect(await service.resolveConflict({ candidateId: 'original', conflictId: 'missing', resolution: 'new' })).toEqual({ status: 'missing', ids: ['missing'] });
    expect(service.get('original')?.superseded).toBe(false);
    const result = await service.resolveConflict({ candidateId: 'original', conflictId: 'text', resolution: 'new' });
    expect(result).toMatchObject({ status: 'done', value: { candidateId: 'resolved', snapshotId: 'snapshot:new', conflictIds: [] } });
    expect(service.get('original')).toMatchObject({ superseded: true, mergeState: { text: 'old' } });
    expect(service.get('resolved')).toMatchObject({ superseded: false, expectedSourceRevision: 7, expectedMainRevision: 9 });
    expect(await service.resolveConflict({ candidateId: 'original', conflictId: 'text', resolution: 'other' })).toMatchObject({ status: 'failed', code: 'ineligible' });
    expect(() => service.register(original)).toThrow('already exists');
  });

  it('uses one publication issuer across package and host, rejecting portable copies', () => {
    const ticket = mintPublishTicket({ candidateId: 'candidate', projectId: 'project', sourceBranchId: 'draft', mainBranchId: 'main', expectedSourceRevision: 1, expectedSourceHeadId: null, expectedMainRevision: 2, expectedMainHeadId: null, snapshotId: 'snapshot', document: { custom: { text: 'notes' } }, operationId: 'operation' });
    expect(validatePublishTicket(ticket)).toBe(validateHostTicket(ticket));
    expect(Object.isFrozen(ticket.document.custom)).toBe(true);
    expect(validatePublishTicket(JSON.parse(JSON.stringify(ticket)))).toBeNull();
    expect(validateHostTicket({ ...ticket })).toBeNull();
  });
});
