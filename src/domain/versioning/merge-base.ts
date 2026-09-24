/**
 * Merge base detection in commit DAG (RV-08c).
 *
 * Implements:
 * - specs/revamp/contracts/storage.md §2 (Ancestry and Creation snapshot bullets)
 * - specs/revamp/contracts/transactions.md §4 & §5
 * - DAG ancestry only (parentIds).
 * - If either head is null (unborn), the base is the creation snapshot.
 * - Otherwise the best common ancestors (Lowest Common Ancestors in DAG).
 * - More than one best common ancestor -> { status: 'ambiguous-merge-base', commitIds }.
 * - When heads share no common commit, the creation snapshot is the implicit common root ({ status: 'ok', commitId: null, snapshotId: initialSnapshotId }).
 * - A lookup miss -> { status: 'missing', commitIds }.
 * - Never use titles or timestamps.
 */

import type { Id } from '../studio/model';

export type CommitLike = {
  readonly id: Id;
  readonly snapshotId: string;
  readonly parentIds: readonly Id[];
};

export type CommitLookup = (
  commitId: Id,
) => Promise<CommitLike | null> | CommitLike | null;

export type MergeBaseSuccess = {
  readonly status: 'ok';
  readonly commitId: Id | null;
  readonly snapshotId: string;
};

export type MergeBaseAmbiguous = {
  readonly status: 'ambiguous-merge-base';
  readonly commitIds: readonly Id[];
};

export type MergeBaseMissing = {
  readonly status: 'missing';
  readonly commitIds?: readonly Id[];
};

export type MergeBaseResult =
  | MergeBaseSuccess
  | MergeBaseAmbiguous
  | MergeBaseMissing;

/**
 * Finds the merge base between ours and theirs commit heads using DAG ancestry only.
 */
export async function findMergeBase(
  lookupCommit: CommitLookup,
  oursHeadId: Id | null,
  theirsHeadId: Id | null,
  initialSnapshotId: string,
): Promise<MergeBaseResult> {
  // If either head is null (unborn), the base is the creation snapshot
  if (oursHeadId === null || theirsHeadId === null) {
    return {
      status: 'ok',
      commitId: null,
      snapshotId: initialSnapshotId,
    };
  }

  const commitCache = new Map<Id, CommitLike>();
  const missingCommitIds = new Set<Id>();

  async function fetchCommit(id: Id): Promise<CommitLike | null> {
    if (commitCache.has(id)) {
      return commitCache.get(id)!;
    }
    const res = await lookupCommit(id);
    if (!res) {
      missingCommitIds.add(id);
      return null;
    }
    commitCache.set(id, res);
    return res;
  }

  // Traverses all ancestors reachable from headId (including headId itself)
  async function collectAncestors(headId: Id): Promise<Set<Id>> {
    const visited = new Set<Id>();
    const queue: Id[] = [headId];

    while (queue.length > 0) {
      const currId = queue.shift()!;
      if (visited.has(currId)) continue;

      const commit = await fetchCommit(currId);
      if (!commit) {
        continue;
      }
      visited.add(currId);

      for (const parentId of commit.parentIds) {
        if (!visited.has(parentId)) {
          queue.push(parentId);
        }
      }
    }
    return visited;
  }

  const ancestorsOurs = await collectAncestors(oursHeadId);
  const ancestorsTheirs = await collectAncestors(theirsHeadId);

  // If any lookup misses occurred during traversal
  if (missingCommitIds.size > 0) {
    return {
      status: 'missing',
      commitIds: Array.from(missingCommitIds).sort(),
    };
  }

  // Find common ancestors
  const commonAncestors = new Set<Id>();
  for (const id of ancestorsOurs) {
    if (ancestorsTheirs.has(id)) {
      commonAncestors.add(id);
    }
  }

  if (commonAncestors.size === 0) {
    // Both heads are born and their commit ancestries share no common commit.
    // The creation snapshot is the implicit common root that every 0-parent commit descends from
    // (storage.md: it is the merge base for unborn branches, and every branch forks from it).
    return {
      status: 'ok',
      commitId: null,
      snapshotId: initialSnapshotId,
    };
  }

  // Find "best" common ancestors (those that are not proper ancestors of any other common ancestor)
  const dominated = new Set<Id>();

  for (const caId of commonAncestors) {
    const commit = commitCache.get(caId)!;
    const queue = [...commit.parentIds];
    const visited = new Set<Id>();

    while (queue.length > 0) {
      const pId = queue.shift()!;
      if (visited.has(pId)) continue;
      visited.add(pId);

      if (commonAncestors.has(pId)) {
        dominated.add(pId);
      }

      const pCommit = commitCache.get(pId);
      if (pCommit) {
        for (const gpId of pCommit.parentIds) {
          if (!visited.has(gpId)) {
            queue.push(gpId);
          }
        }
      }
    }
  }

  const bestCommonAncestors = Array.from(commonAncestors).filter((id) => !dominated.has(id));

  if (bestCommonAncestors.length === 1) {
    const singleId = bestCommonAncestors[0];
    const commit = commitCache.get(singleId)!;
    return {
      status: 'ok',
      commitId: singleId,
      snapshotId: commit.snapshotId,
    };
  }

  if (bestCommonAncestors.length > 1) {
    return {
      status: 'ambiguous-merge-base',
      commitIds: bestCommonAncestors.sort(),
    };
  }

  return {
    status: 'missing',
  };
}
