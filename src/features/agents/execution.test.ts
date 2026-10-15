import { describe, expect, it } from 'vitest';
import { ExecutionSupervisor, type ExecutionIdentity, type ExecutionProcess } from '@canvas-one/agent-bridge';

const identity: ExecutionIdentity = { taskId: 'task', attemptId: 'attempt', projectId: 'project', branchId: 'branch', boardId: 'board', actorId: 'agent', generation: 1 };
const pendingProcess = (cancel: () => Promise<void> = async () => {}) => ({ cancel, finished: new Promise<void>(() => {}) });
describe('execution supervisor fences', () => {
  it('closes relay permission synchronously before cancellation is acknowledged', async () => {
    let acknowledge!: () => void;
    const supervisor = new ExecutionSupervisor(() => 0, 100);
    await supervisor.start(identity, async () => pendingProcess(() => new Promise<void>(resolve => { acknowledge = resolve; })));
    expect(supervisor.permits(identity)).toBe(true);
    const stop = supervisor.stop(identity);
    expect(supervisor.permits(identity)).toBe(false);
    expect(supervisor.cancellation(identity)).toBe('requested');
    await Promise.resolve();
    acknowledge(); await stop;
    expect(supervisor.cancellation(identity)).toBe('acknowledged');
  });
  it('cannot renew an expired lease or reuse a generation after explicit resume', async () => {
    let now = 0;
    const supervisor = new ExecutionSupervisor(() => now, 100);
    await supervisor.start(identity, async () => pendingProcess());
    now = 100;
    expect(supervisor.permits(identity)).toBe(false);
    expect(() => supervisor.renew(identity)).toThrow('Explicit resume');
    await expect(supervisor.start({ ...identity, attemptId: 'new' }, async () => pendingProcess())).rejects.toThrow('cannot be reused');
    const resumed = { ...identity, attemptId: 'new', generation: 2 };
    await supervisor.start(resumed, async () => pendingProcess());
    expect(supervisor.permits(identity)).toBe(false);
    expect(supervisor.permits(resumed)).toBe(true);
  });
  it('rechecks expiry at commit time and binds all scope and actor fields', async () => {
    let now = 0;
    const supervisor = new ExecutionSupervisor(() => now, 100);
    await supervisor.start(identity, async () => pendingProcess());
    for (const field of ['taskId', 'attemptId', 'projectId', 'branchId', 'boardId', 'actorId'] as const) expect(supervisor.permits({ ...identity, [field]: 'other' })).toBe(false);
    supervisor.assertEligible(identity);
    now = 101;
    expect(() => supervisor.assertEligible(identity)).toThrow('fence');
  });
  it('fences a process that finishes launching after Stop', async () => {
    let launched!: (process: ExecutionProcess) => void;
    let cancelled = false;
    const supervisor = new ExecutionSupervisor(() => 0, 100);
    const start = supervisor.start(identity, () => new Promise(resolve => { launched = resolve; }));
    const stop = supervisor.stop(identity);
    expect(supervisor.cancellation(identity)).toBe('requested');
    launched(pendingProcess(async () => { cancelled = true; }));
    await expect(start).rejects.toThrow('revoked during startup');
    await stop;
    expect(cancelled).toBe(true);
    expect(supervisor.permits(identity)).toBe(false);
  });
  it('reserves one editing attempt per board during startup, releases upon provider finish', async () => {
    let finish!: () => void;
    const supervisor = new ExecutionSupervisor(() => 0, 100);
    await supervisor.start(identity, async () => ({ cancel: async () => {}, finished: new Promise(resolve => { finish = resolve; }) }));
    await expect(supervisor.start({ ...identity, taskId: 'other', attemptId: 'other' }, async () => pendingProcess())).rejects.toThrow('active editing attempt');
    finish(); await Promise.resolve();
    expect(supervisor.permits(identity)).toBe(false);
    await supervisor.start({ ...identity, taskId: 'other', attemptId: 'other' }, async () => pendingProcess());
  });
  it('reports cancellation failure without reopening writes and dispose fences slow startup', async () => {
    const supervisor = new ExecutionSupervisor(() => 0, 100);
    await supervisor.start(identity, async () => pendingProcess(async () => { throw new Error('not acknowledged'); }));
    expect(await supervisor.stop(identity)).toBe('failed');
    expect(supervisor.cancellation(identity)).toBe('failed');
    expect(supervisor.permits(identity)).toBe(false);
    expect(await supervisor.dispose()).toEqual(['failed']);
    await expect(supervisor.start({ ...identity, generation: 2, attemptId: 'new' }, async () => pendingProcess())).rejects.toThrow('authorization');
  });
  it('retries a failed cancellation and corrects evidence after a later process close', async () => {
    let finish!: () => void;
    let tries = 0;
    const supervisor = new ExecutionSupervisor(() => 0, 100);
    await supervisor.start(identity, async () => ({ finished: new Promise(resolve => { finish = resolve; }), cancel: async () => { if (++tries === 1) throw new Error('temporary signal failure'); } }));
    expect(await supervisor.stop(identity)).toBe('failed');
    expect(await supervisor.stop(identity)).toBe('acknowledged');
    expect(tries).toBe(2);
    finish(); await Promise.resolve();
    expect(supervisor.cancellation(identity)).toBe('acknowledged');
  });
  it('acknowledges a later natural close even after failed cancellation', async () => {
    let finish!: () => void;
    const supervisor = new ExecutionSupervisor(() => 0, 100);
    await supervisor.start(identity, async () => ({ finished: new Promise(resolve => { finish = resolve; }), cancel: async () => { throw new Error('signal failure'); } }));
    expect(await supervisor.stop(identity)).toBe('failed');
    finish(); await Promise.resolve();
    expect(supervisor.cancellation(identity)).toBe('acknowledged');
    expect(supervisor.permits(identity)).toBe(false);
  });
  it('shares pending cancellation and archives only settled fenced attempts', async () => {
    let acknowledge!: () => void;
    const supervisor = new ExecutionSupervisor(() => 0, 100);
    await supervisor.start(identity, async () => pendingProcess(() => new Promise(resolve => { acknowledge = resolve; })));
    expect(() => supervisor.archive(identity)).toThrow('settled');
    const first = supervisor.stop(identity);
    expect(supervisor.stop(identity)).toBe(first);
    let disposed = false;
    const disposal = supervisor.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);
    acknowledge(); await first; await disposal;
    supervisor.archive(identity);
    expect(supervisor.permits(identity)).toBe(false);
  });
});
