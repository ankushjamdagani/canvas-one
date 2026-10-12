import { toPinClosureState } from '@canvas-one/history';
export { toPinClosureState };
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
import {collectProjectRows, type TransactionStores} from '@canvas-one/storage';
import type {ProjectStorageRows} from './repository';
import {
  computePinClosure,
  type PinClosureResult,
  type PinClosureState,
} from '../../domain/versioning/pin-closure';

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

export async function computeProjectPinClosureFromStores(stores: TransactionStores<ProjectStorageRows>, projectId: string): Promise<PinClosureResult | null> {
  const project = await stores.projects.get(projectId);
  if (!project) return null;
  const [branches, commits, publications, checkpoints, runs] = await Promise.all([
    collectProjectRows(stores.branches, projectId), collectProjectRows(stores.commits, projectId),
    collectProjectRows(stores.publications, projectId), collectProjectRows(stores.checkpoints, projectId),
    collectProjectRows(stores.runs, projectId),
  ]);
  return computePinClosure(toPinClosureState({project, branches, commits, publications, checkpoints, runs}));
}
