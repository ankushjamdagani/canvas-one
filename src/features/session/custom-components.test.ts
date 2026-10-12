import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { planCustomComponent, projectSystemDesignDocument, type Document } from '@canvas-one/system-design';
import { createIssue, type ExtensionDefinition } from '@canvas-one/whiteboard';
import { createStudioComposition } from '../../../apps/web/src/composition';
import { openStudioRepository } from './boot';

let sequence = 40000;
const mintId = () => `ac000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, '0')}`;
const actor = {actorId: 'custom-component-host', displayName: 'Host', kind: 'local-human' as const};
const extensions: readonly ExtensionDefinition[] = [{manifest: {id: 'example/components', version: '1.0.0', dependencies: [], capabilities: ['components']},
  contributions: [{id: 'example/card', version: '1.0.0', kind: 'component', capabilities: [], value: {
    validate: (entity: {data: {text?: unknown}}) => typeof entity.data.text === 'string' ? [] : [createIssue('example/missing-text', 'Card requires text', ['data', 'text'])],
  }}]}];

describe('complete app custom component authority', () => {
  it('rejects known component policy failures before persisting an initial project', async () => {
    const boot = await openStudioRepository({dbName: `initial-component-validation-${sequence}`, mintId});
    if (!boot.ok) throw new Error('Repository unavailable');
    const session = createStudioComposition({extensions}).createSession({repository: boot.repository, mintId, actor});
    const document: Document = {schema: 'studio-model/1', id: mintId(), title: 'Invalid custom initial',
      elements: [{id: mintId(), label: 'Card', description: '', visualKind: 'host', ports: [],
        behavior: {kind: 'unmodeled', version: 1, reason: 'Custom'}, component: {type: 'example/card', data: {text: 5}, extensions: {}}}],
      connections: [], relations: [], schemas: [], fixtures: [], refinements: [], scenarios: [], views: []};
    const write = vi.spyOn(boot.repository, 'execute');
    expect(await session.createProject({title: document.title, initialDocument: document})).toMatchObject({status: 'invalid', issues: [{code: 'example/missing-text'}]});
    expect(write).not.toHaveBeenCalled(); expect(session.getState().document).toBeNull();
    session.dispose(); boot.dispose?.();
  });
  it('retains recoverable originals when an installed schema cannot open an authored version', async () => {
    const boot = await openStudioRepository({dbName: `initial-schema-version-${sequence}`, mintId});
    if (!boot.ok) throw new Error('Repository unavailable');
    const original = createStudioComposition().createSession({repository: boot.repository, mintId, actor});
    const document: Document = {schema: 'studio-model/1', id: mintId(), title: 'Opaque extension', elements: [], connections: [], relations: [], schemas: [], fixtures: [], refinements: [], scenarios: [], views: [],
      extensions: {'example/data': {version: '2.0.0', data: {unknown: [1, null, 'preserved']}}}};
    await original.createProject({title: document.title, initialDocument: document});
    const saved = original.getState(); original.dispose();
    const configured = createStudioComposition({extensions: [{manifest: {id: 'example/schema', version: '1.0.0', dependencies: [], capabilities: ['schemas']},
      contributions: [{id: 'example/data', version: '1.0.0', kind: 'schema', capabilities: ['validation'], value: () => []}]}]})
      .createSession({repository: boot.repository, mintId, actor});
    expect(await configured.openProject(saved.projectId!, saved.branchId!)).toMatchObject({status: 'invalid', issues: [{code: 'extension/incompatible-version'}]});
    expect(configured.getState().document).toBeNull();
    const snapshot = await boot.repository.loadSnapshot(saved.projectId!, saved.workingSnapshotId!);
    expect(snapshot?.document.extensions).toEqual(document.extensions);
    configured.dispose(); boot.dispose?.();
  });
  it('retains registered resources across adoption and fences late loads after one teardown', async () => {
    const boot = await openStudioRepository({dbName: `custom-lifetime-${sequence}`, mintId});
    if (!boot.ok) throw new Error('Repository unavailable');
    const cleanup = vi.fn();
    const session = createStudioComposition({extensions: [{...extensions[0], dispose: cleanup}]}).createSession({repository: boot.repository, mintId, actor});
    const document: Document = {schema: 'studio-model/1', id: mintId(), title: 'Lifetime', elements: [], connections: [], relations: [], schemas: [], fixtures: [], refinements: [], scenarios: [], views: []};
    expect((await session.createProject({title: document.title, initialDocument: document})).status).toBe('applied');
    expect((await session.renameProject('Renamed lifetime')).status).toBe('applied');
    expect((await session.createBranch('Lifetime branch', 'working')).status).toBe('applied');
    const state = session.getState();
    expect((await session.openProject(state.projectId!, state.branchId!)).status).toBe('ready');
    expect(cleanup).not.toHaveBeenCalled();
    const project = await boot.repository.loadProject(state.projectId!);
    let finish!: (value: typeof project) => void;
    vi.spyOn(boot.repository, 'loadProject').mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
    const observer = vi.fn(); session.subscribe(observer);
    const pending = session.openProject(state.projectId!, state.branchId!);
    session.dispose();
    const notifications = observer.mock.calls.length;
    finish(project); await pending;
    expect(session.getState().document).toBeNull();
    expect(observer).toHaveBeenCalledTimes(notifications);
    expect(await session.apply([], 'After teardown')).toMatchObject({status: 'failed', code: 'unavailable'});
    session.dispose(); expect(cleanup).toHaveBeenCalledOnce();
    boot.dispose?.();
  });
  it('validates, persists, undoes and reloads custom content while preserving unavailable extension records', async () => {
    const boot = await openStudioRepository({dbName: `custom-components-${sequence}`, mintId});
    if (!boot.ok) throw new Error('Repository unavailable');
    const composition = createStudioComposition({extensions});
    const session = composition.createSession({repository: boot.repository, mintId, actor});
    const document: Document = {schema: 'studio-model/1', id: mintId(), title: 'Custom host', elements: [], connections: [], relations: [], schemas: [], fixtures: [], refinements: [], scenarios: [], views: [],
      extensions: {'unavailable/provider': {version: '9.0.0', data: {nested: [null, 'preserved', 42]}}}};
    await session.createProject({title: document.title, initialDocument: document});
    const before = session.getState();
    const input = {viewId: before.document!.views[0].id, elementId: mintId(), placementId: mintId(), label: 'Custom card',
      position: {x: 24, y: 48}, component: {type: 'example/card', data: {text: 'Host-defined content'}, extensions: {'unavailable/component': {version: '2.0.0', data: {retained: true}}}}};
    const plan = planCustomComponent(before.document!, input);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error('Planning failed');
    expect((await session.apply(plan.changes, 'Place custom card')).status).toBe('applied');
    const placed = session.getState();
    expect(placed.document!.elements[0].component).toEqual(input.component);
    expect(projectSystemDesignDocument(placed.document!).entities[0]).toMatchObject({type: 'example/card', data: {text: 'Host-defined content'}});
    expect(session.undoStack).toHaveLength(1);
    expect((await session.undo()).status).toBe('applied');
    expect(session.getState().document!.elements).toHaveLength(0);
    expect((await session.redo()).status).toBe('applied');
    expect((await session.openProject(placed.projectId!, placed.branchId!)).status).toBe('ready');
    expect(session.getState().document!.elements[0].component).toEqual(input.component);
    expect(session.getState().document!.extensions).toEqual(document.extensions);
    const invalid = {...session.getState().document!.elements[0], component: {...input.component, data: {text: 5}}};
    expect(await session.apply([{kind: 'replace', value: {recordKind: 'element', record: invalid}}], 'Invalid card')).toMatchObject({status: 'invalid'});
    expect(session.getState().document!.elements[0].component).toEqual(input.component);
  });
});
