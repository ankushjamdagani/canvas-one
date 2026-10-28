import type { Document } from '../../domain/studio/model';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const canonical = (value: unknown): string => JSON.stringify((function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  return object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
})(value));

/** Presentation footprint only. Never use this to grant write authority. */
export function mutationTargetIds(changes: unknown, document?: Document | null): readonly string[] {
  if (!Array.isArray(changes)) return [];
  const ids = new Set<string>();
  const add = (id: unknown) => { if (typeof id === 'string' && id.length > 0 && id.length <= 200) ids.add(id); };
  for (const change of changes.slice(0, 1000)) {
    if (!object(change)) continue;
    const value = object(change.value) ? change.value : undefined;
    const record = value && object(value.record) ? value.record : undefined;
    const id = change.kind === 'remove' ? change.id : record?.id;
    add(id);
    if ((change.kind === 'remove' ? change.recordKind : value?.recordKind) !== 'view') continue;
    const before = document?.views?.find(view => view.id === id)?.canvasElements ?? [];
    const after = record && Array.isArray(record.canvasElements) ? record.canvasElements.filter(object) : [];
    // Views are the transaction records; only changed nested visual objects are
    // actual canvas targets. Unchanged siblings must remain motionless.
    const prior = new Map(before.map(element => [element.id, element]));
    const next = new Map(after.filter(element => typeof element.id === 'string').map(element => [element.id as string, element]));
    for (const [elementId, element] of next) if (canonical(prior.get(elementId)) !== canonical(element)) add(elementId);
    for (const element of before) if (!next.has(element.id)) add(element.id);
  }
  return [...ids];
}
