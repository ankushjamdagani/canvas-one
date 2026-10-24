import { describe, expect, it } from 'vitest';
import { TaskRepository, authorizeTaskWrite, parseTaskLedger, type TaskCommand, type TaskStorage } from '@canvas-one/agents';

const scope = { projectId: 'project', branchId: 'branch', boardId: 'board' };
const binding = { taskId: 'task', actorId: 'claude', scope };
const create = { ...binding, type: 'create' as const, attemptId: 'attempt', instruction: 'Draw flow' };
const attempt = { ...binding, attemptId: 'attempt', generation: 1 };
const execute = (repo: TaskRepository, command: TaskCommand) => repo.execute(command, repo.getSnapshot().revision);
/** Test-only adapter. Production storage must implement durable atomic CAS. */
class MemoryStorage implements TaskStorage {
  raw: string | null = null;
  fail = false;
  failAfterCommit = false;
  acknowledgement: Promise<void> | null = null;
  async load() { return this.raw; }
  async compareAndSwap(expected: number | null, next: string) {
    if (this.acknowledgement) await this.acknowledgement;
    if (this.fail) throw new Error('Disk full');
    const actual = this.raw === null ? null : JSON.parse(this.raw).revision;
    if (actual !== expected) return false;
    this.raw = next;
    if (this.failAfterCommit) throw new Error('Acknowledgement lost');
    return true;
  }
}
async function open(storage: TaskStorage) {
  const result = await TaskRepository.open(storage);
  if (!result.ok) throw new Error(result.code);
  return result.repository;
}
async function active(storage: MemoryStorage) {
  const repo = await open(storage);
  expect((await execute(repo, create)).ok).toBe(true);
  expect((await execute(repo, { ...attempt, type: 'start' })).ok).toBe(true);
  expect((await execute(repo, { ...attempt, type: 'grantLive' })).ok).toBe(true);
  return repo;
}
describe('durable task repository boundary', () => {
  it('evaluates queued decisions against the current durable revision', async () => {
    const storage = new MemoryStorage(), repo = await open(storage);
    const results = await Promise.all([
      repo.executeCurrent(create),
      repo.executeCurrent({ ...attempt, type: 'start' }),
      repo.executeCurrent({ ...attempt, type: 'stop' }),
    ]);
    expect(results.every(result => result.ok)).toBe(true);
    expect(repo.getSnapshot().tasks[0]?.status).toBe('stopped');
    expect((await open(storage)).getSnapshot()).toEqual(repo.getSnapshot());
  });
  it('publishes only after persistence acknowledgement and queues subsequent transitions', async () => {
    const storage = new MemoryStorage(), repo = await open(storage);
    let release!: () => void;
    storage.acknowledgement = new Promise<void>(resolve => { release = resolve; });
    const creating = execute(repo, create);
    const starting = repo.execute({ ...attempt, type: 'start' }, 1);
    await Promise.resolve();
    expect(repo.getSnapshot().tasks).toHaveLength(0);
    release();
    expect((await creating).ok).toBe(true);
    expect((await starting).ok).toBe(true);
    expect(repo.getSnapshot().revision).toBe(2);
    expect(repo.getSnapshot().tasks[0]?.status).toBe('working');
    expect(Object.isFrozen(repo.getSnapshot().tasks[0]?.attempts)).toBe(true);
  });
  it('leaves published state unchanged after persistence failure and permits retry', async () => {
    const storage = new MemoryStorage(), repo = await open(storage);
    const before = repo.getSnapshot(); storage.fail = true;
    expect(await execute(repo, create)).toEqual({ ok: false, code: 'unknown-outcome' });
    expect(repo.getSnapshot()).toBe(before); expect(storage.raw).toBeNull();
    storage.fail = false;
    await repo.refresh();
    expect((await execute(repo, create)).ok).toBe(true);
  });
  it('prevents lost updates across repositories and requires explicit refresh after CAS conflict', async () => {
    const storage = new MemoryStorage(), first = await open(storage), second = await open(storage);
    const [firstResult, secondResult] = await Promise.all([execute(first, create), execute(second, { ...create, taskId: 'second', attemptId: 'second' })]);
    expect(firstResult.ok).toBe(true);
    expect(secondResult).toEqual({ ok: false, code: 'storage-conflict' });
    expect(second.getSnapshot().tasks).toHaveLength(0);
    expect((await second.refresh()).ok).toBe(true);
    expect(await execute(second, { ...create, taskId: 'second', attemptId: 'second' })).toEqual({ ok: false, code: 'busy' });
    expect((await execute(second, { ...attempt, type: 'stop' })).ok).toBe(true);
    expect(await execute(first, { ...attempt, type: 'start' })).toEqual({ ok: false, code: 'storage-conflict' });
    await first.refresh();
    expect(await execute(first, { ...attempt, type: 'start' })).toEqual({ ok: false, code: 'stale-attempt' });
  });
  it('fences recovered active tasks durably while retaining permission only as display metadata', async () => {
    const storage = new MemoryStorage(); await active(storage);
    const reloaded = await open(storage);
    expect((await reloaded.recoverAfterDeparture({ actorId: binding.actorId, scope })).ok).toBe(true);
    const task = reloaded.getSnapshot().tasks[0]!;
    expect(task.status).toBe('interrupted'); expect(task.permission).toBe('suggest'); expect(task.interruptedPermission).toBe('live');
    expect(authorizeTaskWrite(reloaded.getSnapshot(), attempt, { dependenciesValidated: true, leaseValid: true })).toEqual({ ok: false, code: 'stale-attempt' });
    expect(await execute(reloaded, { ...attempt, type: 'complete', unresolvedDecisions: 0, pendingWrites: 0 })).toEqual({ ok: false, code: 'stale-attempt' });
    const persisted = await open(storage);
    expect(persisted.getSnapshot()).toEqual(reloaded.getSnapshot());
    expect((await execute(persisted, { ...binding, type: 'resume', attemptId: 'new', permission: 'suggest', currentBoardValidated: true })).ok).toBe(true);
    expect(persisted.getSnapshot().tasks[0]?.interruptedPermission).toBeUndefined();
  });
  it('does not interpret a second reader as departure or overwrite malformed storage', async () => {
    const storage = new MemoryStorage(); await active(storage);
    const second = await open(storage);
    expect(second.getSnapshot().tasks[0]?.status).toBe('working');
    storage.raw = '{bad JSON';
    const before = second.getSnapshot();
    expect(await second.refresh()).toEqual({ ok: false, code: 'invalid-storage' });
    expect(second.getSnapshot()).toBe(before);
    expect(await TaskRepository.open(storage)).toEqual({ ok: false, code: 'invalid-storage' });
    expect(storage.raw).toBe('{bad JSON');
  });
  it('rejects corrupted identity, generation, state and single-board invariants', async () => {
    const storage = new MemoryStorage(); const repo = await active(storage);
    const good = JSON.parse(JSON.stringify(repo.getSnapshot()));
    const variants = [
      (v: typeof good) => { v.tasks[0].scope.boardId = ''; },
      (v: typeof good) => { v.tasks[0].generation = 0; },
      (v: typeof good) => { v.tasks[0].attempts = []; },
      (v: typeof good) => { v.tasks[0].status = 'invented'; },
      (v: typeof good) => { v.tasks[0].status = ['stopped']; v.tasks[0].generation = 2; v.tasks[0].permission = 'suggest'; v.tasks[0].cancellation = 'pending'; v.tasks[0].attempts[0].status = 'revoked'; },
      (v: typeof good) => { v.tasks[0].cancellation = ['none']; },
      (v: typeof good) => { v.tasks[0].waitReason = 'review'; },
      (v: typeof good) => { v.tasks.push({ ...v.tasks[0], id: 'second', attempts: [{ id: 'second', generation: 1, status: 'working', cancellation: 'none' }] }); },
      (v: typeof good) => { v.tasks[0].attempts.push({ ...v.tasks[0].attempts[0] }); },
      (v: typeof good) => { v.tasks[0].scope.extra = true; },
      (v: typeof good) => { v.tasks[0].providerId = ''; },
      (v: typeof good) => { v.tasks[0].providerId = 'x'.repeat(201); },
      (v: typeof good) => { v.tasks[0].providerId = null; },
      (v: typeof good) => { v.tasks[0].providerId = 5; },
    ];
    for (const corrupt of variants) {
      const value = JSON.parse(JSON.stringify(good)); corrupt(value);
      expect(parseTaskLedger(JSON.stringify(value))).toBeNull();
    }
    expect(parseTaskLedger(JSON.stringify(good))).not.toBeNull();
    good.tasks[0].providerId = 'codex';
    expect(parseTaskLedger(JSON.stringify(good))?.tasks[0]?.providerId).toBe('codex');
  });
  it('atomically recovers all boards and does not publish failed recovery', async () => {
    const storage = new MemoryStorage(), repo = await active(storage);
    expect((await execute(repo, { ...create, scope: { ...scope, boardId: 'other' }, taskId: 'other', attemptId: 'other' })).ok).toBe(true);
    const before = repo.getSnapshot(); storage.fail = true;
    expect(await repo.recoverAfterDeparture({ actorId: binding.actorId, scope })).toEqual({ ok: false, code: 'unknown-outcome' });
    expect(repo.getSnapshot()).toBe(before);
    storage.fail = false;
    await repo.refresh();
    expect((await repo.recoverAfterDeparture({ actorId: binding.actorId, scope })).ok).toBe(true);
    expect(repo.getSnapshot().tasks.map(task => task.status)).toEqual(['interrupted', 'requested']);
  });
  it('rejects rollback refresh and captures queued commands without retaining mutable references', async () => {
    const storage = new MemoryStorage(), repo = await open(storage);
    const instruction = { ...create, scope: { ...scope } };
    let release!: () => void;
    storage.acknowledgement = new Promise<void>(resolve => { release = resolve; });
    const pending = execute(repo, instruction);
    instruction.scope.boardId = 'tampered'; instruction.instruction = 'tampered';
    release(); expect((await pending).ok).toBe(true);
    expect(repo.getSnapshot().tasks[0]?.scope.boardId).toBe('board');
    expect(repo.getSnapshot().tasks[0]?.instruction).toBe('Draw flow');
    expect(() => { (repo.getSnapshot().tasks as unknown as unknown[]).push({}); }).toThrow();
    storage.raw = JSON.stringify({ schema: 'canvas-one/tasks/1', revision: 0, tasks: [] });
    const before = repo.getSnapshot();
    expect(await repo.refresh()).toEqual({ ok: false, code: 'invalid-storage' });
    expect(repo.getSnapshot()).toBe(before);
  });
  it('returns clean invalid-input results for unserializable or malformed commands', async () => {
    const storage = new MemoryStorage(), repo = await open(storage);
    const cyclic = { ...create } as typeof create & { self?: unknown }; cyclic.self = cyclic;
    for (const command of [undefined, cyclic, { ...create, scope: null }, { ...create, type: 'invented' }]) {
      expect(await execute(repo, command as unknown as typeof create)).toEqual({ ok: false, code: 'invalid-input' });
    }
    expect(storage.raw).toBeNull(); expect(repo.getSnapshot().revision).toBe(0);
    expect((await execute(repo, create)).ok).toBe(true);
  });
  it('preserves caller revisions and blocks ambiguous persistence until explicit authoritative refresh', async () => {
    const storage = new MemoryStorage(), repo = await open(storage);
    storage.failAfterCommit = true;
    expect(await repo.execute(create, 0)).toEqual({ ok: false, code: 'unknown-outcome' });
    expect(repo.getSnapshot().tasks).toHaveLength(0);
    expect(await repo.execute(create, 0)).toEqual({ ok: false, code: 'unknown-outcome' });
    storage.failAfterCommit = false;
    expect((await repo.refresh()).ok).toBe(true);
    expect(repo.getSnapshot().tasks).toHaveLength(1);
    expect(await repo.execute({ ...attempt, type: 'start' }, 0)).toEqual({ ok: false, code: 'stale-ledger' });
    expect((await repo.execute({ ...attempt, type: 'start' }, 1)).ok).toBe(true);
  });
  it('preserves completed proposal review and fences only the departed actor and exact scope', async () => {
    const storage = new MemoryStorage(), repo = await active(storage);
    expect((await execute(repo, { ...attempt, type: 'wait', reason: 'review', attemptFinished: true })).ok).toBe(true);
    const before = repo.getSnapshot();
    expect((await repo.recoverAfterDeparture({ actorId: binding.actorId, scope })).ok).toBe(true);
    expect(repo.getSnapshot()).toBe(before);
    await execute(repo, { ...create, scope: { ...scope, boardId: 'other' }, taskId: 'other', attemptId: 'other', actorId: 'codex' });
    expect((await repo.recoverAfterDeparture({ actorId: 'claude', scope: { ...scope, boardId: 'other' } })).ok).toBe(true);
    expect(repo.getSnapshot().tasks[1]?.status).toBe('requested');
    expect((await repo.recoverAfterDeparture({ actorId: 'codex', scope: { ...scope, boardId: 'other' } })).ok).toBe(true);
    expect(repo.getSnapshot().tasks.map(task => task.status)).toEqual(['waiting', 'interrupted']);
  });
  it('validates concurrent read-only questions, rejects question Live state and accepts missing legacy kind as edit', async () => {
    const storage = new MemoryStorage(), repo = await active(storage);
    expect((await execute(repo, { ...create, taskId: 'question', attemptId: 'question', kind: 'question' })).ok).toBe(true);
    const valid = JSON.parse(JSON.stringify(repo.getSnapshot()));
    expect(parseTaskLedger(JSON.stringify(valid))).not.toBeNull();
    valid.tasks[1].permission = 'live'; expect(parseTaskLedger(JSON.stringify(valid))).toBeNull();
    valid.tasks[1].permission = 'suggest'; valid.tasks[1].kind = ['question']; expect(parseTaskLedger(JSON.stringify(valid))).toBeNull();
    valid.tasks.pop(); delete valid.tasks[0].kind;
    expect(parseTaskLedger(JSON.stringify(valid))).not.toBeNull();
  });
});
