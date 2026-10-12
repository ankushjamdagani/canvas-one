import type { BranchRecord } from './records.js';

export type HistoryProject = { readonly revision: number; readonly updatedAt: number };
function nextRevision(value: number): number {
  const next = value + 1;
  if (!Number.isSafeInteger(next) || next < 1) throw new RangeError('History revision limit reached');
  return next;
}
/** Pure history effects. The host validates actors/evidence; storage commits these plans atomically. */
export class HistoryTransitionPlanner {
  project<Project extends HistoryProject>(project: Project, now: number): Project {
    return { ...project, revision: nextRevision(project.revision), updatedAt: now };
  }
  fork(source: BranchRecord, input: { readonly id: string; readonly label: string; readonly snapshotId: string; readonly headCommitId: string | null; readonly now: number }): BranchRecord {
    return { projectId: source.projectId, id: input.id, label: input.label, state: 'open', headCommitId: input.headCommitId,
      workingSnapshotId: input.snapshotId, workingRevision: 0, createdAt: input.now };
  }
  restore(branch: BranchRecord, snapshotId: string): BranchRecord {
    return { ...branch, workingSnapshotId: snapshotId, workingRevision: nextRevision(branch.workingRevision) };
  }
  reopen(branch: BranchRecord): BranchRecord {
    return { ...branch, state: 'open', workingRevision: nextRevision(branch.workingRevision) };
  }
  commit(branch: BranchRecord, commitId: string): BranchRecord {
    return { ...branch, headCommitId: commitId, workingRevision: nextRevision(branch.workingRevision) };
  }
  publish(main: BranchRecord, source: BranchRecord, input: { readonly commitId: string; readonly snapshotId: string; readonly keepSourceOpen: boolean }): {
    readonly main: BranchRecord; readonly source: BranchRecord;
  } {
    return {
      main: { ...main, headCommitId: input.commitId, workingSnapshotId: input.snapshotId, workingRevision: nextRevision(main.workingRevision) },
      source: { ...source, state: input.keepSourceOpen ? 'open' : 'closed', workingRevision: nextRevision(source.workingRevision) },
    };
  }
  publicationParents(main: BranchRecord, source: BranchRecord): readonly string[] {
    if (source.headCommitId === null) throw new TypeError('Publication requires a committed source head');
    return main.headCommitId === null || main.headCommitId === source.headCommitId
      ? [source.headCommitId] : [main.headCommitId, source.headCommitId];
  }
}
