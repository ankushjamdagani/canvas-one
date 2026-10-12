'use client';
import * as React from 'react';
import { createReactFlowAdapter } from '@canvas-one/editor-reactflow';
import { ReactFlow, ReactFlowProvider, Handle, Position, createReactFlowGeometryBridge, type Node, type Edge } from '@canvas-one/editor-reactflow/react';
import { Board, type BoardProps, type BoardEditorHostProps, type BoardHostBridge, type BoardRenderers } from './index.js';
import type { EditorObject, AssetReference, Point, Viewport } from '@canvas-one/whiteboard';
export function selectionFromChanges(selection: readonly string[], changes: readonly {readonly id: string; readonly type: string; readonly selected?: boolean}[]): readonly string[] | null {
  const updates = changes.filter(change => change.type === 'select');
  if (!updates.length) return null;
  const selected = new Set(selection);
  for (const change of updates) { if (change.selected) selected.add(change.id); else selected.delete(change.id); }
  return [...selected];
}
type NodeData = { object: EditorObject; renderers: BoardRenderers; assets: readonly AssetReference[] };
function ComponentNode({ data, selected }: { data: NodeData; selected?: boolean }) {
  const Renderer = data.renderers[data.object.componentType];
  const assetId = data.object.data && typeof data.object.data === 'object' && !Array.isArray(data.object.data) ? (data.object.data as { assetId?: unknown }).assetId : undefined;
  const assetUri = typeof assetId === 'string' ? data.assets.find(asset => asset.id === assetId)?.uri : undefined;
  return <div style={{ width: '100%', height: '100%', transform: data.object.rotation ? `rotate(${data.object.rotation}deg)` : undefined }}>
    <Handle type="target" position={Position.Left} />
    {Renderer ? <Renderer object={data.object} selected={Boolean(selected)} assetUri={assetUri} />
      : <div className="canvas-one-placeholder">Missing renderer: {data.object.componentType}</div>}
    <Handle type="source" position={Position.Right} />
  </div>;
}
const nodeTypes = { component: ComponentNode };
/** React-only presentation. All authored writes pass back as neutral intents. */
export function ReactFlowEditorHost(props: BoardEditorHostProps) {
  // Node and edge selection batches can arrive before React renders the next controlled value.
  const selection = React.useRef(props.selection);
  React.useEffect(() => { selection.current = props.selection; }, [props.selection]);
  const applySelectionChanges = (changes: readonly {readonly id?: string; readonly type: string; readonly selected?: boolean}[]) => {
    const selected = selectionFromChanges(selection.current, changes.filter((change): change is {id: string; type: string; selected?: boolean} => typeof change.id === 'string'));
    if (selected) { selection.current = selected; props.onIntent({kind: 'selection', ids: selected}); }
  };
  const [preview, setPreview] = React.useState<Readonly<Record<string, Point>>>({});
  React.useEffect(() => { setPreview({}); }, [props.projection]);
  const nodes = React.useMemo<Node<NodeData>[]>(() => props.projection.objects.map(object => ({
    id: object.id, type: 'component', position: preview[object.id] ?? { x: object.bounds.x, y: object.bounds.y },
    style: { width: object.bounds.width, height: object.bounds.height },
    selected: props.selection.includes(object.id), data: { object, renderers: props.renderers, assets: props.assets },
  })), [props.projection, props.selection, props.renderers, props.assets, preview]);
  const edges = React.useMemo<Edge[]>(() => props.projection.connectors.map(connector => ({ id: connector.id, source: connector.source.placementId, target: connector.target.placementId, sourceHandle: connector.source.anchorId, targetHandle: connector.target.anchorId, selected: props.selection.includes(connector.id) })), [props.projection, props.selection]);
  React.useEffect(() => () => props.onReady(null), [props.onReady]);
  return <ReactFlowProvider><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
    viewport={props.viewport} onViewportChange={viewport => props.onIntent({ kind: 'viewport', viewport })}
    onInit={engine => props.onReady(createReactFlowGeometryBridge(engine))}
    onNodesChange={changes => {
      const positions = changes.flatMap(change => change.type === 'position' && change.position ? [[change.id, change.position] as const] : []);
      if (positions.length) setPreview(current => ({ ...current, ...Object.fromEntries(positions) }));
      applySelectionChanges(changes);
    }}
    onNodeDragStop={(_event, _node, dragged) => { props.onIntent({ kind: 'move', placements: dragged.map(node => ({ id: node.id, position: node.position })) }); setPreview({}); }}
    onEdgesChange={changes => applySelectionChanges(changes)}
    onPaneClick={() => { selection.current = []; props.onIntent({ kind: 'selection', ids: [] }); }}
    onConnect={connection => { if (connection.source && connection.target) props.onIntent({ kind: 'connect', source: { placementId: connection.source, ...(connection.sourceHandle ? { anchorId: connection.sourceHandle } : {}) }, target: { placementId: connection.target, ...(connection.targetHandle ? { anchorId: connection.targetHandle } : {}) } }); }}
    nodesDraggable={!props.readOnly} nodesConnectable={!props.readOnly} multiSelectionKeyCode={['Shift', 'Meta', 'Control']} deleteKeyCode={null} proOptions={{ hideAttribution: true }}
  /></ReactFlowProvider>;
}


/** Optional React Flow composition; importing the generic Board does not load the engine. */
export function ReactFlowBoard(props: Omit<BoardProps, 'editor' | 'host'>) {
  const bridge = React.useRef<BoardHostBridge | null>(null);
  const state = React.useRef<{selection: readonly string[]; viewport: Viewport}>({selection: [], viewport: {x: 0, y: 0, zoom: 1}});
  const editor = React.useMemo(() => createReactFlowAdapter({
    project: () => undefined,
    getSelection: () => state.current.selection, setSelection: selection => {state.current.selection = selection;},
    getViewport: () => state.current.viewport, setViewport: viewport => {state.current.viewport = viewport; bridge.current?.setViewport(viewport);},
    screenToBoard: point => bridge.current?.screenToBoard(point) ?? point,
    boardToScreen: point => bridge.current?.boardToScreen(point) ?? point,
    getBounds: id => bridge.current?.getBounds(id) ?? null,
    hitTest: point => bridge.current?.hitTest(point) ?? null,
    getConnectionAnchor: endpoint => bridge.current?.getConnectionAnchor(endpoint) ?? null,
  }), []);
  const onReady = React.useCallback((value: BoardHostBridge | null) => {bridge.current = value; props.onHostReady?.(value);}, [props.onHostReady]);
  return <Board {...props} editor={editor} host={ReactFlowEditorHost} onHostReady={onReady} />;
}
