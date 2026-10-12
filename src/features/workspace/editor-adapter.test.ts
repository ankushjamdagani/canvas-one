import { describe, expect, it } from 'vitest';
import { createReactFlowAdapter } from '@canvas-one/editor-reactflow';
import { createReactFlowGeometryBridge, withoutSelectionChanges } from '@canvas-one/editor-reactflow/react';
import type { EditorIntent, Viewport } from '@canvas-one/whiteboard';

describe('React Flow neutral adapter', () => {
  it('projects measured absolute node geometry and handle centers across engine coordinates', () => {
    const internal = {
      id: 'placement', width: 1, height: 1, measured: { width: 100, height: 40 },
      internals: { positionAbsolute: { x: 20, y: 30 }, handleBounds: { source: [{ id: 'port', x: 90, y: 10, width: 10, height: 10 }], target: [] } },
    };
    const engine = {
      getNodes: () => [{ id: 'placement' }, { id: 'hidden', hidden: true }],
      getInternalNode: (id: string) => id === 'placement' ? internal : { ...internal, id },
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }), setViewport: () => Promise.resolve(true),
      screenToFlowPosition: (point: { x: number; y: number }) => point,
      flowToScreenPosition: (point: { x: number; y: number }) => point,
    } as unknown as Parameters<typeof createReactFlowGeometryBridge>[0];
    const bridge = createReactFlowGeometryBridge(engine);
    expect(bridge.getBounds!('placement')).toEqual({ x: 20, y: 30, width: 100, height: 40 });
    expect(bridge.hitTest!({ x: 50, y: 50 })).toBe('placement');
    expect(bridge.hitTest!({ x: 5, y: 5 })).toBeNull();
    expect(bridge.getConnectionAnchor!({ placementId: 'placement', anchorId: 'port' })).toEqual({ x: 115, y: 45 });
    expect(bridge.getConnectionAnchor!({ placementId: 'placement', anchorId: 'missing' })).toBeNull();
    expect(bridge.getConnectionAnchor!({ placementId: 'placement' })).toEqual({ x: 70, y: 50 });
  });
  it('delegates coordinates and viewport, validates input, and cleans up intent handlers', () => {
    let viewport: Viewport = { x: 12, y: 8, zoom: 2 };
    const intents: EditorIntent[] = [];
    const adapter = createReactFlowAdapter({
      getViewport: () => viewport,
      setViewport: next => { viewport = next; },
      screenToBoard: point => ({ x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom }),
      boardToScreen: point => ({ x: point.x * viewport.zoom + viewport.x, y: point.y * viewport.zoom + viewport.y }),
    });
    expect(adapter.screenToBoard({ x: 16, y: 14 }).supported).toBe(false);
    expect(adapter.mount(null, { onIntent: intent => intents.push(intent) }).supported).toBe(true);
    expect(adapter.screenToBoard({ x: 16, y: 14 })).toEqual({ supported: true, value: { x: 2, y: 3 } });
    expect(adapter.boardToScreen({ x: 2, y: 3 })).toEqual({ supported: true, value: { x: 16, y: 14 } });
    expect(adapter.setViewport({ x: 0, y: 0, zoom: 0 }).supported).toBe(false);
    expect(adapter.getViewport()).toEqual({ supported: true, value: viewport });
    expect(adapter.getBounds('missing').supported).toBe(false);
    expect(adapter.capabilities.bounds.supported).toBe(false);
    const intent: EditorIntent = { kind: 'selection', ids: ['placement'] };
    adapter.dispatchIntent(intent);
    expect(intents).toEqual([intent]);
    adapter.dispose();
    expect(adapter.dispatchIntent(intent).supported).toBe(false);
    expect(intents).toHaveLength(1);
  });
  it('uses host geometry, selection and projection without exposing engine objects', () => {
    let selected: readonly string[] = [];
    let projected = '';
    const adapter = createReactFlowAdapter({
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }), setViewport: () => undefined,
      screenToBoard: point => point, boardToScreen: point => point,
      getSelection: () => selected, setSelection: ids => { selected = ids; },
      getBounds: () => ({ x: 2, y: 3, width: 10, height: 20 }),
      hitTest: () => 'placement', getConnectionAnchor: () => ({ x: 7, y: 3 }),
      project: document => { projected = document.pageId; },
    });
    adapter.mount(null, { onIntent: () => undefined });
    adapter.project({ pageId: 'page', objects: [], connectors: [] });
    expect(projected).toBe('page');
    adapter.setSelection(['placement', 'placement']);
    expect(adapter.getSelection()).toEqual({ supported: true, value: ['placement'] });
    expect(adapter.getBounds('placement')).toEqual({ supported: true, value: { x: 2, y: 3, width: 10, height: 20 } });
    expect(adapter.getConnectionAnchor({ placementId: 'placement' })).toEqual({ supported: true, value: { x: 7, y: 3 } });
  });
  it('filters only engine selection mutations without reordering other gestures', () => {
    const changes = [{ type: 'position', id: 'one' }, { type: 'select', id: 'two' }, { type: 'dimensions', id: 'three' }];
    expect(withoutSelectionChanges(changes)).toEqual([changes[0], changes[2]]);
    expect(changes).toHaveLength(3);
  });
});
