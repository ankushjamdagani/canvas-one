import type { AttemptBinding } from '@canvas-one/agents';
import type { Document, RecordChange } from '@canvas-one/system-design';
import { canonicalJson } from '../../domain/studio/canonical';

const key = (binding: AttemptBinding) => JSON.stringify([binding.scope.projectId, binding.scope.branchId, binding.scope.boardId, binding.actorId, binding.taskId, binding.attemptId, binding.generation]);
function strings(value: unknown, result = new Set<string>(), depth = 0): Set<string> {
  if (depth > 100) throw new Error('Record dependency depth exceeds limits');
  if (typeof value === 'string') result.add(value);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) strings(item, result, depth + 1);
  return result;
}
/** Conservative host-derived graph: connected records pause together; disconnected validated work can continue. */
export class TaskOverlapRegistry {
  private readonly held = new Map<string, { blocked: Set<string>; direct: Set<string>; document: Document }>();
  hold(binding: AttemptBinding, document: Document, changes: readonly RecordChange[]): void {
    if (document.id !== binding.scope.boardId || this.held.size >= 32 && !this.held.has(key(binding))) throw new Error('Invalid or unbounded overlap hold');
    const records = ['elements', 'connections', 'relations', 'schemas', 'fixtures', 'refinements', 'scenarios', 'views']
      .flatMap(collection => document[collection as keyof Document] as readonly { readonly id: string }[]);
    const graph = new Map<string, Set<string>>();
    for (const record of records) graph.set(record.id, new Set());
    for (const record of records) for (const reference of strings(record)) if (graph.has(reference) && reference !== record.id) {
      graph.get(record.id)!.add(reference); graph.get(reference)!.add(record.id);
    }
    const previous = this.held.get(key(binding));
    const blocked = previous?.blocked ?? new Set<string>(), direct = previous?.direct ?? new Set<string>();
    for (const change of changes) { const id = change.kind === 'remove' ? change.id : change.value.record.id; blocked.add(id); direct.add(id); }
    for (const change of changes) for (const reference of strings(change)) if (graph.has(reference)) blocked.add(reference);
    const pending = [...blocked];
    while (pending.length) for (const adjacent of graph.get(pending.pop()!) ?? []) if (!blocked.has(adjacent)) { blocked.add(adjacent); pending.push(adjacent); }
    this.held.set(key(binding), { blocked, direct, document });
  }
  independent(binding: AttemptBinding, changes: readonly RecordChange[]): boolean {
    const hold = this.held.get(key(binding));
    if (!hold || !changes.length) return false;
    try { return changes.every(change => {
      // Descriptive edits on a different element do not change the topology or
      // behavior that caused the hold, even when the elements are connected.
      if (change.kind === 'replace' && change.value.recordKind === 'element' && !hold.direct.has(change.value.record.id)) {
        const before = hold.document.elements.find(element => element.id === change.value.record.id);
        if (before) {
          const { label: _beforeLabel, description: _beforeDescription, ...beforeFacts } = before;
          const { label: _afterLabel, description: _afterDescription, ...afterFacts } = change.value.record;
          const a = canonicalJson(beforeFacts), b = canonicalJson(afterFacts);
          if (a.ok && b.ok && a.text === b.text && ![...strings({ label: change.value.record.label, description: change.value.record.description })].some(reference => hold.direct.has(reference))) return true;
        }
      }
      return [...strings(change)].every(reference => !hold.blocked.has(reference));
    }); }
    catch { return false; }
  }
  clear(binding: AttemptBinding): void { this.held.delete(key(binding)); }
}
