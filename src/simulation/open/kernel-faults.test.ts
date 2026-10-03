import { describe, it, expect } from 'vitest';
import { OpenSimulation, type SimLifecycleFact } from './kernel';
import type { ExecutionGraph, ExecutionNode } from '../../domain/execution';

function makeGraph(): ExecutionGraph {
  const nodes: ExecutionNode[] = [
    {
      id: 'svc',
      kind: 'service',
      name: 'Service',
      position: { x: 0, y: 0 },
      behavior: {
        type: 'processor',
        capacity: 1, // 1000ms service time
        concurrency: 1,
        queueLimit: 1,
        failureRate: 0,
        maxRetries: 0,
        retryDelayMs: 0,
      },
    },
  ];
  return {
    executionVersion: 'open-system/1',
    nodes,
    edges: [],
    workloads: [],
    settings: { seed: 42, duration: 10 },
  };
}

describe('kernel fault support', () => {
  it('active work fails once and queued work is rejected once on host outage, completion cancelled', () => {
    const facts: SimLifecycleFact[] = [];
    const graph = makeGraph();
    const sim = new OpenSimulation(graph, {
      requireRunnable: false,
      traceHook: (f) => facts.push(f),
      hostPlacement: new Map([['svc', 'H1']]),
      faults: [
        {
          id: 'f1',
          hostId: 'H1',
          downAtMs: 500,
          upAtMs: 1500,
          detectionDelayMs: 0,
          recoveryDetectionDelayMs: 0,
          activePolicy: 'fail',
          queuedPolicy: 'reject',
          routeReset: 'first-healthy',
        },
      ],
    });

    // t=0: admit op x
    sim.injectInput({
      entryNodeId: 'svc',
      identity: 'x',
      time: 0,
      deadline: 9,
      key: null,
      requestClass: { id: 'c', name: 'c', weight: 1, operation: 'read', tags: [], keyDistribution: { kind: 'uniform', catalogSize: 10, hotSubset: 1, hotShare: 50 } },
    });

    // t=0.25: admit op y (queued)
    sim.injectInput({
      entryNodeId: 'svc',
      identity: 'y',
      time: 0.25,
      deadline: 9,
      key: null,
      requestClass: { id: 'c', name: 'c', weight: 1, operation: 'read', tags: [], keyDistribution: { kind: 'uniform', catalogSize: 10, hotSubset: 1, hotShare: 50 } },
    });

    // Step until past 1.0s (outage at 0.5s, original completion of x at 1.0s)
    while (sim.peekNextEvent() && sim.peekNextEvent()!.time <= 1.2) {
      sim.stepEvent();
    }

    // Host should be down
    expect(sim.getHostState('H1')).toBe(false);

    // x settled failed, y settled rejected
    const xSettled = facts.filter((f) => f.unitIdentity === 'x' && f.kind === 'unit_settled');
    expect(xSettled.length).toBe(1);
    expect(xSettled[0].outcome).toBe('failed');

    const ySettled = facts.filter((f) => f.unitIdentity === 'y' && f.kind === 'unit_settled');
    expect(ySettled.length).toBe(1);
    expect(ySettled[0].outcome).toBe('rejected');

    // Snapshot check: nothing active or queued
    const snap = sim.snapshot();
    expect(snap.nodes.svc.activeWorkers).toBe(0);
    expect(snap.nodes.svc.queued).toBe(0);
    expect(snap.roots.failed).toBe(1);
    expect(snap.roots.rejected).toBe(1);
    expect(snap.roots.succeeded).toBe(0);

    // Step until recovery (t=1.5s)
    while (sim.peekNextEvent() && sim.peekNextEvent()!.time <= 1.5) {
      sim.stepEvent();
    }
    expect(sim.getHostState('H1')).toBe(true);

    // Admit op z at t=1.6s
    sim.injectInput({
      entryNodeId: 'svc',
      identity: 'z',
      time: 1.6,
      deadline: 9,
      key: null,
      requestClass: { id: 'c', name: 'c', weight: 1, operation: 'read', tags: [], keyDistribution: { kind: 'uniform', catalogSize: 10, hotSubset: 1, hotShare: 50 } },
    });

    while (sim.peekNextEvent()) {
      sim.stepEvent();
    }

    const zSettled = facts.filter((f) => f.unitIdentity === 'z' && f.kind === 'unit_settled');
    expect(zSettled.length).toBe(1);
    expect(zSettled[0].outcome).toBe('succeeded');

    const finalSnap = sim.snapshot();
    expect(finalSnap.roots.generated).toBe(3);
    expect(finalSnap.roots.succeeded).toBe(1);
    expect(finalSnap.roots.failed).toBe(1);
    expect(finalSnap.roots.rejected).toBe(1);
  });

  it('outage exactly at completion time: outage phase comes first and work fails once', () => {
    const facts: SimLifecycleFact[] = [];
    const graph = makeGraph();
    const sim = new OpenSimulation(graph, {
      requireRunnable: false,
      traceHook: (f) => facts.push(f),
      hostPlacement: new Map([['svc', 'H1']]),
      faults: [
        {
          id: 'f1',
          hostId: 'H1',
          downAtMs: 1000, // Exactly at completion of x (t=0 + 1000ms service time)
          upAtMs: 1500,
          detectionDelayMs: 0,
          recoveryDetectionDelayMs: 0,
          activePolicy: 'fail',
          queuedPolicy: 'reject',
          routeReset: 'first-healthy',
        },
      ],
    });

    sim.injectInput({
      entryNodeId: 'svc',
      identity: 'x',
      time: 0,
      deadline: 9,
      key: null,
      requestClass: { id: 'c', name: 'c', weight: 1, operation: 'read', tags: [], keyDistribution: { kind: 'uniform', catalogSize: 10, hotSubset: 1, hotShare: 50 } },
    });

    while (sim.peekNextEvent()) {
      sim.stepEvent();
    }

    const xSettled = facts.filter((f) => f.unitIdentity === 'x' && f.kind === 'unit_settled');
    expect(xSettled.length).toBe(1);
    expect(xSettled[0].outcome).toBe('failed');

    const snap = sim.snapshot();
    expect(snap.roots.failed).toBe(1);
    expect(snap.roots.succeeded).toBe(0);
  });

  it('admission to host actually down is rejected immediately', () => {
    const facts: SimLifecycleFact[] = [];
    const graph = makeGraph();
    const sim = new OpenSimulation(graph, {
      requireRunnable: false,
      traceHook: (f) => facts.push(f),
      hostPlacement: new Map([['svc', 'H1']]),
      faults: [
        {
          id: 'f1',
          hostId: 'H1',
          downAtMs: 500,
          upAtMs: 1500,
          detectionDelayMs: 1000,
          recoveryDetectionDelayMs: 0,
          activePolicy: 'fail',
          queuedPolicy: 'reject',
          routeReset: 'first-healthy',
        },
      ],
    });

    // Advance past down time
    while (sim.peekNextEvent() && sim.peekNextEvent()!.time <= 0.6) {
      sim.stepEvent();
    }

    // Host is down, admit op at t=0.7s
    const accepted = sim.injectInput({
      entryNodeId: 'svc',
      identity: 'rej',
      time: 0.7,
      deadline: 9,
      key: null,
      requestClass: { id: 'c', name: 'c', weight: 1, operation: 'read', tags: [], keyDistribution: { kind: 'uniform', catalogSize: 10, hotSubset: 1, hotShare: 50 } },
    });

    expect(accepted).toBe(false);
    const rejSettled = facts.filter((f) => f.unitIdentity === 'rej' && f.kind === 'unit_settled');
    expect(rejSettled.length).toBe(1);
    expect(rejSettled[0].outcome).toBe('rejected');
  });

  function makeRetryableGraph(): ExecutionGraph {
    const nodes: ExecutionNode[] = [
      {
        id: 'svc',
        kind: 'service',
        name: 'Service',
        position: { x: 0, y: 0 },
        behavior: {
          type: 'processor',
          capacity: 1, // 1000ms service time
          concurrency: 1,
          queueLimit: 0,
          failureRate: 100, // always fails processing, forcing a retry
          maxRetries: 1,
          retryDelayMs: 1500,
        },
      },
    ];
    return {
      executionVersion: 'open-system/1',
      nodes,
      edges: [],
      workloads: [],
      settings: { seed: 42, duration: 10 },
    };
  }

  it('a retrying op is left alone at outage time; its retry timer re-admits normally and is rejected because the host is still down', () => {
    // First attempt admitted at t=0 while the host is up; it fails processing at t=1s
    // (1000ms service time, failureRate 100%) and schedules a retry for t=1+1.5=2.5s.
    // Outage covers [2.0, 3.0]s, so the retry's re-admission at t=2.5s lands mid-outage:
    // it must NOT be proactively failed at outage time (t=2.0), and must be rejected as
    // unavailable (not failed) when its timer actually fires (§6 Faults).
    const facts: SimLifecycleFact[] = [];
    const graph = makeRetryableGraph();
    const sim = new OpenSimulation(graph, {
      requireRunnable: false,
      traceHook: (f) => facts.push(f),
      hostPlacement: new Map([['svc', 'H1']]),
      faults: [
        {
          id: 'f1',
          hostId: 'H1',
          downAtMs: 2000,
          upAtMs: 3000,
          detectionDelayMs: 0,
          recoveryDetectionDelayMs: 0,
          activePolicy: 'fail',
          queuedPolicy: 'reject',
          routeReset: 'first-healthy',
        },
      ],
    });

    sim.injectInput({
      entryNodeId: 'svc',
      identity: 'r1',
      time: 0,
      deadline: 9,
      key: null,
      requestClass: { id: 'c', name: 'c', weight: 1, operation: 'read', tags: [], keyDistribution: { kind: 'uniform', catalogSize: 10, hotSubset: 1, hotShare: 50 } },
    });

    while (sim.peekNextEvent()) {
      sim.stepEvent();
    }

    // Not proactively failed at outage time (t=2.0s): no 'attempt_settled'/'unit_settled'
    // fact for r1 fires at t=2.0s.
    const factsAt2s = facts.filter((f) => f.unitIdentity === 'r1' && Math.abs(f.time - 2.0) < 1e-9);
    expect(factsAt2s.length).toBe(0);

    // The retry never gets a second 'started' fact: it was rejected at admission, not
    // processed.
    const started = facts.filter((f) => f.unitIdentity === 'r1' && f.kind === 'started');
    expect(started.length).toBe(1); // only the original attempt started processing

    // Root settles rejected once, at the retry's admission time (t=2.5s).
    const unitSettled = facts.filter((f) => f.unitIdentity === 'r1' && f.kind === 'unit_settled');
    expect(unitSettled.length).toBe(1);
    expect(unitSettled[0].outcome).toBe('rejected');
    expect(unitSettled[0].time).toBeCloseTo(2.5, 6);
  });

  it('a retry timer that fires after recovery is admitted normally', () => {
    // Same shape, but the outage ends before the retry's re-admission time: the retry at
    // t=2.5s must be admitted (started processing again), not rejected.
    const facts: SimLifecycleFact[] = [];
    const graph = makeRetryableGraph();
    const sim = new OpenSimulation(graph, {
      requireRunnable: false,
      traceHook: (f) => facts.push(f),
      hostPlacement: new Map([['svc', 'H1']]),
      faults: [
        {
          id: 'f1',
          hostId: 'H1',
          downAtMs: 2000,
          upAtMs: 2200, // recovered well before the retry re-admission at t=2.5s
          detectionDelayMs: 0,
          recoveryDetectionDelayMs: 0,
          activePolicy: 'fail',
          queuedPolicy: 'reject',
          routeReset: 'first-healthy',
        },
      ],
    });

    sim.injectInput({
      entryNodeId: 'svc',
      identity: 'r2',
      time: 0,
      deadline: 9,
      key: null,
      requestClass: { id: 'c', name: 'c', weight: 1, operation: 'read', tags: [], keyDistribution: { kind: 'uniform', catalogSize: 10, hotSubset: 1, hotShare: 50 } },
    });

    while (sim.peekNextEvent()) {
      sim.stepEvent();
    }

    // The retry was admitted and started processing a second attempt (attempt: 2).
    const started = facts.filter((f) => f.unitIdentity === 'r2' && f.kind === 'started');
    expect(started.length).toBe(2);
    expect(started[1].attempt).toBe(2);
    expect(started[1].time).toBeCloseTo(2.5, 6);

    // maxRetries is 1 and failureRate is 100%, so the second attempt also fails processing
    // (not admission-time rejection): the root settles 'failed', not 'rejected'.
    const unitSettled = facts.filter((f) => f.unitIdentity === 'r2' && f.kind === 'unit_settled');
    expect(unitSettled.length).toBe(1);
    expect(unitSettled[0].outcome).toBe('failed');
  });
});
