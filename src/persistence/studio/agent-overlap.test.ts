import { describe, expect, it } from 'vitest';
import type { Document, Element, RecordChange } from '@canvas-one/system-design';
import { TaskOverlapRegistry } from './agent-overlap';
const element = (id: string): Element => ({ id, label: id, description: '', visualKind: 'host', ports: [], behavior: { kind: 'unmodeled', version: 1, reason: 'fixture' } });
const document: Document = { schema: 'studio-model/1', id: 'board', title: 'Board', elements: [element('held'), element('adjacent'), element('independent')], connections: [], schemas: [], fixtures: [], refinements: [], scenarios: [], views: [], relations: [{ id: 'relation', kind: 'descriptive', label: 'Dependency', sourceId: 'held', targetId: 'adjacent' }] };
const binding = { taskId: 'task', attemptId: 'attempt', actorId: 'agent', generation: 1, scope: { projectId: 'project', branchId: 'draft', boardId: 'board' } };
const remove = (id: string): RecordChange => ({ kind: 'remove', recordKind: 'element', id });
describe('trusted overlap dependency gates', () => {
  it('pauses connected work while permitting disconnected validated actions', () => {
    const registry = new TaskOverlapRegistry();
    registry.hold(binding, document, [remove('held')]);
    expect(registry.independent(binding, [remove('held')])).toBe(false);
    expect(registry.independent(binding, [remove('adjacent')])).toBe(false);
    expect(registry.independent(binding, [remove('independent')])).toBe(true);
    expect(registry.independent({ ...binding, generation: 2 }, [remove('independent')])).toBe(false);
  });
  it('rejects an apparently separate action that refers to the held dependency', () => {
    const registry = new TaskOverlapRegistry(); registry.hold(binding, document, [remove('held')]);
    const value = { ...element('independent'), description: 'held' };
    expect(registry.independent(binding, [{ kind: 'replace', value: { recordKind: 'element', record: value } }])).toBe(false);
    registry.clear(binding); expect(registry.independent(binding, [remove('independent')])).toBe(false);
  });
  it('keeps a human-deleted target blocked even though it is absent from the current graph', () => {
    const registry = new TaskOverlapRegistry(); registry.hold(binding, document, [remove('deleted')]);
    expect(registry.independent(binding, [{ kind: 'insert', value: { recordKind: 'element', record: element('deleted') } }])).toBe(false);
    expect(registry.independent(binding, [remove('independent')])).toBe(true);
  });
  it('allows a connected element label edit while keeping structural edits paused', () => {
    const registry = new TaskOverlapRegistry(); registry.hold(binding, document, [remove('held')]);
    const before = document.elements.find(element => element.id === 'adjacent')!;
    expect(registry.independent(binding, [{ kind: 'replace', value: { recordKind: 'element', record: { ...before, label: 'Readable name' } } }])).toBe(true);
    expect(registry.independent(binding, [{ kind: 'replace', value: { recordKind: 'element', record: { ...before, behavior: { kind: 'unmodeled', version: 1, reason: 'Changed behavior' } } } }])).toBe(false);
  });
});
