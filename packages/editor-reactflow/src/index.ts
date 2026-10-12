import type { EditorAdapter, EditorCapability, EditorHandlers, EditorIntent, EditorProjection, EditorResult, Point, Bounds, Viewport, ConnectorEndpoint, EditorOverlay } from '@canvas-one/whiteboard';

/** Neutral bridge implemented by the React Flow host; no engine types escape this root. */
export interface ReactFlowBridge {
  getViewport(): Viewport;
  setViewport(viewport: Viewport): void;
  screenToBoard(point: Point): Point;
  boardToScreen(point: Point): Point;
  project?(projection: EditorProjection): void;
  getSelection?(): readonly string[];
  setSelection?(ids: readonly string[]): EditorResult<void> | void;
  getBounds?(id: string): Bounds | null;
  hitTest?(point: Point): string | null;
  getConnectionAnchor?(endpoint: ConnectorEndpoint): Point | null;
  setOverlays?(overlays: readonly EditorOverlay[]): void;
}
const ok = <T>(value: T): EditorResult<T> => ({ supported: true, value });
const unsupported = (reason: string): EditorResult<never> => ({ supported: false, reason });
const pointValid = (point: Point) => Number.isFinite(point.x) && Number.isFinite(point.y);
export function createReactFlowAdapter(bridge: ReactFlowBridge): EditorAdapter & {
  dispatchIntent(intent: EditorIntent): EditorResult<void>;
} {
  let handlers: EditorHandlers | null = null;
  const support: Record<EditorCapability, boolean> = {
    selection: !!bridge.getSelection && !!bridge.setSelection, viewport: true, coordinates: true,
    'hit-test': !!bridge.hitTest, bounds: !!bridge.getBounds,
    'connection-anchors': !!bridge.getConnectionAnchor, overlays: !!bridge.setOverlays,
  };
  const capabilities = Object.freeze(Object.fromEntries(Object.entries(support).map(([name, supported]) => [name, Object.freeze(supported ? { supported } : { supported, reason: `Host has no ${name} bridge` })])) as EditorAdapter['capabilities']);
  const failure = (capability?: EditorCapability) => !handlers ? unsupported('Editor is not mounted')
    : capability && !support[capability] ? unsupported(capabilities[capability].reason!) : null;
  return {
    id: 'canvas-one/reactflow', capabilities,
    mount(_host, next) { if (handlers) return unsupported('Editor is already mounted'); handlers = next; return ok(undefined); },
    dispose() { handlers = null; },
    project(projection) { const failed = failure(); if (failed) return failed; if (!bridge.project) return unsupported('Host has no document projection bridge'); bridge.project(projection); return ok(undefined); },
    getSelection() { return failure('selection') ?? ok([...bridge.getSelection!()]); },
    setSelection(ids) { const failed = failure('selection'); if (failed) return failed; return bridge.setSelection!([...new Set(ids)]) ?? ok(undefined); },
    getViewport() { return failure('viewport') ?? ok({ ...bridge.getViewport() }); },
    setViewport(viewport) { const failed = failure('viewport'); if (failed) return failed; if (!pointValid(viewport) || !Number.isFinite(viewport.zoom) || viewport.zoom <= 0) return unsupported('Viewport requires finite coordinates and positive zoom'); bridge.setViewport({ ...viewport }); return ok(undefined); },
    screenToBoard(point) { return failure('coordinates') ?? (pointValid(point) ? ok(bridge.screenToBoard({ ...point })) : unsupported('Point requires finite coordinates')); },
    boardToScreen(point) { return failure('coordinates') ?? (pointValid(point) ? ok(bridge.boardToScreen({ ...point })) : unsupported('Point requires finite coordinates')); },
    hitTest(point) { return failure('hit-test') ?? (pointValid(point) ? ok(bridge.hitTest!({ ...point })) : unsupported('Point requires finite coordinates')); },
    getBounds(id) { const failed = failure('bounds'); if (failed) return failed; const bounds = bridge.getBounds!(id); return ok(bounds ? { ...bounds } : null); },
    getConnectionAnchor(endpoint) { const failed = failure('connection-anchors'); if (failed) return failed; const point = bridge.getConnectionAnchor!({ ...endpoint }); return ok(point ? { ...point } : null); },
    setOverlays(overlays) { const failed = failure('overlays'); if (failed) return failed; bridge.setOverlays!(structuredClone(overlays)); return ok(undefined); },
    dispatchIntent(intent) { const failed = failure(); if (failed) return failed; handlers!.onIntent(structuredClone(intent)); return ok(undefined); },
  };
}
