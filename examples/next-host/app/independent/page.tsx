'use client';
import * as React from 'react';
import { type BoardComponentProps } from '@canvas-one/react/board';
import { ReactFlowBoard as Board } from '@canvas-one/react/reactflow';
import { basicComponentsExtension, planBasicComponent } from '@canvas-one/components-basic';
import { basicRenderers } from '@canvas-one/components-basic/react';
import { createBoardRuntime, validateBoardDocument, applyBoardRecordChanges, lookupBoardRecord, type BoardDocument, type BoardRecordMap } from '@canvas-one/whiteboard';

function createRuntime(id: string) {
  const document: BoardDocument = {
    format: 'canvas-one/board', version: 1, id, title: `Board ${id}`,
    pages: [{ id: 'page', name: 'Page', extensions: {} }],
    entities: [
      { id: 'shape', type: 'basic/rectangle', data: { text: 'Move this component', fill: '#f5f5f5' }, extensions: {} },
      { id: 'custom', type: 'example/custom', data: { text: 'Host overrides custom UI', unknown: { preserve: true } }, extensions: {} },
    ],
    placements: [
      { id: 'shape-placement', pageId: 'page', entityId: 'shape', bounds: { x: 20, y: 20, width: 160, height: 70 }, extensions: {} },
      { id: 'custom-placement', pageId: 'page', entityId: 'custom', bounds: { x: 210, y: 20, width: 180, height: 70 }, extensions: {} },
    ], connectors: [], assets: [], extensions: {},
  };
  return createBoardRuntime<BoardDocument, BoardRecordMap>({ document, scope: { projectId: id, branchId: 'main' }, validate: validateBoardDocument, apply: applyBoardRecordChanges, lookup: lookupBoardRecord });
}
const actor = { actorId: 'embedding-human', kind: 'local-human', displayName: 'Embedding host' };
const extensions = [basicComponentsExtension];
function CustomComponent({ object }: BoardComponentProps) {
  const data = object.data as { text: string };
  return <div style={{ height: '100%', boxSizing: 'border-box', border: '2px solid #525252', borderRadius: 8, padding: 8, background: '#e0f2fe', color: '#171717' }} data-testid="custom-renderer">{data.text}</div>;
}
const customRenderers = { ...basicRenderers, 'example/custom': CustomComponent };

export default function IndependentBoardPage() {
  const [first] = React.useState(() => createRuntime('first'));
  const [second] = React.useState(() => createRuntime('second'));
  const firstSnapshot = React.useSyncExternalStore(first.subscribe, first.getSnapshot, first.getSnapshot);
  const secondSnapshot = React.useSyncExternalStore(second.subscribe, second.getSnapshot, second.getSnapshot);
  const addText = () => {
    const snapshot = first.getSnapshot();
    const id = crypto.randomUUID();
    const plan = planBasicComponent(snapshot.document, { type: 'basic/text', pageId: 'page', entityId: id, placementId: `placement-${id}`, bounds: { x: 20, y: 120, width: 190, height: 60 }, data: { text: 'Created through public contracts' } });
    if (plan.ok) void first.dispatch({ operationId: crypto.randomUUID(), actor, scope: snapshot.scope, expectedRevision: snapshot.revision, changes: plan.changes });
  };
  return <main style={{ padding: 20, background: '#fff', color: '#171717', minHeight: '100vh' }} data-testid="independent-host">
    <h1>Independent boards</h1>
    <p>Two runtimes, host-owned UI, optional custom renderers. No persistence or simulation adapter.</p>
    <button onClick={addText} data-testid="add-first-component">Add text to first board</button>
    <p>First: <span data-testid="first-entity-count">{firstSnapshot.document.entities.length}</span>; second: <span data-testid="second-entity-count">{secondSnapshot.document.entities.length}</span></p>
    <p>Revisions: <span data-testid="first-revision">{firstSnapshot.revision}</span> / <span data-testid="second-revision">{secondSnapshot.revision}</span></p>
    <section style={{ height: 260, border: '1px solid #a3a3a3' }} data-testid="first-board"><Board runtime={first} actor={actor} renderers={basicRenderers} extensions={extensions} style={{ height: '100%' }} /></section>
    <section style={{ height: 260, border: '1px solid #a3a3a3', marginTop: 20 }} data-testid="second-board"><Board runtime={second} actor={actor} renderers={customRenderers} extensions={extensions} style={{ height: '100%' }} /></section>
  </main>;
}
