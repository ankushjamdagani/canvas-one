/**
 * Tests for computePinClosure (RV-08f).
 *
 * Implements specs/revamp/contracts/storage.md §7 (Retention "Pin closure" bullet).
 * Hand-built plain project states; no I/O.
 */

import { describe, expect, it } from 'vitest';
import {
  computePinClosure,
  type PinClosureBranch,
  type PinClosureCommit,
  type PinClosureState,
} from './pin-closure';

function baseState(overrides: Partial<PinClosureState> = {}): PinClosureState {
  return {
    project: { initialSnapshotId: 'snap-genesis', mainBranchId: 'main' },
    branches: [],
    commits: [],
    publications: [],
    checkpoints: [],
    runs: [],
    ...overrides,
  };
}

describe('computePinClosure', () => {
  it('unborn project: only the creation snapshot and branch working snapshots are pinned', () => {
    const mainBranch: PinClosureBranch = {
      id: 'main',
      state: 'open',
      headCommitId: null,
      workingSnapshotId: 'snap-genesis',
    };
    const draftBranch: PinClosureBranch = {
      id: 'draft',
      state: 'open',
      headCommitId: null,
      workingSnapshotId: 'snap-genesis',
    };
    const result = computePinClosure(baseState({ branches: [mainBranch, draftBranch] }));

    expect(result.pinnedSnapshotIds).toEqual(['snap-genesis']);
    expect(result.pinnedCommitIds).toEqual([]);
    expect(result.pinnedRunIds).toEqual([]);
    expect(result.dangling).toEqual([]);
  });

  it('linear history: every commit and snapshot on the chain is pinned, plus evidence runs', () => {
    const c1: PinClosureCommit = {
      id: 'c1',
      snapshotId: 'snap-1',
      parentIds: [],
      evidence: [{ runId: 'run-1' }],
    };
    const c2: PinClosureCommit = {
      id: 'c2',
      snapshotId: 'snap-2',
      parentIds: ['c1'],
      evidence: [{ runId: 'run-2' }],
    };
    const main: PinClosureBranch = {
      id: 'main',
      state: 'open',
      headCommitId: 'c2',
      workingSnapshotId: 'snap-2',
    };

    const result = computePinClosure(
      baseState({
        branches: [main],
        commits: [c1, c2],
        runs: [
          { id: 'run-1', snapshotId: 'snap-1' },
          { id: 'run-2', snapshotId: 'snap-2' },
        ],
      }),
    );

    expect(result.pinnedCommitIds).toEqual(['c1', 'c2']);
    expect(result.pinnedSnapshotIds).toEqual(['snap-1', 'snap-2', 'snap-genesis']);
    expect(result.pinnedRunIds).toEqual(['run-1', 'run-2']);
    expect(result.dangling).toEqual([]);
  });

  it('merge commit: both parents and their ancestry are pinned, deduplicated', () => {
    const base: PinClosureCommit = { id: 'base', snapshotId: 'snap-base', parentIds: [], evidence: [] };
    const left: PinClosureCommit = { id: 'left', snapshotId: 'snap-left', parentIds: ['base'], evidence: [] };
    const right: PinClosureCommit = { id: 'right', snapshotId: 'snap-right', parentIds: ['base'], evidence: [] };
    const merge: PinClosureCommit = {
      id: 'merge',
      snapshotId: 'snap-merge',
      parentIds: ['left', 'right'],
      evidence: [],
    };
    const main: PinClosureBranch = {
      id: 'main',
      state: 'open',
      headCommitId: 'merge',
      workingSnapshotId: 'snap-merge',
    };

    const result = computePinClosure(
      baseState({ branches: [main], commits: [base, left, right, merge] }),
    );

    expect(result.pinnedCommitIds).toEqual(['base', 'left', 'merge', 'right']);
    expect(result.pinnedSnapshotIds).toEqual([
      'snap-base',
      'snap-genesis',
      'snap-left',
      'snap-merge',
      'snap-right',
    ]);
    expect(result.dangling).toEqual([]);
  });

  it('closed branch: its head ancestry stays pinned even though the branch is closed', () => {
    const c1: PinClosureCommit = { id: 'c1', snapshotId: 'snap-1', parentIds: [], evidence: [] };
    const closedBranch: PinClosureBranch = {
      id: 'feature',
      state: 'closed',
      headCommitId: 'c1',
      workingSnapshotId: 'snap-1-working',
    };

    const result = computePinClosure(baseState({ branches: [closedBranch], commits: [c1] }));

    expect(result.pinnedCommitIds).toEqual(['c1']);
    expect(result.pinnedSnapshotIds).toEqual(['snap-1', 'snap-1-working', 'snap-genesis']);
  });

  it('dangling parent: a missing ancestor is reported, never silently skipped', () => {
    const orphan: PinClosureCommit = {
      id: 'orphan',
      snapshotId: 'snap-orphan',
      parentIds: ['ghost-parent'],
      evidence: [],
    };
    const main: PinClosureBranch = {
      id: 'main',
      state: 'open',
      headCommitId: 'orphan',
      workingSnapshotId: 'snap-orphan',
    };

    const result = computePinClosure(baseState({ branches: [main], commits: [orphan] }));

    expect(result.pinnedCommitIds).toEqual(['orphan']);
    expect(result.dangling).toEqual([
      { kind: 'commit', id: 'ghost-parent', referencedBy: { kind: 'commit', id: 'orphan' } },
    ]);
  });

  it('dangling branch head: a head pointing at a missing commit is reported', () => {
    const main: PinClosureBranch = {
      id: 'main',
      state: 'open',
      headCommitId: 'missing-head',
      workingSnapshotId: 'snap-genesis',
    };

    const result = computePinClosure(baseState({ branches: [main] }));

    expect(result.pinnedCommitIds).toEqual([]);
    expect(result.dangling).toEqual([
      { kind: 'commit', id: 'missing-head', referencedBy: { kind: 'branch', id: 'main' } },
    ]);
  });

  it('dangling evidence run: a commit referencing a missing run is reported and not pinned', () => {
    const c1: PinClosureCommit = {
      id: 'c1',
      snapshotId: 'snap-1',
      parentIds: [],
      evidence: [{ runId: 'ghost-run' }],
    };
    const main: PinClosureBranch = {
      id: 'main',
      state: 'open',
      headCommitId: 'c1',
      workingSnapshotId: 'snap-1',
    };

    const result = computePinClosure(baseState({ branches: [main], commits: [c1] }));

    expect(result.pinnedRunIds).toEqual([]);
    expect(result.dangling).toEqual([
      { kind: 'run', id: 'ghost-run', referencedBy: { kind: 'commit', id: 'c1' } },
    ]);
  });

  it('checkpoints pin their snapshot independently of any commit', () => {
    const result = computePinClosure(
      baseState({ checkpoints: [{ id: 'cp1', snapshotId: 'snap-checkpoint' }] }),
    );
    expect(result.pinnedSnapshotIds).toEqual(['snap-checkpoint', 'snap-genesis']);
  });

  it('is deterministic: repeated calls on the same state produce identical sorted output', () => {
    const c1: PinClosureCommit = {
      id: 'c1',
      snapshotId: 'snap-1',
      parentIds: [],
      evidence: [{ runId: 'run-1' }],
    };
    const main: PinClosureBranch = {
      id: 'main',
      state: 'open',
      headCommitId: 'c1',
      workingSnapshotId: 'snap-1',
    };
    const state = baseState({
      branches: [main],
      commits: [c1],
      runs: [{ id: 'run-1', snapshotId: 'snap-1' }],
    });

    const a = computePinClosure(state);
    const b = computePinClosure(state);
    expect(a).toEqual(b);
  });
  it('retained unpinned runs still pin their snapshots', () => {
    const state = baseState({
      runs: [{ id: 'run-free', snapshotId: 'snap-run-only' }],
    });
    const result = computePinClosure(state);
    expect(result.pinnedRunIds).toEqual([]);
    expect(result.pinnedSnapshotIds).toContain('snap-run-only');
  });
});
