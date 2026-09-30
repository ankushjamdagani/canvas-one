import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Document, Id } from '../../domain/studio/model';
import { checkReadiness } from '../../domain/studio/readiness';
import { runScenario } from '../../domain/studio/runner/scenario-runner';
import { applyRecordChanges } from '../../persistence/studio/apply-records';
import { planWrapInBoundary, wrapBoundaryCrossingEndpoints, type WrapBoundaryIds } from './wrapPlan';

const S05_PATH = join(process.cwd(), 'specs/revamp/fixtures/s05.json');
const QUEUE_ID = '3f495542-b8ea-5d92-90a0-3c8ec53b12d8';
const WORKER_ID = '7453e0ab-17a6-579d-909c-0586d9144ad3';

function loadS05(): Document {
  return JSON.parse(readFileSync(S05_PATH, 'utf8')) as Document;
}

function uuid(serial: number): Id {
  return `f0000000-0000-4000-8000-${serial.toString().padStart(12, '0')}`;
}

function idsFor(document: Document, elementIds: readonly Id[], start = 1): WrapBoundaryIds {
  let next = start;
  return {
    ownerElementId: uuid(next++),
    refinementId: uuid(next++),
    portIds: wrapBoundaryCrossingEndpoints(document, elementIds).map(() => ({
      ownerPortId: uuid(next++),
      mappingId: uuid(next++),
    })),
    placementId: uuid(next++),
  };
}

function applyPlan(document: Document, plan: ReturnType<typeof planWrapInBoundary>): Document {
  if (!plan.ok) throw new Error(plan.reason);
  const applied = applyRecordChanges(document, plan.changes);
  if (!applied.ok) throw new Error(applied.issues.map((issue) => issue.message).join('\n'));
  return applied.document;
}

function executedElements(result: Awaited<ReturnType<typeof runScenario>>): readonly Id[] {
  return [...new Set(result.events.flatMap((event) => event.elementId ? [event.elementId] : []))].sort();
}

describe('planWrapInBoundary', () => {
  it('wraps part of S05 without changing executed elements, outcomes or assertions, and stays ready', async () => {
    const before = loadS05();
    const viewId = before.views[0].id;
    const members = [QUEUE_ID, WORKER_ID];
    const plan = planWrapInBoundary(before, viewId, members, idsFor(before, members), 'Async fulfilment');
    expect(plan).toMatchObject({ ok: true, label: 'Wrap in boundary' });
    const after = applyPlan(before, plan);

    const owner = after.elements.at(-1);
    expect(owner).toMatchObject({
      label: 'Async fulfilment',
      visualKind: 'custom',
      behavior: { kind: 'unmodeled', version: 1, reason: 'Aggregate behaviour not configured' },
    });
    expect(owner?.ports).toHaveLength(1);
    expect(owner?.ports[0].label).toBe('Fulfillment queue · in');
    expect(after.refinements.at(-1)).toMatchObject({ memberElementIds: members });

    for (const scenario of before.scenarios) {
      const afterScenario = after.scenarios.find((candidate) => candidate.id === scenario.id);
      expect(afterScenario?.revision).toBe(scenario.revision + 1);
      expect(checkReadiness(after, scenario.id).ready).toBe(true);

      const runId = `run-wrap-${scenario.id}`;
      const beforeRun = await runScenario(before, scenario.id, runId);
      const afterRun = await runScenario(after, scenario.id, runId);
      expect(afterRun.status).toBe(beforeRun.status);
      expect(executedElements(afterRun)).toEqual(executedElements(beforeRun));
      expect(afterRun.summary.rootCounts).toEqual(beforeRun.summary.rootCounts);
      expect(afterRun.summary.messageCounts).toEqual(beforeRun.summary.messageCounts);
      expect(afterRun.checks).toEqual(beforeRun.checks);
    }
  });

  it('supports nesting when the selected member is itself an existing owner', () => {
    const original = loadS05();
    const viewId = original.views[0].id;
    const innerIds = idsFor(original, [QUEUE_ID, WORKER_ID], 20);
    const inner = applyPlan(
      original,
      planWrapInBoundary(original, viewId, [QUEUE_ID, WORKER_ID], innerIds, 'Inner boundary'),
    );
    const outerIds = idsFor(inner, [innerIds.ownerElementId], 40);
    const outerPlan = planWrapInBoundary(inner, viewId, [innerIds.ownerElementId], outerIds, 'Outer boundary');
    expect(outerPlan).toMatchObject({ ok: true });
    const nested = applyPlan(inner, outerPlan);
    expect(nested.refinements.at(-1)).toMatchObject({
      ownerElementId: outerIds.ownerElementId,
      memberElementIds: [innerIds.ownerElementId],
    });
    for (const scenario of nested.scenarios) {
      const readiness = checkReadiness(nested, scenario.id);
      expect(readiness.ready, JSON.stringify(readiness)).toBe(true);
    }
  });

  it('returns typed rejections for empty, unplaced and already-owned selections', () => {
    const document = loadS05();
    const viewId = document.views[0].id;
    expect(planWrapInBoundary(document, viewId, [], idsFor(document, []), 'Empty'))
      .toMatchObject({ ok: false, code: 'empty-selection' });
    expect(planWrapInBoundary(document, viewId, ['missing'], idsFor(document, ['missing']), 'Missing'))
      .toMatchObject({ ok: false, code: 'not-placed' });

    const firstIds = idsFor(document, [QUEUE_ID, WORKER_ID], 60);
    const wrapped = applyPlan(
      document,
      planWrapInBoundary(document, viewId, [QUEUE_ID, WORKER_ID], firstIds, 'First'),
    );
    expect(planWrapInBoundary(wrapped, viewId, [QUEUE_ID], idsFor(wrapped, [QUEUE_ID], 80), 'Again'))
      .toMatchObject({ ok: false, code: 'already-member' });
  });
});
