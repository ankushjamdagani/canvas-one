import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createInspectorDraftApi, openDraft as openSemanticDraft } from '@canvas-one/system-design/authoring/inspector/draft';
import { createInspectorFieldFactory } from '@canvas-one/system-design/authoring/inspector/presentation';
import { applyRecordChanges } from '@canvas-one/system-design/authoring/apply-records';
import type { Document } from '@canvas-one/system-design';
import type { DraftSession } from '@canvas-one/system-design/authoring/inspector/types';
import { openDraft as openAppDraft } from './draft';

const load = (): Document => JSON.parse(readFileSync('src/features/entry/examples/s02.json', 'utf8'));

describe('independent inspector behavior composition', () => {
  it('keeps app stripe presentation outside the semantic draft handle', () => {
    const document = load(); const element = document.elements.find((record) => record.behavior.kind === 'resource')!;
    const target = { kind: 'element' as const, ids: [element.id] };
    const headless = openSemanticDraft('draft', target, 0, document);
    expect('layer' in headless).toBe(false); expect('stripeColor' in headless).toBe(false);
    const presented = openAppDraft('draft', target, 0, document);
    expect(presented).toHaveProperty('stripeColor');
    const metadata = (fields: typeof headless.fields) => fields.map(({ id, kind, label, group, unit, options }) => ({ id, kind, label, group, unit, options }));
    expect(metadata(presented.fields)).toEqual(metadata(headless.fields));
  });
  it('binds custom metadata across one compound apply without changing parser bounds or semantic writes', async () => {
    let document = load(); let revision = 0; let calls = 0;
    const element = document.elements.find((record) => record.behavior.kind === 'resource')!;
    const api = createInspectorDraftApi({ fields: createInspectorFieldFactory({ element: {
      'config.capacity': { label: 'Custom service capacity', unit: 'operations/s', group: 'Custom panel' },
      'config.serviceTime': { optionLabels: { fixed: 'Predictable duration' } },
    } }) });
    const session: DraftSession = {
      getState: () => ({ document, workingRevision: revision }),
      apply: async (changes) => { calls++; expect(changes).toHaveLength(1); const applied = applyRecordChanges(document, changes);
        if (!applied.ok) return { status: 'invalid', issues: applied.issues };
        document = applied.document; revision++; return { status: 'applied' };
      },
    };
    let handle = api.openDraft('draft', { kind: 'element', ids: [element.id] }, revision, document);
    const capacity = handle.fields.find((field) => field.id === 'config.capacity')!;
    expect(capacity.label).toBe('Custom service capacity'); expect(capacity.unit).toBe('operations/s');
    expect(capacity.parse('0').ok).toBe(false);
    const choices = handle.fields.find((field) => field.id === 'config.serviceTime')!.options!;
    expect(choices.find((choice) => choice.value === 'fixed')?.label).toBe('Predictable duration');
    handle = api.changeField(handle, 'config.capacity', '1234');
    const accepted = await api.applyDraft(handle, session);
    expect(calls).toBe(1); expect(accepted.handle.status).toBe('clean'); expect(accepted.handle.baseWorkingRevision).toBe(1);
    expect(accepted.handle.fields.find((field) => field.id === 'config.capacity')?.label).toBe('Custom service capacity');
    const changed = document.elements.find((record) => record.id === element.id)!;
    expect(changed.behavior.kind === 'resource' && changed.behavior.config.capacity).toBe(1234);
  });
});
