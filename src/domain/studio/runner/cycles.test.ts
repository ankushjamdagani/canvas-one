import { describe, expect, it } from 'vitest';
import type { SimLifecycleFact } from '../../../simulation/open/kernel';
import { CycleTracker } from './cycles';

const fact = (p: Partial<SimLifecycleFact> & Pick<SimLifecycleFact, 'kind' | 'time' | 'unitIdentity'>): SimLifecycleFact => ({
  nodeId: 'n',
  attempt: 0,
  path: 'n',
  category: 'root',
  ...p,
});
const msg = (time: number, id: string, parent: string) =>
  fact({ kind: 'message_created', time, unitIdentity: id, category: 'message', parentIdentity: parent });
const settled = (time: number, id: string, outcome: SimLifecycleFact['outcome'], category: 'root' | 'message' = 'root') =>
  fact({ kind: 'unit_settled', time, unitIdentity: id, outcome, category });

describe('CycleTracker', () => {
  it('a plain request is complete when its response arrives', () => {
    const t = new CycleTracker();
    t.record(fact({ kind: 'admitted', time: 1, unitIdentity: 'w-0' }));
    t.record(settled(1.25, 'w-0', 'succeeded'));
    expect(t.cycles()).toEqual([
      expect.objectContaining({ id: 'w-0', startedAtMs: 1000, responseAtMs: 1250, completedAtMs: 1250, outcome: 'ok' }),
    ]);
  });

  it('takes the workload id from a UUID-style root identity', () => {
    const t = new CycleTracker();
    t.record(fact({ kind: 'admitted', time: 0, unitIdentity: 'aaaa-bbbb-cccc-7' }));
    expect(t.cycles()[0].workloadId).toBe('aaaa-bbbb-cccc');
  });

  it('completion waits for descendant messages after the response', () => {
    const t = new CycleTracker();
    t.record(fact({ kind: 'admitted', time: 0, unitIdentity: 'w-0' }));
    t.record(msg(0.1, 'w-0:p:e1:', 'w-0'));
    t.record(settled(0.2, 'w-0', 'succeeded'));
    expect(t.cycles()[0]).toMatchObject({ responseAtMs: 200, completedAtMs: null, outcome: null });
    expect(t.openCycleIds()).toEqual(['w-0']);
    t.record(settled(3, 'w-0:p:e1:', 'succeeded', 'message'));
    expect(t.cycles()[0]).toMatchObject({ responseAtMs: 200, completedAtMs: 3000, outcome: 'ok' });
  });

  it('a message published after the cycle looked complete reopens it', () => {
    const t = new CycleTracker();
    t.record(fact({ kind: 'admitted', time: 0, unitIdentity: 'w-0' }));
    t.record(settled(0.2, 'w-0', 'succeeded'));
    expect(t.cycles()[0].outcome).toBe('ok');
    t.record(msg(0.3, 'w-0:p:e1:', 'w-0'));
    expect(t.cycles()[0]).toMatchObject({ outcome: null, completedAtMs: null });
    t.record(settled(0.9, 'w-0:p:e1:', 'succeeded', 'message'));
    expect(t.cycles()[0]).toMatchObject({ outcome: 'ok', completedAtMs: 900 });
  });

  it('a failed descendant makes the cycle failed; counts cover every unit', () => {
    const t = new CycleTracker();
    t.record(fact({ kind: 'admitted', time: 0, unitIdentity: 'w-1' }));
    t.record(msg(0.1, 'w-1:p:e1:', 'w-1'));
    t.record(settled(0.2, 'w-1', 'succeeded'));
    t.record(settled(0.5, 'w-1:p:e1:', 'failed', 'message'));
    expect(t.cycles()[0].outcome).toBe('failed');
    expect(t.cycles()[0].counts).toMatchObject({ ok: 1, failed: 1 });
  });

  it('a root that expires is timed-out, a message that expires is expired, a rejected root is rejected', () => {
    const t = new CycleTracker();
    t.record(fact({ kind: 'admitted', time: 0, unitIdentity: 'w-2' }));
    t.record(settled(1, 'w-2', 'expired'));
    t.record(fact({ kind: 'rejected', time: 0, unitIdentity: 'w-3' }));
    t.record(settled(0, 'w-3', 'rejected'));
    t.record(fact({ kind: 'admitted', time: 0, unitIdentity: 'w-4' }));
    t.record(msg(0, 'w-4:p:e1:', 'w-4'));
    t.record(settled(0, 'w-4', 'succeeded'));
    t.record(settled(2, 'w-4:p:e1:', 'expired', 'message'));
    const byId = Object.fromEntries(t.cycles().map((c) => [c.id, c.outcome]));
    expect(byId).toEqual({ 'w-2': 'timed-out', 'w-3': 'rejected', 'w-4': 'expired' });
  });

  it('markStuck settles open units as stuck and completes their cycle', () => {
    const t = new CycleTracker();
    t.record(fact({ kind: 'admitted', time: 0, unitIdentity: 'w-4' }));
    t.record(msg(0.1, 'w-4:p:e1:', 'w-4'));
    t.record(settled(0.2, 'w-4', 'succeeded'));
    t.markStuck(['w-4:p:e1:'], 9000);
    expect(t.cycles()[0]).toMatchObject({ outcome: 'stuck', completedAtMs: 9000 });
  });

  it('summarizes counts and latencies', () => {
    const t = new CycleTracker();
    for (const [i, end] of [[0, 1], [1, 3]] as const) {
      t.record(fact({ kind: 'admitted', time: 0, unitIdentity: `w-${i}` }));
      t.record(settled(end, `w-${i}`, 'succeeded'));
    }
    t.record(fact({ kind: 'admitted', time: 0, unitIdentity: 'w-9' }));
    const s = t.summary();
    expect(s).toMatchObject({ total: 3, open: 1, byOutcome: expect.objectContaining({ ok: 2 }) });
    expect(s.completionLatencyMs).toEqual({ mean: 2000, max: 3000 });
    expect(s.responseLatencyMs).toEqual({ mean: 2000, max: 3000 });
  });
});
