import type { Document, Id } from '../../domain/studio/model';
import { diffDocuments, type RecordDiff } from '../../domain/versioning/diff';

function containsId(value: unknown, ids: ReadonlySet<Id>): boolean {
  if (typeof value === 'string') return ids.has(value);
  if (Array.isArray(value)) return value.some((v) => containsId(v, ids));
  if (value && typeof value === 'object') {
    return Object.values(value).some((v) => containsId(v, ids));
  }
  return false;
}

export function touchesElement(
  diff: RecordDiff,
  parent: Document | null,
  child: Document,
  elementIds: ReadonlySet<Id>
): boolean {
  if (diff.recordKind === 'document') return false;
  if (diff.recordKind === 'view') return false;
  if (diff.recordKind === 'element' && elementIds.has(diff.id)) return true;

  const findRecord = (doc: Document | null) => {
    if (!doc) return undefined;
    switch (diff.recordKind) {
      case 'element': return doc.elements.find(e => e.id === diff.id);
      case 'connection': return doc.connections.find(c => c.id === diff.id);
      case 'relation': return doc.relations.find(r => r.id === diff.id);
      case 'refinement': return doc.refinements.find(r => r.id === diff.id);
      case 'scenario': return doc.scenarios.find(s => s.id === diff.id);
      case 'schema': return doc.schemas.find(s => s.id === diff.id);
      case 'fixture': return doc.fixtures.find(f => f.id === diff.id);
    }
    return undefined;
  };

  const record = findRecord(child) ?? findRecord(parent);
  if (!record) return false;

  switch (diff.recordKind) {
    case 'connection':
    case 'relation':
    case 'refinement':
    case 'scenario':
      return containsId(record, elementIds);
  }
  return false;
}

export function filterHistorySteps<T extends { snapshot: Document | null, parentSnapshot: Document | null }>(
  steps: readonly T[],
  elementIds: readonly Id[]
): T[] {
  if (elementIds.length === 0) return [...steps];
  const idSet = new Set(elementIds);
  return steps.filter(step => {
    if (!step.snapshot || !step.parentSnapshot) return false;
    const parent = step.parentSnapshot;
    const child = step.snapshot;
    const diffs = diffDocuments(parent, child);
    return diffs.some(diff => touchesElement(diff, parent, child, idSet));
  });
}
