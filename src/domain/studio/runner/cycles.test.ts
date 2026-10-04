import { describe, expect, it } from 'vitest';
import type { SimLifecycleFact } from '../../../simulation/open/kernel';
import type { ExecutionGraph, ExecutionNode } from '../../../domain/execution';
import { defaultBehavior, defaultExecutionEdge, defaultWorkload } from '../../../domain/behaviorDefaults';
import { OpenSimulation } from '../../../simulation/open/kernel';
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

describe('CycleTracker with the kernel', () => {
  /** entry -> svc (call) -> queue (message) -> one worker that takes 1 s per message. */
  function slowConsumerGraph(): ExecutionGraph {
    const nodes: ExecutionNode[] = [
      { id: 'src', kind: 'traffic', name: 'src', position: { x: 0, y: 0 }, behavior: defaultBehavior('traffic') },
      { id: 'svc', kind: 'service', name: 'svc', position: { x: 0, y: 0 }, behavior: defaultBehavior('service') },
      {
        id: 'q', kind: 'queue', name: 'q', position: { x: 0, y: 0 },
        behavior: { type: 'broker', delivery: 'competing', capacity: 2000, concurrency: 1, queueLimit: 100, failureRate: 0, maxRetries: 0, retryDelayMs: 100 },
      },
      {
        id: 'w', kind: 'worker', name: 'w', position: { x: 0, y: 0 },
        behavior: { type: 'processor', capacity: 1, concurrency: 1, queueLimit: 100, failureRate: 0, maxRetries: 0, retryDelayMs: 100 },
      },
    ];
    const call = defaultExecutionEdge('src', 'svc');
    call.id = 'e1';
    const publish = defaultExecutionEdge('svc', 'q', nodes[2].behavior);
    publish.id = 'e2';
    publish.messageTtlMs = null;
    const deliver = defaultExecutionEdge('q', 'w', nodes[3].behavior);
    deliver.id = 'e3';
    deliver.transport = 'message';
    deliver.messageTtlMs = null;
    const wl = defaultWorkload('src');
    wl.id = 'w';
    wl.schedule = { kind: 'bulk', requests: 3, arrival: 'instant', startDelayMs: 0 };
    return { executionVersion: 'open-system/1', nodes, edges: [call, publish, deliver], workloads: [wl], settings: { seed: 3, duration: 3600 } };
  }

  it('the response comes back at once; the cycle completes when the slow consumer is done', () => {
    const tracker = new CycleTracker();
    const sim = new OpenSimulation(slowConsumerGraph(), { requireRunnable: false, traceHook: (f) => tracker.record(f) });
    while (sim.hasPendingWork()) sim.stepEvent();
    const cycles = tracker.cycles();
    expect(cycles).toHaveLength(3);
    for (const c of cycles) {
      expect(c.outcome).toBe('ok');
      expect(c.responseAtMs!).toBeLessThan(200);
      expect(c.completedAtMs!).toBeGreaterThan(c.responseAtMs! + 500);
    }
    // One worker at 1 message per second: the cycles finish about a second apart.
    const done = cycles.map((c) => c.completedAtMs!).sort((a, b) => a - b);
    expect(done[2] - done[0]).toBeGreaterThan(1500);
    expect(tracker.summary().completionLatencyMs!.mean).toBeGreaterThan(tracker.summary().responseLatencyMs!.mean * 5);
  });
});

describe('CycleTracker streaming out', () => {
  const run = (t: CycleTracker, id: string, start: number, end: number) => {
    t.record(fact({ kind: 'admitted', time: start, unitIdentity: id }));
    t.record(settled(end, id, 'succeeded'));
  };

  it('drainFinished hands out each completed cycle once, in completion order', () => {
    const t = new CycleTracker();
    run(t, 'w-0', 0, 2);
    run(t, 'w-1', 0, 1);
    t.record(fact({ kind: 'admitted', time: 0, unitIdentity: 'w-2' }));
    expect(t.drainFinished().map((c) => c.id)).toEqual(['w-0', 'w-1']);
    expect(t.drainFinished()).toEqual([]);
    t.record(settled(3, 'w-2', 'succeeded'));
    expect(t.drainFinished().map((c) => c.id)).toEqual(['w-2']);
  });

  it('discardFinished frees drained cycles but the summary still counts them', () => {
    const t = new CycleTracker({ discardFinished: true });
    run(t, 'w-0', 0, 1);
    run(t, 'w-1', 0, 3);
    t.record(fact({ kind: 'admitted', time: 0, unitIdentity: 'w-2' }));
    t.drainFinished();
    expect(t.cycles().map((c) => c.id)).toEqual(['w-2']);
    const s = t.summary();
    expect(s).toMatchObject({ total: 3, open: 1, byOutcome: expect.objectContaining({ ok: 2 }) });
    expect(s.completionLatencyMs).toEqual({ mean: 2000, max: 3000 });
  });

  it('a cycle that reopens after it was drained is handed out again when it completes', () => {
    const t = new CycleTracker();
    run(t, 'w-0', 0, 1);
    expect(t.drainFinished()).toHaveLength(1);
    t.record(msg(2, 'w-0:p:e:', 'w-0'));
    t.record(settled(4, 'w-0:p:e:', 'succeeded', 'message'));
    expect(t.drainFinished().map((c) => [c.id, c.completedAtMs])).toEqual([['w-0', 4000]]);
    expect(t.summary().byOutcome.ok).toBe(1);
    expect(t.summary().completionLatencyMs).toEqual({ mean: 4000, max: 4000 });
  });
});
