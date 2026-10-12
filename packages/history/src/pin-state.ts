import type { PinClosureState } from './pin-closure.js';

/** Projects storage or portable records onto history retention contracts. */
export function toPinClosureState(rows: PinClosureState): PinClosureState {
  return {
    project: {
      initialSnapshotId: rows.project.initialSnapshotId,
      mainBranchId: rows.project.mainBranchId,
    },
    branches: rows.branches.map((b) => ({
      id: b.id,
      state: b.state,
      headCommitId: b.headCommitId,
      workingSnapshotId: b.workingSnapshotId,
    })),
    commits: rows.commits.map((c) => ({
      id: c.id,
      snapshotId: c.snapshotId,
      parentIds: c.parentIds,
      evidence: c.evidence,
    })),
    publications: rows.publications.map((p) => ({ id: p.id, commitId: p.commitId })),
    checkpoints: rows.checkpoints.map((cp) => ({ id: cp.id, snapshotId: cp.snapshotId })),
    runs: rows.runs.map((r) => ({ id: r.id, snapshotId: r.snapshotId })),
  };
}
