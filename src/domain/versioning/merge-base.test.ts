import { describe, it, expect } from 'vitest';
import { findMergeBase, type CommitLike } from './merge-base';

describe('findMergeBase: DAG ancestry merge base detection', () => {
  const INITIAL_SNAPSHOT = '0000000000000000000000000000000000000000000000000000000000000000';

  it('unborn: returns creation snapshot if either head is null', async () => {
    const commits: Record<string, CommitLike> = {
      c1: { id: 'c1', snapshotId: 'snap1', parentIds: [] },
    };
    const lookup = (id: string) => commits[id] ?? null;

    const res1 = await findMergeBase(lookup, null, 'c1', INITIAL_SNAPSHOT);
    expect(res1).toEqual({
      status: 'ok',
      commitId: null,
      snapshotId: INITIAL_SNAPSHOT,
    });

    const res2 = await findMergeBase(lookup, 'c1', null, INITIAL_SNAPSHOT);
    expect(res2).toEqual({
      status: 'ok',
      commitId: null,
      snapshotId: INITIAL_SNAPSHOT,
    });

    const res3 = await findMergeBase(lookup, null, null, INITIAL_SNAPSHOT);
    expect(res3).toEqual({
      status: 'ok',
      commitId: null,
      snapshotId: INITIAL_SNAPSHOT,
    });
  });

  it('linear: finds immediate ancestor in linear chain', async () => {
    const commits: Record<string, CommitLike> = {
      c0: { id: 'c0', snapshotId: 'snap0', parentIds: [] },
      c1: { id: 'c1', snapshotId: 'snap1', parentIds: ['c0'] },
      c2: { id: 'c2', snapshotId: 'snap2', parentIds: ['c1'] },
    };
    const lookup = (id: string) => commits[id] ?? null;

    const res = await findMergeBase(lookup, 'c2', 'c1', INITIAL_SNAPSHOT);
    expect(res).toEqual({
      status: 'ok',
      commitId: 'c1',
      snapshotId: 'snap1',
    });
  });

  it('linear: finds common root ancestor of branched chains', async () => {
    const commits: Record<string, CommitLike> = {
      c0: { id: 'c0', snapshotId: 'snap0', parentIds: [] },
      c1: { id: 'c1', snapshotId: 'snap1', parentIds: ['c0'] },
      c2: { id: 'c2', snapshotId: 'snap2', parentIds: ['c0'] },
    };
    const lookup = (id: string) => commits[id] ?? null;

    const res = await findMergeBase(lookup, 'c1', 'c2', INITIAL_SNAPSHOT);
    expect(res).toEqual({
      status: 'ok',
      commitId: 'c0',
      snapshotId: 'snap0',
    });
  });

  it('criss-cross ambiguous: detects multiple best common ancestors', async () => {
    // c0 splits into c1 and c2
    // c3 merges (c1, c2)
    // c4 merges (c1, c2)
    const commits: Record<string, CommitLike> = {
      c0: { id: 'c0', snapshotId: 'snap0', parentIds: [] },
      c1: { id: 'c1', snapshotId: 'snap1', parentIds: ['c0'] },
      c2: { id: 'c2', snapshotId: 'snap2', parentIds: ['c0'] },
      c3: { id: 'c3', snapshotId: 'snap3', parentIds: ['c1', 'c2'] },
      c4: { id: 'c4', snapshotId: 'snap4', parentIds: ['c1', 'c2'] },
    };
    const lookup = (id: string) => commits[id] ?? null;

    const res = await findMergeBase(lookup, 'c3', 'c4', INITIAL_SNAPSHOT);
    expect(res).toEqual({
      status: 'ambiguous-merge-base',
      commitIds: ['c1', 'c2'],
    });
  });

  it('main first commit M(0 parents) and branch first commit X(0 parents) -> creation snapshot', async () => {
    const commits: Record<string, CommitLike> = {
      M: { id: 'M', snapshotId: 'snapM', parentIds: [] },
      X: { id: 'X', snapshotId: 'snapX', parentIds: [] },
    };
    const lookup = (id: string) => commits[id] ?? null;

    const res = await findMergeBase(lookup, 'M', 'X', INITIAL_SNAPSHOT);
    expect(res).toEqual({
      status: 'ok',
      commitId: null,
      snapshotId: INITIAL_SNAPSHOT,
    });
  });

  it('lookup miss: returns missing with missing commit IDs', async () => {
    const commits: Record<string, CommitLike> = {
      c1: { id: 'c1', snapshotId: 'snap1', parentIds: ['cMissing'] },
    };
    const lookup = (id: string) => commits[id] ?? null;

    const res = await findMergeBase(lookup, 'c1', 'c1', INITIAL_SNAPSHOT);
    expect(res).toEqual({
      status: 'missing',
      commitIds: ['cMissing'],
    });
  });

  it('identical heads: returns head commit as base', async () => {
    const commits: Record<string, CommitLike> = {
      c1: { id: 'c1', snapshotId: 'snap1', parentIds: [] },
    };
    const lookup = (id: string) => commits[id] ?? null;

    const res = await findMergeBase(lookup, 'c1', 'c1', INITIAL_SNAPSHOT);
    expect(res).toEqual({
      status: 'ok',
      commitId: 'c1',
      snapshotId: 'snap1',
    });
  });
});
