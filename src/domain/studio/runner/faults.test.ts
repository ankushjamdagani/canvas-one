import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Document, ResourceBehavior } from '../model';
import { runScenario, ScenarioRunner } from './scenario-runner';
import { canonicalJson } from '../canonical';
import { expectCleanJourneysAndRootIds } from './acceptance.test';

const FIXTURES_DIR = path.join(process.cwd(), 'specs/revamp/fixtures');

function loadFixture(name: string): Document {
  const content = fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
  return JSON.parse(content) as Document;
}

type ResultEvent = Awaited<ReturnType<typeof runScenario>>['events'][number];

// Exactly one 'settled' event per root/unit carries the unit-level outcome; per-attempt
// resource settlements always use the distinct 'attempt-settled:<attempt>' code (§8 &
// coordinator review), so excluding that prefix isolates the single canonical unit-level
// settlement regardless of how many attempts ran or which subsystem (resource admission,
// machine reply) produced it.
function unitSettlements(events: readonly ResultEvent[], rootId: string): ResultEvent[] {
  return events.filter(
    (e) => e.rootId === rootId && e.kind === 'settled' && !e.code.startsWith('attempt-settled:'),
  );
}

// The element a router selected for this root (§11: "which service element each root
// reached"), surfaced via the 'route-selected' dispatch fact rather than admission facts,
// since a rejected admission never reaches 'started'/'admitted' at the target.
function routedTarget(events: readonly ResultEvent[], rootId: string): string | undefined {
  return events.find((e) => e.rootId === rootId && e.kind === 'dispatch' && e.code === 'route-selected')
    ?.elementId;
}

describe('S04 host failover and fault scheduler', () => {
  const s04Doc = loadFixture('s04.json');

  it('Scenario 1: Failover routing passes all authored assertions and trace-level facts', async () => {
    const scenario = s04Doc.scenarios.find((s) => s.label === 'Failover routing')!;
    expect(scenario).toBeDefined();

    const runId = '00000000-0000-4000-8000-000000000001';
    const result = await runScenario(s04Doc, scenario.id, runId);

    // Terminal status completed
    expect(result.status).toBe('completed');
    expect(result.summary.rootCounts.generated).toBe(6);
    expect(result.summary.rootCounts.succeeded).toBe(5);
    expect(result.summary.rootCounts.rejected).toBe(1);
    expect(result.summary.rootCounts.failed).toBe(0);
    expect(result.summary.rootCounts.inFlight).toBe(0);

    // All authored assertions pass
    expect(result.checks.length).toBeGreaterThan(0);
    for (const check of result.checks) {
      expect(check.status).toBe('passed');
    }

    // Trace-level facts: verify per-arrival route selections and outcomes (§11)
    const routerId = '816fe039-76dd-5b7b-a787-4d7666ff8d62';
    const routeSelectedEvents = result.events.filter(
      (e) => e.kind === 'dispatch' && e.code === 'admitted' && e.elementId === routerId,
    );
    expect(routeSelectedEvents.length).toBe(6);

    const serviceA = 'ec155572-83d4-5ad5-b77a-e26a2eaabdfb';
    const serviceB = 'ae615f97-2661-5d23-9565-d88605af2e9e';

    // Only the root op (the router, as the chain's entry node) gets an 'input'/root-scoped
    // trace event at the arrival's own atMs; downstream hops (router -> A/B) settle later,
    // after the router's own service time, so we correlate by rootId rather than atMs.
    const arrivalAt = (ms: number) =>
      result.events.find((e) => e.kind === 'input' && e.atMs === ms)!.rootId;

    // All six arrivals per §11: t0->A ok, t1->B ok, t2->A rejected (host down, router not
    // yet updated), t3->B ok, t4->B ok, t5->A ok (cursor reset at recovery detection).
    // For each root: exactly one unit-level settlement, with the expected outcome, and the
    // route-selected fact shows which service element it actually targeted.
    const expectedArrivals: Array<{ atMs: number; target: string; outcome: string }> = [
      { atMs: 0, target: serviceA, outcome: 'succeeded' },
      { atMs: 1000, target: serviceB, outcome: 'succeeded' },
      { atMs: 2000, target: serviceA, outcome: 'rejected' },
      { atMs: 3000, target: serviceB, outcome: 'succeeded' },
      { atMs: 4000, target: serviceB, outcome: 'succeeded' },
      { atMs: 5000, target: serviceA, outcome: 'succeeded' },
    ];

    for (const { atMs, target, outcome } of expectedArrivals) {
      const rootId = arrivalAt(atMs);
      expect(routedTarget(result.events, rootId), `route target for arrival at ${atMs}ms`).toBe(target);

      const settlements = unitSettlements(result.events, rootId);
      expect(settlements.length, `unit-level settlements for arrival at ${atMs}ms`).toBe(1);
      expect(settlements[0].outcome, `outcome for arrival at ${atMs}ms`).toBe(outcome);
    }
  });

  it('Scenario 2: Active queued outage passes all authored assertions and trace-level facts', async () => {
    const scenario = s04Doc.scenarios.find((s) => s.label === 'Active queued outage')!;
    expect(scenario).toBeDefined();

    const runId = '00000000-0000-4000-8000-000000000002';
    const result = await runScenario(s04Doc, scenario.id, runId);

    expect(result.status).toBe('completed');
    expect(result.summary.rootCounts.generated).toBe(3);
    expect(result.summary.rootCounts.succeeded).toBe(1);
    expect(result.summary.rootCounts.failed).toBe(1);
    expect(result.summary.rootCounts.rejected).toBe(1);
    expect(result.summary.rootCounts.inFlight).toBe(0);

    for (const check of result.checks) {
      expect(check.status).toBe('passed');
    }

    // Trace-level checks, correlated by rootId with exactly one unit-level settlement each.
    const arrivalAt = (ms: number) => result.events.find((e) => e.kind === 'input' && e.atMs === ms)!.rootId;

    // x arrived at t=0 (active when the outage fires at t=500): fails exactly once.
    const xRootId = arrivalAt(0);
    const xSettlements = unitSettlements(result.events, xRootId);
    expect(xSettlements.length).toBe(1);
    expect(xSettlements[0].outcome).toBe('failed');
    expect(xSettlements[0].atMs).toBe(500);

    // y arrived at t=250 (queued when the outage fires at t=500): rejected exactly once.
    const yRootId = arrivalAt(250);
    const ySettlements = unitSettlements(result.events, yRootId);
    expect(ySettlements.length).toBe(1);
    expect(ySettlements[0].outcome).toBe('rejected');
    expect(ySettlements[0].atMs).toBe(500);

    // Cancelled completion at t=1000ms (x's original, pre-outage completion time) adds no
    // outcome for any root.
    const t1000Settled = result.events.filter((e) => e.atMs === 1000 && e.kind === 'settled');
    expect(t1000Settled.length).toBe(0);

    // z arrives at t=1600ms, after recovery (host up at t=1500), and succeeds once at
    // t=2600ms (1000ms service time).
    const zRootId = arrivalAt(1600);
    const zSettlements = unitSettlements(result.events, zRootId);
    expect(zSettlements.length).toBe(1);
    expect(zSettlements[0].outcome).toBe('succeeded');
    expect(zSettlements[0].atMs).toBe(2600);
  });

  it('Scenario 3: Outage at completion passes all authored assertions and trace-level facts', async () => {
    const scenario = s04Doc.scenarios.find((s) => s.label === 'Outage at completion')!;
    expect(scenario).toBeDefined();

    const runId = '00000000-0000-4000-8000-000000000003';
    const result = await runScenario(s04Doc, scenario.id, runId);

    expect(result.status).toBe('completed');
    expect(result.summary.rootCounts.generated).toBe(3);
    expect(result.summary.rootCounts.succeeded).toBe(1);
    expect(result.summary.rootCounts.failed).toBe(1);
    expect(result.summary.rootCounts.rejected).toBe(1);
    expect(result.summary.rootCounts.inFlight).toBe(0);

    for (const check of result.checks) {
      expect(check.status).toBe('passed');
    }

    // At t=1000ms: host-down fires before completion, active work fails exactly once
    const t1000Events = result.events.filter((e) => e.atMs === 1000);
    const hostDown = t1000Events.find((e) => e.kind === 'fault' && e.code === 'host-down');
    expect(hostDown).toBeDefined();

    const arrivalAt = (ms: number) => result.events.find((e) => e.kind === 'input' && e.atMs === ms)!.rootId;

    // x arrived at t=0 and was due to complete at exactly t=1000ms, the same instant the
    // outage fires: the outage phase comes first (§6), so x fails exactly once, not succeeds.
    const xRootId = arrivalAt(0);
    const xSettlements = unitSettlements(result.events, xRootId);
    expect(xSettlements.length).toBe(1);
    expect(xSettlements[0].outcome).toBe('failed');
    expect(xSettlements[0].atMs).toBe(1000);

    // y arrived at t=250, still queued when the outage fires at t=1000: rejected exactly once.
    const yRootId = arrivalAt(250);
    const ySettlements = unitSettlements(result.events, yRootId);
    expect(ySettlements.length).toBe(1);
    expect(ySettlements[0].outcome).toBe('rejected');
    expect(ySettlements[0].atMs).toBe(1000);

    // No success at t=1000ms.
    const t1000Success = t1000Events.filter((e) => e.kind === 'settled' && e.outcome === 'succeeded');
    expect(t1000Success.length).toBe(0);

    // z arrives at t=1600ms, after recovery (host up at t=1500), and succeeds once at
    // t=2600ms (1000ms service time).
    const zRootId = arrivalAt(1600);
    const zSettlements = unitSettlements(result.events, zRootId);
    expect(zSettlements.length).toBe(1);
    expect(zSettlements[0].outcome).toBe('succeeded');
    expect(zSettlements[0].atMs).toBe(2600);
  });

  it('determinism: chunked vs one-shot stepping produce identical results', async () => {
    const scenario = s04Doc.scenarios.find((s) => s.label === 'Failover routing')!;
    const runId = '00000000-0000-4000-8000-000000000004';

    // One-shot
    const oneShotRunner = new ScenarioRunner(s04Doc, scenario.id, runId);
    const oneShotResult = await oneShotRunner.run();

    // Chunked (1 step at a time)
    const chunkedRunner = new ScenarioRunner(s04Doc, scenario.id, runId);
    let chunkedResult;
    while (true) {
      const more = await chunkedRunner.step();
      if (!more) {
        chunkedResult = chunkedRunner.getResult();
        break;
      }
    }

    expect(canonicalJson(oneShotResult.summary)).toEqual(canonicalJson(chunkedResult.summary));
    expect(oneShotResult.events.length).toBe(chunkedResult.events.length);
  });
});

describe('S04 fault and placement validation', () => {
  const s04Doc = loadFixture('s04.json');
  const baseScenario = s04Doc.scenarios.find((s) => s.label === 'Failover routing')!;

  it('rejects overlapping fault intervals on the same host', async () => {
    const invalidDoc: Document = {
      ...s04Doc,
      scenarios: s04Doc.scenarios.map((sc) => {
        if (sc.id === baseScenario.id) {
          return {
            ...sc,
            faults: [
              {
                id: 'f1',
                hostId: 'H1',
                downAtMs: 1000,
                upAtMs: 3000,
                detectionDelayMs: 0,
                recoveryDetectionDelayMs: 0,
                activePolicy: 'fail',
                queuedPolicy: 'reject',
                routeReset: 'first-healthy',
              },
              {
                id: 'f2',
                hostId: 'H1',
                downAtMs: 2000, // Overlaps with f1 (1000-3000)
                upAtMs: 4000,
                detectionDelayMs: 0,
                recoveryDetectionDelayMs: 0,
                activePolicy: 'fail',
                queuedPolicy: 'reject',
                routeReset: 'first-healthy',
              },
            ],
          };
        }
        return sc;
      }),
    };

    const res = await runScenario(invalidDoc, baseScenario.id, 'run-val-1');
    expect(res.status).toBe('invalid');
    expect(res.reason).toMatch(/overlapping fault intervals/i);
    expect(res.issues?.some((i) => i.code === 'invalid')).toBe(true);
  });

  it('rejects fault with upAtMs <= downAtMs', async () => {
    const invalidDoc: Document = {
      ...s04Doc,
      scenarios: s04Doc.scenarios.map((sc) => {
        if (sc.id === baseScenario.id) {
          return {
            ...sc,
            faults: [
              {
                id: 'f1',
                hostId: 'H1',
                downAtMs: 3000,
                upAtMs: 2000, // up <= down
                detectionDelayMs: 0,
                recoveryDetectionDelayMs: 0,
                activePolicy: 'fail',
                queuedPolicy: 'reject',
                routeReset: 'first-healthy',
              },
            ],
          };
        }
        return sc;
      }),
    };

    const res = await runScenario(invalidDoc, baseScenario.id, 'run-val-2');
    expect(res.status).toBe('invalid');
    expect(res.reason).toMatch(/upAtMs.*<=.*downAtMs/i);
  });

  it('rejects conflicting host placement', async () => {
    const invalidDoc: Document = {
      ...s04Doc,
      relations: [
        ...s04Doc.relations,
        {
          id: 'rel-conflict',
          label: 'Runs on H2 too',
          kind: 'deployed-on',
          elementId: 'ec155572-83d4-5ad5-b77a-e26a2eaabdfb', // already deployed on H1
          hostId: 'e5083d81-8e2c-5b4a-ae98-3a8dc0d9d9da', // conflicting host H2
        },
      ],
    };

    const res = await runScenario(invalidDoc, baseScenario.id, 'run-val-3');
    expect(res.status).toBe('invalid');
    expect(res.reason).toMatch(/conflicting host placement/i);
  });

  it('rejects cyclic host placement', async () => {
    const invalidDoc: Document = {
      ...s04Doc,
      relations: [
        {
          id: 'rel-cycle-1',
          label: 'A on B',
          kind: 'deployed-on',
          elementId: 'node-A',
          hostId: 'node-B',
        },
        {
          id: 'rel-cycle-2',
          label: 'B on A',
          kind: 'deployed-on',
          elementId: 'node-B',
          hostId: 'node-A',
        },
      ],
    };

    const res = await runScenario(invalidDoc, baseScenario.id, 'run-val-4');
    expect(res.status).toBe('invalid');
    expect(res.reason).toMatch(/cyclic host placement/i);
  });
});

describe('Decision D36: broadcast message roots', () => {
  const s02Doc = loadFixture('s02.json');
  const allowScenarioId = '5bf95962-e1aa-5df7-8dd2-5784bbad14c8';
  const queueElementId = 'cbf95fcf-bc61-5c89-9c0c-d506c152f7f8';

  it('a broadcast broker with 2 consumers produces 2 message roots, each linked to the emitting parent, with exact conservation', async () => {
    // Add a second worker consumer to Queue
    const worker2Id = 'worker-2-id';
    const worker2PortIn = 'worker-2-in';
    const worker1 = s02Doc.elements.find((e) => e.visualKind === 'service')!;

    const docWith2Consumers: Document = {
      ...s02Doc,
      elements: [
        ...s02Doc.elements.map((el) => {
          if (el.id === queueElementId) {
            const rb = el.behavior as ResourceBehavior;
            return {
              ...el,
              behavior: {
                ...rb,
                config: {
                  ...rb.config,
                  delivery: 'broadcast' as const,
                },
              },
            };
          }
          return el;
        }),
        {
          ...worker1,
          id: worker2Id,
          label: 'Worker 2',
          ports: [
            {
              id: worker2PortIn,
              label: 'in',
              direction: 'in' as const,
              channel: 'call' as const, protocol: 'http' as const,
              schemaId: worker1.ports[0].schemaId,
              responseSchemaId: worker1.ports[0].responseSchemaId,
            },
          ],
          behavior: {
            ...(worker1.behavior as ResourceBehavior),
            entryPortId: worker2PortIn,
          },
        },
      ],
      connections: [
        ...s02Doc.connections,
        {
          id: 'queue-to-worker2',
          kind: 'message' as const,
          source: {
            elementId: queueElementId,
            portId: s02Doc.elements.find((e) => e.id === queueElementId)!.ports[1].id,
          },
          target: {
            elementId: worker2Id,
            portId: worker2PortIn,
          },
          config: {
            latencyMs: 10,
            linkClass: null, jitterMs: 0, lossRate: 0, bandwidthKbps: null,
            weight: 1,
            condition: null,
            fallback: false,
            },
        },
      ],
      scenarios: s02Doc.scenarios.map((sc) => {
        if (sc.id === allowScenarioId) {
          return {
            ...sc,
            scopeElementIds: [...sc.scopeElementIds, worker2Id],
          };
        }
        return sc;
      }),
    };

    const res = await runScenario(docWith2Consumers, allowScenarioId, 'run-d36-broadcast');
    expect(res.status).toBe('completed');

    // 2 message roots generated, 2 succeeded, 0 failed, 0 inFlight
    expect(res.summary.messageCounts.generated).toBe(2);
    expect(res.summary.messageCounts.succeeded).toBe(2);
    expect(res.summary.messageCounts.failed).toBe(0);
    expect(res.summary.messageCounts.inFlight).toBe(0);

    // RV-14f review: no delivered/broadcast-copy unit is left with journeyId 'unknown',
    // and both broadcast copies expose a clean runner-minted root id, never a raw kernel
    // delivery-path identity.
    const scenario = docWith2Consumers.scenarios.find((s) => s.id === allowScenarioId)!;
    expectCleanJourneysAndRootIds(res.events, scenario);
  });

  it('one consumer failing on broadcast broker is counted as one failed message root', async () => {
    const worker2Id = 'worker-2-failing';
    const worker2PortIn = 'worker-2-in-failing';
    const worker1 = s02Doc.elements.find((e) => e.visualKind === 'service')!;

    const docWithFailingConsumer: Document = {
      ...s02Doc,
      elements: [
        ...s02Doc.elements.map((el) => {
          if (el.id === queueElementId) {
            const rb = el.behavior as ResourceBehavior;
            return {
              ...el,
              behavior: {
                ...rb,
                config: {
                  ...rb.config,
                  delivery: 'broadcast' as const,
                },
              },
            };
          }
          return el;
        }),
        {
          ...worker1,
          id: worker2Id,
          label: 'Worker 2 Failing',
          ports: [
            {
              id: worker2PortIn,
              label: 'in',
              direction: 'in' as const,
              channel: 'call' as const, protocol: 'http' as const,
              schemaId: worker1.ports[0].schemaId,
              responseSchemaId: worker1.ports[0].responseSchemaId,
            },
          ],
          behavior: {
            ...(worker1.behavior as ResourceBehavior),
            config: {
              ...(worker1.behavior as ResourceBehavior).config,
              failureRate: 100, // 100% failure rate
              maxRetries: 0,
            },
            entryPortId: worker2PortIn,
          },
        },
      ],
      connections: [
        ...s02Doc.connections,
        {
          id: 'queue-to-worker2-failing',
          kind: 'message' as const,
          source: {
            elementId: queueElementId,
            portId: s02Doc.elements.find((e) => e.id === queueElementId)!.ports[1].id,
          },
          target: {
            elementId: worker2Id,
            portId: worker2PortIn,
          },
          config: {
            latencyMs: 10,
            linkClass: null, jitterMs: 0, lossRate: 0, bandwidthKbps: null,
            weight: 1,
            condition: null,
            fallback: false,
            },
        },
      ],
      scenarios: s02Doc.scenarios.map((sc) => {
        if (sc.id === allowScenarioId) {
          return {
            ...sc,
            scopeElementIds: [...sc.scopeElementIds, worker2Id],
          };
        }
        return sc;
      }),
    };

    const res = await runScenario(docWithFailingConsumer, allowScenarioId, 'run-d36-fail');
    expect(res.status).toBe('completed');

    // Exactly 2 message roots: 1 succeeded, 1 failed, 0 inFlight
    expect(res.summary.messageCounts.generated).toBe(2);
    expect(res.summary.messageCounts.succeeded).toBe(1);
    expect(res.summary.messageCounts.failed).toBe(1);
    expect(res.summary.messageCounts.inFlight).toBe(0);

    // User root stays succeeded (async message does not change user root)
    expect(res.summary.rootCounts.succeeded).toBe(1);
  });
});
