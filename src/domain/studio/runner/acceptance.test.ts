/**
 * Acceptance: success, failure and boundary cases for the five reference scenario
 * families (S01-S05), chunk-independent scheduling, and cancellation at compiler and
 * runner batch boundaries. Runs the families together via `runScenario`, plus
 * determinism, chunked-vs-one-shot equivalence, and cancellation.
 *
 * Per-family exhaustive edge cases (fulfillment failure regression, transport retry,
 * payment timeout, per-arrival routing/outage accounting) already live in
 * resource-adapter.test.ts and faults.test.ts; this file's job is the cross-family
 * "all five pass together" acceptance pass plus the cross-cutting properties, not to
 * re-derive every per-scenario table row already covered elsewhere.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runScenario, ScenarioRunner } from './scenario-runner';
import { prepareScenario } from './compile';
import { canonicalJson } from '../canonical';
import type { AuthoredSnapshot, TraceEvent } from './types';
import type { Document, Scenario } from '../model';

const FIXTURES_DIR = join(process.cwd(), 'src/features/entry/examples');
function loadFixture(name: string): Document {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

function expectAllChecksPassed(checks: readonly { status: string; reason: string | null; assertionId: string }[]) {
  const failed = checks.filter((c) => c.status !== 'passed');
  expect(failed, JSON.stringify(failed)).toEqual([]);
  expect(checks.length).toBeGreaterThan(0);
}

/**
 * Runner-level trace invariant: no TraceEvent carries journeyId
 * 'unknown' (fault-kind events are host-level and carry no journey at all, so they're
 * exempt), and every TraceEvent.rootId is either an input/workload-derived root (input
 * or workload ID plus ordinal) or a runner-minted
 * message root (`msg_N`, its `msg_N:ordinal` delivered/broadcast copies, or a
 * `pub_N` broadcast top-level admission and its own `:ordinal` copies) — never a raw
 * kernel-internal delivery-path identity (e.g. `msg_1:<path>:__entry:<id>:`).
 */
export function expectCleanJourneysAndRootIds(events: readonly TraceEvent[], scenario: Scenario) {
  const inputIds = new Set(scenario.inputs.map((i) => i.id));
  const workloadIds = new Set(scenario.workloads.map((w) => w.id));

  const isInputRoot = (root: string) => [...inputIds].some((id) => root === `${id}#0` || root.startsWith(`${id}#`));
  const isWorkloadRoot = (root: string) => [...workloadIds].some((id) => root === id || root.startsWith(`${id}-`));
  const isMessageRoot = (root: string) => /^(msg_|pub_)\d+(:\d+)?$/.test(root);

  for (const e of events) {
    if (e.kind === 'fault') continue; // host-level; no journey applies (host_down/up)
    expect(e.journeyId, `event ${e.id} (${e.kind}/${e.code}) has journeyId 'unknown'`).not.toBe('unknown');
    expect(
      isInputRoot(e.rootId) || isWorkloadRoot(e.rootId) || isMessageRoot(e.rootId),
      `event ${e.id} (${e.kind}/${e.code}) has an unexpected rootId '${e.rootId}' (not input/workload-derived or a runner-minted message root)`,
    ).toBe(true);
  }
}

describe('acceptance: S01-S05 pass together', () => {
  it('S01 checkout machine: all three scenarios complete with every assertion passing', async () => {
    const doc = loadFixture('s01.json');
    for (const scenario of doc.scenarios) {
      const result = await runScenario(doc, scenario.id, `run-s01-${scenario.id}`);
      expect(result.status, `${scenario.label}: ${result.reason}`).toBe('completed');
      expectAllChecksPassed(result.checks);
      expectCleanJourneysAndRootIds(result.events, scenario);
    }
  });

  it('S02 order processing: allow and deny both complete with every assertion passing', async () => {
    const doc = loadFixture('s02.json');
    for (const scenario of doc.scenarios) {
      const result = await runScenario(doc, scenario.id, `run-s02-${scenario.id}`);
      expect(result.status, `${scenario.label}: ${result.reason}`).toBe('completed');
      expectAllChecksPassed(result.checks);
      expectCleanJourneysAndRootIds(result.events, scenario);
    }
  });

  it('S03 records pipeline: completes with every assertion passing, and row provenance is exact', async () => {
    const doc = loadFixture('s03.json');
    const scenario = doc.scenarios[0];
    const result = await runScenario(doc, scenario.id, 'run-s03');
    expect(result.status).toBe('completed');
    expectAllChecksPassed(result.checks);
    expectCleanJourneysAndRootIds(result.events, scenario);

    // S03 accounting: errors=[r4]; duplicate=[r2]; retained=[r1,r3,r5], so 5 rows = 1
    // invalid + 1 duplicate + 3 retained, and every aggregate lists its source rows. The
    // group-sum step emits one row per group (EU, US), each carrying the ordered union of
    // its contributing source rows, so "3 retained" shows up as inputRows across the 2
    // emitted (group-sum) rows, not as 3 separate 'emitted' outcomes.
    const rowOutcomes = result.summary.rowOutcomes;
    const errorRows = rowOutcomes.filter((r) => r.outcome === 'error');
    expect(errorRows).toHaveLength(1);
    expect(errorRows[0].errorCode).toBe('schema-mismatch');
    expect(rowOutcomes.filter((r) => r.outcome === 'duplicate')).toHaveLength(1);
    const emittedRows = rowOutcomes.filter((r) => r.outcome === 'emitted');
    expect(emittedRows).toHaveLength(2); // EU and US groups
    const retainedSourceRowCount = emittedRows.reduce((sum, r) => sum + r.inputRows.length, 0);
    expect(retainedSourceRowCount).toBe(3); // r1, r3, r5
  });

  it('S04 host failover: all three scenarios complete with every assertion passing', async () => {
    const doc = loadFixture('s04.json');
    for (const scenario of doc.scenarios) {
      const result = await runScenario(doc, scenario.id, `run-s04-${scenario.id}`);
      expect(result.status, `${scenario.label}: ${result.reason}`).toBe('completed');
      expectAllChecksPassed(result.checks);
      expectCleanJourneysAndRootIds(result.events, scenario);
    }
  });

  it('S05 fullstack composition: both scenarios complete with every assertion passing, plus distinct request IDs, a shared journey, and message-root linkage', async () => {
    const doc = loadFixture('s05.json');

    const success = doc.scenarios.find((s) => s.label === 'Accepted and fulfilled')!;
    const successResult = await runScenario(doc, success.id, 'run-s05-success');
    expect(successResult.status, successResult.reason ?? '').toBe('completed');
    expectAllChecksPassed(successResult.checks);
    expectCleanJourneysAndRootIds(successResult.events, success);

    // "1 completed fulfillment message whose message root links to the user root."
    const userRoot = successResult.events.find((e) => e.kind === 'input')!.rootId;
    const messageGenerated = successResult.events.find((e) => e.kind === 'input' && e.elementId !== undefined && e.rootId.startsWith('msg_'));
    // The message's admit event's parentId names a TraceEvent belonging to the user root.
    const messageAdmit = successResult.events.find((e) => e.kind === 'input' && e.code === 'admit');
    expect(messageAdmit).toBeDefined();
    const linkedParent = successResult.events.find((e) => e.id === messageAdmit!.parentId);
    expect(linkedParent).toBeDefined();
    expect(linkedParent!.rootId).toBe(userRoot);
    void messageGenerated;

    const outage = doc.scenarios.find((s) => s.label === 'Outage then explicit retry')!;
    const outageResult = await runScenario(doc, outage.id, 'run-s05-outage');
    expect(outageResult.status, outageResult.reason ?? '').toBe('completed');
    expectAllChecksPassed(outageResult.checks);
    expectCleanJourneysAndRootIds(outageResult.events, outage);

    // Distinct request IDs under the shared journey: both inputs share journeyId (fixed by
    // the fixture) and the checkout machine's own "create order" call payload carries a
    // fresh requestId each time.
    expect(new Set(outage.inputs.map((i) => i.journeyId)).size).toBe(1);
    const createOrderOutputs = outageResult.summary.outputs.find(
      (o) => o.port.elementId === 'b5582eea-b31f-5df1-b50c-bf73046f2726',
    );
    expect(createOrderOutputs).toBeDefined();
    const requestIds = (createOrderOutputs!.values as Array<{ requestId: string }>).map((v) => v.requestId);
    expect(requestIds).toHaveLength(2);
    expect(new Set(requestIds).size).toBe(2);

    // Trace-level: the two user roots (external submits) are distinct, and every event
    // in the run (both user roots and the linked fulfillment message root) carries the same
    // journey.
    const userRoots = outageResult.events
      .filter((e) => e.kind === 'input' && e.code === 'input')
      .map((e) => e.rootId);
    expect(new Set(userRoots).size).toBe(2);
    const journeys = new Set(
      outageResult.events.filter((e) => e.kind !== 'fault').map((e) => e.journeyId),
    );
    expect(journeys.size).toBe(1);
  });
});

describe('acceptance: determinism, chunking and cancellation', () => {
  it('determinism: two runs of the same scenario produce byte-identical canonical output', async () => {
    const doc = loadFixture('s05.json');
    const scenario = doc.scenarios.find((s) => s.label === 'Accepted and fulfilled')!;

    const runId = '00000000-0000-0000-0000-0000000000f1';
    const resultA = await runScenario(doc, scenario.id, runId);
    const resultB = await runScenario(doc, scenario.id, runId);

    const canonA = canonicalJson({ events: resultA.events, summary: resultA.summary, checks: resultA.checks, status: resultA.status });
    const canonB = canonicalJson({ events: resultB.events, summary: resultB.summary, checks: resultB.checks, status: resultB.status });
    expect(canonA.ok && canonB.ok).toBe(true);
    if (canonA.ok && canonB.ok) {
      expect(canonB.text).toBe(canonA.text);
    }
  });

  it('chunked vs one-shot stepping give identical results (chunked and one-shot stepping give identical results)', async () => {
    const doc = loadFixture('s05.json');
    const scenario = doc.scenarios.find((s) => s.label === 'Outage then explicit retry')!;
    const runId = '00000000-0000-0000-0000-0000000000f2';

    const oneShot = await runScenario(doc, scenario.id, runId);
    const chunked = await runScenario(doc, scenario.id, runId, { stepSize: 1 });

    const canonOne = canonicalJson({ events: oneShot.events, summary: oneShot.summary, status: oneShot.status });
    const canonChunked = canonicalJson({ events: chunked.events, summary: chunked.summary, status: chunked.status });
    expect(canonOne.ok && canonChunked.ok).toBe(true);
    if (canonOne.ok && canonChunked.ok) {
      expect(canonChunked.text).toBe(canonOne.text);
    }
  });

  it('cancellation at the compiler boundary: an already-aborted prepareScenario returns cancelled', async () => {
    const doc = loadFixture('s01.json');
    const controller = new AbortController();
    controller.abort();

    const snapshot: AuthoredSnapshot = { id: 'snap-cancel', document: doc };
    const result = await prepareScenario(snapshot, doc.scenarios[0].id, controller.signal, {
      compilerVersion: '0.1.0',
      runnerVersions: [{ runnerId: 'resource-kernel', version: '0.1.0' }],
    });
    expect(result.status).toBe('cancelled');
  });

  it('cancellation at a runner batch boundary: an aborted run ends "cancelled" with no terminal success', async () => {
    const doc = loadFixture('s05.json');
    const scenario = doc.scenarios.find((s) => s.label === 'Accepted and fulfilled')!;
    const controller = new AbortController();

    const runner = new ScenarioRunner(doc, scenario.id, '00000000-0000-0000-0000-0000000000f3', { signal: controller.signal });
    // Advance a couple of scheduler batch boundaries, then cancel mid-run: real work
    // (the checkout submit, the resource admission) has already started, but the run
    // must never reach a terminal 'completed'/succeeded outcome after this.
    await runner.step();
    await runner.step();
    controller.abort();
    const result = await runner.run();

    expect(result.status).toBe('cancelled');
    expect(result.summary.rootCounts.succeeded).toBe(0);
  });

  it('a resource-call settlement with no outcome, or an unresolvable payload, fails the run instead of inferring success or an empty payload (no success is inferred)', async () => {
    const doc = loadFixture('s05.json');
    const scenario = doc.scenarios.find((s) => s.label === 'Accepted and fulfilled')!;
    const runner: any = new ScenarioRunner(doc, scenario.id, '00000000-0000-0000-0000-0000000000f4');

    // Seed resourceCallPending directly (the private map routeSettlement consults) so the
    // guard is exercised without needing to drive a full resource admission first.
    runner.resourceCallPending.set('fake-root-1', {
      callPortId: 'call-port',
      correlationRequestId: 'req-1',
      initiatingFrameId: 'frame-1',
      machineElementId: 'b5582eea-b31f-5df1-b50c-bf73046f2726',
      rootId: 'fake-root-1',
      journeyId: 'journey-1',
    });
    const noOutcome = runner.routeSettlement({
      id: 'evt-1',
      kind: 'settled',
      code: 'succeeded',
      rootId: 'fake-root-1',
      outcome: null,
      atMs: 0,
      payloadRef: null,
    });
    expect(noOutcome.ok).toBe(false);
    expect(noOutcome.reason).toMatch(/carried no outcome/);

    runner.resourceCallPending.set('fake-root-2', {
      callPortId: 'call-port',
      correlationRequestId: 'req-2',
      initiatingFrameId: 'frame-2',
      machineElementId: 'b5582eea-b31f-5df1-b50c-bf73046f2726',
      rootId: 'fake-root-2',
      journeyId: 'journey-1',
    });
    const unresolvablePayload = runner.routeSettlement({
      id: 'evt-2',
      kind: 'settled',
      code: 'succeeded',
      rootId: 'fake-root-2',
      outcome: 'succeeded',
      atMs: 0,
      payloadRef: 'sha256:does-not-exist',
    });
    expect(unresolvablePayload.ok).toBe(false);
    expect(unresolvablePayload.reason).toMatch(/unresolvable payload/);
  });
});
