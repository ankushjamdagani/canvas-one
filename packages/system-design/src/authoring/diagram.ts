import { CATALOG_ENTRIES } from '../catalog/catalog.js';
import { placeEntry } from '../catalog/place.js';
import { completeConnection, planConnection } from '../catalog/connect.js';
import type { Document, Endpoint, Id, Json } from '../studio/model.js';
import type { Protocol } from '../studio/protocols.js';
import type { RecordChange, RecordKind } from '../studio/records.js';
import { createIssue } from '../studio/issue.js';
import { validateDocument, type Issue } from '../studio/validate.js';
import { applyRecordChanges } from './apply-records.js';
import { planAddNote } from './selectionPlans.js';
import {planCustomComponent} from './custom-components.js';

declare const structuredClone: <T>(value: T) => T;

export type DiagramComponent = { readonly id: string; readonly type: string; readonly label?: string; readonly data?: Json; readonly position?: { readonly x: number; readonly y: number } };
export type DiagramConnection = { readonly source: string; readonly target: string; readonly sourcePort?: string; readonly targetPort?: string; readonly protocol?: Protocol; readonly path?: string };
export type DiagramAnnotation = { readonly id: string; readonly text: string; readonly position?: {readonly x: number; readonly y: number}; readonly attachedTo?: readonly string[] };
export type DiagramRequest = { readonly viewId: Id; readonly components: readonly DiagramComponent[]; readonly connections?: readonly DiagramConnection[]; readonly annotations?: readonly DiagramAnnotation[] };
export type DiagramPlanResult =
  | { readonly ok: true; readonly changes: readonly RecordChange[]; readonly elementIds: Readonly<Record<string, Id>>; readonly placementIds: Readonly<Record<string, Id>>; readonly annotationIds: Readonly<Record<string, Id>>; readonly assumptions: readonly string[] }
  | { readonly ok: false; readonly issues: readonly Issue[] };

/** Host mints internal IDs; agents supply readable aliases and registered component identifiers. */
export function planSystemDesignDiagram(document: Document, request: DiagramRequest, mintId: () => Id, options: {readonly customComponentTypes?: readonly string[]} = {}): DiagramPlanResult {
  const initial = validateDocument(document);
  if (!initial.ok) return initial;
  if (!request || !Array.isArray(request.components) || request.connections !== undefined && !Array.isArray(request.connections)) return { ok: false, issues: [createIssue('wrong-type', 'Diagram components and connections must be arrays', [])] };
  if (request.annotations !== undefined && (!Array.isArray(request.annotations) || request.annotations.length > 50)) return {ok: false, issues: [createIssue('too-many', 'Supply an array of at most 50 annotations', ['annotations'])]};
  if (!document.views.some((view) => view.id === request.viewId)) return { ok: false, issues: [createIssue('dangling-reference', 'Select an existing view for the diagram', ['viewId'])] };
  if (request.components.length > 100 || (request.connections?.length ?? 0) > 200) return { ok: false, issues: [createIssue('too-many', 'A diagram supports at most 100 components and 200 connections', ['components'])] };
  let candidate = document;
  const aliases = new Map<string, Id>(); const placements = new Map<string, Id>();
  const annotationIds = new Map<string, Id>();
  for (let index = 0; index < request.components.length; index++) {
    const component = request.components[index];
    if (!component || typeof component.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(component.id) || aliases.has(component.id)) return { ok: false, issues: [createIssue('duplicate-id', 'Component aliases must be unique readable identifiers (letters, digits, underscore or hyphen)', ['components', index, 'id'])] };
    if (options.customComponentTypes?.includes(component.type)) {
      const elementId = mintId(); const placementId = mintId();
      const plan = planCustomComponent(candidate, {viewId: request.viewId, elementId, placementId, label: component.label ?? component.id,
        position: component.position ?? {x: 64 + index % 3 * 280, y: 64 + Math.floor(index / 3) * 180},
        component: {type: component.type, data: component.data ?? {}, extensions: {}}});
      if (!plan.ok) return plan;
      const applied = applyRecordChanges(candidate, plan.changes); if (!applied.ok) return applied;
      candidate = applied.document; aliases.set(component.id, elementId); placements.set(component.id, placementId);
      continue;
    }
    if (typeof component.type !== 'string' || !component.type.startsWith('system-design/')) return { ok: false, issues: [createIssue('invalid-literal', 'Use an available component identifier from component_schemas', ['components', index, 'type'])] };
    const placed = placeEntry({ document: candidate, viewId: request.viewId, entryId: component.type.slice('system-design/'.length), mintId,
      anchor: component.position ?? { x: 64 + index % 3 * 280, y: 80 + Math.floor(index / 3) * 180 } });
    if (!placed.ok) return placed;
    const changes = placed.changes.map((change): RecordChange => change.kind !== 'remove' && change.value.recordKind === 'element' && change.value.record.id === placed.elementId && component.label !== undefined
      ? { ...change, value: { recordKind: 'element', record: { ...change.value.record, label: component.label } } } : change);
    const applied = applyRecordChanges(candidate, changes);
    if (!applied.ok) return applied;
    candidate = applied.document; aliases.set(component.id, placed.elementId); placements.set(component.id, placed.placementId);
  }
  const resolve = (reference: string) => candidate.elements.find((element) => element.id === (aliases.get(reference) ?? reference));
  for (let index = 0; index < (request.connections?.length ?? 0); index++) {
    const connection = request.connections![index];
    if (!connection || typeof connection.source !== 'string' || typeof connection.target !== 'string') return { ok: false, issues: [createIssue('wrong-type', 'Connections require source and target references', ['connections', index])] };
    const source = resolve(connection.source); const target = resolve(connection.target);
    if (!source || !target) return { ok: false, issues: [createIssue('dangling-reference', 'Connections must reference a component alias or existing element ID', ['connections', index])] };
    const sourcePort = source.ports.find((port) => port.direction === 'out' && (connection.sourcePort ? port.id === connection.sourcePort || port.label === connection.sourcePort : port.channel !== 'event'));
    const targetPort = connection.targetPort ? target.ports.find((port) => port.direction === 'in' && (port.id === connection.targetPort || port.label === connection.targetPort)) : undefined;
    if (!sourcePort || connection.targetPort && !targetPort) return { ok: false, issues: [createIssue('dangling-reference', 'Select an available output/input port by label or ID', ['connections', index])] };
    const targetEndpoint: Endpoint | { elementId: Id } = targetPort ? { elementId: target.id, portId: targetPort.id } : { elementId: target.id };
    const planned = planConnection({ document: candidate, viewId: request.viewId, source: { elementId: source.id, portId: sourcePort.id }, target: targetEndpoint, mintId, protocol: connection.protocol, path: connection.path });
    if (planned.kind === 'rejected') return { ok: false, issues: planned.issues };
    const ready = planned.kind === 'needs-resource-metadata' ? completeConnection(planned.draft) : { ok: true as const, changes: planned.changes };
    if (!ready.ok) return ready;
    const applied = applyRecordChanges(candidate, ready.changes);
    if (!applied.ok) return applied;
    candidate = applied.document;
  }
  for (let index = 0; index < (request.annotations?.length ?? 0); index++) {
    const annotation: DiagramAnnotation = request.annotations![index];
    const path = ['annotations', index] as const;
    if (!annotation || typeof annotation.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(annotation.id) || aliases.has(annotation.id) || annotationIds.has(annotation.id) || typeof annotation.text !== 'string') return {ok: false, issues: [createIssue('wrong-type', 'Annotations require unique readable IDs and text', path)]};
    if (annotation.attachedTo !== undefined && (!Array.isArray(annotation.attachedTo) || annotation.attachedTo.some(id => typeof id !== 'string'))) return {ok: false, issues: [createIssue('wrong-type', 'Annotation attachments must be component aliases or element IDs', [...path, 'attachedTo'])]};
    const attached = (annotation.attachedTo ?? []).map(reference => resolve(reference)?.id);
    if (attached.some(id => !id)) return {ok: false, issues: [createIssue('dangling-reference', 'Annotation attachment was not found', [...path, 'attachedTo'])]};
    const id = mintId();
    const note = planAddNote(candidate, request.viewId, id, annotation.text, annotation.position ?? {x: 64 + index % 3 * 280, y: 128 + Math.ceil(request.components.length / 3) * 180 + Math.floor(index / 3) * 160}, attached as Id[]);
    if (!note.ok) return {ok: false, issues: [createIssue('structural-rule', note.reason, path)]};
    const applied = applyRecordChanges(candidate, note.changes);
    if (!applied.ok) return applied;
    candidate = applied.document; annotationIds.set(annotation.id, id);
  }
  // Sequential planning may touch one view/element repeatedly. Collapse to one atomic
  // record change per target, so history receives one validated gesture and one inverse.
  const collections = [
    ['schemas', 'schema'], ['fixtures', 'fixture'], ['elements', 'element'], ['connections', 'connection'],
    ['relations', 'relation'], ['refinements', 'refinement'], ['scenarios', 'scenario'], ['views', 'view'],
  ] as const;
  const changes: RecordChange[] = [];
  for (const [collection, kind] of collections) {
    const prior = new Map<string, unknown>(document[collection].map((record) => [record.id, record]));
    for (const record of candidate[collection]) {
      const previous = prior.get(record.id);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(record)) changes.push({ kind: previous ? 'replace' : 'insert', value: { recordKind: kind as RecordKind, record } } as RecordChange);
    }
  }
  const verified = applyRecordChanges(document, changes);
  if (!verified.ok) return verified;
  return { ok: true, changes, elementIds: Object.freeze(Object.fromEntries(aliases)), placementIds: Object.freeze(Object.fromEntries(placements)),
    annotationIds: Object.freeze(Object.fromEntries(annotationIds)),
    assumptions: request.components.length || request.connections?.length ? ['Catalog behavior and connection defaults are authored assumptions, not measured production results.'] : [] };
}

/** Discoverable component identifiers and authored default schemas for agent/tool hosts. */
export function discoverSystemDesignComponents() {
  return structuredClone(CATALOG_ENTRIES.map((entry) => ({ id: `system-design/${entry.entryId}`, label: entry.label, visualKind: entry.visualKind,
    behaviorKind: entry.behaviorKind, ports: entry.ports, defaultConfig: entry.defaultConfig, models: entry.models, doesNotModel: entry.doesNotModel })));
}

export const diagramRequestSchema = {
  type: 'object', required: ['viewId', 'components'], additionalProperties: false,
  properties: {
    viewId: { type: 'string' },
    annotations: {type: 'array', maxItems: 50, items: {type: 'object', required: ['id', 'text'], additionalProperties: false, properties: {
      id: {type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,79}$'}, text: {type: 'string', minLength: 1, maxLength: 4000},
      attachedTo: {type: 'array', items: {type: 'string'}}, position: {type: 'object', required: ['x', 'y'], properties: {x: {type: 'number'}, y: {type: 'number'}}, additionalProperties: false},
    }}},
    components: { type: 'array', maxItems: 100, items: { type: 'object', required: ['id', 'type'], additionalProperties: false, properties: {
      id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,79}$' }, type: { type: 'string', description: 'Choose an available identifier returned by component_schemas' }, label: { type: 'string', maxLength: 80 }, data: {},
      position: { type: 'object', required: ['x', 'y'], additionalProperties: false, properties: { x: { type: 'number' }, y: { type: 'number' } } },
    } } },
    connections: { type: 'array', maxItems: 200, items: { type: 'object', required: ['source', 'target'], additionalProperties: false, properties: {
      source: { type: 'string' }, target: { type: 'string' }, sourcePort: { type: 'string' }, targetPort: { type: 'string' }, protocol: { type: 'string' }, path: { type: 'string' },
    } } },
  },
} as const;
