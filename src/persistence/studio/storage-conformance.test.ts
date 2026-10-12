import 'fake-indexeddb/auto';
import type { Dexie } from 'dexie';
import { readFile } from 'node:fs/promises';
import { createStudioDatabase } from './db';
import { LocalRepository } from './repository';
import type { ModelApplyRecordsCommand } from './types';
import type { Document } from '@canvas-one/system-design';
import { describe, expect, it } from 'vitest';
import { AtomicDocumentCoordinator, AtomicOperationCoordinator, ArtifactPruningCoordinator, ImmutableArtifactCoordinator, MemoryBackend, PreferenceService, ProjectCatalog, ProjectCatalogReader, ProjectLifecycleCoordinator, collectProjectRows, checkReceipt, insertImmutable, type PreferenceRecord, type CatalogProject, type CatalogRows, type TransactionStore, type AtomicBackend, type OperationReceipt } from '@canvas-one/storage';
import { IndexedDbBackend, IndexedDbDatabase } from '@canvas-one/storage-indexeddb';

type Rows = { documents: { revision: number; text: string }; operations: OperationReceipt<number> };
for (const kind of ['memory', 'indexeddb'] as const) {
  it(`${kind} reads only the selected project through bounded composite-key pages`, async () => {
    type ScopedRows = {rows: {projectId: string; value: number}};
    const backend = kind === 'memory' ? new MemoryBackend<ScopedRows>(['rows']) : new IndexedDbBackend<ScopedRows>(`scoped-reader-${crypto.randomUUID()}`, ['rows']);
    try {
      await backend.transaction(async stores => {
        await stores.rows.add(['a', 'before'], {projectId: 'a', value: 0});
        for (let value = 1; value <= 3; value++) await stores.rows.add(['p', `row-${value}`], {projectId: 'p', value});
        await stores.rows.add(['q', 'after'], {projectId: 'q', value: 4});
        expect(await collectProjectRows(stores.rows, 'p', 2)).toEqual([{projectId: 'p', value: 1}, {projectId: 'p', value: 2}, {projectId: 'p', value: 3}]);
        expect(await collectProjectRows(stores.rows, 'missing', 2)).toEqual([]);
      });
    } finally {if (backend instanceof IndexedDbBackend) await backend.database.delete();}
  });
  it(`${kind} prepared history operations replay before planning and roll all rows back on immutable collision`, async () => {
    type HistoryRows = CatalogRows<CatalogProject> & { checkpoints: { text: string } };
    const backend = kind === 'memory' ? new MemoryBackend<HistoryRows>(['projects', 'operations', 'checkpoints'])
      : new IndexedDbBackend<HistoryRows>(`history-operation-${crypto.randomUUID()}`, ['projects', 'operations', 'checkpoints']);
    const coordinator = new AtomicOperationCoordinator<HistoryRows, string>({ backend,
      policy: { equal: (_store, a, b) => JSON.stringify(a) === JSON.stringify(b), collision: () => new Error('collision') },
      decodeReceipt: value => value as string, reused: () => 'reused', failed: error => (error as Error).message });
    const identity = { projectId: 'p', operationId: 'op', requestHash: 'hash' };
    const project: CatalogProject = { id: 'p', title: 'Original', revision: 0, createdAt: 1, updatedAt: 1 };
    try {
      await backend.transaction(async stores => { await stores.projects.add('p', project); await stores.checkpoints.add('cp', { text: 'old' }); });
      expect(await coordinator.execute(identity, async () => ({ result: 'applied', writes: [
        { kind: 'update', store: 'projects', key: 'p', row: { ...project, revision: 1 } },
        { kind: 'immutable', store: 'checkpoints', key: 'cp', row: { text: 'conflict' } },
      ] }))).toBe('collision');
      await backend.transaction(async stores => { expect((await stores.projects.get('p'))?.revision).toBe(0); expect(await stores.operations.get(['p', 'op'])).toBeUndefined(); });
      expect(await coordinator.execute(identity, async () => 'rejected')).toBe('rejected');
      expect(await coordinator.execute(identity, async () => ({ result: 'applied', writes: [
        { kind: 'update', store: 'projects', key: 'p', row: { ...project, revision: 1 } },
        { kind: 'immutable', store: 'checkpoints', key: 'cp', row: { text: 'old' } },
      ] }))).toBe('applied');
      expect(await coordinator.execute(identity, async () => { throw new Error('must not plan retry'); })).toBe('applied');
      expect(await coordinator.execute({ ...identity, requestHash: 'changed' }, async () => { throw new Error('must not plan reused identity'); })).toBe('reused');
      await backend.transaction(async stores => { await stores.projects.update('missing', { title: 'absent' }); expect(await stores.projects.get('missing')).toBeUndefined(); expect((await stores.projects.get('p'))?.revision).toBe(1); });
    } finally { if (backend instanceof IndexedDbBackend) await backend.database.delete(); }
  });
}
for (const kind of ['memory', 'indexeddb'] as const) {
  it(`${kind} pruning protects live references and drains bounded trace pages atomically`, async () => {
    type PruneRows = { projects: CatalogProject; runs: { projectId: string; id: string; traceState: string; summary: string }; snapshots: { text: string }; traceChunks: { projectId: string; runId: string; index: number } };
    const names = ['projects', 'runs', 'snapshots', 'traceChunks'] as const;
    const indexes = { traceChunks: [{ name: 'run', keyPath: ['projectId', 'runId'] }] };
    const backend = kind === 'memory' ? new MemoryBackend<PruneRows>(names, indexes)
      : new IndexedDbBackend<PruneRows>(`pruning-${crypto.randomUUID()}`, names, indexes);
    const request = { projectId: 'p', expectedProjectRevision: 0, selection: { runIds: [], traceRunIds: ['r'], snapshotIds: [] } };
    const options = { backend, traceIndex: 'run', pageSize: 2, missing: () => 'missing', stale: () => 'stale', failed: () => 'failed', applied: () => 'applied', protect: async () => null };
    try {
      await backend.transaction(async stores => {
        await stores.projects.add('p', { id: 'p', title: 'P', revision: 0, createdAt: 1, updatedAt: 1 });
        await stores.runs.add(['p', 'r'], { projectId: 'p', id: 'r', traceState: 'complete', summary: 'evidence' });
        for (let index = 0; index < 3; index++) await stores.traceChunks.add(['p', 'r', index], { projectId: 'p', runId: 'r', index });
        const range = await stores.traceChunks.queryRange('run', ['p', 'r'], ['p', 'r'], 2);
        expect(range.entries).toHaveLength(2); expect(range.truncated).toBe(true);
      });
      expect(await new ArtifactPruningCoordinator<PruneRows, string>({ ...options, protect: async () => 'protected' }).prune(request)).toBe('protected');
      expect(await new ArtifactPruningCoordinator<PruneRows, string>({ ...options, applied: () => { throw new Error('rollback after mutation'); } }).prune(request)).toBe('failed');
      await backend.transaction(async stores => { expect((await stores.projects.get('p'))?.revision).toBe(0); expect((await stores.traceChunks.query('run', ['p', 'r'], 2)).truncated).toBe(true); });
      const coordinator = new ArtifactPruningCoordinator<PruneRows, string>(options);
      expect(await coordinator.prune(request)).toBe('applied');
      expect(await coordinator.prune(request)).toBe('stale');
      await backend.transaction(async stores => { expect((await stores.projects.get('p'))?.revision).toBe(1); expect(await stores.runs.get(['p', 'r'])).toMatchObject({ traceState: 'pruned', summary: 'evidence' }); expect((await stores.traceChunks.query('run', ['p', 'r'], 1000)).entries).toEqual([]); });
    } finally { if (backend instanceof IndexedDbBackend) await backend.database.delete(); }
  });
}
for (const kind of ['memory', 'indexeddb'] as const) {
  it(`${kind} artifact batches preserve existing content and roll back all participants on collision`, async () => {
    type Artifacts = { snapshots: { text: string }; runs: { snapshot: string }; chunks: { events: number[] } };
    const backend = kind === 'memory' ? new MemoryBackend<Artifacts>(['snapshots', 'runs', 'chunks'])
      : new IndexedDbBackend<Artifacts>(`artifact-${crypto.randomUUID()}`, ['snapshots', 'runs', 'chunks']);
    const coordinator = new ImmutableArtifactCoordinator<Artifacts, string>({ backend,
      policy: { equal: (_store, left, right) => JSON.stringify(left) === JSON.stringify(right), collision: () => new Error('immutable collision') },
      failed: error => (error as Error).message });
    try {
      await backend.transaction(stores => stores.chunks.add(['p', 'r', 0], { events: [1] }));
      expect(await coordinator.save([
        { store: 'snapshots', key: ['p', 's'], row: { text: 'original' } },
        { store: 'runs', key: ['p', 'r'], row: { snapshot: 's' } },
        { store: 'chunks', key: ['p', 'r', 0], row: { events: [2] } },
      ], () => 'saved')).toBe('immutable collision');
      await backend.transaction(async stores => { expect(await stores.snapshots.get(['p', 's'])).toBeUndefined(); expect(await stores.runs.get(['p', 'r'])).toBeUndefined(); expect(await stores.chunks.get(['p', 'r', 0])).toEqual({ events: [1] }); });
      const events = [3];
      const save = coordinator.save([
        { store: 'snapshots', key: ['p', 's'], row: { text: 'original' } },
        { store: 'runs', key: ['p', 'r'], row: { snapshot: 's' } },
        { store: 'chunks', key: ['p', 'r', 1], row: { events } },
      ], () => 'saved');
      events.push(4);
      expect(await save).toBe('saved');
      expect(await coordinator.save([{ store: 'snapshots', key: ['p', 's'], row: { text: 'original' } }], () => 'replay')).toBe('replay');
      await backend.transaction(async stores => { expect(await stores.chunks.get(['p', 'r', 1])).toEqual({ events: [3] }); });
    } finally { if (backend instanceof IndexedDbBackend) await backend.database.delete(); }
  });
}
for (const kind of ['memory', 'indexeddb'] as const) {
  it(`${kind} lifecycle owns receipt/CAS and rolls domain participants back atomically`, async () => {
    type LifecycleRows = { projects: CatalogProject; operations: OperationReceipt<unknown>; children: { owner: string } };
    const backend = kind === 'memory' ? new MemoryBackend<LifecycleRows>(['projects', 'operations', 'children'])
      : new IndexedDbBackend<LifecycleRows>(`lifecycle-${crypto.randomUUID()}`, ['projects', 'operations', 'children']);
    const coordinator = new ProjectLifecycleCoordinator<LifecycleRows, string>({ backend, now: () => 1,
      missing: () => 'missing', stale: () => 'stale', reused: () => 'reused', decodeReceipt: value => value as string, failed: () => 'failed' });
    const identity = { projectId: 'p', operationId: 'create', requestHash: 'create-hash' };
    const project: CatalogProject = { id: 'p', title: 'Original', revision: 0, createdAt: 1, updatedAt: 1 };
    try {
      expect(await coordinator.create(identity, project, { exists: () => 'exists', check: async () => null,
        initialize: async stores => { await stores.children.add('child', { owner: 'p' }); throw new Error('rollback'); }, result: 'created' })).toBe('failed');
      await backend.transaction(async stores => { expect(await stores.projects.get('p')).toBeUndefined(); expect(await stores.children.get('child')).toBeUndefined(); expect(await stores.operations.get(['p', 'create'])).toBeUndefined(); });
      const policy = { exists: () => 'exists', check: async () => null, initialize: async () => {}, result: 'created' };
      expect(await coordinator.create(identity, project, policy)).toBe('created');
      expect(await coordinator.create(identity, project, { ...policy, initialize: async () => { throw new Error('must not execute'); } })).toBe('created');
      expect(await coordinator.create({ ...identity, requestHash: 'other' }, project, policy)).toBe('reused');
      const update = { projectId: 'p', operationId: 'rename', requestHash: 'rename-hash' };
      expect(await coordinator.update(update, 0, async (stores, current, revision, now) => ({ project: { ...current, title: 'New', revision, updatedAt: now }, result: 'renamed', apply: async () => { await stores.children.put('child', { owner: 'p' }); } }))).toBe('renamed');
      expect(await coordinator.update(update, 0, async () => { throw new Error('must not execute'); })).toBe('renamed');
      expect(await coordinator.update({ ...update, operationId: 'stale' }, 0, async () => { throw new Error('must not execute'); })).toBe('stale');
      expect(await coordinator.delete('p', { protect: async () => 'protected', cleanup: async () => { throw new Error('must not execute'); }, applied: () => 'deleted' })).toBe('protected');
      expect(await coordinator.delete('p', { protect: async () => null, cleanup: async stores => { await stores.children.delete('child'); throw new Error('rollback'); }, applied: () => 'deleted' })).toBe('failed');
      await backend.transaction(async stores => { expect((await stores.projects.get('p'))?.revision).toBe(1); expect(await stores.children.get('child')).toEqual({ owner: 'p' }); });
      expect(await coordinator.delete('p', { protect: async () => null, cleanup: async stores => { await stores.children.delete('child'); }, applied: () => 'deleted' })).toBe('deleted');
      expect(await coordinator.delete('p', { protect: async () => null, cleanup: async () => {}, applied: () => 'deleted' })).toBe('missing');
    } finally { if (backend instanceof IndexedDbBackend) await backend.database.delete(); }
  });
}
it('replays a real accepted agent insertion before stale revision/domain reapplication and rejects reused identity', async () => {
  const db = createStudioDatabase(`agent-insert-retry-${crypto.randomUUID()}`);
  try {
    const repository = new LocalRepository(db);
    const document = JSON.parse(await readFile(new URL('../../features/entry/examples/s01.json', import.meta.url), 'utf8')) as Document;
    const projectId = crypto.randomUUID(); const mainBranchId = crypto.randomUUID(); const branchId = crypto.randomUUID();
    const actor = { actorId: 'reviewer', displayName: 'Reviewer', kind: 'local-human' as const };
    expect((await repository.execute({ commandId: 'project.create', operationId: crypto.randomUUID(), actor,
      payload: { newProjectId: projectId, title: 'Retry', initialDocument: document, mainBranchId, draftBranchId: branchId } })).status).toBe('applied');
    const command: ModelApplyRecordsCommand = { commandId: 'model.apply-records', operationId: crypto.randomUUID(), actor, projectId, branchId, expectedWorkingRevision: 0,
      payload: { changes: [{ kind: 'insert', value: { recordKind: 'schema', record: { id: crypto.randomUUID(), label: 'Agent annotation', shape: { type: 'string', nullable: false } } } }],
        proposal: { operationId: 'agent-proposal', actor: { actorId: 'agent', displayName: 'Agent', kind: 'agent' } } } };
    const accepted = await repository.execute(command);
    expect(accepted).toMatchObject({ status: 'applied', branchRevision: 1, proposal: command.payload.proposal });
    expect(await repository.execute(command)).toEqual(accepted);
    expect(await repository.execute({ ...command, payload: { ...command.payload, changes: [] } })).toMatchObject({ status: 'failed', code: 'operation-id-reused' });
    expect((await repository.loadBranch(projectId, branchId))!.workingRevision).toBe(1);
  } finally { await db.delete(); }
});
for (const kind of ['memory', 'indexeddb'] as const) {
  describe(`${kind} atomic storage conformance`, () => {
    async function withBackend(test: (backend: AtomicBackend<Rows>) => Promise<void>) {
      const backend = kind === 'memory' ? new MemoryBackend<Rows>(['documents', 'operations'])
        : new IndexedDbBackend<Rows>(`storage-conformance-${crypto.randomUUID()}`, ['documents', 'operations']);
      try { await test(backend); } finally { if (backend instanceof IndexedDbBackend) await backend.database.delete(); }
    }
    it('rolls back document and receipt together, then permits a new transaction', () => withBackend(async backend => {
      await expect(backend.transaction(async stores => {
        await stores.documents.put('board', { revision: 1, text: 'Uncommitted' });
        await stores.operations.add(['project', 'op'], { projectId: 'project', id: 'op', requestHash: 'hash', result: 1, createdAt: 1 });
        throw new Error('Abort');
      })).rejects.toThrow('Abort');
      await backend.transaction(async stores => {
        expect(await stores.documents.get('board')).toBeUndefined();
        expect(await stores.operations.get(['project', 'op'])).toBeUndefined();
        await stores.documents.put('board', { revision: 0, text: 'Initial' });
      });
    }));
    it('serializes CAS writes and replays receipts before checking a stale revision', () => withBackend(async backend => {
      await backend.transaction(async stores => { await stores.documents.put('board', { revision: 0, text: 'Initial' }); });
      const write = (operationId: string, hash: string, expected: number) => backend.transaction(async stores => {
        const replay = await checkReceipt({ get: key => stores.operations.get(key) }, 'project', operationId, hash);
        if (replay.kind === 'replay') return replay.result;
        if (replay.kind === 'reused') return 'reused';
        const current = (await stores.documents.get('board'))!;
        if (current.revision !== expected) return 'stale';
        const revision = current.revision + 1;
        await stores.documents.put('board', { revision, text: operationId });
        await stores.operations.add(['project', operationId], { projectId: 'project', id: operationId, requestHash: hash, result: revision, createdAt: 1 });
        return revision;
      });
      expect(await Promise.all([write('first', 'h1', 0), write('second', 'h2', 0)])).toEqual([1, 'stale']);
      expect(await write('first', 'h1', 0)).toBe(1);
      expect(await write('first', 'different', 1)).toBe('reused');
      await backend.transaction(async stores => {
        const document = (await stores.documents.get('board'))!;
        document.text = 'Mutated returned value';
        expect((await stores.documents.get('board'))!.text).toBe('first');
      });
    }));
    it('retains immutable content and rejects conflicting collisions', () => withBackend(async backend => {
      await backend.transaction(async stores => {
        const table = { get: (key: string) => stores.documents.get(key), add: (row: Rows['documents']) => stores.documents.add('snapshot', row) };
        const row = { revision: 1, text: 'Original' };
        const insert = (value: Rows['documents']) => insertImmutable(table, value, 'snapshot',
          (left, right) => left.revision === right.revision && left.text === right.text, () => new Error('Immutable collision'));
        await insert(row);
        await insert({ ...row });
        await expect(insert({ ...row, text: 'Changed' })).rejects.toThrow('Immutable collision');
        expect(await table.get('snapshot')).toEqual(row);
      });
    }));
  });
}

for (const kind of ['memory', 'indexeddb'] as const) {
  describe(`${kind} independent preference lifecycle`, () => {
    it('isolates preference CAS, schema, validation and value copies', async () => {
      type Value = { theme: string };
      type PreferenceRows = { preferences: PreferenceRecord<string, Value>; projects: { revision: number } };
      const backend = kind === 'memory' ? new MemoryBackend<PreferenceRows>(['preferences', 'projects'])
        : new IndexedDbBackend<PreferenceRows>(`preference-conformance-${crypto.randomUUID()}`, ['preferences', 'projects']);
      const service = new PreferenceService<string, Value, { status: 'failed'; message: string }>({ backend, schema: 'preferences/1',
        validate: value => !value.theme ? { status: 'failed', message: 'Theme required' } : null,
        failed: error => ({ status: 'failed', message: String(error) }) });
      try {
        await backend.transaction(async stores => { await stores.projects.add('authored', { revision: 7 }); });
        expect(await service.load()).toBeNull();
        expect(await service.save(3, { theme: 'light' })).toEqual({ status: 'stale', scope: 'preferences', expected: 3, actual: 0 });
        const input = { theme: 'light' }; const saving = service.save(0, input); input.theme = 'Caller mutation';
        expect(await saving).toEqual({ status: 'applied', revision: 1, value: { theme: 'light' } });
        expect(await service.save(1, { theme: '' })).toMatchObject({ status: 'failed' });
        const competing = await Promise.all(['dark', 'other'].map(theme => service.save(1, { theme })));
        expect(competing.map(result => result.status)).toEqual(['applied', 'stale']);
        const loaded = await service.load(); expect(loaded).toMatchObject({ schema: 'preferences/1', revision: 2, value: { theme: 'dark' } });
        expect(Object.isFrozen(loaded)).toBe(true); loaded!.value.theme = 'Changed returned value';
        expect((await service.load())!.value.theme).toBe('dark');
        await backend.transaction(async stores => { expect((await stores.projects.get('authored'))!.revision).toBe(7); });
      } finally { if (backend instanceof IndexedDbBackend) await backend.database.delete(); }
    });
  });
}

type DocResult = { status: 'applied' | 'missing' | 'stale' | 'reused' | 'failed' | 'limited'; revision?: number };
type DocRows = {
  projects: { id: string; revision: number; updatedAt: number };
  branches: { projectId: string; id: string; workingRevision: number; workingSnapshotId: string };
  snapshots: { projectId: string; id: string; document: { text: string } };
  operations: OperationReceipt<unknown>;
  metadata: { text: string };
};
for (const kind of ['memory', 'indexeddb'] as const) {
  describe(`${kind} atomic authored document coordinator`, () => {
    async function withCoordinator(test: (coordinator: AtomicDocumentCoordinator<DocRows, DocResult>, backend: AtomicBackend<DocRows>) => Promise<void>, mode: 'normal' | 'participant-failure' | 'limit' = 'normal') {
      const backend = kind === 'memory' ? new MemoryBackend<DocRows>(['projects', 'branches', 'snapshots', 'operations', 'metadata'])
        : new IndexedDbBackend<DocRows>(`document-conformance-${crypto.randomUUID()}`, ['projects', 'branches', 'snapshots', 'operations', 'metadata']);
      await backend.transaction(async stores => {
        await stores.projects.add('p', { id: 'p', revision: 0, updatedAt: 0 });
        await stores.branches.add(['p', 'b'], { projectId: 'p', id: 'b', workingRevision: 0, workingSnapshotId: 'initial' });
      });
      const coordinator = new AtomicDocumentCoordinator<DocRows, DocResult>({ backend,
        decodeReceipt: result => result as DocResult, missing: () => ({ status: 'missing' }), stale: () => ({ status: 'stale' }), reused: () => ({ status: 'reused' }), failed: () => ({ status: 'failed' }),
        applied: value => ({ status: 'applied', revision: value.branchRevision }), now: () => 10,
        equalSnapshot: (a, b) => JSON.stringify(a) === JSON.stringify(b), snapshotCollision: () => new Error('Immutable collision'),
        check: async () => mode === 'limit' ? { status: 'limited' } : null,
        participants: [async stores => { await stores.metadata.add('required', { text: 'Evidence' }); if (mode === 'participant-failure') throw new Error('Required participant failed'); }],
      });
      try { await test(coordinator, backend); } finally { if (backend instanceof IndexedDbBackend) await backend.database.delete(); }
    }
    const prepared = () => ({ operationId: 'op', projectId: 'p', branchId: 'b', expectedRevision: 0, requestHash: 'hash', snapshot: { projectId: 'p', id: 'next', document: { text: 'Authored' } } });
    it('commits document, participant, revisions and receipt together; retries precede CAS', () => withCoordinator(async (coordinator, backend) => {
      const request = prepared();
      const pending = coordinator.commit(request);
      request.snapshot.document.text = 'Caller mutation';
      expect(await pending).toEqual({ status: 'applied', revision: 1 });
      expect(await coordinator.commit(prepared())).toEqual({ status: 'applied', revision: 1 });
      expect(await coordinator.commit({ ...prepared(), requestHash: 'different' })).toEqual({ status: 'reused' });
      expect(await coordinator.commit({ ...prepared(), operationId: 'stale' })).toEqual({ status: 'stale' });
      await backend.transaction(async stores => {
        expect((await stores.projects.get('p'))!.revision).toBe(1);
        expect((await stores.branches.get(['p', 'b']))!.workingSnapshotId).toBe('next');
        expect((await stores.snapshots.get(['p', 'next']))!.document.text).toBe('Authored');
        expect(await stores.metadata.get('required')).toEqual({ text: 'Evidence' });
        expect(await stores.operations.get(['p', 'op'])).toBeDefined();
        expect(await stores.operations.get(['p', 'stale'])).toBeUndefined();
      });
    }));
    for (const mode of ['participant-failure', 'limit'] as const) it(`preserves all authored state after ${mode}`, () => withCoordinator(async (coordinator, backend) => {
      expect((await coordinator.commit(prepared())).status).toBe(mode === 'limit' ? 'limited' : 'failed');
      await backend.transaction(async stores => {
        expect((await stores.projects.get('p'))!.revision).toBe(0);
        expect((await stores.branches.get(['p', 'b']))!.workingSnapshotId).toBe('initial');
        expect(await stores.snapshots.get(['p', 'next'])).toBeUndefined();
        expect(await stores.metadata.get('required')).toBeUndefined();
        expect(await stores.operations.get(['p', 'op'])).toBeUndefined();
      });
    }, mode));
  });
}

type Project = CatalogProject & { readonly team: string };
type ProjectRows = CatalogRows<Project> & { children: { projectId: string; text: string } };
for (const kind of ['memory', 'indexeddb', 'indexeddb-inline'] as const) {
  describe(`${kind} project catalog conformance`, () => {
    async function withCatalog(test: (catalog: ProjectCatalog<Project, ProjectRows>, backend: AtomicBackend<ProjectRows>) => Promise<void>, failCreate = false) {
      const indexes = { projects: [{ name: 'team', keyPath: 'team' }], children: [{ name: 'project', keyPath: 'projectId' }] };
      const name = `catalog-conformance-${crypto.randomUUID()}`;
      const inline = kind === 'indexeddb-inline' ? new IndexedDbDatabase<{
        projects: { row: Project; key: string }; operations: { row: ProjectRows['operations']; key: [string, string] }; children: { row: ProjectRows['children']; key: string };
      }>(name, 1, { projects: 'id,team', operations: '[projectId+id]', children: 'projectId' }) : null;
      const backend = kind === 'memory' ? new MemoryBackend<ProjectRows>(['projects', 'operations', 'children'], indexes)
        : new IndexedDbBackend<ProjectRows>(inline ? inline as unknown as Dexie : name, ['projects', 'operations', 'children'], indexes);
      const catalog = new ProjectCatalog<Project, ProjectRows>({ backend, fingerprint: request => JSON.stringify(request), now: () => 10,
        validate: project => !project.title.trim() ? 'Title is required' : null,
        rename: (project, title, revision, updatedAt) => ({ ...project, title, revision, updatedAt }),
        onCreate: async (stores, project) => { await stores.children.add(project.id, { projectId: project.id, text: 'Initial' }); if (failCreate) throw new Error('Child creation failed'); },
        onDelete: async (stores, project) => { const children = await stores.children.query('project', project.id, 100); for (const entry of children.entries) await stores.children.delete(entry.key); },
      });
      try { await test(catalog, backend); } finally { if (backend instanceof IndexedDbBackend) await backend.database.delete(); }
    }
    const project = (id: string): Project => ({ id, title: id, revision: 0, createdAt: 1, updatedAt: 1, team: 'Core' });
    it('creates, renames with CAS, replays the original receipt and atomically deletes related content', () => withCatalog(async (catalog, backend) => {
      const create = { kind: 'create' as const, operationId: 'create', projectId: 'a', project: project('a') };
      expect((await catalog.execute(create)).status).toBe('applied');
      const rename = { kind: 'rename' as const, operationId: 'rename', projectId: 'a', expectedRevision: 0, title: 'Renamed' };
      const renamed = await catalog.execute(rename);
      expect(renamed).toEqual({ status: 'applied', project: { ...project('a'), title: 'Renamed', revision: 1, updatedAt: 10 } });
      expect(await catalog.execute(rename)).toEqual(renamed);
      expect(await catalog.execute({ ...rename, title: 'Different' })).toEqual({ status: 'operation-reused' });
      expect(await catalog.execute({ ...rename, operationId: 'stale' })).toEqual({ status: 'stale', actualRevision: 1 });
      const deletion = { kind: 'delete' as const, operationId: 'delete', projectId: 'a', expectedRevision: 1 };
      expect(await catalog.execute(deletion)).toEqual({ status: 'applied', project: null });
      expect(await catalog.execute(deletion)).toEqual({ status: 'applied', project: null });
      expect(await catalog.load('a')).toBeUndefined();
      await backend.transaction(async stores => { expect(await stores.children.get('a')).toBeUndefined(); expect(await stores.operations.get(['a', 'delete'])).toBeDefined(); });
    }));
    it('rolls back project, related rows and receipt when required creation fails', () => withCatalog(async (catalog, backend) => {
      expect((await catalog.execute({ kind: 'create', operationId: 'failed', projectId: 'a', project: project('a') })).status).toBe('failed');
      await backend.transaction(async stores => { expect(await stores.projects.get('a')).toBeUndefined(); expect(await stores.children.get('a')).toBeUndefined(); expect(await stores.operations.get(['a', 'failed'])).toBeUndefined(); });
    }, true));
    it('serializes competing catalog renames and preserves the winning project', () => withCatalog(async catalog => {
      await catalog.execute({ kind: 'create', operationId: 'create', projectId: 'a', project: project('a') });
      const result = await Promise.all(['First', 'Second'].map(title => catalog.execute({ kind: 'rename', operationId: title, projectId: 'a', expectedRevision: 0, title })));
      expect(result.map(value => value.status)).toEqual(['applied', 'stale']);
      expect((await catalog.load('a'))!.title).toBe('First');
    }));
    it('provides deterministic bounded pagination and index queries without exposing mutable rows', () => withCatalog(async (catalog, backend) => {
      for (const id of ['c', 'a', 'b']) await catalog.execute({ kind: 'create', operationId: id, projectId: id, project: project(id) });
      const first = await catalog.list({ limit: 2 });
      expect(first.entries.map(entry => entry.key)).toEqual(['a', 'b']); expect(first.truncated).toBe(true);
      expect((await catalog.list({ limit: 2, after: first.entries[1]!.key })).entries.map(entry => entry.key)).toEqual(['c']);
      await backend.transaction(async stores => {
        const page = await stores.projects.query('team', 'Core', 2); expect(page.entries.map(entry => entry.key)).toEqual(['a', 'b']); expect(page.truncated).toBe(true);
        (page.entries[0]!.row as { title: string }).title = 'Mutated'; expect((await stores.projects.get('a'))!.title).toBe('a');
        await expect(stores.projects.scan({ limit: 0 })).rejects.toThrow('Scan limit');
        await expect(stores.projects.query('missing', 'Core', 2)).rejects.toThrow('Unknown storage index');
      });
    }));
    it('rejects expired transaction capabilities after returning', () => withCatalog(async (_catalog, backend) => {
      let expired!: TransactionStore<Project>;
      await backend.transaction(async stores => { expired = stores.projects; });
      await expect(expired.scan({ limit: 1 })).rejects.toThrow('Transaction is closed');
      await expect(expired.delete('a')).rejects.toThrow('Transaction is closed');
    }));
    it('reads all catalog pages and preserves title/id ordering and read-only detached records', () => withCatalog(async (catalog, backend) => {
      for (const id of ['c', 'b', 'a']) await catalog.execute({ kind: 'create', operationId: id, projectId: id, project: { ...project(id), title: id === 'c' ? 'Alpha' : 'Beta' } });
      const reader = new ProjectCatalogReader<Project>(backend, 1);
      const listed = await reader.list();
      expect(listed.map(row => row.id)).toEqual(['c', 'a', 'b']);
      expect(Object.isFrozen(listed)).toBe(true); expect(Object.isFrozen(listed[0])).toBe(true);
      const loaded = await reader.load('c'); expect(loaded).toEqual(listed[0]); expect(Object.isFrozen(loaded)).toBe(true);
      expect(await reader.load('missing')).toBeNull();
    }));
  });
}
