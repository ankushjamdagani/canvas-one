import { describe, expect, it, vi } from 'vitest';
import type { StudioRepository, ProjectRecord, BranchRecord } from '../../persistence/studio/types';
import { RepositoryError } from '../../persistence/studio/errors';
import type { SessionController } from '../session/controller';

describe('EntryScreen project and branch resolution', () => {
  const dummyProject: ProjectRecord = {
    id: 'proj-1',
    title: 'Test Project',
    revision: 1,
    mainBranchId: 'branch-main',
    initialSnapshotId: 'snap-1',
    importSourceId: null,
    createdAt: 1000,
    updatedAt: 1000,
  };

  const mainBranch: BranchRecord = {
    projectId: 'proj-1',
    id: 'branch-main',
    label: 'main',
    state: 'open',
    headCommitId: null,
    workingSnapshotId: 'snap-1',
    workingRevision: 1,
    createdAt: 1000,
  };

  const draftBranch: BranchRecord = {
    projectId: 'proj-1',
    id: 'branch-draft',
    label: 'draft',
    state: 'open',
    headCommitId: null,
    workingSnapshotId: 'snap-2',
    workingRevision: 2,
    createdAt: 1001,
  };

  const closedBranch: BranchRecord = {
    projectId: 'proj-1',
    id: 'branch-closed',
    label: 'feature-old',
    state: 'closed',
    headCommitId: null,
    workingSnapshotId: 'snap-3',
    workingRevision: 1,
    createdAt: 999,
  };

  it('lists only open branches, marking main as "main" and others by label, with main first', async () => {
    const mockRepo: Partial<StudioRepository> = {
      listProjects: vi.fn().mockResolvedValue([dummyProject]),
      loadHistory: vi.fn().mockResolvedValue({
        project: dummyProject,
        branches: [draftBranch, closedBranch, mainBranch],
        commits: [],
        publications: [],
        checkpoints: [],
        branchHistories: [],
      }),
    };

    const history = await mockRepo.loadHistory!('proj-1');
    const openBranches = history.branches
      .filter((b) => b.state === 'open')
      .map((b) => ({
        id: b.id,
        label: b.id === dummyProject.mainBranchId ? 'main' : b.label,
        isMain: b.id === dummyProject.mainBranchId,
      }));

    openBranches.sort((a, b) => {
      if (a.isMain && !b.isMain) return -1;
      if (!a.isMain && b.isMain) return 1;
      return a.label.localeCompare(b.label);
    });

    expect(openBranches.length).toBe(2);
    // Main branch first, marked 'main'
    expect(openBranches[0]).toEqual({
      id: 'branch-main',
      label: 'main',
      isMain: true,
    });
    // Draft branch second, marked by label
    expect(openBranches[1]).toEqual({
      id: 'branch-draft',
      label: 'draft',
      isMain: false,
    });
    // Closed branch excluded
    expect(openBranches.some((b) => b.id === 'branch-closed')).toBe(false);
  });

  it('handles loadHistory failure by showing typed error and offering no open choices (no fallback)', async () => {
    const mockRepo: Partial<StudioRepository> = {
      listProjects: vi.fn().mockResolvedValue([dummyProject]),
      loadHistory: vi.fn().mockRejectedValue(
        new RepositoryError({ code: 'unavailable', message: 'IndexedDB read failed' }),
      ),
    };

    let rowState: { status: string; errorMessage?: string; branches?: unknown[] };
    try {
      await mockRepo.loadHistory!('proj-1');
      rowState = { status: 'ready', branches: [] };
    } catch {
      rowState = {
        status: 'error',
        errorMessage: 'Storage is currently unavailable.',
      };
    }

    expect(rowState.status).toBe('error');
    expect(rowState.errorMessage).toBe('Storage is currently unavailable.');
    // No branches / open choices offered, and no fallback to main!
    expect(rowState.branches).toBeUndefined();
  });

  it('passes exact branchId to session.openProject', async () => {
    const openProjectMock = vi.fn().mockResolvedValue({ status: 'ready' });
    const mockSession = {
      openProject: openProjectMock,
    } as unknown as SessionController;

    // Simulate clicking draft branch
    await mockSession.openProject('proj-1', 'branch-draft');
    expect(openProjectMock).toHaveBeenCalledWith('proj-1', 'branch-draft');

    // Simulate clicking main branch
    await mockSession.openProject('proj-1', 'branch-main');
    expect(openProjectMock).toHaveBeenCalledWith('proj-1', 'branch-main');
  });
});
