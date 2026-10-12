import { describe, expect, it, vi } from 'vitest';
vi.mock('dexie', () => { throw new Error('History composition imported Dexie'); });
vi.mock('react', () => { throw new Error('History composition imported React'); });
import { HistoryController, PublishController } from '@canvas-one/simulation-system-design/history';
import type { HistoryRepository, HistorySession } from '@canvas-one/simulation-system-design/history/contracts';

describe('headless simulation-gated history composition', () => {
  it('runs checkpoint behavior against host capabilities with host-authored interface copy', async () => {
    const branch = { projectId: 'project', id: 'draft', label: 'Draft', state: 'open' as const, headCommitId: null, workingSnapshotId: 'snapshot', workingRevision: 4, createdAt: 0 };
    const execute = vi.fn(async (_command: Parameters<HistoryRepository['execute']>[0]) => ({ status: 'applied' as const, operationId: 'operation', projectRevision: 2, branchRevision: 4, changedIds: [], undo: null, value: { kind: 'none' as const } }));
    const repository: HistoryRepository = {
      execute, loadHistory: async () => ({ project: { id: 'project', revision: 1, mainBranchId: 'main', initialSnapshotId: 'snapshot' }, branches: [branch], commits: [], checkpoints: [], publications: [], branchHistories: [] }),
      loadProject: async () => null, loadBranch: async () => branch, loadCommit: async () => null, loadSnapshot: async () => null,
      listRuns: async () => [], runsByFingerprint: async () => [], listPublications: async () => [], loadPublication: async () => null,
    };
    const openProject = vi.fn(async () => undefined);
    const session: HistorySession = { getState: () => ({ projectId: 'project', branchId: 'draft', workingRevision: 4, document: null }), undoStack: [{ label: 'Move' }], subscribe: () => () => undefined, openProject };
    const actor = { actorId: 'human', kind: 'local-human' as const, displayName: 'Reviewer' };
    const mapError = () => ({ status: 'failed' as const, code: 'unavailable' as const, issues: [] });
    const history = new HistoryController({ repository, session, actor, mintId: () => 'operation', mapError, workingEditsNotice: 'Local revisions' });
    await history.loadHistory();
    expect(history.getState()).toMatchObject({ status: 'ready', isMain: false, workingEdits: ['Move'], workingEditsNotice: 'Local revisions' });
    expect(await history.saveCheckpoint('Review checkpoint')).toMatchObject({ status: 'applied' });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][0]).toMatchObject({ commandId: 'history.checkpoint', expectedWorkingRevision: 4, payload: { label: 'Review checkpoint' } });
    expect(openProject).not.toHaveBeenCalled();
    const publication = new PublishController({ repository, session, actor, mintId: () => 'operation', mapError,
      candidateController: { get: () => null, prepare: async () => ({ status: 'missing', ids: ['candidate'] }), resolveConflict: async () => ({ status: 'missing', ids: ['candidate'] }), evaluate: async () => ({ status: 'missing', ids: ['candidate'], eligible: false }), publish: async () => ({ status: 'missing', ids: ['candidate'] }) },
      runScenario: async () => ({ status: 'cancelled' }),
    });
    expect(publication.getState().status).toBe('idle');
  });
});
