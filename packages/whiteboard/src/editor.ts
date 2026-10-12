import type { Bounds, ConnectorEndpoint, Json, Point } from './document.js';
import { immutableSnapshot } from './immutable.js';

export type Viewport = { readonly x: number; readonly y: number; readonly zoom: number };
export type EditorCapability = 'selection' | 'viewport' | 'coordinates' | 'hit-test' | 'bounds' | 'connection-anchors' | 'overlays';
export type EditorResult<T> = { readonly supported: true; readonly value: T } | { readonly supported: false; readonly reason: string };
export type EditorObject = {
  readonly id: string; readonly entityId: string; readonly componentType: string; readonly bounds: Bounds;
  readonly rotation?: number; readonly data: Json; readonly anchors?: Readonly<Record<string, Point>>;
};
export type EditorProjection = {
  readonly pageId: string; readonly objects: readonly EditorObject[];
  readonly connectors: readonly { readonly id: string; readonly source: ConnectorEndpoint; readonly target: ConnectorEndpoint; readonly points?: readonly Point[] }[];
};
export type EditorOverlay = { readonly id: string; readonly type: string; readonly bounds: Bounds; readonly data: Json };
export type EditorIntent =
  | { readonly kind: 'move'; readonly placements: readonly { readonly id: string; readonly position: Point }[] }
  | { readonly kind: 'selection'; readonly ids: readonly string[] }
  | { readonly kind: 'viewport'; readonly viewport: Viewport }
  | { readonly kind: 'connect'; readonly source: ConnectorEndpoint; readonly target: ConnectorEndpoint }
  | { readonly kind: 'command'; readonly commandId: string; readonly input: Json };
export type EditorHandlers = { readonly onIntent: (intent: EditorIntent) => void };
/** Engine types and UI frameworks never cross this boundary. A host supplies its own mount target. */
export interface EditorAdapter {
  readonly id: string;
  readonly capabilities: Readonly<Record<EditorCapability, { readonly supported: boolean; readonly reason?: string }>>;
  mount(host: unknown, handlers: EditorHandlers): EditorResult<void>;
  dispose(): void;
  project(document: EditorProjection): EditorResult<void>;
  getSelection(): EditorResult<readonly string[]>;
  setSelection(ids: readonly string[]): EditorResult<void>;
  getViewport(): EditorResult<Viewport>;
  setViewport(viewport: Viewport): EditorResult<void>;
  screenToBoard(point: Point): EditorResult<Point>;
  boardToScreen(point: Point): EditorResult<Point>;
  hitTest(point: Point): EditorResult<string | null>;
  getBounds(id: string): EditorResult<Bounds | null>;
  getConnectionAnchor(endpoint: ConnectorEndpoint): EditorResult<Point | null>;
  setOverlays(overlays: readonly EditorOverlay[]): EditorResult<void>;
}

const capabilityNames: readonly EditorCapability[] = ['selection', 'viewport', 'coordinates', 'hit-test', 'bounds', 'connection-anchors', 'overlays'];
const validPoint = (point: Point) => Number.isFinite(point.x) && Number.isFinite(point.y);
const validViewport = (viewport: Viewport) => validPoint(viewport) && Number.isFinite(viewport.zoom) && viewport.zoom > 0;
const ok = <T>(value: T): EditorResult<T> => ({ supported: true, value });
const unsupported = (reason: string): EditorResult<never> => ({ supported: false, reason });

/** A headless conformance adapter with rotated-rectangle geometry and explicit unsupported features. */
export function createTestEditorAdapter(options: { readonly unsupportedCapabilities?: readonly EditorCapability[] } = {}): EditorAdapter & {
  readonly simulate: (intent: EditorIntent) => EditorResult<void>;
  readonly getOverlays: () => readonly EditorOverlay[];
} {
  const capabilities = Object.freeze(Object.fromEntries(capabilityNames.map((capability) => [capability, Object.freeze(options.unsupportedCapabilities?.includes(capability) ? { supported: false, reason: `Test adapter does not support ${capability}` } : { supported: true })])) as Record<EditorCapability, { supported: boolean; reason?: string }>);
  let handlers: EditorHandlers | null = null;
  let projection: EditorProjection = immutableSnapshot({ pageId: '', objects: [], connectors: [] });
  let selection: readonly string[] = Object.freeze([]);
  let viewport: Viewport = Object.freeze({ x: 0, y: 0, zoom: 1 });
  let overlays: readonly EditorOverlay[] = Object.freeze([]);
  const unavailable = (capability?: EditorCapability) => !handlers ? unsupported('Editor is not mounted') : capability && !capabilities[capability].supported ? unsupported(capabilities[capability].reason!) : null;
  const rotated = (point: Point, object: EditorObject, inverse = false): Point => {
    const radians = (object.rotation ?? 0) * Math.PI / 180 * (inverse ? -1 : 1);
    const cx = object.bounds.x + object.bounds.width / 2; const cy = object.bounds.y + object.bounds.height / 2;
    return { x: cx + (point.x - cx) * Math.cos(radians) - (point.y - cy) * Math.sin(radians), y: cy + (point.x - cx) * Math.sin(radians) + (point.y - cy) * Math.cos(radians) };
  };
  return {
    id: 'canvas-one/test-editor', capabilities,
    mount(_host, nextHandlers) { if (handlers) return unsupported('Editor is already mounted'); handlers = nextHandlers; return ok(undefined); },
    dispose() { handlers = null; selection = Object.freeze([]); overlays = Object.freeze([]); projection = immutableSnapshot({ pageId: '', objects: [], connectors: [] }); viewport = Object.freeze({ x: 0, y: 0, zoom: 1 }); },
    project(document) { const failure = unavailable(); if (failure) return failure; projection = immutableSnapshot(document); const ids = new Set([...projection.objects, ...projection.connectors].map((entry) => entry.id)); selection = Object.freeze(selection.filter((id) => ids.has(id))); return ok(undefined); },
    getSelection() { return unavailable('selection') ?? ok(selection); },
    setSelection(ids) { const failure = unavailable('selection'); if (failure) return failure; const available = new Set([...projection.objects, ...projection.connectors].map((entry) => entry.id)); selection = Object.freeze([...new Set(ids.filter((id) => available.has(id)))]); return ok(undefined); },
    getViewport() { return unavailable('viewport') ?? ok(viewport); },
    setViewport(value) { const failure = unavailable('viewport'); if (failure) return failure; if (!validViewport(value)) return unsupported('Viewport requires finite coordinates and positive zoom'); viewport = Object.freeze({ ...value }); return ok(undefined); },
    screenToBoard(point) { const failure = unavailable('coordinates'); if (failure) return failure; return validPoint(point) ? ok({ x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom }) : unsupported('Point requires finite coordinates'); },
    boardToScreen(point) { const failure = unavailable('coordinates'); if (failure) return failure; return validPoint(point) ? ok({ x: point.x * viewport.zoom + viewport.x, y: point.y * viewport.zoom + viewport.y }) : unsupported('Point requires finite coordinates'); },
    hitTest(point) {
      const failure = unavailable('hit-test'); if (failure) return failure;
      for (const object of [...projection.objects].reverse()) { const p = rotated(point, object, true); const b = object.bounds; if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) return ok(object.id); }
      return ok(null);
    },
    getBounds(id) { const failure = unavailable('bounds'); if (failure) return failure; const object = projection.objects.find((entry) => entry.id === id); if (!object) return ok(null); const b = object.bounds; const corners = [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x, y: b.y + b.height }, { x: b.x + b.width, y: b.y + b.height }].map((point) => rotated(point, object)); const x = Math.min(...corners.map((point) => point.x)); const y = Math.min(...corners.map((point) => point.y)); return ok({ x, y, width: Math.max(...corners.map((point) => point.x)) - x, height: Math.max(...corners.map((point) => point.y)) - y }); },
    getConnectionAnchor(endpoint) { const failure = unavailable('connection-anchors'); if (failure) return failure; const object = projection.objects.find((entry) => entry.id === endpoint.placementId); if (!object) return ok(null); const anchor = endpoint.anchorId ? object.anchors?.[endpoint.anchorId] : { x: object.bounds.x + object.bounds.width / 2, y: object.bounds.y + object.bounds.height / 2 }; return ok(anchor ? rotated(anchor, object) : null); },
    setOverlays(next) { const failure = unavailable('overlays'); if (failure) return failure; overlays = immutableSnapshot(next); return ok(undefined); },
    getOverlays: () => overlays,
    simulate(intent) { const failure = unavailable(); if (failure) return failure; handlers!.onIntent(immutableSnapshot(intent)); return ok(undefined); },
  };
}
