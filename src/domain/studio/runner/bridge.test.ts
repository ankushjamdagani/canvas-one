/**
 * Bridge call frames.
 *
 * Exercises ResourceAdapter/OpenSimulation directly (not through the composed
 * ScenarioRunner): a resource with a call continuation to a non-resource target waits
 * exactly like a retained call chain, and the adapter's `settleCall` resolves it.
 *
 * The emission carries a system frameId, and the parent waits as in retained call
 * chains. The bridge settles the frame once via settleCall; the kernel applies
 * returnLatencyMs and its existing child-response handling. For bridge frames only, the
 * parent adopts the child's outcome and returns the child's payload. A second
 * settlement of a frame fails the run. If an outage or expiry settles the parent while
 * its bridge frame is open, the frame stays open until its descendants settle; the later
 * settleCall is ignored, isn't a second settlement, and still counts toward root
 * settlement and drain.
 */
import { describe, it, expect } from 'vitest';
import type { Element, CallConnection, ResourceConfig, Relation } from '../model';
import type { ResourceInput, PortEmission, TraceEvent } from './types';
import { ResourceAdapter } from './resource-adapter';

function makeResourceElement(id: string, config: ResourceConfig, entryPortId = `${id}-in`): Element {
  return {
    id,
    label: id,
    description: '',
    visualKind: 'service',
    ports: [
      { id: entryPortId, label: 'in', direction: 'in', channel: 'call', protocol: 'http', schemaId: 'schema-1', responseSchemaId: 'schema-1' },
      { id: `${id}-out`, label: 'out', direction: 'out', channel: 'call', protocol: 'http', schemaId: 'schema-1', responseSchemaId: 'schema-1' },
    ],
    behavior: { kind: 'resource', version: 1, config, entryPortId },
  };
}

/** A non-resource bridge target. Its behavior is irrelevant to the kernel/adapter: the
 * bridge only needs the target element to exist and not be a `resource`. */
function makeNonResourceElement(id: string): Element {
  return {
    id,
    label: id,
    description: '',
    visualKind: 'service',
    ports: [{ id: `${id}-in`, label: 'in', direction: 'in', channel: 'call', protocol: 'http', schemaId: 'schema-1', responseSchemaId: 'schema-1' }],
    behavior: { kind: 'unmodeled', version: 1, reason: 'bridge target stub' },
  };
}

function makeCallConnection(id: string, sourceEl: string, targetEl: string, latencyMs = 10, returnLatencyMs = 10): CallConnection {
  return {
    id,
    kind: 'call',
    source: { elementId: sourceEl, portId: `${sourceEl}-out` },
    target: { elementId: targetEl, portId: `${targetEl}-in` },
    config: { latencyMs, returnLatencyMs, weight: 1, condition: null, fallback: false, linkClass: null , jitterMs: 0, lossRate: 0, bandwidthKbps: null,},
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
    key: overrides.key !== undefined ? overrides.key : null,
    tags: overrides.tags ?? [],
    payloadRef: overrides.payloadRef ?? 'sha256:payload-1',
    atMs: overrides.atMs ?? 0,
    deadlineMs: overrides.deadlineMs ?? 5000,
  };
}

const processorConfig: ResourceConfig = {
  type: 'processor',
  capacity: 10, // 1000/10 = 100ms service time
  concurrency: 1,
  queueLimit: 10,
  failureRate: 0,
  maxRetries: 0,
  retryDelayMs: 0,
};

/**
 * Steps the adapter's kernel events one at a time, like the composed ScenarioRunner's own
 * global scheduler does (never blindly drained to exhaustion): a periodic history-sample
 * tick or another unit's own deadline timer keeps `peekNext()` non-null long after a
 * bridge dispatch, so tests stop as soon as they've observed what they're looking for
 * (`until` returns true), leaving any later kernel event unstepped — settleCall() is then
 * free to resolve the frame before the unit's own deadline could otherwise expire it.
 */
function stepAdapterUntil(
  adapter: ResourceAdapter,
  until: (events: readonly TraceEvent[]) => boolean,
  maxSteps = 20,
) {
  const events: TraceEvent[] = [];
  const outputs: PortEmission[] = [];
  for (let i = 0; i < maxSteps && adapter.peekNext(); i++) {
    const delta = adapter.stepNext();
    events.push(...delta.events);
    outputs.push(...delta.outputs);
    if (until(delta.events)) break;
  }
  return { events, outputs };
}

const isBridgeDispatch = (events: readonly TraceEvent[]) => events.some((e) => e.kind === 'dispatch' && e.code === 'bridge-dispatch');
const isSettled = (events: readonly TraceEvent[]) =>
  events.some((e) => e.kind === 'settled' && (e.code === 'succeeded' || e.code === 'failed' || e.code === 'rejected' || e.code === 'expired'));



describe('Bridge call frames', () => {
  it('a resource with only a bridge continuation waits, dispatches exactly once, and settleCall completes it with returnLatencyMs applied and the adopted outcome/payload', () => {
    const p1 = makeResourceElement('p1', processorConfig);
    const m1 = makeNonResourceElement('m1');
    const bridgeConn = makeCallConnection('bridge-1', 'p1', 'm1', 10, 20);

    const adapter = new ResourceAdapter({ runId: 'bridge-run', elements: [p1, m1], connections: [bridgeConn], seed: 1, durationMs: 5000 });

    const input = makeResourceInput({ rootId: 'req-1', atMs: 0, deadlineMs: 5000 });
    const adm = adapter.admit(input);
    expect(adm.accepted).toBe(true);
    expect(adm.response).toBeNull();

    const { events: e1, outputs: o1 } = stepAdapterUntil(adapter, isBridgeDispatch);
    const bridgeFact = e1.find((e) => e.kind === 'dispatch' && e.code === 'bridge-dispatch');
    expect(bridgeFact).toBeDefined();
    // p1's processing takes 1000/10 = 100ms before dispatching the bridge.
    expect(bridgeFact!.atMs).toBe(100);
    // No settlement yet: the parent is waiting, not completing locally.
    expect(e1.some((e) => e.kind === 'settled' && e.code === 'succeeded')).toBe(false);

    expect(o1).toHaveLength(1);
    expect(o1[0].frameId).toBeTruthy();
    const frameId = o1[0].frameId!;

    adapter.settleCall({ frameId, outcome: 'succeeded', payloadRef: 'sha256:child-payload', atMs: 100 });

    const { events: e2 } = stepAdapterUntil(adapter, isSettled);
    const settled = e2.find((e) => e.kind === 'settled' && (e.code === 'succeeded' || e.code === 'failed' || e.code === 'rejected' || e.code === 'expired'));
    expect(settled).toBeDefined();
    expect(settled!.outcome).toBe('succeeded');
    // returnLatencyMs (20ms) applied on top of the settleCall time (100ms).
    expect(settled!.atMs).toBe(120);
    // The parent returns the child's payload, not the originally admitted payload.
    expect(settled!.payloadRef).toBe('sha256:child-payload');

    const summary = adapter.snapshot();
    expect(summary.rootCounts.succeeded).toBe(1);
    expect(summary.rootCounts.inFlight).toBe(0);
  });

  it('a non-succeeded bridge child outcome is adopted exactly (not collapsed to "failed")', () => {
    const p1 = makeResourceElement('p1', processorConfig);
    const m1 = makeNonResourceElement('m1');
    const adapter = new ResourceAdapter({
      runId: 'bridge-run-2',
      elements: [p1, m1],
      connections: [makeCallConnection('bridge-1', 'p1', 'm1', 0, 0)],
      seed: 1,
      durationMs: 5000,
    });

    const adm = adapter.admit(makeResourceInput({ rootId: 'req-2' }));
    expect(adm.accepted).toBe(true);
    const { outputs } = stepAdapterUntil(adapter, isBridgeDispatch);
    const frameId = outputs[0].frameId!;

    adapter.settleCall({ frameId, outcome: 'rejected', payloadRef: 'sha256:denied', atMs: 100 });
    const { events } = stepAdapterUntil(adapter, isSettled);
    const settled = events.find((e) => e.kind === 'settled' && (e.code === 'succeeded' || e.code === 'failed' || e.code === 'rejected' || e.code === 'expired'));
    expect(settled!.outcome).toBe('rejected');

    const summary = adapter.snapshot();
    expect(summary.rootCounts.rejected).toBe(1);
    expect(summary.rootCounts.failed).toBe(0);
    expect(summary.rootCounts.succeeded).toBe(0);
  });

  it('a double settleCall on the same frame fails the run', () => {
    const p1 = makeResourceElement('p1', processorConfig);
    const m1 = makeNonResourceElement('m1');
    const adapter = new ResourceAdapter({
      runId: 'bridge-run-3',
      elements: [p1, m1],
      connections: [makeCallConnection('bridge-1', 'p1', 'm1', 0, 0)],
      seed: 1,
      durationMs: 5000,
    });

    adapter.admit(makeResourceInput({ rootId: 'req-3' }));
    const { outputs } = stepAdapterUntil(adapter, isBridgeDispatch);
    const frameId = outputs[0].frameId!;

    adapter.settleCall({ frameId, outcome: 'succeeded', payloadRef: 'sha256:ok', atMs: 100 });
    stepAdapterUntil(adapter, isSettled); // let the first settlement resolve

    expect(() => adapter.settleCall({ frameId, outcome: 'succeeded', payloadRef: 'sha256:ok-again', atMs: 100 })).toThrow();
  });

  it('an outage settling the parent while its bridge frame is open: the frame stays open, the later settleCall is ignored (not a second settlement) and still counts toward drain', () => {
    const p1 = makeResourceElement('p1', processorConfig);
    const m1 = makeNonResourceElement('m1');
    const relations: Relation[] = [{ id: 'rel-1', label: 'Runs on', kind: 'deployed-on', elementId: 'p1', hostId: 'h1' }];
    const adapter = new ResourceAdapter({
      runId: 'bridge-run-4',
      elements: [p1, m1],
      connections: [makeCallConnection('bridge-1', 'p1', 'm1', 0, 0)],
      relations,
      seed: 1,
      durationMs: 5000,
    });

    adapter.admit(makeResourceInput({ rootId: 'req-4' }));
    const { outputs } = stepAdapterUntil(adapter, isBridgeDispatch);
    const frameId = outputs[0].frameId!;

    // The outage settles the parent (root -> 'failed') while the bridge frame is still
    // open: no unit_settled fact has fired yet for req-4 up to this point.
    let summary = adapter.snapshot();
    expect(summary.rootCounts.inFlight).toBe(1);

    const interruptDelta = adapter.interruptHost('h1', 100);
    const outageSettled = interruptDelta.events.find((e) => e.kind === 'settled' && e.rootId === 'req-4');
    expect(outageSettled).toBeDefined();
    expect(outageSettled!.outcome).toBe('failed');

    summary = adapter.snapshot();
    expect(summary.rootCounts.failed).toBe(1);
    expect(summary.rootCounts.inFlight).toBe(0);

    // The later settleCall for the now-orphaned frame must not throw (it is ignored, not
    // a second settlement) and must not double-count root outcomes.
    expect(() => adapter.settleCall({ frameId, outcome: 'succeeded', payloadRef: 'sha256:late', atMs: 200 })).not.toThrow();

    const { events } = stepAdapterUntil(adapter, () => false, 10);
    expect(events.some((e) => e.kind === 'settled' && e.rootId === 'req-4')).toBe(false);

    summary = adapter.snapshot();
    expect(summary.rootCounts.failed).toBe(1);
    expect(summary.rootCounts.succeeded).toBe(0);
    expect(summary.rootCounts.inFlight).toBe(0);
    // Any events remaining beyond this point are inert bookkeeping (periodic history
    // samples) that never touch req-4s already-settled accounting again — the frame no
    // longer blocks anything.
  });
});

describe('No invented outcomes/categories (no success is inferred)', () => {
  it('a unit_settled fact with no outcome sets a journey failure and is never counted as succeeded', () => {
    const p1 = makeResourceElement('p1', processorConfig);
    const adapter = new ResourceAdapter({ runId: 'no-outcome-run', elements: [p1], connections: [], seed: 1, durationMs: 5000 });

    // Register 'req-x' as a real unit context first (via admit()), so the malformed fact
    // below is rejected specifically for its missing outcome, not for being unregistered.
    adapter.admit(makeResourceInput({ rootId: 'req-x', atMs: 0 }));

    // Drive the private per-fact path directly with a malformed fact (no `outcome`),
    // exactly the shape a kernel regression could produce: the adapter must never
    // default it to 'succeeded'.
    (adapter as any).consumeFact({ kind: 'unit_settled', time: 0, nodeId: 'p1', unitIdentity: 'req-x', attempt: 1, path: 'p1', category: 'root' });
    expect(adapter.takeJourneyFailure()).toMatch(/carried no outcome/);

    const summary = adapter.snapshot();
    expect(summary.rootCounts.succeeded).toBe(0);

    // mapFactToTraceEvent must likewise refuse to fabricate a 'succeeded' TraceEvent.
    const te = (adapter as any).mapFactToTraceEvent({ kind: 'unit_settled', time: 0, nodeId: 'p1', unitIdentity: 'req-x', attempt: 1, path: 'p1', category: 'root' });
    expect(te).toBeNull();
    expect(adapter.takeJourneyFailure()).toMatch(/carried no outcome/);
  });

  it('a root identity that contains a colon is still counted as a root, never mistaken for a message by its shape', () => {
    const p1 = makeResourceElement('p1', processorConfig);
    const m1 = makeNonResourceElement('m1');
    const adapter = new ResourceAdapter({
      runId: 'colon-root-run',
      elements: [p1, m1],
      connections: [makeCallConnection('bridge-1', 'p1', 'm1', 0, 0)],
      seed: 1,
      durationMs: 5000,
    });

    // A root identity with a colon (e.g. a UUID-derived id embedding ':') must still be
    // treated as a root: category comes from the kernel's Unit.category, never from
    // string shape.
    const input = makeResourceInput({ rootId: 'journey:root-1', atMs: 0 });
    const adm = adapter.admit(input);
    expect(adm.accepted).toBe(true);

    const { outputs } = stepAdapterUntil(adapter, isBridgeDispatch);
    const frameId = outputs[0].frameId!;
    adapter.settleCall({ frameId, outcome: 'succeeded', payloadRef: 'sha256:ok', atMs: 100 });
    stepAdapterUntil(adapter, isSettled);

    const summary = adapter.snapshot();
    expect(summary.rootCounts.succeeded).toBe(1);
    expect(summary.messageCounts.succeeded).toBe(0);
    expect(summary.rootCounts.inFlight).toBe(0);
    expect(adapter.takeJourneyFailure()).toBeNull();
  });
});
