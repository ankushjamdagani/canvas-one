import { describe, it, expect } from 'vitest';
import { filterHistorySteps } from './historyFilter';
import type { Document } from '../../domain/studio/model';

function emptyDoc(): Document {
  return { schema: 'studio-model/1', id: 'test', title: '', elements: [], connections: [], relations: [], schemas: [], fixtures: [], refinements: [], scenarios: [], views: [] };
}

describe('filterHistorySteps', () => {
  it('filters steps that touch an element', () => {
    const d1 = emptyDoc();
    const d2 = { ...d1, elements: [{ id: 'e1', label: 'E1', type: 'machine', ports: [], defaultSchemaId: 's1', defaultResponseSchemaId: null }] as any };
    const step = { parentSnapshot: d1, snapshot: d2 };
    expect(filterHistorySteps([step], ['e1']).length).toBe(1);
    expect(filterHistorySteps([step], ['e2']).length).toBe(0);
  });
});
