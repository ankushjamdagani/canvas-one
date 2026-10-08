import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runScenario, ScenarioRunner, handleSettlementEvent } from './scenario-runner';
import type { SettlementState } from './scenario-runner';
import type { Document, ResourceBehavior } from '../model';
import type { TraceEvent } from './types';
import { canonicalJson } from '../canonical';

const FIXTURES_DIR = join(process.cwd(), 'src/features/entry/examples');

function loadFixture(name: string): Document {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

describe('scenario runner: S02 reference fixture', () => {
  const s02Doc = loadFixture('s02.json');

  it('runs scenario "allow" via runScenario: passes all authored assertions and trace order', async () => {
    const scenarioId = '5bf95962-e1aa-5df7-8dd2-5784bbad14c8'; // allow
    const runId = '00000000-0000-0000-0000-000000000001';

    const result = await runScenario(s02Doc, scenarioId, runId);

    expect(result.status).toBe('completed');
    expect(result.reason).toBeNull();

    // Every authored assertion passes
    expect(result.checks.length).toBe(5);
    for (const check of result.checks) {
      expect(check.status).toBe('passed');
    }

    // Counts: root succeeded 1, message generated 1 / succeeded 1
    expect(result.summary.rootCounts.generated).toBe(1);
    expect(result.summary.rootCounts.succeeded).toBe(1);
    expect(result.summary.rootCounts.rejected).toBe(0);
    expect(result.summary.rootCounts.inFlight).toBe(0);

    expect(result.summary.messageCounts.generated).toBe(1);
    expect(result.summary.messageCounts.succeeded).toBe(1);
    expect(result.summary.messageCounts.inFlight).toBe(0);

    // Exactly one unit-level settlement per root: per-attempt resource settlements always
    // use the distinct 'attempt-settled:<attempt>' code, so excluding that prefix isolates
    // the single canonical settlement for the user root (a machine 'reply') and, separately,
    // for the message root (a resource completion) (coordinator review: this must hold
    // outside S04 too).
    const inputRootId = result.events.find((e) => e.kind === 'input')!.rootId;
    const rootUnitSettlements = result.events.filter(
      (e) => e.rootId === inputRootId && e.kind === 'settled' && !e.code.startsWith('attempt-settled:'),
    );
    expect(rootUnitSettlements.length).toBe(1);
    expect(rootUnitSettlements[0].outcome).toBe('succeeded');

    const messageRootId = result.events.find(
      (e) => e.rootId !== inputRootId && e.kind === 'settled' && e.outcome === 'succeeded',
    )!.rootId;
    const messageUnitSettlements = result.events.filter(
      (e) => e.rootId === messageRootId && e.kind === 'settled' && !e.code.startsWith('attempt-settled:'),
    );
    expect(messageUnitSettlements.length).toBe(1);

    // Trace ordering check:
    // "the accepted reply is traced BEFORE fulfillment completes (reply settles independently)"
    const acceptedTraceIdx = result.events.findIndex((e) => e.code === 'accepted-order');
    expect(acceptedTraceIdx).toBeGreaterThanOrEqual(0);

    // Fulfillment complete is the settled event for fulfillment completion at t=100
    const workerElementId = 'b870e6ff-5835-5cdc-80b9-9f9e159c8a55';
    const fulfillmentSettledIdx = result.events.findIndex(
      (e) =>
        (e.elementId === workerElementId || e.elementId === 'cbf95fcf-bc61-5c89-9c0c-d506c152f7f8') &&
        e.kind === 'settled' &&
        (e.code === 'succeeded' || e.code === 'attempt-settled:1') &&
        e.atMs === 100,
    );
    expect(fulfillmentSettledIdx).toBeGreaterThanOrEqual(0);

    expect(acceptedTraceIdx).toBeLessThan(fulfillmentSettledIdx);

    // Verify time: accepted-order traced at t=0, fulfillment complete at t=100
    expect(result.events[acceptedTraceIdx].atMs).toBe(0);
    expect(result.events[fulfillmentSettledIdx].atMs).toBe(100);
  });

  it('runs scenario "deny" via runScenario: passes all authored assertions', async () => {
    const scenarioId = '498f913f-5159-594e-9257-823735e6d2d1'; // deny
    const runId = '00000000-0000-0000-0000-000000000002';

    const result = await runScenario(s02Doc, scenarioId, runId);

    expect(result.status).toBe('completed');
    expect(result.reason).toBeNull();

    expect(result.checks.length).toBe(5);
    for (const check of result.checks) {
      expect(check.status).toBe('passed');
    }

    // Counts: root rejected 1, no message generated
    expect(result.summary.rootCounts.generated).toBe(1);
    expect(result.summary.rootCounts.succeeded).toBe(0);
    expect(result.summary.rootCounts.rejected).toBe(1);
    expect(result.summary.rootCounts.inFlight).toBe(0);

    expect(result.summary.messageCounts.generated).toBe(0);
    expect(result.summary.messageCounts.succeeded).toBe(0);
    expect(result.summary.messageCounts.inFlight).toBe(0);
  });
});

describe('scenario runner: S02 regression variants', () => {
  const s02Doc = loadFixture('s02.json');
  const allowScenarioId = '5bf95962-e1aa-5df7-8dd2-5784bbad14c8';
  const workerElementId = 'b870e6ff-5835-5cdc-80b9-9f9e159c8a55';

  it('fulfillment worker failureRate 100 -> user root stays succeeded and message failed 1', async () => {
    // Test-local copy: change fulfillment worker failureRate to 100
    const modifiedDoc: Document = {
      ...s02Doc,
      elements: s02Doc.elements.map((el) => {
        if (el.id === workerElementId) {
          const rb = el.behavior as ResourceBehavior;
          return {
            ...el,
            behavior: {
              ...rb,
              config: {
                ...rb.config,
                failureRate: 100,
              },
            },
          };
        }
        return el;
      }),
    };

    const runId = '00000000-0000-0000-0000-000000000003';
    const result = await runScenario(modifiedDoc, allowScenarioId, runId);

    expect(result.status).toBe('completed');

    // User root stays succeeded 1
    expect(result.summary.rootCounts.generated).toBe(1);
    expect(result.summary.rootCounts.succeeded).toBe(1);
    expect(result.summary.rootCounts.failed).toBe(0);
    expect(result.summary.rootCounts.inFlight).toBe(0);

    // Message failed 1
    expect(result.summary.messageCounts.generated).toBe(1);
    expect(result.summary.messageCounts.failed).toBe(1);
    expect(result.summary.messageCounts.succeeded).toBe(0);
    expect(result.summary.messageCounts.inFlight).toBe(0);
  });

  it('worker maxRetries 2 with failureRate 100 -> at most 3 attempts in the trace', async () => {
    const modifiedDoc: Document = {
      ...s02Doc,
      elements: s02Doc.elements.map((el) => {
        if (el.id === workerElementId) {
          const rb = el.behavior as ResourceBehavior;
          return {
            ...el,
            behavior: {
              ...rb,
              config: {
                ...rb.config,
                failureRate: 100,
                maxRetries: 2,
                retryDelayMs: 0,
              },
            },
          };
        }
        return el;
      }),
    };

    const runId = '00000000-0000-0000-0000-000000000004';
    const result = await runScenario(modifiedDoc, allowScenarioId, runId);

    expect(result.status).toBe('completed');

    // User root stays succeeded 1, message failed 1
    expect(result.summary.rootCounts.succeeded).toBe(1);
    expect(result.summary.messageCounts.failed).toBe(1);

    // Count attempts in trace for the worker
    const attemptEvents = result.events.filter(
      (e) => e.elementId === workerElementId && e.kind === 'started' && e.code.startsWith('attempt:'),
    );
    expect(attemptEvents.length).toBeLessThanOrEqual(3);
    expect(attemptEvents.length).toBe(3); // 1 initial attempt + 2 retries
  });
});

describe('scenario runner: S01 reference fixture through runScenario', () => {
  const s01Doc = loadFixture('s01.json');

  it('runs scenario 1 (Invalid cart): passes all authored assertions', async () => {
    const scenarioId = '63096c28-fb95-589b-ac92-178597be9c0d';
    const runId = '00000000-0000-0000-0000-000000000011';

    const result = await runScenario(s01Doc, scenarioId, runId);

    expect(result.status).toBe('completed');
    expect(result.reason).toBeNull();
    expect(result.checks.length).toBe(2);
    for (const check of result.checks) {
      expect(check.status).toBe('passed');
    }
  });

  it('runs scenario 2 (Duplicate submit): passes all authored assertions', async () => {
    const scenarioId = '425ec755-23cd-56f9-ab2f-1b1ae8ab18d6';
    const runId = '00000000-0000-0000-0000-000000000012';

    const result = await runScenario(s01Doc, scenarioId, runId);

    expect(result.status).toBe('completed');
    expect(result.reason).toBeNull();
    expect(result.checks.length).toBe(4);
    for (const check of result.checks) {
      expect(check.status).toBe('passed');
    }
  });

  it('runs scenario 3 (Timeout retry stale response): passes all authored assertions', async () => {
    const scenarioId = 'c90abfe5-387e-556c-85cc-a246dd3aeec4';
    const runId = '00000000-0000-0000-0000-000000000013';

    const result = await runScenario(s01Doc, scenarioId, runId);

    expect(result.status).toBe('completed');
    expect(result.reason).toBeNull();
    expect(result.checks.length).toBe(4);
    for (const check of result.checks) {
      expect(check.status).toBe('passed');
    }
  });
});

describe('scenario runner: S03 reference fixture through runScenario', () => {
  const s03Doc = loadFixture('s03.json');

  it('runs scenario (Normalize orders): passes all authored assertions', async () => {
    const scenarioId = s03Doc.scenarios[0].id;
    const runId = '00000000-0000-0000-0000-000000000021';

    const result = await runScenario(s03Doc, scenarioId, runId);

    expect(result.status).toBe('completed');
    expect(result.reason).toBeNull();
    expect(result.checks.length).toBe(2);
    for (const check of result.checks) {
      expect(check.status).toBe('passed');
    }

    // Pure data run: 0 transport roots generated
    expect(result.summary.rootCounts.generated).toBe(0);
    expect(result.summary.consumedInputs).toBe(1);

    // Row outcomes recorded
    expect(result.summary.rowOutcomes.length).toBeGreaterThan(0);
  });
});

describe('scenario runner: determinism and chunked stepping', () => {
  const s02Doc = loadFixture('s02.json');
  const scenarioId = '5bf95962-e1aa-5df7-8dd2-5784bbad14c8';
  const runId = '00000000-0000-0000-0000-000000000031';

  it('two runs give identical canonical JSON of events and summary', async () => {
    const run1 = await runScenario(s02Doc, scenarioId, runId);
    const run2 = await runScenario(s02Doc, scenarioId, runId);

    const cEvt1 = canonicalJson(run1.events);
    const cEvt2 = canonicalJson(run2.events);
    expect(cEvt1.ok).toBe(true);
    expect(cEvt2.ok).toBe(true);
    if (cEvt1.ok && cEvt2.ok) {
      expect(cEvt1.text).toBe(cEvt2.text);
    }

    const cSum1 = canonicalJson(run1.summary);
    const cSum2 = canonicalJson(run2.summary);
    expect(cSum1.ok).toBe(true);
    expect(cSum2.ok).toBe(true);
    if (cSum1.ok && cSum2.ok) {
      expect(cSum1.text).toBe(cSum2.text);
    }
  });

  it('chunked vs one-shot stepping gives identical results', async () => {
    const oneShot = await runScenario(s02Doc, scenarioId, runId);

    // Chunked stepping via ScenarioRunner
    const runner = new ScenarioRunner(s02Doc, scenarioId, runId);
    while (await runner.step()) {
      // Step by single discrete event
    }
    const chunked = runner.getResult();

    const cEvtOne = canonicalJson(oneShot.events);
    const cEvtChunk = canonicalJson(chunked.events);
    expect(cEvtOne.ok).toBe(true);
    expect(cEvtChunk.ok).toBe(true);
    if (cEvtOne.ok && cEvtChunk.ok) {
      expect(cEvtOne.text).toBe(cEvtChunk.text);
    }

    const cSumOne = canonicalJson(oneShot.summary);
    const cSumChunk = canonicalJson(chunked.summary);
    expect(cSumOne.ok).toBe(true);
    expect(cSumChunk.ok).toBe(true);
    if (cSumOne.ok && cSumChunk.ok) {
      expect(cSumOne.text).toBe(cSumChunk.text);
    }
  });
});

describe('review fix 1: no inferred success on settlement without outcome', () => {
  it('fails with sanitized diagnostic naming the event when a settled message unit has outcome null', () => {
    const state: SettlementState = {
      activeMessageRoots: new Set(['msg_1']),
      activeUserRoots: new Map(),
      deliveredUnitToMessageRoot: new Map([['deliv_unit_1', 'msg_1']]),
      rootCounts: { generated: 0, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
      messageCounts: { generated: 1, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 1 },
    };

    const nullOutcomeEvent: Pick<TraceEvent, 'id' | 'kind' | 'code' | 'rootId' | 'outcome'> = {
      id: 'evt-settled-1',
      kind: 'settled',
      code: 'succeeded',
      rootId: 'deliv_unit_1',
      outcome: null,
    };

    const res = handleSettlementEvent(nullOutcomeEvent, state);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe('failed');
      expect(res.reason).toContain('evt-settled-1');
      expect(res.reason).toMatch(/no explicit outcome/i);
    }
    // Verify state was not modified with a false success
    expect(state.messageCounts.succeeded).toBe(0);
    expect(state.messageCounts.inFlight).toBe(1);
    expect(state.activeMessageRoots.has('msg_1')).toBe(true);
  });

  it('fails with sanitized diagnostic naming the event when a settled user root has outcome null', () => {
    const state: SettlementState = {
      activeMessageRoots: new Set(),
      activeUserRoots: new Map([['user_root_1', { openFrameCount: 1, outcomes: [] }]]),
      deliveredUnitToMessageRoot: new Map(),
      rootCounts: { generated: 1, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 1 },
      messageCounts: { generated: 0, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
    };

    const nullOutcomeEvent: Pick<TraceEvent, 'id' | 'kind' | 'code' | 'rootId' | 'outcome'> = {
      id: 'evt-user-settled-1',
      kind: 'settled',
      code: 'succeeded',
      rootId: 'user_root_1',
      outcome: null,
    };

    const res = handleSettlementEvent(nullOutcomeEvent, state);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe('failed');
      expect(res.reason).toContain('evt-user-settled-1');
      expect(res.reason).toMatch(/no explicit outcome/i);
    }
    // Verify state was not modified with a false success
    expect(state.rootCounts.succeeded).toBe(0);
    expect(state.rootCounts.inFlight).toBe(1);
    expect(state.activeUserRoots.has('user_root_1')).toBe(true);
  });

  it('succeeds and increments appropriate counts when settled event has explicit outcome', () => {
    const state: SettlementState = {
      activeMessageRoots: new Set(['msg_1']),
      activeUserRoots: new Map([['user_root_1', { openFrameCount: 1, outcomes: [] }]]),
      deliveredUnitToMessageRoot: new Map([['deliv_unit_1', 'msg_1']]),
      rootCounts: { generated: 1, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 1 },
      messageCounts: { generated: 1, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 1 },
    };

    // Message settlement
    const msgEvent: Pick<TraceEvent, 'id' | 'kind' | 'code' | 'rootId' | 'outcome'> = {
      id: 'evt-msg-ok',
      kind: 'settled',
      code: 'succeeded',
      rootId: 'deliv_unit_1',
      outcome: 'succeeded',
    };
    const resMsg = handleSettlementEvent(msgEvent, state);
    expect(resMsg.ok).toBe(true);
    expect(state.messageCounts.succeeded).toBe(1);
    expect(state.messageCounts.inFlight).toBe(0);
    expect(state.activeMessageRoots.has('msg_1')).toBe(false);

    // User root settlement
    const userEvent: Pick<TraceEvent, 'id' | 'kind' | 'code' | 'rootId' | 'outcome'> = {
      id: 'evt-user-ok',
      kind: 'settled',
      code: 'succeeded',
      rootId: 'user_root_1',
      outcome: 'succeeded',
    };
    const resUser = handleSettlementEvent(userEvent, state);
    expect(resUser.ok).toBe(true);
    expect(state.rootCounts.succeeded).toBe(1);
    expect(state.rootCounts.inFlight).toBe(0);
    expect(state.activeUserRoots.has('user_root_1')).toBe(false);
  });
});

describe('review fix 2: exact linkage, no string prefix collisions', () => {
  it('distinguishes message roots whose IDs share a prefix (e.g. msg_1 vs msg_10)', () => {
    const state: SettlementState = {
      activeMessageRoots: new Set(['msg_1', 'msg_10']),
      activeUserRoots: new Map(),
      deliveredUnitToMessageRoot: new Map([
        ['unit_for_msg_1', 'msg_1'],
        ['unit_for_msg_10', 'msg_10'],
      ]),
      rootCounts: { generated: 0, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
      messageCounts: { generated: 2, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 2 },
    };

    // Settle unit for msg_10
    const evt10: Pick<TraceEvent, 'id' | 'kind' | 'code' | 'rootId' | 'outcome'> = {
      id: 'evt-10',
      kind: 'settled',
      code: 'succeeded',
      rootId: 'unit_for_msg_10',
      outcome: 'succeeded',
    };

    const res = handleSettlementEvent(evt10, state);
    expect(res.ok).toBe(true);
    // msg_10 is settled, msg_1 remains active
    expect(state.activeMessageRoots.has('msg_10')).toBe(false);
    expect(state.activeMessageRoots.has('msg_1')).toBe(true);
    expect(state.deliveredUnitToMessageRoot.has('unit_for_msg_10')).toBe(false);
    expect(state.deliveredUnitToMessageRoot.has('unit_for_msg_1')).toBe(true);
    expect(state.messageCounts.succeeded).toBe(1);
    expect(state.messageCounts.inFlight).toBe(1);
  });
});

describe('broadcast message roots', () => {
  const s02Doc = loadFixture('s02.json');
  const allowScenarioId = '5bf95962-e1aa-5df7-8dd2-5784bbad14c8';
  const queueElementId = 'cbf95fcf-bc61-5c89-9c0c-d506c152f7f8';

  it('runs to completion when a message edge reaches a broadcast broker, minting one message root per delivered copy', async () => {
    const broadcastDoc: Document = {
      ...s02Doc,
      elements: s02Doc.elements.map((el) => {
        if (el.id === queueElementId) {
          const rb = el.behavior as ResourceBehavior;
          return {
            ...el,
            behavior: {
              ...rb,
              config: {
                ...rb.config,
                delivery: 'broadcast',
              },
            },
          };
        }
        return el;
      }),
    };

    const runId = '00000000-0000-0000-0000-000000000099';
    const result = await runScenario(broadcastDoc, allowScenarioId, runId);

    // A broadcast broker runs to completion.
    expect(result.status).toBe('completed');
    expect(result.reason).toBeNull();

    // The queue has exactly one downstream consumer in this fixture, so broadcasting to it
    // mints exactly one message root (linked to the emitting parent), same conservation as
    // a competing delivery would for a single consumer.
    expect(result.summary.messageCounts.generated).toBe(1);
    expect(result.summary.messageCounts.succeeded).toBe(1);
    expect(result.summary.messageCounts.failed).toBe(0);
    expect(result.summary.messageCounts.inFlight).toBe(0);

    // The user root is unaffected by the (now-supported) broadcast delivery.
    expect(result.summary.rootCounts.succeeded).toBe(1);
  });
});

