/** Transitional engine-specific presentation bindings; semantic operations stay with the host. */
import type { Node, Edge, ReactFlowInstance } from '@xyflow/react';
import type { ReactFlowBridge } from './index.js';
export {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, MiniMap,
  useNodesState, useEdgesState, useReactFlow, useViewport, useNodesInitialized, useUpdateNodeInternals, ViewportPortal, Handle, Position,
  BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useStore,
} from '@xyflow/react';
export type {
  Node, Edge, NodeMouseHandler, EdgeMouseHandler, OnNodeDrag, NodeChange, EdgeChange,
  NodeProps, EdgeProps,
} from '@xyflow/react';

/** Guarded host selection is authoritative; other engine changes retain their original order. */
export function withoutSelectionChanges<Change extends { type: string }>(changes: readonly Change[]): Change[] {
  return changes.filter(change => change.type !== 'select');
}

/** Translate measured engine geometry into neutral world coordinates. */
export function createReactFlowGeometryBridge<N extends Node, E extends Edge>(engine: ReactFlowInstance<N, E>): Required<Pick<ReactFlowBridge, 'getViewport' | 'setViewport' | 'screenToBoard' | 'boardToScreen' | 'getBounds' | 'hitTest' | 'getConnectionAnchor'>> {
  return {
    getViewport: () => engine.getViewport(),
    setViewport: viewport => { void engine.setViewport(viewport); },
    screenToBoard: point => engine.screenToFlowPosition(point),
    boardToScreen: point => engine.flowToScreenPosition(point),
    getBounds: id => {
      const node = engine.getInternalNode(id);
      if (!node) return null;
      const position = node.internals.positionAbsolute;
      return { x: position.x, y: position.y, width: node.measured?.width ?? node.width ?? 0, height: node.measured?.height ?? node.height ?? 0 };
    },
    hitTest: point => {
      for (const node of [...engine.getNodes()].reverse()) {
        const internal = engine.getInternalNode(node.id);
        if (!internal || node.hidden) continue;
        const position = internal.internals.positionAbsolute;
        const width = internal.measured?.width ?? internal.width ?? 0;
        const height = internal.measured?.height ?? internal.height ?? 0;
        if (point.x >= position.x && point.x <= position.x + width && point.y >= position.y && point.y <= position.y + height) return node.id;
      }
      return null;
    },
    getConnectionAnchor: endpoint => {
      const node = engine.getInternalNode(endpoint.placementId);
      if (!node) return null;
      const position = node.internals.positionAbsolute;
      if (endpoint.anchorId) {
        const handles = [...(node.internals.handleBounds?.source ?? []), ...(node.internals.handleBounds?.target ?? [])];
        const handle = handles.find(handle => handle.id === endpoint.anchorId);
        return handle ? { x: position.x + handle.x + handle.width / 2, y: position.y + handle.y + handle.height / 2 } : null;
      }
      return { x: position.x + (node.measured?.width ?? node.width ?? 0) / 2, y: position.y + (node.measured?.height ?? node.height ?? 0) / 2 };
    },
  };
}
