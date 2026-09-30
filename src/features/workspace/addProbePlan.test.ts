import { describe, expect, it } from 'vitest';
import { planAddProbe } from './addProbePlan';
import type { Document, Scenario } from '../../domain/studio/model';

const doc: Document = {
  schema: 'studio-model/1',
  id: 'd1',
  title: 'doc',
  elements: [
    {
      id: 'e1',
      type: 'process',
      title: 'E1',
      ports: [
        { id: 'p1', direction: 'out', channel: 'event', label: '', schema: null, shape: 'square' },
        { id: 'p2', direction: 'out', channel: 'request', label: '', schema: null, shape: 'square' },
      ],
      state: [],
    },
    {
      id: 'e2',
      type: 'process',
      title: 'E2',
      ports: [{ id: 'p1', direction: 'out', channel: 'event', label: '', schema: null, shape: 'square' }],
      state: [],
    },
  ],
  connections: [],
  relations: [],
  schemas: [],
  fixtures: [],
  refinements: [],
  scenarios: [],
  views: [],
};

describe('planAddProbe', () => {
  it('returns no-data-output for logical scenario on element with only event ports', () => {
    const scn: Scenario = { id: 's1', label: '', mode: 'logical', steps: [], assertions: [] };
    const res = planAddProbe(doc, scn, 'e2', () => 'chk');
    expect(res.disabledReason).toBe('no-data-output');
  });

  it('adds output probe for logical scenario', () => {
    const scn: Scenario = { id: 's1', label: '', mode: 'logical', steps: [], assertions: [] };
    const res = planAddProbe(doc, scn, 'e1', () => 'chk');
    expect(res.disabledReason).toBeNull();
    expect(res.newCheckId).toBe('chk');
    const patched = res.patch!({ assertions: [] } as any);
    expect(patched.assertions[0]).toMatchObject({
      id: 'chk',
      operator: 'equals',
      subject: { kind: 'output', port: { element: 'e1', port: 'p2' } }
    });
  });

  it('adds throughput probe for timed scenario', () => {
    const scn: Scenario = { id: 's1', label: '', mode: 'timed', traffic: [], assertions: [], completion: { kind: 'quiescent' } };
    const res = planAddProbe(doc, scn, 'e1', () => 'chk');
    expect(res.disabledReason).toBeNull();
    expect(res.newCheckId).toBe('chk');
    const patched = res.patch!({ assertions: [] } as any);
    expect(patched.assertions[0]).toMatchObject({
      id: 'chk',
      operator: 'at-least',
      subject: { kind: 'metric', elementId: 'e1', key: 'throughput' },
      expected: 1,
    });
  });
});
