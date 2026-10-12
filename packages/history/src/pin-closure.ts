/**
 * Pin closure: the snapshots, commits and runs that retention must keep. Pinned are the
 * creation snapshot, all branch head and working snapshots, commit ancestry and evidence,
 * publications, checkpoints, and snapshots referenced by any retained run. A snapshot is
 * released only after all references are rechecked inside an explicit prune transaction.
 *
 * Pure and deterministic: no I/O, no Date.now(), no randomness. Given a plain project
 * state (project + branches + commits + publications + checkpoints + runs), returns the
 * sets of pinned snapshot/commit/run IDs plus any dangling references discovered while
 * walking the graph. A dangling reference (a parent, head, publication or evidence run
 * that points at something absent from the given state) is always reported, never
 * silently dropped or fabricated.
 *
 * Limitation: this function only has the entity lists the caller passes in (no
 * snapshots table). It can therefore detect dangling commit parents/heads/publication
 * commits/evidence runs (all cross-checked against the given arrays), but it cannot by
 * itself detect a checkpoint or run pointing at a snapshot ID absent from the `snapshots`
 * table -- that requires the actual snapshot rows, which is exactly what
 * `verifyReferenceIntegrity` (repository.ts) additionally checks against storage.
 * computePinClosure reports dangling only for references it can resolve
 * against its own input; verifyReferenceIntegrity is the authority for snapshot existence
 * and content-hash corruption.
 */

export type PinClosureProject = {
  readonly initialSnapshotId: string;
  readonly mainBranchId: string;
};

export type PinClosureBranch = {
  readonly id: string;
  readonly state: 'open' | 'closed';
  readonly headCommitId: string | null;
  readonly workingSnapshotId: string;
};

export type PinClosureEvidenceRef = {
  readonly runId: string;
};

export type PinClosureCommit = {
  readonly id: string;
  readonly snapshotId: string;
  readonly parentIds: readonly string[];
  readonly evidence: readonly PinClosureEvidenceRef[];
};

export type PinClosurePublication = {
  readonly id: string;
  readonly commitId: string;
};

export type PinClosureCheckpoint = {
  readonly id: string;
  readonly snapshotId: string;
};

export type PinClosureRun = {
  readonly id: string;
  readonly snapshotId: string;
};

export type PinClosureState = {
  readonly project: PinClosureProject;
  readonly branches: readonly PinClosureBranch[];
  readonly commits: readonly PinClosureCommit[];
  readonly publications: readonly PinClosurePublication[];
  readonly checkpoints: readonly PinClosureCheckpoint[];
  readonly runs: readonly PinClosureRun[];
};

export type PinClosureDanglingKind = 'commit' | 'run';

export type PinClosureReferrer = {
  readonly kind: 'branch' | 'commit' | 'publication';
  readonly id: string;
};

export type PinClosureDangling = {
  readonly kind: PinClosureDanglingKind;
  readonly id: string;
  readonly referencedBy: PinClosureReferrer;
};

export type PinClosureResult = {
  /** Sorted, de-duplicated snapshot IDs that must be retained. */
  readonly pinnedSnapshotIds: readonly string[];
  /** Sorted, de-duplicated commit IDs reachable from any branch head or publication. */
  readonly pinnedCommitIds: readonly string[];
  /** Sorted, de-duplicated run IDs referenced as evidence by a retained commit. */
  readonly pinnedRunIds: readonly string[];
  /** Every dangling reference discovered while walking the graph, deterministically ordered. */
  readonly dangling: readonly PinClosureDangling[];
};

function danglingSortKey(d: PinClosureDangling): string {
  return `${d.kind}\u0000${d.id}\u0000${d.referencedBy.kind}\u0000${d.referencedBy.id}`;
}

/**
 * Computes the pin closure for a project's history.
 */
export function computePinClosure(state: PinClosureState): PinClosureResult {
  const commitById = new Map<string, PinClosureCommit>();
  for (const commit of state.commits) {
    commitById.set(commit.id, commit);
  }
  const runById = new Map<string, PinClosureRun>();
  for (const run of state.runs) {
    runById.set(run.id, run);
  }

  const pinnedSnapshotIds = new Set<string>();
  const pinnedCommitIds = new Set<string>();
  const pinnedRunIds = new Set<string>();
  const dangling: PinClosureDangling[] = [];
  const seenDangling = new Set<string>();

  function addDangling(entry: PinClosureDangling): void {
    const key = danglingSortKey(entry);
    if (seenDangling.has(key)) return;
    seenDangling.add(key);
    dangling.push(entry);
  }

  function pinEvidenceRuns(commit: PinClosureCommit): void {
    for (const ref of commit.evidence) {
      const run = runById.get(ref.runId);
      if (!run) {
        addDangling({
          kind: 'run',
          id: ref.runId,
          referencedBy: { kind: 'commit', id: commit.id },
        });
        continue;
      }
      pinnedRunIds.add(run.id);
    }
  }

  // Commit ancestry walk (DFS over parentIds; merge parents deduplicated by visited set).
  // Each stack entry carries the referrer that pointed at it (the branch/publication for
  // the head, or the child commit for a parent), so a dangling reference is attributed to
  // whatever actually named the missing ID.
  function walkAncestry(startCommitId: string | null, referrer: PinClosureReferrer): void {
    if (startCommitId === null) return;
    const stack: { commitId: string; referrer: PinClosureReferrer }[] = [
      { commitId: startCommitId, referrer },
    ];
    while (stack.length > 0) {
      const { commitId, referrer: entryReferrer } = stack.pop()!;
      if (pinnedCommitIds.has(commitId)) continue;
      const commit = commitById.get(commitId);
      if (!commit) {
        addDangling({ kind: 'commit', id: commitId, referencedBy: entryReferrer });
        continue;
      }
      pinnedCommitIds.add(commit.id);
      pinnedSnapshotIds.add(commit.snapshotId);
      pinEvidenceRuns(commit);
      for (const parentId of commit.parentIds) {
        stack.push({ commitId: parentId, referrer: { kind: 'commit', id: commit.id } });
      }
    }
  }

  // Creation snapshot: always pinned.
  pinnedSnapshotIds.add(state.project.initialSnapshotId);

  // Every branch's head and working snapshots, plus commit ancestry of every branch head.
  for (const branch of state.branches) {
    pinnedSnapshotIds.add(branch.workingSnapshotId);
    walkAncestry(branch.headCommitId, { kind: 'branch', id: branch.id });
  }

  // Publications' commits (defensive: normally already reachable via main's ancestry,
  // but publications are pinned in their own right).
  for (const publication of state.publications) {
    walkAncestry(publication.commitId, { kind: 'publication', id: publication.id });
  }

  // Checkpoints' snapshots.
  for (const checkpoint of state.checkpoints) {
    pinnedSnapshotIds.add(checkpoint.snapshotId);
  }

  // Snapshots referenced by any retained run (a run pinned via commit evidence above).
  // Snapshots referenced by any retained run: every stored run is
  // retained until an explicit prune removes it, pinned or not.
  for (const run of state.runs) {
    pinnedSnapshotIds.add(run.snapshotId);
  }

  dangling.sort((a, b) => {
    const ka = danglingSortKey(a);
    const kb = danglingSortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return {
    pinnedSnapshotIds: Array.from(pinnedSnapshotIds).sort(),
    pinnedCommitIds: Array.from(pinnedCommitIds).sort(),
    pinnedRunIds: Array.from(pinnedRunIds).sort(),
    dangling,
  };
}
