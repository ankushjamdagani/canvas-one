import type { Document, View } from "../../domain/studio/model";
import type { RecordChange } from "../../domain/studio/records";

const canonical = (value: unknown): string =>
  JSON.stringify(
    (function sorted(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(sorted);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [
              key,
              sorted((value as Record<string, unknown>)[key]),
            ]),
        );
      return value;
    })(value),
  );
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const scopeError = () =>
  new Error(
    "These changes exceed the conversation scope. Expand the conversation scope or choose Whole board, then send a new request.",
  );

/** Capture dependencies once, with the request. Later graph changes cannot expand this grant. */
export function conversationWriteScope(
  document: Document,
  ids: readonly string[],
): readonly string[] {
  const known = new Set(
    [
      ...document.elements,
      ...document.connections,
      ...document.relations,
      ...document.schemas,
      ...document.fixtures,
      ...document.refinements,
      ...document.scenarios,
      ...document.views,
      ...document.views.flatMap((view) => [...view.notes, ...view.groups]),
    ].map((record) => record.id),
  );
  if (ids.some((id) => !known.has(id)))
    throw new Error(
      "A conversation target no longer exists. Reattach the conversation before sending a new request.",
    );
  const allowed = new Set(ids);
  for (const view of document.views)
    for (const group of view.groups) {
      if (allowed.has(group.id))
        for (const id of group.elementIds) allowed.add(id);
    }
  for (const connection of document.connections) {
    if (
      allowed.has(connection.source.elementId) ||
      allowed.has(connection.target.elementId)
    )
      allowed.add(connection.id);
  }
  return [...allowed];
}

function assertCollection<T extends { readonly id: string }>(
  before: readonly T[],
  after: readonly T[],
  editable: (record: T) => boolean,
): void {
  if (!Array.isArray(before) || !Array.isArray(after)) throw scopeError();
  // Every record outside the footprint, including its relative order, stays exact.
  if (
    !same(
      before.filter((record) => !editable(record)),
      after.filter((record) => !editable(record)),
    )
  )
    throw scopeError();
}

function assertViewChange(
  before: View,
  after: View,
  allowed: ReadonlySet<string>,
): void {
  const {
    placements: _bp,
    notes: _bn,
    groups: _bg,
    connectionIds: _bc,
    relationIds: _br,
    ...beforeFields
  } = before;
  const {
    placements: _ap,
    notes: _an,
    groups: _ag,
    connectionIds: _ac,
    relationIds: _ar,
    ...afterFields
  } = after;
  if (!same(beforeFields, afterFields)) throw scopeError();
  assertCollection(before.placements, after.placements, (placement) =>
    allowed.has(placement.elementId),
  );
  // A placement cannot be retargeted under cover of a selected element.
  for (const placement of after.placements) {
    const prior = before.placements.find((item) => item.id === placement.id);
    if (prior && prior.elementId !== placement.elementId) throw scopeError();
  }
  assertCollection(before.notes, after.notes, (note) => allowed.has(note.id));
  for (const note of after.notes) {
    const prior = before.notes.find((item) => item.id === note.id);
    if (
      allowed.has(note.id) &&
      (!prior || !same(prior.attachedElementIds, note.attachedElementIds))
    )
      throw scopeError();
  }
  assertCollection(before.groups, after.groups, (group) =>
    allowed.has(group.id),
  );
  for (const group of after.groups) {
    const prior = before.groups.find((item) => item.id === group.id);
    if (
      allowed.has(group.id) &&
      (!prior || !same(prior.elementIds, group.elementIds))
    )
      throw scopeError();
  }
  for (const field of ["connectionIds", "relationIds"] as const) {
    if (
      !Array.isArray(after[field]) ||
      !same(
        before[field].filter((id) => !allowed.has(id)),
        after[field].filter((id) => !allowed.has(id)),
      )
    )
      throw scopeError();
  }
}

/** Conservative record-level boundary, in addition to the existing revision/lease authority. */
export function assertConversationChanges(
  document: Document,
  explicitIds: readonly string[],
  capturedIds: readonly string[],
  changes: readonly RecordChange[],
): void {
  if (explicitIds.length === 0) return;
  const allowed = new Set(capturedIds);
  if (!Array.isArray(changes)) throw scopeError();
  for (const change of changes) {
    if (!change || typeof change !== "object") throw scopeError();
    if (change.kind === "remove") {
      if (change.recordKind === "view" || !allowed.has(change.id))
        throw scopeError();
      continue;
    }
    if (
      (change.kind !== "replace" && change.kind !== "insert") ||
      !change.value ||
      !change.value.record
    )
      throw scopeError();
    if (change.kind === "insert") throw scopeError();
    const { recordKind, record } = change.value;
    if (recordKind === "view") {
      const before = document.views.find((view) => view.id === record.id);
      if (change.kind !== "replace" || !before) throw scopeError();
      assertViewChange(before, record, allowed);
    } else {
      if (!allowed.has(record.id)) throw scopeError();
      if (recordKind === "connection") {
        const before = document.connections.find(
          (connection) => connection.id === record.id,
        );
        if (
          before &&
          (!same(before.source, record.source) ||
            !same(before.target, record.target))
        )
          throw scopeError();
      }
    }
  }
}
