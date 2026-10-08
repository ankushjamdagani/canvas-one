import { describe, it, expect } from 'vitest';
import type {
  Element,
  CallConnection,
  ResourceConfig,
  Workload,
} from '../model';
import type { ResourceInput } from './types';
import { ResourceAdapter } from './resource-adapter';

function makeResourceElement(
  id: string,
  config: ResourceConfig,
  entryPortId = `${id}-in`,
): Element {
  return {
    id,
    label: id,
    description: '',
    visualKind: 'service',
    ports: [
      {
        id: entryPortId,
        label: 'in',
        direction: 'in',
        channel: 'call', protocol: 'http',
        schemaId: 'schema-1',
        responseSchemaId: 'schema-1',
      },
      {
        id: `${id}-out`,
        label: 'out',
        direction: 'out',
        channel: 'call', protocol: 'http',
        schemaId: 'schema-1',
        responseSchemaId: 'schema-1',
      },
    ],
    behavior: {
      kind: 'resource',
      version: 1,
      config,
      entryPortId,
    },
  };
}

function makeCallConnection(
  id: string,
  sourceEl: string,
  targetEl: string,
  latencyMs = 10,
  returnLatencyMs = 10,
): CallConnection {
  return {
    id,
    kind: 'call',
    source: { elementId: sourceEl, portId: `${sourceEl}-out` },
    target: { elementId: targetEl, portId: `${targetEl}-in` },
    config: {
      latencyMs,
      returnLatencyMs,
      weight: 1,
      condition: null,
      fallback: false,
      linkClass: null, jitterMs: 0, lossRate: 0, bandwidthKbps: null,
    },
  };
}

function makeResourceInput(overrides: Partial<ResourceInput> = {}): ResourceInput {
  return {
    rootId: overrides.rootId ?? 'root-1',
    journeyId: overrides.journeyId ?? 'journey-1',
    parentEventId: overrides.parentEventId ?? null,
    entryElementId: overrides.entryElementId ?? 'p1',
    requestClassId: overrides.requestClassId ?? 'rc-default',
    operation: overrides.operation ?? 'read',
    key: overrides.key !== undefined ? overrides.key : 'key-1',
    tags: overrides.tags ?? [],
    payloadRef: overrides.payloadRef ?? 'sha256:payload-1',
    atMs: overrides.atMs ?? 0,
    deadlineMs: overrides.deadlineMs ?? 2000,
  };
}

describe('Retained Resource Adapter', () => {
  it('1. a finite input admitted to a processor settles succeeded with the exact latency 1000/capacity ms plus edge latencies', () => {
    // p1: capacity 10 req/s -> service time = 1000/10 = 100 ms
    const p1 = makeResourceElement('p1', {
      type: 'processor',
      capacity: 10,
      concurrency: 1,
      queueLimit: 10,
      failureRate: 0,
      maxRetries: 0,
      retryDelayMs: 0,
    });

    // p2: capacity 20 req/s -> service time = 1000/20 = 50 ms
    const p2 = makeResourceElement('p2', {
      type: 'processor',
      capacity: 20,
      concurrency: 1,
      queueLimit: 10,
      failureRate: 0,
      maxRetries: 0,
      retryDelayMs: 0,
    });

    // edge: forward latency = 15 ms, return latency = 25 ms
    const conn = makeCallConnection('e-p1-p2', 'p1', 'p2', 15, 25);

    const adapter = new ResourceAdapter({
      runId: 'run-lat-test',
      elements: [p1, p2],
      connections: [conn],
      seed: 42,
      durationMs: 1000,
    });

    const input = makeResourceInput({
      rootId: 'req-exact-latency',
      entryElementId: 'p1',
      atMs: 0,
      deadlineMs: 1000,
    });

    const adm = adapter.admit(input);
    expect(adm.accepted).toBe(true);
    expect(adm.response).toBeNull();

    // Step until all events settle
    const allEvents = [...adm.events];
    while (adapter.peekNext()) {
      const delta = adapter.stepNext();
      allEvents.push(...delta.events);
    }

    const summary = adapter.snapshot();
    expect(summary.rootCounts.succeeded).toBe(1);
    expect(summary.rootCounts.inFlight).toBe(0);

    // Exact expected latency: 100ms (p1) + 15ms (edge) + 50ms (p2) + 25ms (return) = 190ms
    const expectedLatencyMs = 190;

    const unitSettled = allEvents.find((e) => e.kind === 'settled' && e.code === 'succeeded');
    expect(unitSettled).toBeDefined();
    expect(unitSettled!.atMs).toBe(expectedLatencyMs);
    expect(unitSettled!.outcome).toBe('succeeded');

    const meanLatencyMetric = summary.metrics.find((m) => m.key === 'meanLatencyMs');
    expect(meanLatencyMetric).toBeDefined();
    expect(meanLatencyMetric!.value).toBe(expectedLatencyMs);
  });

  it('2. queueLimit rejection -> Admission.accepted false with a response; a rejection settles once', () => {
    // p1: concurrency 1, queueLimit 0 -> second request must be rejected on arrival
    const p1 = makeResourceElement('p1', {
      type: 'processor',
      capacity: 10,
      concurrency: 1,
      queueLimit: 0,
      failureRate: 0,
      maxRetries: 0,
      retryDelayMs: 0,
    });

    const adapter = new ResourceAdapter({
      elements: [p1],
      connections: [],
      seed: 42,
      durationMs: 1000,
    });

    const input1 = makeResourceInput({
      rootId: 'req-1',
      payloadRef: 'sha256:payload-1',
      atMs: 0,
    });
    const adm1 = adapter.admit(input1);
    expect(adm1.accepted).toBe(true);
    expect(adm1.response).toBeNull();

    const input2 = makeResourceInput({
      rootId: 'req-2',
      payloadRef: 'sha256:payload-2',
      atMs: 0,
    });
    const adm2 = adapter.admit(input2);
    expect(adm2.accepted).toBe(false);
    expect(adm2.response).not.toBeNull();
    expect(adm2.response).toEqual({
      outcome: 'rejected',
      payloadRef: 'sha256:payload-2',
    });

    const rejectedEvent = adm2.events.find((e) => e.kind === 'settled' && e.outcome === 'rejected');
    expect(rejectedEvent).toBeDefined();
    expect(rejectedEvent!.rootId).toBe('req-2');

    const summary = adapter.snapshot();
    expect(summary.rootCounts.rejected).toBe(1);
    expect(summary.rootCounts.generated).toBe(2);
    expect(summary.rootCounts.inFlight).toBe(1);
  });

  it('3. a retry case with maxRetries 2 shows <=3 attempts in the trace', () => {
    // p1: failureRate 100%, maxRetries 2, retryDelay 10ms
    const p1 = makeResourceElement('p1', {
      type: 'processor',
      capacity: 100,
      concurrency: 1,
      queueLimit: 10,
      failureRate: 100,
      maxRetries: 2,
      retryDelayMs: 10,
    });

    const adapter = new ResourceAdapter({
      elements: [p1],
      connections: [],
      seed: 42,
      durationMs: 1000,
    });

    const input = makeResourceInput({
      rootId: 'req-retry',
      atMs: 0,
      deadlineMs: 1000,
    });

    const adm = adapter.admit(input);
    const trace = [...adm.events];

    while (adapter.peekNext()) {
      const delta = adapter.stepNext();
      trace.push(...delta.events);
    }

    const attempts = trace.filter((e) => e.kind === 'started' && e.rootId === 'req-retry');
    expect(attempts.length).toBeLessThanOrEqual(3);
    expect(attempts.length).toBe(3); // 1 initial attempt + 2 retries

    const finalSettled = trace.find((e) => e.kind === 'settled' && e.code === 'failed');
    expect(finalSettled).toBeDefined();
    expect(finalSettled!.outcome).toBe('failed');

    const summary = adapter.snapshot();
    expect(summary.rootCounts.failed).toBe(1);
    expect(summary.rootCounts.succeeded).toBe(0);
    expect(summary.rootCounts.inFlight).toBe(0);
  });

  it('4. the per-root trace is consistent with Counts (conservation: generated = succeeded + rejected + failed + expired + inFlight)', () => {
    const p1 = makeResourceElement('p1', {
      type: 'processor',
      capacity: 10, // 100ms per request
      concurrency: 1,
      queueLimit: 1,
      failureRate: 0,
      maxRetries: 0,
      retryDelayMs: 0,
    });

    const adapter = new ResourceAdapter({
      elements: [p1],
      connections: [],
      seed: 42,
      durationMs: 2000,
    });

    // 1. Success input (will succeed at 100ms)
    const in1 = makeResourceInput({ rootId: 'r-success', atMs: 0, deadlineMs: 1000 });
    const adm1 = adapter.admit(in1);
    expect(adm1.accepted).toBe(true);

    // 2. Queued input (starts at 100ms, will succeed at 200ms)
    const in2 = makeResourceInput({ rootId: 'r-queued', atMs: 0, deadlineMs: 1000 });
    const adm2 = adapter.admit(in2);
    expect(adm2.accepted).toBe(true);

    // 3. Rejected input (queue is full with 1 active + 1 queued)
    const in3 = makeResourceInput({ rootId: 'r-rejected', atMs: 0, deadlineMs: 1000 });
    const adm3 = adapter.admit(in3);
    expect(adm3.accepted).toBe(false);

    // 4. Input with tight deadline that expires while in queue
    // First, let r-success finish:
    while (adapter.peekNext() && adapter.peekNext()!.atMs <= 100) {
      adapter.stepNext();
    }
    // Now r-queued is active (100ms..200ms). Queue has space 1.
    // Inject r-expired with deadline at 150ms:
    const in4 = makeResourceInput({ rootId: 'r-expired', atMs: 100, deadlineMs: 150 });
    const adm4 = adapter.admit(in4);
    expect(adm4.accepted).toBe(true);

    // Step until 160ms (r-expired will expire at 150ms)
    while (adapter.peekNext() && adapter.peekNext()!.atMs <= 160) {
      adapter.stepNext();
    }

    // Now inject r-inflight at 160ms, which will remain in flight:
    const in5 = makeResourceInput({ rootId: 'r-inflight', atMs: 160, deadlineMs: 3000 });
    const adm5 = adapter.admit(in5);
    expect(adm5.accepted).toBe(true);

    // Step up to 200ms (r-queued finishes at 200ms, r-inflight starts at 200ms)
    while (adapter.peekNext() && adapter.peekNext()!.atMs <= 200) {
      adapter.stepNext();
    }

    const summary = adapter.snapshot();
    const c = summary.rootCounts;

    // Verify conservation: generated = succeeded + rejected + failed + expired + inFlight
    expect(c.generated).toBe(c.succeeded + c.rejected + c.failed + c.expired + c.inFlight);
    expect(c.generated).toBe(5);
    expect(c.succeeded).toBe(2); // r-success (100ms) and r-queued (200ms)
    expect(c.rejected).toBe(1);  // r-rejected
    expect(c.expired).toBe(1);   // r-expired (expired at 150ms)
    expect(c.failed).toBe(0);
    expect(c.inFlight).toBe(1);  // r-inflight
    expect(summary.liveRoots).toBe(c.inFlight);
  });

  it('5. drain completes vs ends incomplete at the deadline', () => {
    const p1 = makeResourceElement('p1', {
      type: 'processor',
      capacity: 10, // 100ms per request
      concurrency: 1,
      queueLimit: 10,
      failureRate: 0,
      maxRetries: 0,
      retryDelayMs: 0,
    });

    // Case A: Completes within deadline
    {
      const adapterA = new ResourceAdapter({
        elements: [p1],
        connections: [],
        seed: 42,
        durationMs: 1000,
      });

      adapterA.admit(makeResourceInput({ rootId: 'a1', atMs: 0, deadlineMs: 1000 }));
      adapterA.admit(makeResourceInput({ rootId: 'a2', atMs: 50, deadlineMs: 1000 }));

      // Total work: a1 (0..100), a2 (100..200).
      // arrivalHorizon = 100, deadline = 500
      const resA = adapterA.stepToDrain(100, 500);
      expect(resA.status).toBe('completed');
      expect(resA.drained).toBe(true);
      expect(resA.atMs).toBe(200);
      expect(resA.summary.rootCounts.inFlight).toBe(0);
      expect(resA.summary.rootCounts.succeeded).toBe(2);
    }

    // Case B: Incomplete at deadline
    {
      const adapterB = new ResourceAdapter({
        elements: [p1],
        connections: [],
        seed: 42,
        durationMs: 1000,
      });

      // 4 requests: 100ms each = 400ms of work
      adapterB.admit(makeResourceInput({ rootId: 'b1', atMs: 0, deadlineMs: 1000 }));
      adapterB.admit(makeResourceInput({ rootId: 'b2', atMs: 0, deadlineMs: 1000 }));
      adapterB.admit(makeResourceInput({ rootId: 'b3', atMs: 0, deadlineMs: 1000 }));
      adapterB.admit(makeResourceInput({ rootId: 'b4', atMs: 0, deadlineMs: 1000 }));

      // Deadline is set to 250ms (only b1 and b2 finish, b3 and b4 are still in flight/queue)
      const resB = adapterB.stepToDrain(100, 250);
      expect(resB.status).toBe('incomplete');
      expect(resB.drained).toBe(false);
      expect(resB.atMs).toBe(250);
      expect(resB.summary.rootCounts.inFlight).toBeGreaterThan(0);
    }
  });

  it('6. determinism across two runs', () => {
    function runSimulation() {
      const p1 = makeResourceElement('p1', {
        type: 'processor',
        capacity: 20,
        concurrency: 2,
        queueLimit: 10,
        failureRate: 20,
        maxRetries: 2,
        retryDelayMs: 25,
      });

      const adapter = new ResourceAdapter({
        runId: 'det-run',
        elements: [p1],
        connections: [],
        seed: 99,
        durationMs: 1000,
      });

      const events = [];
      const outputs = [];

      for (let i = 0; i < 5; i++) {
        const atMs = i * 30;
        while (adapter.peekNext() && adapter.peekNext()!.atMs <= atMs) {
          const delta = adapter.stepNext();
          events.push(...delta.events);
          outputs.push(...delta.outputs);
        }
        const adm = adapter.admit(
          makeResourceInput({
            rootId: `req-${i}`,
            atMs,
            deadlineMs: 1000,
          }),
        );
        events.push(...adm.events);
      }

      while (adapter.peekNext()) {
        const delta = adapter.stepNext();
        events.push(...delta.events);
        outputs.push(...delta.outputs);
      }

      const summary = adapter.snapshot();
      return { events, outputs, summary };
    }

    const run1 = runSimulation();
    const run2 = runSimulation();

    expect(run1.events).toEqual(run2.events);
    expect(run1.outputs).toEqual(run2.outputs);
    expect(run1.summary).toEqual(run2.summary);
  });

  it('7. admitting at a time that has an earlier pending kernel event throws; correct interleave gives expected trace order', () => {
    const p1 = makeResourceElement('p1', {
      type: 'processor',
      capacity: 10, // 100ms service time
      concurrency: 1,
      queueLimit: 10,
      failureRate: 0,
      maxRetries: 0,
      retryDelayMs: 0,
    });

    // 1. Throws if admitting when a pending kernel event exists at or before input.atMs
    {
      const adapter = new ResourceAdapter({
        elements: [p1],
        connections: [],
        seed: 42,
        durationMs: 1000,
      });

      adapter.admit(makeResourceInput({ rootId: 'in-1', atMs: 0 }));

      // Pending event at 100ms exists. Admitting at 150ms without stepping throws:
      expect(() => {
        adapter.admit(makeResourceInput({ rootId: 'in-2', atMs: 150 }));
      }).toThrow(/pending kernel event exists/);

      // Admitting at equal time (100ms) without stepping retained kernel event throws (phase 1 runs before phase 3):
      expect(() => {
        adapter.admit(makeResourceInput({ rootId: 'in-3', atMs: 100 }));
      }).toThrow(/pending kernel event exists/);

      // Admitting in the past throws:
      expect(() => {
        adapter.admit(makeResourceInput({ rootId: 'in-past', atMs: -1 }));
      }).toThrow(/earlier than current simulation time/);
    }

    // 2. Correct interleave gives expected trace order
    {
      const adapter = new ResourceAdapter({
        runId: 'interleave-run',
        elements: [p1],
        connections: [],
        seed: 42,
        durationMs: 1000,
      });

      const trace: string[] = [];

      const adm1 = adapter.admit(makeResourceInput({ rootId: 'in-1', atMs: 0 }));
      for (const e of adm1.events) trace.push(`${e.atMs}ms:${e.kind}:${e.code}:${e.rootId}`);

      // Step kernel events up to 100ms first
      while (adapter.peekNext() && adapter.peekNext()!.atMs <= 100) {
        const delta = adapter.stepNext();
        for (const e of delta.events) trace.push(`${e.atMs}ms:${e.kind}:${e.code}:${e.rootId}`);
      }

      // Now admit in-2 at 100ms
      const adm2 = adapter.admit(makeResourceInput({ rootId: 'in-2', atMs: 100 }));
      for (const e of adm2.events) trace.push(`${e.atMs}ms:${e.kind}:${e.code}:${e.rootId}`);

      while (adapter.peekNext()) {
        const delta = adapter.stepNext();
        for (const e of delta.events) trace.push(`${e.atMs}ms:${e.kind}:${e.code}:${e.rootId}`);
      }

      // Phase 1 (kernel event in-1 completion at 100ms) precedes phase 3 (external input in-2 admit at 100ms)
      const in1SettledIdx = trace.findIndex((t) => t.includes('100ms:settled:succeeded:in-1'));
      const in2AdmitIdx = trace.findIndex((t) => t.includes('100ms:input:admit:in-2'));
      expect(in1SettledIdx).toBeGreaterThanOrEqual(0);
      expect(in2AdmitIdx).toBeGreaterThanOrEqual(0);
      expect(in1SettledIdx).toBeLessThan(in2AdmitIdx);
    }
  });

  it('8. injecting an input no longer changes workload generation', () => {
    const p1 = makeResourceElement('p1', {
      type: 'processor',
      capacity: 100, // 10ms per req
      concurrency: 5,
      queueLimit: 10,
      failureRate: 0,
      maxRetries: 0,
      retryDelayMs: 0,
    });

    const workload: Workload = {
      id: 'wl-stream',
      entry: { elementId: 'p1', portId: 'p1-in' },
      enabled: true,
      startDelayMs: 0,
      emission: { mode: 'stream', ratePerSecond: 20, profile: { kind: 'steady' } },
      timeoutMs: 1000,
      classes: [
        {
          id: 'rc-wl',
          name: 'workload-class',
          weight: 1,
          operation: 'read',
          tags: [],
          keyDistribution: {
            kind: 'uniform',
            catalogSize: 10,
            hotSubset: 2,
            hotShare: 50,
          },
        },
      ],
    };

    const adapter = new ResourceAdapter({
      elements: [p1],
      connections: [],
      workloads: [workload],
      seed: 42,
      durationMs: 1000,
    });

    // Inject finite input at t=0
    const adm = adapter.admit(
      makeResourceInput({
        rootId: 'finite-input-1',
        entryElementId: 'p1',
        atMs: 0,
        deadlineMs: 1000,
      }),
    );
    expect(adm.accepted).toBe(true);

    // Step simulation up to 300ms
    const events = [...adm.events];
    while (adapter.peekNext() && adapter.peekNext()!.atMs <= 300) {
      const delta = adapter.stepNext();
      events.push(...delta.events);
    }

    // Workload units should have arrived and been processed alongside the finite input
    const workloadEvents = events.filter((e) => e.rootId !== 'finite-input-1');
    expect(workloadEvents.length).toBeGreaterThan(0);

    const summary = adapter.snapshot();
    expect(summary.rootCounts.generated).toBeGreaterThan(1);
    expect(summary.rootCounts.succeeded).toBeGreaterThan(1);
  });

  it('9. an LRU cache primed by workload key k-0 does NOT hit for a null-key finite input', () => {
    const cache = makeResourceElement(
      'cache',
      {
        type: 'cache',
        mode: 'lru',
        hitRate: 0,
        entries: 10,
        ttlMs: 10000,
        capacity: 1000,
        concurrency: 2,
        queueLimit: 10,
        failureRate: 0,
        maxRetries: 0,
        retryDelayMs: 0,
      },
    );

    const origin = makeResourceElement(
      'origin',
      {
        type: 'storage',
        capacity: 100, // 10ms per read
        writeCapacity: 100,
        concurrency: 2,
        queueLimit: 10,
        failureRate: 0,
        maxRetries: 0,
        retryDelayMs: 0,
      },
    );

    const conn = makeCallConnection('e-cache-origin', 'cache', 'origin', 5, 5);

    const workload: Workload = {
      id: 'wl-prime',
      entry: { elementId: 'cache', portId: 'cache-in' },
      enabled: true,
      startDelayMs: 0,
      emission: { mode: 'stream', ratePerSecond: 10, profile: { kind: 'steady' } },
      timeoutMs: 1000,
      classes: [
        {
          id: 'rc-prime',
          name: 'prime',
          weight: 1,
          operation: 'read',
          tags: [],
          keyDistribution: {
            kind: 'uniform',
            catalogSize: 1, // keyDistribution draws catalogSize 1 -> key is always 'k-0'
            hotSubset: 1,
            hotShare: 100,
          },
        },
      ],
    };

    const adapter = new ResourceAdapter({
      elements: [cache, origin],
      connections: [conn],
      workloads: [workload],
      seed: 42,
      durationMs: 1000,
    });

    // Step first workload request to completion so that key 'k-0' primes the LRU cache
    while (adapter.peekNext()) {
      adapter.stepNext();
      const s = adapter.snapshot();
      const entries = s.metrics.find((m) => m.elementId === 'cache' && m.key === 'cacheEntries');
      if (entries?.value === 1) break;
    }

    const summaryAfterPrime = adapter.snapshot();
    const cacheMetricsPrime = summaryAfterPrime.metrics;
    const entriesPrime = cacheMetricsPrime.find((m) => m.elementId === 'cache' && m.key === 'cacheEntries');
    const hitsPrime = cacheMetricsPrime.find((m) => m.elementId === 'cache' && m.key === 'cacheHits');
    const missesPrime = cacheMetricsPrime.find((m) => m.elementId === 'cache' && m.key === 'cacheMisses');

    expect(entriesPrime?.value).toBe(1); // 'k-0' is in cache!
    expect(hitsPrime?.value).toBe(0);
    expect(missesPrime?.value).toBe(1);

    // Current simulation time after prime completes; step any pending events at current time
    let nullKeyAtMs = summaryAfterPrime.atMs;
    while (adapter.peekNext() && adapter.peekNext()!.atMs <= nullKeyAtMs) {
      adapter.stepNext();
      nullKeyAtMs = adapter.snapshot().atMs;
    }

    // Now inject a finite input with key: null
    const adm = adapter.admit(
      makeResourceInput({
        rootId: 'req-null-key',
        entryElementId: 'cache',
        key: null,
        atMs: nullKeyAtMs,
        deadlineMs: 2000,
      }),
    );
    expect(adm.accepted).toBe(true);

    // Step until req-null-key settles
    while (adapter.peekNext()) {
      adapter.stepNext();
      if (adapter.snapshot().rootCounts.inFlight === 0) break;
    }

    const summaryAfterNull = adapter.snapshot();
    const cacheMetricsNull = summaryAfterNull.metrics;
    const entriesNull = cacheMetricsNull.find((m) => m.elementId === 'cache' && m.key === 'cacheEntries');
    const hitsNull = cacheMetricsNull.find((m) => m.elementId === 'cache' && m.key === 'cacheHits');
    const missesNull = cacheMetricsNull.find((m) => m.elementId === 'cache' && m.key === 'cacheMisses');

    // The null-key finite input did NOT hit the primed 'k-0' key!
    expect(hitsNull?.value).toBe(0); // Still 0 hits!
    // It counted as a miss:
    expect(missesNull?.value).toBe(2);
    // And it was NOT stored in the cache (cacheEntries stays 1):
    expect(entriesNull?.value).toBe(1);

    // If a request WITH key 'k-0' arrives, it hits:
    let k0AtMs = summaryAfterNull.atMs;
    while (adapter.peekNext() && adapter.peekNext()!.atMs <= k0AtMs) {
      adapter.stepNext();
      k0AtMs = adapter.snapshot().atMs;
    }

    const admKey0 = adapter.admit(
      makeResourceInput({
        rootId: 'req-with-k0',
        entryElementId: 'cache',
        key: 'k-0',
        atMs: k0AtMs,
        deadlineMs: 2000,
      }),
    );
    expect(admKey0.accepted).toBe(true);
    while (adapter.peekNext()) {
      adapter.stepNext();
      if (adapter.snapshot().rootCounts.inFlight === 0) break;
    }
    const summaryAfterK0 = adapter.snapshot();
    const hitsK0 = summaryAfterK0.metrics.find((m) => m.elementId === 'cache' && m.key === 'cacheHits');
    expect(hitsK0?.value).toBe(1); // Hits!
  });
});
