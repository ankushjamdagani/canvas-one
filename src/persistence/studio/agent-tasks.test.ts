import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { Dexie } from 'dexie';
import { TaskRepository, emptyTaskLedger, transitionTask, type TaskScope } from '@canvas-one/agents';
import { StudioDatabase } from './db';
import { StudioTaskStorage, agentTaskLedgerKey } from './agent-tasks';

const scope: TaskScope = { projectId: 'project', branchId: 'branch', boardId: 'board' };
const binding = { taskId: 'task', actorId: 'claude', scope };
const create = { ...binding, type: 'create' as const, attemptId: 'attempt', instruction: 'Draw flow' };
const attempt = { ...binding, attemptId: 'attempt', generation: 1 };
const databases: Dexie[] = [];
function database(name = `agent-storage-${crypto.randomUUID()}`) {
  const db = new StudioDatabase(name); databases.push(db); return db;
}
afterEach(async () => {
  const names = new Set(databases.map(db => db.name));
  for (const db of databases.splice(0)) db.close();
  for (const name of names) await Dexie.delete(name);
});
async function repository(storage: StudioTaskStorage) {
  const opened = await TaskRepository.open(storage);
  if (!opened.ok) throw new Error(opened.code);
  return opened.repository;
}
function serializedTask(boundScope = scope) {
  const result = transitionTask(emptyTaskLedger(), 0, { ...create, scope: boundScope });
  if (!result.ok) throw new Error(result.code);
  return JSON.stringify(result.ledger);
}

describe('Studio task storage', () => {
  it('atomically compares revisions across two database connections and preserves board exclusivity across agents', async () => {
    const firstDb = database(), secondDb = database(firstDb.name);
    const first = await repository(new StudioTaskStorage(firstDb, scope));
    const second = await repository(new StudioTaskStorage(secondDb, scope));
    const outcomes = await Promise.all([
      first.execute(create, 0),
      second.execute({ ...create, taskId: 'codex-task', actorId: 'codex', attemptId: 'codex-attempt' }, 0),
    ]);
    expect(outcomes.filter(result => result.ok)).toHaveLength(1);
    expect(outcomes.filter(result => !result.ok && result.code === 'storage-conflict')).toHaveLength(1);
    const loser = outcomes[0]?.ok ? second : first;
    await loser.refresh();
    expect(await loser.execute({ ...create, taskId: 'third', attemptId: 'third', actorId: 'agy' }, 1)).toEqual({ ok: false, code: 'busy' });
    expect(await firstDb.agentTaskLedgers.count()).toBe(1);
  });
  it('reopens durable metadata and requires explicit scoped recovery before a new attempt', async () => {
    const db = database(), repo = await repository(new StudioTaskStorage(db, scope));
    await repo.execute(create, 0); await repo.execute({ ...attempt, type: 'start' }, 1); await repo.execute({ ...attempt, type: 'grantLive' }, 2);
    const name = db.name; db.close();
    const reopened = await repository(new StudioTaskStorage(database(name), scope));
    expect(reopened.getSnapshot().tasks[0]?.status).toBe('working');
    await reopened.recoverAfterDeparture({ actorId: binding.actorId, scope });
    expect(reopened.getSnapshot().tasks[0]?.status).toBe('interrupted');
    expect(reopened.getSnapshot().tasks[0]?.interruptedPermission).toBe('live');
    expect(await reopened.execute({ ...attempt, type: 'grantLive' }, 4)).toEqual({ ok: false, code: 'stale-attempt' });
    const again = await repository(new StudioTaskStorage(database(name), scope));
    expect(again.getSnapshot()).toEqual(reopened.getSnapshot());
    expect((await again.execute({ ...binding, type: 'resume', attemptId: 'new', permission: 'suggest', currentBoardValidated: true }, 4)).ok).toBe(true);
  });
  it('rejects malformed rows and row-ledger revision mismatches without overwriting', async () => {
    const db = database(), storage = new StudioTaskStorage(db, scope);
    for (const bad of [
      { key: storage.key, revision: 1, serializedLedger: '{bad' },
      { key: storage.key, revision: 9, serializedLedger: serializedTask() },
      { key: storage.key, revision: 1, serializedLedger: serializedTask({ ...scope, boardId: 'other' }) },
    ]) {
      await db.agentTaskLedgers.put(bad);
      await expect(storage.load()).rejects.toThrow();
      const next = JSON.parse(serializedTask()); next.revision = 2;
      await expect(storage.compareAndSwap(1, JSON.stringify(next))).rejects.toThrow();
      expect(await db.agentTaskLedgers.get(storage.key)).toEqual(bad);
    }
  });
  it('isolates tuple scopes, rejects cross-board incoming records and prevents missing or regressed CAS writes', async () => {
    const db = database(), storage = new StudioTaskStorage(db, scope);
    expect(agentTaskLedgerKey({ projectId: 'a:b', branchId: 'c', boardId: 'd' })).not.toBe(agentTaskLedgerKey({ projectId: 'a', branchId: 'b:c', boardId: 'd' }));
    await expect(storage.compareAndSwap(null, serializedTask({ ...scope, boardId: 'other' }))).rejects.toThrow();
    expect(await storage.compareAndSwap(0, serializedTask())).toBe(false);
    expect(await storage.compareAndSwap(null, serializedTask())).toBe(true);
    expect(await storage.compareAndSwap(null, serializedTask())).toBe(false);
    expect(await storage.compareAndSwap(1, serializedTask())).toBe(false);
    expect(await db.agentTaskLedgers.count()).toBe(1);
    expect(await new StudioTaskStorage(db, { ...scope, branchId: 'other' }).load()).toBeNull();
  });
  it('upgrades the existing version-1 database additively and preserves every existing store and content', async () => {
    const name = `agent-upgrade-${crypto.randomUUID()}`;
    const old = new Dexie(name); databases.push(old);
    const stores = {
      projects: 'id, updatedAt', branches: '[projectId+id], projectId', snapshots: '[projectId+id], projectId', commits: '[projectId+id], projectId',
      publications: '[projectId+id], projectId, &[projectId+ordinal], &[projectId+versionKey]', checkpoints: '[projectId+id], projectId',
      runs: '[projectId+id], projectId, [projectId+fingerprint]', traceChunks: '[projectId+runId+index], [projectId+runId]',
      operations: '[projectId+id], projectId', parts: '[projectId+id+revision], projectId, [projectId+id]', preferences: 'key',
    };
    old.version(1).stores(stores); await old.open();
    const content = {
      projects: { id: 'project', title: 'Existing board', revision: 7, updatedAt: 12 },
      branches: { projectId: 'project', id: 'branch', workingRevision: 8 }, snapshots: { projectId: 'project', id: 'snapshot', document: { title: 'Preserve me' } },
      commits: { projectId: 'project', id: 'commit', parentIds: [] }, publications: { projectId: 'project', id: 'publication', ordinal: 1, versionKey: '1.0.0' },
      checkpoints: { projectId: 'project', id: 'checkpoint' }, runs: { projectId: 'project', id: 'run' }, traceChunks: { projectId: 'project', runId: 'run', index: 0, items: [1] },
      operations: { projectId: 'project', id: 'operation' }, parts: { projectId: 'project', id: 'part', revision: 1 }, preferences: { key: 'user', schema: 'studio-preferences/1', revision: 3, value: { theme: 'dark' } },
    };
    for (const [table, row] of Object.entries(content)) await old.table(table).put(row);
    old.close();
    const upgraded = database(name); await upgraded.open();
    expect(upgraded.verno).toBe(4);
    expect(upgraded.tables.map(table => table.name).sort()).toEqual([...Object.keys(stores), 'agentTaskLedgers', 'agentConversations', 'agentTaskActions', 'agentConversationArchive'].sort());
    for (const [table, row] of Object.entries(content)) expect(await upgraded.table(table).toArray()).toEqual([row]);
    expect(await upgraded.agentTaskLedgers.count()).toBe(0);
  });
});
