import { describe, expect, it, vi } from 'vitest';
import { createIssue, invertRecordChanges, type RecordChange } from '@canvas-one/whiteboard';
import type { Document } from '../../domain/studio/model';
import { createIssue as domainIssue } from '../../domain/studio/issue';
import { isValidUuid } from '../../domain/studio/ids';
import { computeInverseChanges } from './inverse';
import { applyRecordChanges } from '../../persistence/studio/apply-records';
import { deriveVersionKey } from '../../domain/versioning/publication';

vi.mock('dexie', () => { throw new Error('Pure authoring imported Dexie'); });

type CustomRecords = { 'example/sticky': { id: string; content: { text: string } } };
const id = '00000000-0000-4000-8000-000000000001';
function document(): Document {
  return { schema: 'studio-model/1', id, title: 'Board', elements: [], connections: [],
    relations: [], schemas: [], fixtures: [], refinements: [], scenarios: [],
    views: [{ id: '00000000-0000-4000-8000-000000000002', label: 'Main', placements: [], connectionIds: [], relationIds: [], groups: [], notes: [] }] };
}

describe('authoring contract conformance', () => {
  it('loads the domain inverse, record reducer and publication helpers without Dexie', () => {
    expect(applyRecordChanges(document(), [])).toMatchObject({ ok: true });
    expect(deriveVersionKey({ major: 1, minor: 2, patch: 3 })).toBe('1.2.3');
  });
  it('supports namespaced custom kinds and clones the pre-transaction record', () => {
    const prior = { recordKind: 'example/sticky' as const, record: { id: 'readable-id', content: { text: 'Before' } } };
    const changes: RecordChange<CustomRecords>[] = [
      { kind: 'replace', value: { ...prior, record: { ...prior.record, content: { text: 'After' } } } },
      { kind: 'insert', value: { ...prior, record: { ...prior.record, id: 'new-note' } } },
    ];
    const result = invertRecordChanges<CustomRecords>(changes, () => prior);
    expect(result).toEqual({ ok: true, changes: [
      { kind: 'remove', recordKind: 'example/sticky', id: 'new-note' },
      { kind: 'replace', value: prior },
    ] });
    prior.record.content.text = 'Mutated later';
    if (result.ok && result.changes[1].kind === 'replace') {
      expect(result.changes[1].value.record.content.text).toBe('Before');
    }
  });

  it('preserves unknown issue codes and isolates paths in both public and domain helpers', () => {
    const path = ['extension', 'config'];
    const issue = createIssue('example/custom-code', 'Configure the extension', path, 'note', 'warning');
    const specialized = domainIssue('dangling-reference', 'Missing record', path, id);
    path.push('later');
    expect(issue).toEqual({ code: 'example/custom-code', message: 'Configure the extension',
      path: ['extension', 'config'], entityId: 'note', severity: 'warning' });
    expect(specialized.path).toEqual(['extension', 'config']);
  });

  it('retains domain inverse envelope, prior data, dependency order and error locations', () => {
    const doc = document();
    const view = doc.views[0];
    expect(computeInverseChanges(doc, [
      { kind: 'replace', value: { recordKind: 'view', record: { ...view, label: 'Changed' } } },
      { kind: 'insert', value: { recordKind: 'view', record: { ...view, id: 'another-view' } } },
    ])).toEqual({ ok: true, changes: [
      { kind: 'remove', recordKind: 'view', id: 'another-view' },
      { kind: 'replace', value: { recordKind: 'view', record: view } },
    ] });
    expect(computeInverseChanges(doc, [
      { kind: 'remove', recordKind: 'element', id: 'missing' },
      { kind: 'remove', recordKind: 'view', id: 'missing-view' },
    ])).toEqual({ ok: false, issues: [
      domainIssue('dangling-reference', 'Cannot invert change at index 0: prior record not found in document for element with ID missing', ['changes', 0], 'missing'),
      domainIssue('dangling-reference', 'Cannot invert change at index 1: prior record not found in document for view with ID missing-view', ['changes', 1], 'missing-view'),
    ] });
  });

  it('preserves the exact lowercase UUID validation policy', () => {
    expect(isValidUuid(id)).toBe(true);
    expect(isValidUuid('ABCDEF00-0000-4000-8000-000000000001')).toBe(false);
    expect(isValidUuid('00000000-0000-7000-8000-000000000001')).toBe(false);
    expect(isValidUuid(null)).toBe(false);
  });
});
