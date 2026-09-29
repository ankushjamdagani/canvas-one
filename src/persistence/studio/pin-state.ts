/**
 * Bridges Dexie rows to the pure `computePinClosure` input (RV-08f).
 *
 * Single shared helper so retention (limits.ts), reference integrity and history reads
 * (repository.ts) all agree on exactly one definition of "pinned" -- per
 * specs/revamp/contracts/storage.md §7: "A run is pinned when a retained commit
 * references it," derived from the same pin closure as everything else, never a
 * second, independently-maintained notion of pinning.
 *
 * Reads only; callers decide the transaction scope. When called from inside an open
 * Dexie transaction (e.g. `db.transaction('rw', ..., async () => { ... })`), these table
 * reads join that transaction automatically (Dexie's zone tracking), giving one
 * consistent read.
 */

import type { StudioDatabase } from './db';
import {
  computePinClosure,
  type PinClosureResult,
  type PinClosureState,
} from '../../domain/versioning/pin-closure';

/**
 * Loads the plain project state computePinClosure needs, or null if the project itself
 * does not exist.
 */
export async function loadPinClosureState(
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

  return {
    project: {
      initialSnapshotId: project.initialSnapshotId,
      mainBranchId: project.mainBranchId,
    },
    branches: branches.map((b) => ({
      id: b.id,
      state: b.state,
      headCommitId: b.headCommitId,
      workingSnapshotId: b.workingSnapshotId,
    })),
    commits: commits.map((c) => ({
      id: c.id,
      snapshotId: c.snapshotId,
      parentIds: c.parentIds,
      evidence: c.evidence,
    })),
    publications: publications.map((p) => ({ id: p.id, commitId: p.commitId })),
    checkpoints: checkpoints.map((cp) => ({ id: cp.id, snapshotId: cp.snapshotId })),
    runs: runs.map((r) => ({ id: r.id, snapshotId: r.snapshotId })),
  };
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
