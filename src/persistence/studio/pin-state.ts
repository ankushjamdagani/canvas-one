/**
 * Bridges Dexie rows to the pure `computePinClosure` input.
 *
 * Single shared helper so retention (limits.ts), reference integrity and history reads
 * (repository.ts) all agree on one definition of "pinned": a run is pinned when a
 * retained commit references it, derived from the same pin closure as everything else.
 *
 * Reads only; callers decide the transaction scope. When called from inside an open
 * Dexie transaction (e.g. `db.transaction('rw', ..., async () => { ... })`), these table
 * reads join that transaction automatically (Dexie's zone tracking), giving one
 * consistent read.
 */

import type { StudioDatabase } from './db';
import type {
  BranchRecord,
  CheckpointRecord,
  CommitRecord,
  ProjectRecord,
  PublicationRecord,
  RunRecord,
} from './types';
import {
  computePinClosure,
  type PinClosureResult,
  type PinClosureState,
} from '../../domain/versioning/pin-closure';

type PinClosureRows = {
  readonly project: Pick<ProjectRecord, 'initialSnapshotId' | 'mainBranchId'>;
  readonly branches: readonly Pick<BranchRecord, 'id' | 'state' | 'headCommitId' | 'workingSnapshotId'>[];
  readonly commits: readonly Pick<CommitRecord, 'id' | 'snapshotId' | 'parentIds' | 'evidence'>[];
  readonly publications: readonly Pick<PublicationRecord, 'id' | 'commitId'>[];
  readonly checkpoints: readonly Pick<CheckpointRecord, 'id' | 'snapshotId'>[];
  readonly runs: readonly Pick<RunRecord, 'id' | 'snapshotId'>[];
};

/** Projects stored rows onto the plain shape `computePinClosure` reads. */
export function toPinClosureState(rows: PinClosureRows): PinClosureState {
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

/**
 * Loads the plain project state computePinClosure needs, or null if the project itself
 * does not exist.
 */
async function loadPinClosureState(
  db: StudioDatabase,
  projectId: string,
): Promise<PinClosureState | null> {
  const project = await db.projects.get(projectId);
  if (!project) return null;

  const [branches, commits, publications, checkpoints, runs] = await Promise.all([
    db.branches.where('projectId').equals(projectId).toArray(),
    db.commits.where('projectId').equals(projectId).toArray(),
    db.publications.where('projectId').equals(projectId).toArray(),
    db.checkpoints.where('projectId').equals(projectId).toArray(),
    db.runs.where('projectId').equals(projectId).toArray(),
  ]);

  return toPinClosureState({ project, branches, commits, publications, checkpoints, runs });
}

/**
 * Loads the project state and computes its pin closure in one step, or null if the
 * project does not exist.
 */
export async function computeProjectPinClosure(
  db: StudioDatabase,
  projectId: string,
): Promise<PinClosureResult | null> {
  const state = await loadPinClosureState(db, projectId);
  if (!state) return null;
  return computePinClosure(state);
}
