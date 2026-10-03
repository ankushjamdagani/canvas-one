import { describe, expect, it } from 'vitest';
import type { Document, Id, Scenario } from '../../domain/studio/model';
import { scenarioToDraft } from '../scenarios/draftScenario';
import { planAddProbe } from './addProbePlan';

const ids = {
  document: '00000000-0000-4000-8000-000000000001',
  schema: '00000000-0000-4000-8000-000000000002',
  element: '00000000-0000-4000-8000-000000000003',
  eventPort: '00000000-0000-4000-8000-000000000004',
  dataPort: '00000000-0000-4000-8000-000000000005',
  scenario: '00000000-0000-4000-8000-000000000006',
  check: '00000000-0000-4000-8000-000000000007',
} satisfies Record<string, Id>;

const document: Document = {
  schema: 'studio-model/1', id: ids.document, title: 'Probe test',
  elements: [{
    id: ids.element, label: 'Worker', description: '', visualKind: 'service',
    ports: [
      { id: ids.eventPort, label: 'event', direction: 'out', channel: 'event', protocol: null, schemaId: ids.schema, responseSchemaId: null },
      { id: ids.dataPort, label: 'data', direction: 'out', channel: 'data', protocol: 'jdbc', schemaId: ids.schema, responseSchemaId: null },
    ],
    behavior: { kind: 'unmodeled', version: 1, reason: 'Test' },
  }],
  connections: [], relations: [],
  schemas: [{ id: ids.schema, label: 'Payload', shape: { type: 'record', nullable: false, fields: [] } }],
  fixtures: [], refinements: [], scenarios: [], views: [],
};

function scenario(mode: Scenario['mode'], scopeElementIds: readonly Id[] = [ids.element]): Scenario {
  return {
    id: ids.scenario, label: 'Flow', revision: 1, mode, scopeElementIds,
    entryPorts: [], inputs: [], workloads: [], faults: [], boundaries: [], refinementSelections: [],
    initialContexts: [], assertions: [], seed: 1,
    budgets: { maxEvents: 100, maxTraceRows: 100, maxTraceBytes: 1000, maxScheduledEvents: 100, maxLiveRoots: 10 },
    completion: mode === 'logical' ? { kind: 'quiescent' } : { kind: 'horizon', horizonMs: 1000 },
    assumptions: [],
  };
}

describe('planAddProbe', () => {
  it('rejects an element outside the scenario scope', () => {
    expect(planAddProbe(document, scenario('logical', []), ids.element, () => ids.check)).toEqual({
      ok: false,
      reason: 'This component is not in the selected scenario scope',
    });
  });

  it('creates a logical output check on the first non-event output', () => {
    const source = scenario('logical');
    const result = planAddProbe(document, source, ids.element, () => ids.check);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.check).toEqual({
      id: ids.check, label: 'Check output', operator: 'equals', expected: null,
      subject: { kind: 'output', port: { elementId: ids.element, portId: ids.dataPort }, path: [] },
    });
    expect(result.patch(scenarioToDraft(source)).assertions).toEqual([result.check]);
  });

  it('creates a timed throughput at-least check with an empty expected value', () => {
    const result = planAddProbe(document, scenario('timed'), ids.element, () => ids.check);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.check).toMatchObject({
      id: ids.check, operator: 'at-least', expected: null,
      subject: { kind: 'metric', elementId: ids.element, key: 'throughput' },
    });
  });

  it('rejects a logical element with no non-event output', () => {
    const eventOnly: Document = { ...document, elements: [{ ...document.elements[0], ports: [document.elements[0].ports[0]] }] };
    expect(planAddProbe(eventOnly, scenario('logical'), ids.element, () => ids.check)).toMatchObject({ ok: false });
  });
});
