'use client';
import * as React from 'react';
import { planBoardMoves, planBoardConnector, type ExtensionDefinition, type ExtensionRegistrationResult } from '@canvas-one/whiteboard';
import type { Actor, AssetReference, BoardDocument, BoardRecordMap, BoardRuntime, BoardDispatchResult, EditorAdapter, EditorProjection, EditorIntent, EditorObject, Point, Viewport, Bounds, ConnectorEndpoint } from '@canvas-one/whiteboard';

type BoardContextValue = {readonly runtime: BoardRuntime<BoardDocument, BoardRecordMap>; readonly actor?: Actor; readonly portalTarget: HTMLElement | null};
const BoardContext = React.createContext<BoardContextValue | null>(null);
function useBoardContext(): BoardContextValue {
  const context = React.useContext(BoardContext);
  if (!context) throw new Error('Board hooks require a containing Board');
  return context;
}
/** Custom presentation binds to this board instance, never a process-global service. */
export function useBoardRuntime() {return useBoardContext().runtime;}
export function useBoardActor() {return useBoardContext().actor;}
export function useBoardPortalTarget() {return useBoardContext().portalTarget;}
export function useBoardSnapshot() {
  const runtime = useBoardRuntime();
  return React.useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
}

export type BoardComponentProps = { readonly object: EditorObject; readonly selected: boolean; readonly assetUri?: string };
export type BoardRenderers = Readonly<Record<string, React.ComponentType<BoardComponentProps>>>;
export type BoardHostBridge = {
  getViewport(): Viewport; setViewport(viewport: Viewport): void;
  screenToBoard(point: Point): Point; boardToScreen(point: Point): Point;
  getBounds(id: string): Bounds | null; hitTest(point: Point): string | null;
  getConnectionAnchor(endpoint: ConnectorEndpoint): Point | null;
};
export type BoardEditorHostProps = {
  readonly projection: EditorProjection; readonly selection: readonly string[];
  readonly assets: readonly AssetReference[];
  readonly viewport: Viewport; readonly renderers: BoardRenderers; readonly readOnly: boolean;
  readonly onIntent: (intent: EditorIntent) => void;
  readonly onReady: (bridge: BoardHostBridge | null) => void;
};
export type BoardProps = {
  readonly runtime: BoardRuntime<BoardDocument, BoardRecordMap>;
  readonly editor: EditorAdapter;
  /** A custom imperative adapter can mount itself without supplying a React host. */
  readonly host?: React.ComponentType<BoardEditorHostProps>;
  readonly actor?: Actor; readonly pageId?: string; readonly renderers?: BoardRenderers;
  readonly extensions?: readonly ExtensionDefinition[];
  readonly onExtensionError?: (result: Extract<ExtensionRegistrationResult, { ok: false }>) => void;
  readonly className?: string; readonly style?: React.CSSProperties;
  readonly onResult?: (result: BoardDispatchResult) => void;
  readonly onIntent?: (intent: EditorIntent) => void;
  readonly onHostReady?: (bridge: BoardHostBridge | null) => void;
};
export function projectBoardPage(document: BoardDocument, pageId: string): EditorProjection {
  const entities = new Map(document.entities.map(entity => [entity.id, entity]));
  return {
    pageId,
    objects: document.placements.filter(placement => placement.pageId === pageId).flatMap(placement => {
      const entity = entities.get(placement.entityId);
      return entity ? [{ id: placement.id, entityId: entity.id, componentType: entity.type, bounds: placement.bounds, rotation: placement.rotation, data: entity.data }] : [];
    }),
    connectors: document.connectors.filter(connector => connector.pageId === pageId).map(connector => ({ id: connector.id, source: connector.source, target: connector.target, points: connector.points })),
  };
}
/** Independent authored board: no project navigation, persistence or simulation services. */
export function Board(props: BoardProps) {
  const snapshot = React.useSyncExternalStore(props.runtime.subscribe, props.runtime.getSnapshot, props.runtime.getSnapshot);
  const pageId = props.pageId ?? snapshot.document.pages[0]?.id ?? '';
  const projection = React.useMemo(() => projectBoardPage(snapshot.document, pageId), [snapshot.document, pageId]);
  const [selection, setSelection] = React.useState<readonly string[]>([]);
  const [viewport, setViewport] = React.useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [displayProjection, setDisplayProjection] = React.useState(projection);
  const container = React.useRef<HTMLDivElement>(null);
  const [portalTarget, setPortalTarget] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {setPortalTarget(container.current);}, []);
  const onReady = React.useCallback((next: BoardHostBridge | null) => { props.onHostReady?.(next); }, [props.onHostReady]);
  const editor = props.editor;
  const handler = React.useRef<(intent: EditorIntent) => void>(() => undefined);
  handler.current = intent => {
    props.onIntent?.(intent);
    if (intent.kind === 'selection') { setSelection(intent.ids); return; }
    if (intent.kind === 'viewport') { setViewport(intent.viewport); return; }
    if (!props.actor || snapshot.busy || snapshot.disposed || snapshot.needsReload) return;
    const current = props.runtime.getSnapshot();
    if (intent.kind === 'move') {
      const plan = planBoardMoves(current.document, pageId, intent.placements);
      if (!plan.ok) { props.onResult?.({ status: 'invalid', issues: plan.issues }); return; }
      if (plan.changes.length) void props.runtime.dispatch({ operationId: crypto.randomUUID(), actor: props.actor, scope: current.scope, expectedRevision: current.revision, changes: plan.changes, label: 'Move components' }).then(result => props.onResult?.(result));
    }
    if (intent.kind === 'connect') {
      const plan = planBoardConnector(current.document, pageId, crypto.randomUUID(), intent.source, intent.target);
      if (!plan.ok) { props.onResult?.({ status: 'invalid', issues: plan.issues }); return; }
      void props.runtime.dispatch({ operationId: crypto.randomUUID(), actor: props.actor, scope: current.scope, expectedRevision: current.revision, changes: plan.changes, label: 'Connect components' }).then(result => props.onResult?.(result));
    }
  };
  const onIntent = React.useCallback((intent: EditorIntent) => handler.current(intent), []);
  React.useEffect(() => {
    const removals: (() => unknown)[] = [];
    for (const extension of props.extensions ?? []) {
      const registration = props.runtime.extensions.register(extension);
      if (!registration.ok) props.onExtensionError?.(registration);
      else removals.push(registration.unregister);
    }
    return () => { for (const unregister of removals.reverse()) unregister(); };
  }, [props.runtime, props.extensions, props.onExtensionError]);
  React.useEffect(() => { const result = editor.mount(container.current, { onIntent }); return () => { if (result.supported) editor.dispose(); }; }, [editor, onIntent]);
  React.useEffect(() => { editor.setSelection(selection); }, [editor, selection]);
  React.useEffect(() => { editor.setViewport(viewport); }, [editor, viewport]);
  React.useEffect(() => { editor.project(projection); setDisplayProjection(projection); setSelection(current => current.filter(id => [...projection.objects, ...projection.connectors].some(object => object.id === id))); }, [editor, projection]);
  const Host = props.host;
  return <BoardContext.Provider value={{runtime: props.runtime, actor: props.actor, portalTarget}}><div ref={container} className={`canvas-one-board ${props.className ?? ''}`} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 240, isolation: 'isolate', ...props.style }} data-board-id={snapshot.document.id}>
    {Host && <Host projection={displayProjection} assets={snapshot.document.assets} selection={selection} viewport={viewport} renderers={props.renderers ?? {}} readOnly={!props.actor || snapshot.busy || snapshot.disposed || snapshot.needsReload} onIntent={onIntent} onReady={onReady} />}
  </div></BoardContext.Provider>;
}
