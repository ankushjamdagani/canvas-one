import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { Board, projectBoardPage, useBoardRuntime, useBoardSnapshot, useBoardActor, useBoardPortalTarget, type BoardEditorHostProps } from '@canvas-one/react';
import { selectionFromChanges } from '@canvas-one/react/reactflow';
import { basicComponentsExtension, planBasicComponent, validateBasicEntity } from '@canvas-one/components-basic';
import { createBoardRuntime, createExtensionRegistry, createTestEditorAdapter, validateBoardDocument, applyBoardRecordChanges, lookupBoardRecord, type BoardDocument, type BoardRecordMap } from '@canvas-one/whiteboard';

function document(): BoardDocument {
  return { format: 'canvas-one/board', version: 1, id: 'board', title: 'Independent', pages: [{ id: 'page', name: 'Page', extensions: {} }], entities: [], placements: [], connectors: [], assets: [], extensions: {} };
}
const actor = { actorId: 'human', kind: 'local-human', displayName: 'Human' };
describe('independent Board composition', () => {
  it('binds custom UI hooks and portal targets to each board instance during server rendering', () => {
    const first = createBoardRuntime<BoardDocument, BoardRecordMap>({document: document(), scope: {projectId: 'first', branchId: 'main'}, validate: validateBoardDocument, apply: applyBoardRecordChanges, lookup: lookupBoardRecord});
    const second = createBoardRuntime<BoardDocument, BoardRecordMap>({document: {...document(), id: 'other'}, scope: {projectId: 'second', branchId: 'main'}, validate: validateBoardDocument, apply: applyBoardRecordChanges, lookup: lookupBoardRecord});
    function Host() {
      const runtime = useBoardRuntime(); const snapshot = useBoardSnapshot(); const actor = useBoardActor(); const portal = useBoardPortalTarget();
      return React.createElement('span', null, `${runtime.getSnapshot().scope.projectId}/${snapshot.document.id}/${actor?.actorId ?? 'readonly'}/${portal === null}`);
    }
    const html = renderToString(React.createElement(React.Fragment, null,
      React.createElement(Board, {runtime: first, editor: createTestEditorAdapter(), host: Host, actor}),
      React.createElement(Board, {runtime: second, editor: createTestEditorAdapter(), host: Host})));
    expect(html).toContain('first/board/human/true');
    expect(html).toContain('second/other/readonly/true');
    first.dispose(); second.dispose();
  });
  it('translates marquee, keyboard and shift deselection batches without dropping existing edge selection', () => {
    expect(selectionFromChanges(['edge', 'first'], [{type: 'select', id: 'first', selected: false}, {type: 'select', id: 'second', selected: true}])).toEqual(['edge', 'second']);
    expect(selectionFromChanges(['first'], [{type: 'position', id: 'first'}])).toBeNull();
    expect(selectionFromChanges(['first'], [{type: 'select', id: 'first', selected: false}])).toEqual([]);
  });
  it('creates a basic component in one runtime transaction with an atomic inverse', async () => {
    let observed = 0;
    const runtime = createBoardRuntime<BoardDocument, BoardRecordMap>({ document: document(), scope: { projectId: 'project', branchId: 'branch' }, validate: validateBoardDocument, apply: applyBoardRecordChanges, lookup: lookupBoardRecord, onCommitted: transaction => { observed++; expect(transaction.inverseChanges.map(change => change.kind)).toEqual(['remove', 'remove']); } });
    const plan = planBasicComponent(runtime.getSnapshot().document, { type: 'basic/freehand', pageId: 'page', entityId: 'drawing', placementId: 'placed-drawing', bounds: { x: 10, y: 20, width: 80, height: 40 }, data: { points: [{ x: 0, y: 0 }, { x: 20, y: 30 }], strokeWidth: 2 } });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(await runtime.dispatch({ operationId: 'create', actor, scope: runtime.getSnapshot().scope, expectedRevision: 0, changes: plan.changes })).toMatchObject({ status: 'applied', revision: 1 });
    expect(observed).toBe(1);
    expect(projectBoardPage(runtime.getSnapshot().document, 'page').objects[0]).toMatchObject({ id: 'placed-drawing', entityId: 'drawing', componentType: 'basic/freehand', data: { points: [{ x: 0, y: 0 }, { x: 20, y: 30 }] } });
  });
  it('retains unknown component payloads and can render an independent server host', () => {
    const unknown = { ...document(), entities: [{ id: 'custom', type: 'example/custom', data: { nested: { meaning: 42 } }, extensions: {} }], placements: [{ id: 'placed', pageId: 'page', entityId: 'custom', bounds: { x: 0, y: 0, width: 100, height: 80 }, extensions: {} }] } satisfies BoardDocument;
    const runtime = createBoardRuntime<BoardDocument, BoardRecordMap>({ document: unknown, scope: { projectId: 'project', branchId: 'branch' }, validate: validateBoardDocument, apply: applyBoardRecordChanges, lookup: lookupBoardRecord });
    function Host(props: BoardEditorHostProps) { return React.createElement('span', null, props.projection.objects[0].componentType); }
    const html = renderToString(React.createElement(Board, { runtime, editor: createTestEditorAdapter(), host: Host }));
    expect(html).toContain('example/custom');
    expect(runtime.getSnapshot().document.entities[0].data).toEqual({ nested: { meaning: 42 } });
    expect(runtime.getSnapshot().revision).toBe(0);
  });
  it('rejects missing assets/pages and malformed freehand points before emitting a plan', () => {
    expect(planBasicComponent(document(), { type: 'basic/image', pageId: 'page', entityId: 'image', placementId: 'image-placement', bounds: { x: 0, y: 0, width: 10, height: 10 }, data: { assetId: 'missing' } })).toMatchObject({ ok: false, issues: [{ code: 'basic/missing-asset' }] });
    expect(validateBasicEntity({ id: 'drawing', type: 'basic/freehand', data: { points: [{ x: 1, y: null }] }, extensions: {} })).toMatchObject([{ code: 'basic/invalid-data' }]);
  });
  it('registers first-party schemas through the same extension registry as custom definitions', () => {
    const registry = createExtensionRegistry();
    expect(registry.register(basicComponentsExtension).ok).toBe(true);
    expect(registry.getContribution('schema', 'basic/freehand')?.contribution.value).toMatchObject({ required: ['points'] });
    expect(registry.register(basicComponentsExtension)).toMatchObject({ ok: false, code: 'duplicate-extension' });
    expect(registry.dispose()).toEqual([]);
    expect(registry.list()).toEqual([]);
  });
});
