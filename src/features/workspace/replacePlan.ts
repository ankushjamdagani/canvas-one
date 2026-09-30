import type { Document, Id, Element, Connection, Scenario, Relation, View } from '../../domain/studio/model';
import { placeEntry } from '../catalog/place';
import { shapesCompatible } from '../../domain/studio/readiness';
import { DeletePlan, planDelete } from './deletePlan';
import { AnyRecord, RecordChange } from '../../domain/versioning/records';
import { applyRecordChanges } from '../../persistence/studio/apply-records';

export type ReplacePlan = DeletePlan & {
  readonly newElementId: Id;
  readonly newPlacementId: Id;
};

function matchPorts(document: Document, oldElement: Element, newElement: Element): Map<Id, Id> {
  const mapping = new Map<Id, Id>();
  for (const oldPort of oldElement.ports) {
    const newPort = newElement.ports.find((p) => {
      if (p.direction !== oldPort.direction || p.channel !== oldPort.channel) return false;
      const oldSchema = document.schemas.find((s) => s.id === oldPort.schemaId);
      const newSchema = document.schemas.find((s) => s.id === p.schemaId);
      if (oldSchema && newSchema && !shapesCompatible(oldSchema.shape, newSchema.shape)) return false;
      if (oldPort.responseSchemaId || p.responseSchemaId) {
        if (!oldPort.responseSchemaId || !p.responseSchemaId) return false;
        const oldRes = document.schemas.find((s) => s.id === oldPort.responseSchemaId);
        const newRes = document.schemas.find((s) => s.id === p.responseSchemaId);
        if (oldRes && newRes && !shapesCompatible(oldRes.shape, newRes.shape)) return false;
      }
      return true;
    });
    if (newPort) mapping.set(oldPort.id, newPort.id);
  }
  return mapping;
}

function mapIds<T>(obj: T, oldElementId: Id, newElementId: Id, portMap: Map<Id, Id>): T {
  if (typeof obj === 'string') return (obj === oldElementId ? newElementId : obj) as any;
  if (Array.isArray(obj)) return obj.map((v) => mapIds(v, oldElementId, newElementId, portMap)) as any;
  if (obj && typeof obj === 'object') {
    if ('element' in obj && 'port' in obj && typeof obj.element === 'string' && typeof obj.port === 'string' && Object.keys(obj).length === 2) {
      if (obj.element === oldElementId) {
        const p = portMap.get(obj.port as Id);
        if (p) return { element: newElementId, port: p } as any;
        return obj as any; // unmappable, keep old ID to be deleted
      }
      return obj as any;
    }
    const res: any = {};
    for (const key of Object.keys(obj)) {
      res[key] = mapIds((obj as any)[key], oldElementId, newElementId, portMap);
    }
    return res;
  }
  return obj;
}

export function planReplacePart(
  document: Document,
  viewId: Id,
  oldElementId: Id,
  newEntryId: string,
  mintId: () => Id,
): { disabledReason: string | null; plan: ReplacePlan | null } {
  const oldElement = document.elements.find((e) => e.id === oldElementId);
  if (!oldElement) return { disabledReason: 'element-not-found', plan: null };

  const view = document.views.find((v) => v.id === viewId);
  if (!view) return { disabledReason: 'view-not-found', plan: null };

  const oldPlacement = view.placements.find((p) => p.elementId === oldElementId);
  if (!oldPlacement) return { disabledReason: 'placement-not-found', plan: null };

  if (document.refinements.some((r) => r.ownerElementId === oldElementId || r.memberElementIds.includes(oldElementId))) {
    return { disabledReason: 'Refinement owners and members cannot be replaced. Delete them explicitly.', plan: null };
  }

  const placeResult = placeEntry({ document, viewId, entryId: newEntryId, anchor: { x: oldPlacement.x, y: oldPlacement.y }, mintId });
  if (!placeResult.ok) return { disabledReason: 'failed-to-instantiate-part', plan: null };

  const newElementRecord = placeResult.changes.find((c: any) => c.value?.recordKind === 'element') as any;
  if (!newElementRecord) return { disabledReason: 'no-element-created', plan: null };
  const newElement = newElementRecord.value.record as Element;
  
  const newPlacementRecord = placeResult.changes.find((c: any) => c.value?.recordKind === 'view') as any;
  const newPlacementId = newPlacementRecord?.value?.record?.placements?.find((p: any) => p.elementId === newElement.id)?.id ?? mintId();

  const portMap = matchPorts(document, oldElement, newElement);

  const mappedConnections = document.connections.map((c) => {
    if (c.source.elementId === oldElementId || c.target.elementId === oldElementId) {
      return mapIds(c, oldElementId, newElement.id, portMap) as Connection;
    }
    return c;
  });

  const mappedRelations = document.relations.map((r) => mapIds(r, oldElementId, newElement.id, portMap) as Relation);
  const mappedScenarios = document.scenarios.map((s) => mapIds(s, oldElementId, newElement.id, portMap) as Scenario);
  const mappedViews = document.views.map((v) => ({
    ...v,
    groups: mapIds(v.groups, oldElementId, newElement.id, portMap),
    notes: mapIds(v.notes, oldElementId, newElement.id, portMap),
  }));

  const intermediateDoc: Document = {
    ...document,
    connections: mappedConnections,
    relations: mappedRelations,
    scenarios: mappedScenarios,
    views: mappedViews,
  };

  const intermediateDocWithNewElements = applyRecordChanges(intermediateDoc, placeResult.changes);
  if (!intermediateDocWithNewElements.ok) return { disabledReason: 'internal-error', plan: null };

  const deletePlan = planDelete(intermediateDocWithNewElements.document, viewId, { elementIds: [oldElementId], connectionIds: [] });
  
  // Now we must construct the TRUE changes to apply to `document`!
  // True changes = placeResult.changes + (modified connections/relations/scenarios/views) + (deletePlan.changes which removes oldElement and drops unmapped stuff).
  
  // Wait, if we just diff intermediateDocWithNewElements.document against document... no, applyRecordChanges takes changes.
  // We can just emit replace records for all mapped stuff that actually changed!
  
  const finalChanges: RecordChange[] = [...placeResult.changes];
  
  for (let i = 0; i < document.connections.length; i++) {
    if (document.connections[i] !== mappedConnections[i]) {
      finalChanges.push({ kind: 'replace', value: { recordKind: 'connection', record: mappedConnections[i] } });
    }
  }
  for (let i = 0; i < document.relations.length; i++) {
    if (document.relations[i] !== mappedRelations[i]) {
      finalChanges.push({ kind: 'replace', value: { recordKind: 'relation', record: mappedRelations[i] } });
    }
  }
  for (let i = 0; i < document.scenarios.length; i++) {
    if (document.scenarios[i] !== mappedScenarios[i]) {
      finalChanges.push({ kind: 'replace', value: { recordKind: 'scenario', record: mappedScenarios[i] } });
    }
  }
  for (let i = 0; i < document.views.length; i++) {
    if (document.views[i] !== mappedViews[i]) {
      finalChanges.push({ kind: 'replace', value: { recordKind: 'view', record: mappedViews[i] } });
    }
  }
  
  // Add delete changes (removing oldElement, unmapped connections, etc)
  // DeletePlan generates changes relative to intermediateDoc. Those changes are valid for `document` + mapped changes!
  // Wait, `deletePlan.changes` might replace `view` AGAIN.
  // If `deletePlan.changes` replaces a record we already replaced, we should combine them!
  // Better yet: just apply deletePlan.changes to intermediateDoc, then diff the FINAL doc with the ORIGINAL doc to get precise Replace/Remove/Add changes?
  // Or just use `placeResult.changes`, then manually push replacements?
  
  return { disabledReason: 'not-fully-implemented', plan: null };
}
