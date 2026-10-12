import { createIssue, type BoardDocument, type BoardRecordMap, type BoardEntity, type Bounds, type ExtensionDefinition, type Json, type Point, type RecordChange, type ValidationIssue } from '@canvas-one/whiteboard';

export const basicComponentTypes = ['basic/text', 'basic/rectangle', 'basic/ellipse', 'basic/frame', 'basic/image', 'basic/freehand'] as const;
export type BasicComponentType = typeof basicComponentTypes[number];
export type BasicData = {
  readonly text?: string; readonly fill?: string; readonly stroke?: string; readonly strokeWidth?: number;
  readonly assetId?: string; readonly points?: readonly Point[];
};
export type BasicPlan = { readonly ok: true; readonly changes: readonly RecordChange<BoardRecordMap>[] }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };
export const basicComponentSchemas = Object.fromEntries(basicComponentTypes.map(type => [type, {
  type: 'object', properties: { text: { type: 'string' }, fill: { type: 'string' }, stroke: { type: 'string' }, strokeWidth: { type: 'number', minimum: 0 }, assetId: { type: 'string' }, points: { type: 'array', items: { type: 'object', required: ['x', 'y'], properties: { x: { type: 'number' }, y: { type: 'number' } }, additionalProperties: false } } }, additionalProperties: true,
  ...(type === 'basic/image' ? { required: ['assetId'] } : type === 'basic/freehand' ? { required: ['points'] } : {}),
}])) as Readonly<Record<BasicComponentType, object>>;
export function validateBasicEntity(entity: BoardEntity): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fail = (message: string, key: string) => issues.push(createIssue('basic/invalid-data', message, ['entities', entity.id, 'data', key], entity.id));
  if (!(basicComponentTypes as readonly string[]).includes(entity.type)) { fail(`Unknown basic component ${entity.type}`, 'type'); return issues; }
  if (!entity.data || typeof entity.data !== 'object' || Array.isArray(entity.data)) { fail('Component data must be an object', ''); return issues; }
  const data = entity.data as Readonly<Record<string, Json>>;
  for (const key of ['text', 'fill', 'stroke', 'assetId']) if (data[key] !== undefined && typeof data[key] !== 'string') fail(`${key} must be a string`, key);
  if (data.strokeWidth !== undefined && (typeof data.strokeWidth !== 'number' || !Number.isFinite(data.strokeWidth) || data.strokeWidth < 0)) fail('strokeWidth must be a nonnegative finite number', 'strokeWidth');
  if (entity.type === 'basic/image' && (typeof data.assetId !== 'string' || !data.assetId)) fail('Image requires an asset reference', 'assetId');
  if (entity.type === 'basic/freehand' && (!Array.isArray(data.points) || data.points.some(point => !point || typeof point !== 'object' || Array.isArray(point) || typeof (point as { x?: unknown }).x !== 'number' || !Number.isFinite((point as { x: number }).x) || typeof (point as { y?: unknown }).y !== 'number' || !Number.isFinite((point as { y: number }).y)))) fail('Freehand requires finite points', 'points');
  return issues;
}
export function planBasicComponent(document: BoardDocument, input: {
  readonly type: BasicComponentType; readonly pageId: string; readonly bounds: Bounds;
  readonly data: BasicData; readonly entityId: string; readonly placementId: string;
}): BasicPlan {
  const entity: BoardEntity = { id: input.entityId, type: input.type, data: input.data as Json, extensions: {} };
  const issues = [...validateBasicEntity(entity)];
  if (!input.entityId || !input.placementId || document.entities.some(entity => entity.id === input.entityId) || document.placements.some(placement => placement.id === input.placementId)) issues.push(createIssue('basic/duplicate-id', 'Supply distinct unused entity and placement identifiers', ['entityId'], input.entityId));
  if (![input.bounds.x, input.bounds.y, input.bounds.width, input.bounds.height].every(Number.isFinite) || input.bounds.width < 0 || input.bounds.height < 0) issues.push(createIssue('basic/invalid-bounds', 'Bounds require finite coordinates and nonnegative dimensions', ['bounds'], input.placementId));
  if (!document.pages.some(page => page.id === input.pageId)) issues.push(createIssue('basic/missing-page', 'Select an existing page', ['pageId'], input.pageId));
  if (input.type === 'basic/image' && !document.assets.some(asset => asset.id === input.data.assetId)) issues.push(createIssue('basic/missing-asset', 'Image asset is unavailable', ['data', 'assetId'], input.entityId));
  if (issues.length) return { ok: false, issues };
  return { ok: true, changes: [
    { kind: 'insert', value: { recordKind: 'entity', record: entity } },
    { kind: 'insert', value: { recordKind: 'placement', record: { id: input.placementId, entityId: input.entityId, pageId: input.pageId, bounds: input.bounds, extensions: {} } } },
  ] };
}
/** Trusted first-party extension uses the same registration API as host extensions. */
export const basicComponentsExtension: ExtensionDefinition = {
  manifest: { id: 'canvas-one/basic', version: '1.0.0', dependencies: [], capabilities: ['components', 'schemas', 'planning'] },
  contributions: basicComponentTypes.flatMap(id => [
    { id, version: '1.0.0', kind: 'component' as const, capabilities: ['planning'], value: { plan: planBasicComponent, validate: validateBasicEntity } },
    { id, version: '1.0.0', kind: 'schema' as const, capabilities: ['validation'], value: basicComponentSchemas[id] },
  ]),
};
