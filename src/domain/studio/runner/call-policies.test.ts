/**
 * D54: the caller's circuit breaker, in-flight limit and hedging, link jitter, loss and bandwidth,
 * a callee's concurrency cap, and message confirm and batching, all through the real planners and
 * the scenario runner.
 */
import { describe, expect, it } from 'vitest';
import type { Assertion, Document, Id, Scenario } from '../model';
import { applyRecordChanges } from '../../../persistence/studio/apply-records';
import { checkReadiness } from '../readiness';
import { validateDocument } from '../validate';
import { placeEntry } from '../../../features/catalog/place';
import { completeConnection, planConnection } from '../../../features/catalog/connect';
import { DEFAULT_SCENARIO_BUDGETS } from '../../../features/scenarios/budgets';
import { runScenario } from './scenario-runner';

type Patch = Record<string, unknown>;

/** gateway-less chain: a workload enters `caller`, which calls `callee` (or publishes to a queue feeding a worker). */
function build(opts: {
  kind?: 'call' | 'publish';
  callerOut?: Patch;
  calleeIn?: Patch;
  calleeConfig?: Patch;
  link?: Patch;
  rate?: number;
  seconds?: number;
}): { doc: Document; caller: Id; callee: Id; worker: Id | null } {
  let n = 0;
  const mint = () => `00000000-0009-4000-8000-${(++n).toString(16).padStart(12, '0')}`;
  const viewId = mint();
  let doc: Document = {
    schema: 'studio-model/1', id: mint(), title: 'Call policies', elements: [], connections: [], relations: [], schemas: [],
    fixtures: [], refinements: [], scenarios: [],
    views: [{ id: viewId, label: 'Main', placements: [], connectionIds: [], relationIds: [], groups: [], notes: [] }],
  };
  const apply = (changes: Parameters<typeof applyRecordChanges>[1]) => {
    const r = applyRecordChanges(doc, changes);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    doc = r.document;
  };
  const el = (id: Id) => doc.elements.find((e) => e.id === id)!;
  const place = (entryId: string, x: number): Id => {
    const r = placeEntry({ document: doc, viewId, entryId, anchor: { x, y: 0 }, mintId: mint });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    apply(r.changes);
    return r.elementId;
  };
  const connect = (from: Id, to: Id): Id => {
    const out = el(from).ports.find((p) => p.direction === 'out' && p.channel !== 'event')!;
    const r = planConnection({ document: doc, viewId, source: { elementId: from, portId: out.id }, target: { elementId: to }, mintId: mint });
    if (r.kind === 'rejected') throw new Error(JSON.stringify(r.issues));
    if (r.kind === 'ready') {
      apply(r.changes);
      return r.connectionId;
    }
    const c = completeConnection(r.draft);
    if (!c.ok) throw new Error(JSON.stringify(c.issues));
    apply(c.changes);
    return c.connectionId;
  };
  const patchPort = (id: Id, direction: 'in' | 'out', channel: 'call' | 'message', settings: Patch) => {
    const e = el(id);
    apply([{ kind: 'replace', value: { recordKind: 'element', record: { ...e, ports: e.ports.map((p) => (p.direction === direction && p.channel === channel ? { ...p, settings: { ...(p.settings ?? {}), ...settings } } : p)) } } } as never]);
  };

  const caller = place('service', 0);
  let callee: Id;
  let worker: Id | null = null;
  let connectionId: Id;
  if (opts.kind === 'publish') {
    callee = place('queue', 300);
    worker = place('worker', 600);
    connectionId = connect(caller, callee);
    connect(callee, worker);
  } else {
    callee = place('service', 300);
    connectionId = connect(caller, callee);
  }
  if (opts.calleeConfig) {
    const e = el(callee);
    if (e.behavior.kind !== 'resource') throw new Error('not a resource');
    apply([{ kind: 'replace', value: { recordKind: 'element', record: { ...e, behavior: { ...e.behavior, config: { ...e.behavior.config, ...opts.calleeConfig } } } } } as never]);
  }
  const channel = opts.kind === 'publish' ? 'message' : 'call';
  if (opts.callerOut) patchPort(caller, 'out', channel, opts.callerOut);
  if (opts.calleeIn) patchPort(callee, 'in', channel, opts.calleeIn);
  if (opts.link) {
    const c = doc.connections.find((x) => x.id === connectionId)!;
    apply([{ kind: 'replace', value: { recordKind: 'connection', record: { ...c, config: { ...c.config, ...opts.link } } } } as never]);
  }

  const entry = { elementId: caller, portId: (el(caller).behavior as { entryPortId: Id }).entryPortId };
  const count = (outcome: 'succeeded' | 'failed' | 'rejected' | 'expired'): Assertion => ({
    id: mint(), label: outcome, subject: { kind: 'count', scope: 'root', elementId: null, outcome }, operator: 'at-least', expected: 0,
  });
  const scenario: Scenario = {
    id: mint(), label: 'Steady', revision: 0, mode: 'timed', scopeElementIds: doc.elements.map((e) => e.id),
    entryPorts: [entry], inputs: [],
    workloads: [{
      id: mint(), entry, enabled: true, rate: opts.rate ?? 50, profile: { kind: 'steady' }, timeoutMs: 30000, intervalMs: null,
      classes: [{ id: mint(), name: 'Req', weight: 1, operation: 'read', tags: [], keyDistribution: { kind: 'uniform', catalogSize: 100, hotSubset: 1, hotShare: 100 } }],
    }],
    faults: [], boundaries: [], refinementSelections: [], initialContexts: [],
    assertions: [count('succeeded'), count('failed'), count('rejected'), count('expired')],
    seed: 9, budgets: DEFAULT_SCENARIO_BUDGETS, completion: { kind: 'drain', arrivalHorizonMs: (opts.seconds ?? 5) * 1000, deadlineMs: 60000 }, assumptions: [],
  };
  return { doc: { ...doc, scenarios: [scenario] }, caller, callee, worker };
}

async function run(o: Parameters<typeof build>[0]) {
  const { doc, callee, caller, worker } = build(o);
  const valid = validateDocument(doc);
  expect(valid.ok ? [] : valid.issues).toEqual([]);
  expect(checkReadiness(doc, doc.scenarios[0].id).ready).toBe(true);
  const r = await runScenario(doc, doc.scenarios[0].id, 'policies');
  expect(r.status).toBe('completed');
  const metric = (id: Id | null, key: string, scope: 'root' | 'message' | 'element' = 'element') =>
    r.summary.elementMetrics.find((m) => m.elementId === id && m.key === key && m.scope === scope)?.value ?? 0;
  return {
    roots: r.summary.rootCounts as { generated: number; succeeded: number; failed: number; rejected: number; expired: number },
    messages: r.summary.messageCounts as { generated: number; succeeded: number; failed: number; rejected: number; expired: number },
    atCallee: (key: string) => metric(callee, key),
    atCaller: (key: string) => metric(caller, key),
    atWorker: (key: string) => (worker ? metric(worker, key) : 0),
    latencyMs: metric(caller, 'p95LatencyMs'),
    meanMs: metric(caller, 'meanLatencyMs'),
  };
}

describe('callee concurrency cap (D54)', () => {
  it('rejects calls beyond the endpoint\'s slots, while an uncapped endpoint absorbs them', async () => {
    const slow = { serviceTimeMs: 1000 };
    const open = await run({ calleeIn: slow });
    const capped = await run({ calleeIn: { ...slow, maxConcurrency: 5 } });
    expect(open.roots.succeeded).toBe(open.roots.generated);
    // A call the callee turns away fails its caller.
    expect(capped.roots.succeeded).toBeLessThan(capped.roots.generated / 2);
    expect(capped.roots.failed).toBeGreaterThan(0);
    expect(capped.roots.succeeded + capped.roots.failed).toBe(capped.roots.generated);
  });
});

describe('caller circuit breaker (D54)', () => {
  // A failing callee that takes 100 ms per call: the load it carries shows in its utilization.
  const failing = { failureRate: 100, serviceTimeMs: 100 };
  it('stops sending to a callee that keeps failing, and probes again after it has been open a while', async () => {
    const without = await run({ calleeIn: failing });
    const breaker = { failureThreshold: 3, openMs: 1000, halfOpenProbes: 1 };
    const withBreaker = await run({ calleeIn: failing, callerOut: { circuitBreaker: breaker } });
    // Every call fails either way, but far fewer reach the callee behind a breaker.
    expect(without.roots.failed).toBe(without.roots.generated);
    expect(withBreaker.roots.failed + withBreaker.roots.rejected).toBe(withBreaker.roots.generated);
    expect(without.atCallee('utilization')).toBeGreaterThan(0);
    expect(withBreaker.atCallee('utilization')).toBeLessThan(without.atCallee('utilization') / 3);
    // The trip itself and the probes still reach it.
    expect(withBreaker.atCallee('utilization')).toBeGreaterThan(0);
  });

  it('stays closed while the callee is healthy', async () => {
    const r = await run({ callerOut: { circuitBreaker: { failureThreshold: 3, openMs: 1000, halfOpenProbes: 1 } } });
    expect(r.roots.succeeded).toBe(r.roots.generated);
  });
});

describe('caller in-flight limit (D54)', () => {
  it('fails calls fast once that many are outstanding', async () => {
    const slow = { serviceTimeMs: 400 };
    const open = await run({ calleeIn: slow });
    const limited = await run({ calleeIn: slow, callerOut: { maxInFlight: 5 } });
    expect(open.roots.succeeded).toBe(open.roots.generated);
    expect(limited.roots.succeeded).toBeLessThan(limited.roots.generated);
    // Fast-failed calls never reach the callee, so it carries less load.
    expect(limited.atCallee('utilization')).toBeLessThan(open.atCallee('utilization'));
  });
});

describe('hedged calls (D54)', () => {
  it('send a second copy of a slow call, which adds load but cuts the tail', async () => {
    // Half the time the callee is slow: a 20% failure rate cannot be hedged around, but latency can.
    const base = { calleeConfig: { serviceTime: 'lognormal', serviceTimeCv: 3 } };
    const plain = await run({ ...base, calleeIn: { serviceTimeMs: 50 } });
    const hedged = await run({ ...base, calleeIn: { serviceTimeMs: 50 }, callerOut: { hedge: { afterMs: 80 } } });
    expect(hedged.atCallee('utilization')).toBeGreaterThan(plain.atCallee('utilization'));
    expect(hedged.latencyMs).toBeLessThan(plain.latencyMs);
    expect(hedged.roots.succeeded).toBe(hedged.roots.generated);
  });
});

describe('link impairments (D54)', () => {
  it('loss: a lost request or response never reaches the caller, so only a timeout or the deadline ends the call', async () => {
    const lossy = await run({ link: { lossRate: 30 }, callerOut: { retry: { maxAttempts: 1, backoffMs: 0, backoffMultiplier: 1, maxBackoffMs: 0, jitter: false, attemptTimeoutMs: null } } });
    // About half the calls lose a leg (30% each way) and expire at the 30 s deadline.
    expect(lossy.roots.expired).toBeGreaterThan(lossy.roots.generated * 0.3);
    expect(lossy.roots.succeeded).toBeGreaterThan(lossy.roots.generated * 0.4);
    expect(lossy.roots.succeeded + lossy.roots.expired).toBe(lossy.roots.generated);
  });

  it('loss with an attempt timeout and retries recovers most calls', async () => {
    const retry = { maxAttempts: 4, backoffMs: 10, backoffMultiplier: 1, maxBackoffMs: 10, jitter: false, attemptTimeoutMs: 200 };
    const r = await run({ link: { lossRate: 30 }, callerOut: { retry } });
    expect(r.roots.succeeded).toBeGreaterThan(r.roots.generated * 0.85);
  });

  it('jitter widens the latency; bandwidth adds transfer time per byte', async () => {
    const steady = await run({ link: { latencyMs: 2 } });
    const jittery = await run({ link: { jitterMs: 100 } });
    expect(jittery.meanMs).toBeGreaterThan(steady.meanMs + 50);
    // 100 kB over 8 000 kbps is 100 ms each way.
    const slowLink = await run({ link: { bandwidthKbps: 8000 }, callerOut: { requestBytes: 100_000 }, calleeIn: { responseBytes: 100_000 } });
    expect(slowLink.meanMs).toBeGreaterThan(steady.meanMs + 150);
    const noBytes = await run({ link: { bandwidthKbps: 8000 } });
    expect(noBytes.meanMs).toBeCloseTo(steady.meanMs, 0);
  });
});

describe('message publishing (D54)', () => {
  const ack = { ackDelayMs: 200 };
  it('confirm waits for the acknowledgement; fire and forget does not', async () => {
    const confirmed = await run({ kind: 'publish', calleeIn: ack });
    const forgotten = await run({ kind: 'publish', calleeIn: ack, callerOut: { confirm: false } });
    expect(confirmed.meanMs).toBeGreaterThan(forgotten.meanMs + 150);
    expect(forgotten.roots.succeeded).toBe(forgotten.roots.generated);
    // The messages still arrive and are worked.
    expect(forgotten.messages.generated).toBe(confirmed.messages.generated);
  });

  it('fire and forget hides a full queue from the publisher', async () => {
    const small = { calleeConfig: { queueLimit: 1 }, rate: 200 };
    const confirmed = await run({ kind: 'publish', ...small });
    const forgotten = await run({ kind: 'publish', ...small, callerOut: { confirm: false } });
    expect(confirmed.roots.failed).toBeGreaterThan(0);
    expect(forgotten.roots.failed).toBe(0);
  });

  it('a batch holds publishes until it is full or its window passes, delaying the acknowledgement', async () => {
    const plain = await run({ kind: 'publish', rate: 20 });
    const batched = await run({ kind: 'publish', rate: 20, callerOut: { batch: { size: 1000, windowMs: 300 } } });
    expect(batched.meanMs).toBeGreaterThan(plain.meanMs + 100);
    expect(batched.roots.succeeded).toBe(batched.roots.generated);
    // A full batch leaves at once, without waiting out the window.
    const full = await run({ kind: 'publish', rate: 100, callerOut: { batch: { size: 2, windowMs: 2000 } } });
    expect(full.meanMs).toBeLessThan(plain.meanMs + 100);
  });

  it('a lost message is never delivered and expires at its TTL', async () => {
    const r = await run({ kind: 'publish', link: { lossRate: 100 }, calleeIn: { messageTtlMs: 2000 } });
    expect(r.messages.expired).toBe(r.messages.generated);
    expect(r.atWorker('succeeded')).toBe(0);
  });
});
