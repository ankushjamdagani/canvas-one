import {describe, expect, it} from 'vitest';
import {MemoryBackend} from '@canvas-one/storage';
import {enforceProjectLimits} from './limits';
import type {ProjectStorageRows} from './repository';
import type {StudioDatabase} from './db';

describe('transaction-scoped accounting bindings', () => {
  it('counts the active memory transaction without touching the IndexedDB handle', async () => {
    const names: (keyof ProjectStorageRows)[] = ['projects', 'branches', 'snapshots', 'operations', 'commits', 'publications', 'checkpoints', 'runs', 'parts', 'traceChunks'];
    const backend = new MemoryBackend<ProjectStorageRows>(names);
    const forbidden = new Proxy({} as StudioDatabase, {get() {throw new Error('Raw database reads are outside the scoped transaction');}});
    await backend.transaction(async stores => {
      await stores.checkpoints.add(['p', 'checkpoint'], {projectId: 'p', id: 'checkpoint', snapshotId: 'snapshot', sourceBranchId: 'branch', label: 'Checkpoint', actor: {actorId: 'test', displayName: 'Test', kind: 'local-human'}, createdAt: 1});
      expect(await enforceProjectLimits(forbidden, {projectId: 'p', additionalCheckpoints: 100}, stores)).toMatchObject({status: 'failed', code: 'limit'});
      expect(await enforceProjectLimits(forbidden, {projectId: 'p', additionalCheckpoints: 99, additionalLocalBytes: 1}, stores)).toBeNull();
    });
  });
});
