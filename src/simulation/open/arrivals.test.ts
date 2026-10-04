import { describe, expect, it } from 'vitest';
import type { ExecutionEdge, ExecutionGraph, ExecutionNode, WorkloadSchedule } from '../../domain/execution';
import { defaultBehavior, defaultExecutionEdge, defaultWorkload } from '../../domain/behaviorDefaults';
import { OpenSimulation, type SimLifecycleFact } from './kernel';

function graphWith(schedule: WorkloadSchedule, extra: { rate?: number; edges?: ExecutionEdge[]; nodes?: ExecutionNode[] } = {}): ExecutionGraph {
  const nodes: ExecutionNode[] = extra.nodes ?? [
    { id: 'src', kind: 'traffic', name: 'src', position: { x: 0, y: 0 }, behavior: defaultBehavior('traffic') },
    { id: 'svc', kind: 'service', name: 'svc', position: { x: 0, y: 0 }, behavior: defaultBehavior('service') },
  ];
  const edge = defaultExecutionEdge('src', 'svc');
  edge.id = 'e1';
  const wl = defaultWorkload('src');
  wl.id = 'w';
  wl.rate = extra.rate ?? 0;
  wl.schedule = schedule;
  return {
    executionVersion: 'open-system/1',
    nodes,
    edges: extra.edges ?? [edge],
    workloads: [wl],
    settings: { seed: 7, duration: 3600 },
  };
}

/** Steps real work only (the periodic sample never ends), until nothing more can happen or the clock passes `untilSeconds`. */
function run(sim: OpenSimulation, untilSeconds = Infinity): void {
  while (sim.hasPendingWork() && (sim.peekNextEvent()?.time ?? Infinity) <= untilSeconds) sim.stepEvent();
}

describe('bulk arrivals', () => {
  it('sends exactly N requests, then nothing is pending once they settle', () => {
    const facts: SimLifecycleFact[] = [];
    const sim = new OpenSimulation(graphWith({ kind: 'bulk', requests: 25, arrival: { spreadMs: 1000 }, startDelayMs: 0 }), { traceHook: (f) => facts.push(f) });
    run(sim);
    expect(sim.snapshot().roots.generated).toBe(25);
    expect(facts.filter((f) => f.kind === 'unit_settled' && f.category === 'root')).toHaveLength(25);
    expect(sim.isIdle()).toBe(true);
    expect(sim.pendingArrivalCount()).toBe(0);
    expect(sim.unsettled()).toEqual([]);
  });

  it('honors the start delay for the first arrival', () => {
    const facts: SimLifecycleFact[] = [];
    const sim = new OpenSimulation(graphWith({ kind: 'bulk', requests: 3, arrival: 'instant', startDelayMs: 400 }), { traceHook: (f) => facts.push(f) });
    run(sim);
    expect(facts.find((f) => f.kind === 'admitted')!.time).toBeCloseTo(0.4, 9);
  });

  it('spreads arrivals evenly', () => {
    const times: number[] = [];
    const sim = new OpenSimulation(graphWith({ kind: 'bulk', requests: 4, arrival: { spreadMs: 2000 }, startDelayMs: 0 }), {
      traceHook: (f) => { if (f.kind === 'admitted') times.push(f.time); },
    });
    run(sim);
    expect(times).toEqual([0, 0.5, 1, 1.5]);
  });
});

describe('stream arrivals', () => {
  it('keeps arriving until stopArrivals, then nothing more is generated', () => {
    const sim = new OpenSimulation(graphWith({ kind: 'stream', startDelayMs: 0 }, { rate: 50 }));
    run(sim, 2);
    const before = sim.snapshot().roots.generated;
    expect(before).toBeGreaterThan(50);
    expect(sim.pendingArrivalCount()).toBeGreaterThan(0);
    sim.stopArrivals();
    run(sim);
    expect(sim.snapshot().roots.generated).toBe(before);
    expect(sim.isIdle()).toBe(true);
  });

  it('starts after its delay', () => {
    const first: number[] = [];
    const sim = new OpenSimulation(graphWith({ kind: 'stream', startDelayMs: 1500 }, { rate: 100 }), {
      traceHook: (f) => { if (f.kind === 'admitted' && first.length === 0) first.push(f.time); },
    });
    run(sim, 3);
    expect(first[0]).toBeGreaterThanOrEqual(1.5);
  });
});

describe('message TTL', () => {
  /** entry -> svc (call) -> queue (message, `messageTtlMs`) -> one slow worker (1 message per second). */
  function queueGraph(messageTtlMs: number | null): ExecutionGraph {
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
    publish.messageTtlMs = messageTtlMs;
    const deliver = defaultExecutionEdge('q', 'w', nodes[3].behavior);
    deliver.id = 'e3';
    deliver.transport = 'message';
    deliver.messageTtlMs = null;
    return graphWith({ kind: 'bulk', requests: 3, arrival: 'instant', startDelayMs: 0 }, { nodes, edges: [call, publish, deliver] });
  }

  it('a message with no TTL waits for the slow worker and is delivered', () => {
    const sim = new OpenSimulation(queueGraph(null), { requireRunnable: false });
    run(sim);
    expect(sim.snapshot().messages.expired).toBe(0);
    expect(sim.snapshot().messages.succeeded).toBe(3);
    expect(sim.unsettled()).toEqual([]);
  });

  it('with a short TTL the messages still waiting expire', () => {
    const sim = new OpenSimulation(queueGraph(500), { requireRunnable: false });
    run(sim);
    expect(sim.snapshot().messages.expired).toBeGreaterThan(0);
    expect(sim.unsettled()).toEqual([]);
  });

  it('reports units that are still live (unsettled) mid-run', () => {
    const sim = new OpenSimulation(queueGraph(null), { requireRunnable: false });
    run(sim, 0.5);
    expect(sim.unsettled().length).toBeGreaterThan(0);
  });
});
