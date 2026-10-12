import { createIssue, type EditableRecord, type RecordChange, type ValidationIssue } from './index.js';

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
export type ExtensionRecord = { readonly version: string; readonly data: Json };
export type ExtensionRecords = Readonly<Record<string, ExtensionRecord>>;
export type Point = { readonly x: number; readonly y: number };
export type Bounds = Point & { readonly width: number; readonly height: number };
export type BoardPage = { readonly id: string; readonly name: string; readonly extensions: ExtensionRecords };
export type BoardEntity = { readonly id: string; readonly type: string; readonly data: Json; readonly extensions: ExtensionRecords };
export type BoardPlacement = {
  readonly id: string; readonly pageId: string; readonly entityId: string;
  readonly bounds: Bounds; readonly rotation?: number; readonly extensions: ExtensionRecords;
};
export type ConnectorEndpoint = { readonly placementId: string; readonly anchorId?: string };
export type BoardConnector = {
  readonly id: string; readonly pageId: string; readonly source: ConnectorEndpoint;
  readonly target: ConnectorEndpoint; readonly points?: readonly Point[]; readonly extensions: ExtensionRecords;
};
export type AssetReference = { readonly id: string; readonly uri: string; readonly mediaType: string; readonly extensions: ExtensionRecords };
export type BoardDocument = {
  readonly format: 'canvas-one/board'; readonly version: 1; readonly id: string; readonly title: string;
  readonly pages: readonly BoardPage[]; readonly entities: readonly BoardEntity[];
  readonly placements: readonly BoardPlacement[]; readonly connectors: readonly BoardConnector[];
  readonly assets: readonly AssetReference[]; readonly extensions: ExtensionRecords;
};
export type BoardRecordMap = {
  page: BoardPage; entity: BoardEntity; placement: BoardPlacement; connector: BoardConnector; asset: AssetReference;
};
export type DocumentValidationResult<D> =
  | { readonly ok: true; readonly document: D }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

const namespaced = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*[/:][a-zA-Z0-9._:/-]+$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Validate neutral references/geometry. Semantic extension validation is host supplied. */
export function validateBoardDocument(input: unknown): DocumentValidationResult<BoardDocument> {
  const issues: ValidationIssue[] = [];
  const issue = (code: string, message: string, path: readonly (string | number)[], id: string | null = null) => issues.push(createIssue(code, message, path, id));
  const seen = new Set<object>();
  let count = 0;
  const json = (value: unknown, path: readonly (string | number)[], depth = 0): void => {
    if (++count > 100_000 || depth > 128) { if (issues.length < 100) issue('too-large', 'JSON exceeds the validation depth or item budget', path); return; }
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value)) return;
    if (!object(value) && !Array.isArray(value)) { issue('invalid-json', 'Expected JSON data', path); return; }
    if (seen.has(value)) { issue('invalid-json', 'Circular JSON data', path); return; }
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) { issue('invalid-json', 'Expected a plain JSON object', path); return; }
    seen.add(value);
    for (const [key, child] of Object.entries(value)) json(child, [...path, Array.isArray(value) ? Number(key) : key], depth + 1);
    seen.delete(value);
  };
  json(input, []);
  if (issues.length) return { ok: false, issues };
  if (!object(input)) return { ok: false, issues: [createIssue('wrong-type', 'Expected a board document', [])] };
  if (input.format !== 'canvas-one/board' || input.version !== 1) issue('unsupported-version', 'Expected canvas-one/board version 1', ['version']);
  if (!identifier(input.id)) issue('invalid-id', 'Document id must be a nonempty readable identifier', ['id']);
  if (typeof input.title !== 'string') issue('wrong-type', 'Document title must be a string', ['title']);
  const extensions = (value: unknown, path: readonly (string | number)[]) => {
    if (!object(value)) { issue('wrong-type', 'Expected extension records', path); return; }
    for (const [key, record] of Object.entries(value)) {
      if (!namespaced(key)) issue('invalid-namespace', 'Extension identifiers must be namespaced', [...path, key]);
      if (!object(record) || typeof record.version !== 'string' || !record.version || !Object.hasOwn(record, 'data')) issue('wrong-type', 'Extension records require version and JSON data', [...path, key]);
    }
  };
  extensions(input.extensions, ['extensions']);
  const tables = ['pages', 'entities', 'placements', 'connectors', 'assets'] as const;
  const records = new Map<string, Map<string, Record<string, unknown>>>();
  for (const table of tables) {
    const values = input[table]; const ids = new Map<string, Record<string, unknown>>(); records.set(table, ids);
    if (!Array.isArray(values)) { issue('wrong-type', `Expected ${table} array`, [table]); continue; }
    values.forEach((value, index) => {
      const path = [table, index];
      if (!object(value)) { issue('wrong-type', 'Expected a record', path); return; }
      if (!identifier(value.id)) issue('invalid-id', 'Record id must be a nonempty readable identifier', [...path, 'id']);
      else if (ids.has(value.id)) issue('duplicate-id', `Duplicate ${table} id ${value.id}`, [...path, 'id'], value.id);
      else ids.set(value.id, value);
      extensions(value.extensions, [...path, 'extensions']);
      if (table === 'pages' && typeof value.name !== 'string') issue('wrong-type', 'Page name must be a string', [...path, 'name']);
      if (table === 'entities' && (!namespaced(value.type) || !Object.hasOwn(value, 'data'))) issue('wrong-type', 'Entity requires a namespaced type and JSON data', path);
      if (table === 'assets' && (typeof value.uri !== 'string' || !value.uri || typeof value.mediaType !== 'string' || !value.mediaType)) issue('wrong-type', 'Asset requires uri and mediaType strings', path);
    });
  }
  const reference = (table: string, id: unknown, path: readonly (string | number)[]) => {
    if (!identifier(id) || !records.get(table)?.has(id)) issue('dangling-reference', `Missing ${table} record ${String(id)}`, path, identifier(id) ? id : null);
  };
  if (Array.isArray(input.placements)) input.placements.forEach((placement, index) => {
    if (!object(placement)) return; const path = ['placements', index];
    reference('pages', placement.pageId, [...path, 'pageId']); reference('entities', placement.entityId, [...path, 'entityId']);
    const b = placement.bounds;
    if (!object(b) || !finite(b.x) || !finite(b.y) || !finite(b.width) || b.width < 0 || !finite(b.height) || b.height < 0) issue('invalid-geometry', 'Bounds require finite x/y and nonnegative width/height', [...path, 'bounds']);
    if (placement.rotation !== undefined && !finite(placement.rotation)) issue('invalid-geometry', 'Rotation must be finite', [...path, 'rotation']);
  });
  if (Array.isArray(input.connectors)) input.connectors.forEach((connector, index) => {
    if (!object(connector)) return; const path = ['connectors', index]; reference('pages', connector.pageId, [...path, 'pageId']);
    for (const side of ['source', 'target']) {
      const endpoint = connector[side];
      if (!object(endpoint)) { issue('wrong-type', 'Expected connector endpoint', [...path, side]); continue; }
      reference('placements', endpoint.placementId, [...path, side, 'placementId']);
      const placement = records.get('placements')?.get(String(endpoint.placementId));
      if (placement && placement.pageId !== connector.pageId) issue('cross-page-reference', 'Connector endpoints must belong to its page', [...path, side]);
      if (endpoint.anchorId !== undefined && !identifier(endpoint.anchorId)) issue('invalid-id', 'Anchor id must be nonempty', [...path, side, 'anchorId']);
    }
    if (connector.points !== undefined && (!Array.isArray(connector.points) || connector.points.some((point) => !object(point) || !finite(point.x) || !finite(point.y)))) issue('invalid-geometry', 'Connector points require finite x/y', [...path, 'points']);
  });
  return issues.length ? { ok: false, issues } : { ok: true, document: input as unknown as BoardDocument };
}

const tableForKind = { page: 'pages', entity: 'entities', placement: 'placements', connector: 'connectors', asset: 'assets' } as const;
export function lookupBoardRecord(document: BoardDocument, kind: keyof BoardRecordMap, id: string): EditableRecord<BoardRecordMap> | null {
  const record = document[tableForKind[kind]].find((entry) => entry.id === id);
  return record ? { recordKind: kind, record } as EditableRecord<BoardRecordMap> : null;
}

/** Apply a validated record batch without mutating the document. References validate at the end. */
export function applyBoardRecordChanges(document: BoardDocument, changes: readonly RecordChange<BoardRecordMap>[]): DocumentValidationResult<BoardDocument> {
  const touched = new Set<string>();
  let candidate = document;
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index]; const kind = change.kind === 'remove' ? change.recordKind : change.value.recordKind;
    const id = change.kind === 'remove' ? change.id : change.value.record.id; const key = `${kind}\u0000${id}`;
    if (touched.has(key)) return { ok: false, issues: [createIssue('duplicate-change', 'One transaction may change a record once', ['changes', index], id)] };
    touched.add(key);
    const table = tableForKind[kind]; const previous = candidate[table].find((entry) => entry.id === id);
    if ((change.kind === 'insert') === Boolean(previous)) return { ok: false, issues: [createIssue(change.kind === 'insert' ? 'duplicate-id' : 'dangling-reference', `Cannot ${change.kind} ${kind} ${id}`, ['changes', index], id)] };
    const entries = change.kind === 'remove' ? candidate[table].filter((entry) => entry.id !== id)
      : change.kind === 'insert' ? [...candidate[table], change.value.record]
        : candidate[table].map((entry) => entry.id === id ? change.value.record : entry);
    candidate = { ...candidate, [table]: entries };
  }
  return validateBoardDocument(candidate);
}

/** JSON Schema for AI/host generation. Runtime validation additionally checks cross-record references. */
export const boardDocumentSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://canvas-one.dev/schema/board-v1.json',
  type: 'object', required: ['format', 'version', 'id', 'title', 'pages', 'entities', 'placements', 'connectors', 'assets', 'extensions'],
  properties: {
    format: { const: 'canvas-one/board' }, version: { const: 1 }, id: { type: 'string', minLength: 1, maxLength: 256 }, title: { type: 'string' },
    pages: { type: 'array', items: { $ref: '#/$defs/page' } }, entities: { type: 'array', items: { $ref: '#/$defs/entity' } },
    placements: { type: 'array', items: { $ref: '#/$defs/placement' } }, connectors: { type: 'array', items: { $ref: '#/$defs/connector' } },
    assets: { type: 'array', items: { $ref: '#/$defs/asset' } }, extensions: { $ref: '#/$defs/extensions' },
  },
  $defs: {
    extensions: { type: 'object', propertyNames: { pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]*[/:][a-zA-Z0-9._:/-]+$' }, additionalProperties: { type: 'object', required: ['version', 'data'], properties: { version: { type: 'string', minLength: 1 }, data: {} } } },
    point: { type: 'object', required: ['x', 'y'], properties: { x: { type: 'number' }, y: { type: 'number' } } },
    bounds: { type: 'object', required: ['x', 'y', 'width', 'height'], properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number', minimum: 0 }, height: { type: 'number', minimum: 0 } } },
    page: { type: 'object', required: ['id', 'name', 'extensions'], properties: { id: { type: 'string', minLength: 1, maxLength: 256 }, name: { type: 'string' }, extensions: { $ref: '#/$defs/extensions' } } },
    entity: { type: 'object', required: ['id', 'type', 'data', 'extensions'], properties: { id: { type: 'string', minLength: 1, maxLength: 256 }, type: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]*[/:][a-zA-Z0-9._:/-]+$' }, data: {}, extensions: { $ref: '#/$defs/extensions' } } },
    placement: { type: 'object', required: ['id', 'pageId', 'entityId', 'bounds', 'extensions'], properties: { id: { type: 'string', minLength: 1, maxLength: 256 }, pageId: { type: 'string', minLength: 1, maxLength: 256 }, entityId: { type: 'string', minLength: 1, maxLength: 256 }, bounds: { $ref: '#/$defs/bounds' }, rotation: { type: 'number' }, extensions: { $ref: '#/$defs/extensions' } } },
    endpoint: { type: 'object', required: ['placementId'], properties: { placementId: { type: 'string', minLength: 1, maxLength: 256 }, anchorId: { type: 'string', minLength: 1, maxLength: 256 } } },
    connector: { type: 'object', required: ['id', 'pageId', 'source', 'target', 'extensions'], properties: { id: { type: 'string', minLength: 1, maxLength: 256 }, pageId: { type: 'string', minLength: 1, maxLength: 256 }, source: { $ref: '#/$defs/endpoint' }, target: { $ref: '#/$defs/endpoint' }, points: { type: 'array', items: { $ref: '#/$defs/point' } }, extensions: { $ref: '#/$defs/extensions' } } },
    asset: { type: 'object', required: ['id', 'uri', 'mediaType', 'extensions'], properties: { id: { type: 'string', minLength: 1, maxLength: 256 }, uri: { type: 'string', minLength: 1 }, mediaType: { type: 'string', minLength: 1 }, extensions: { $ref: '#/$defs/extensions' } } },
  },
} as const;
