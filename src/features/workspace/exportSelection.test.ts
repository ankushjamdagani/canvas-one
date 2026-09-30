import { describe, expect, it } from 'vitest';
import { createSelectionExport } from './exportSelection';
import { parsePartFile } from '../../domain/parts/validate';
import type { Document, Id } from '../../domain/studio/model';

const E1_ID = '11111111-1111-4111-8111-111111111111' as Id;
const SCH_ID = '22222222-2222-4222-8222-222222222222' as Id;
const P1_ID = '33333333-3333-4333-8333-333333333333' as Id;
const PL1_ID = '44444444-4444-4444-8444-444444444444' as Id;

const doc: Document = {
  schema: 'studio-model/1',
  id: '55555555-5555-4555-8555-555555555555' as Id,
  title: 'doc',
  elements: [
    {
      id: E1_ID,
      label: 'E1',
      description: 'Element 1',
      visualKind: 'client',
      ports: [
        { id: P1_ID, direction: 'out', channel: 'event', label: 'P', schemaId: SCH_ID, responseSchemaId: null },
      ],
      behavior: { kind: 'unmodeled', version: 1, reason: 'test' },
    },
  ],
  connections: [],
  relations: [],
  schemas: [{ id: SCH_ID, label: 'Schema', shape: { type: 'string', nullable: false } }],
  fixtures: [],
  refinements: [],
  scenarios: [],
  views: [{ id: '66666666-6666-4666-8666-666666666666' as Id, label: 'V', groups: [], placements: [{ id: PL1_ID, elementId: E1_ID, x: 0, y: 0, width: 100, expanded: false }], notes: [], connectionIds: [], relationIds: [] }],
};

describe('createSelectionExport', () => {
  it('creates bytes that parse successfully with parsePartFile', () => {
    let idCounter = 1;
    const mintId = () => {
      const c = idCounter++;
      return `00000000-0000-4000-8000-${c.toString().padStart(12, '0')}` as Id;
    };
    
    const res = createSelectionExport(doc, doc.views[0].id, [E1_ID], [], mintId(), 'Exported Selection');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    
    const parsed = parsePartFile(res.bytes);
    if (!parsed.ok) {
      console.log('ISSUES:', JSON.stringify(parsed.issues, null, 2));
    }
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.label).toBe('Exported Selection');
      expect(parsed.value.content.elements.length).toBe(1);
      expect(parsed.value.content.elements[0].label).toBe('E1');
    }
  });
});
