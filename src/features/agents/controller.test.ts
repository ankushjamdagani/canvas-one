import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BridgeRequest, BridgeParticipant } from '@canvas-one/agent-bridge';
import type { Document, Element } from '@canvas-one/system-design';
import { CANVAS_ELEMENT_KINDS, type CanvasElement } from '../../domain/studio/model';
import { openStudioRepository, SessionController } from '../session';
import { SystemAgentSession } from './controller';
import { StudioDatabase } from '../../persistence/studio/db';

const bridge = vi.hoisted(() => ({ handle: null as null | ((request: BridgeRequest, participant: BridgeParticipant) => unknown), dispose: vi.fn() }));
vi.mock('@canvas-one/agent-bridge/browser', () => ({ pairBrowserBridge: vi.fn(async (options) => {
  bridge.handle = options.handle;
  return { participant: { kind: 'agent', actorId: 'paired-agent', displayName: 'Local assistant' }, dispose: bridge.dispose };
}) }));

let counter = 100000;
const mintId = () => `00000000-0000-4000-8000-${(++counter).toString(16).padStart(12, '0')}`;
const actor = { actorId: 'reviewer', displayName: 'Reviewer', kind: 'local-human' as const };
const agent: BridgeParticipant = { actorId: 'paired-agent', displayName: 'Local assistant', kind: 'agent' };
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

async function setup(extensions?: readonly import('@canvas-one/whiteboard').ExtensionDefinition[]) {
  const dbName = `agent-binding-${counter}`;
  const boot = await openStudioRepository({ dbName, mintId });
  if (!boot.ok) throw new Error('Repository boot failed');
  const session = new SessionController({ repository: boot.repository, mintId, actor, extensions });
  const document: Document = { schema: 'studio-model/1', id: mintId(), title: 'Agent board',
    elements: [], connections: [], relations: [], schemas: [], fixtures: [], refinements: [], scenarios: [], views: [] };
  await session.createProject({ title: document.title, initialDocument: document });
  const agents = new SystemAgentSession(session);
  cleanups.push(() => agents.dispose());
  const element: Element = { id: mintId(), label: 'Agent explanation', description: '', visualKind: 'host', ports: [],
    behavior: { kind: 'unmodeled', version: 1, reason: 'Diagram annotation' } };
  const state = session.getState();
  const request = { operationId: 'readable-proposal-id', scope: { projectId: state.projectId, branchId: state.branchId },
    expectedRevision: state.workingRevision, label: 'Explain architecture', changes: [{ kind: 'insert', value: { recordKind: 'element', record: element } }] };
  await agents.pair('http://127.0.0.1:4318', 'pairing-code');
  const tool = (tool: BridgeRequest['tool'], input: unknown) => bridge.handle!({ requestId: mintId(), tool, input }, agent);
  return { agents, session, request, tool, element, dbName };
}

describe('system agent app composition', () => {
  it('discovers visual-only shapes and text, inspects selected objects and applies them only after review', async () => {
    const h = await setup();
    const discovered = h.tool('component_schemas', {}) as { canvasElementSchema: { required: string[]; properties: { kind: { enum: readonly string[] } } }; canvasElementLimit: number; guidance: string };
    expect(discovered.canvasElementSchema.properties.kind.enum).toEqual(CANVAS_ELEMENT_KINDS);
    expect(discovered.canvasElementSchema.required).toContain('height');
    expect(discovered.canvasElementLimit).toBe(200);
    expect(discovered.guidance).toContain('View.canvasElements');
    const before = h.session.getState().document!;
    const view = before.views[0];
    const shape: CanvasElement = { id: mintId(), kind: 'diamond', x: 40, y: 80, width: 160, height: 120, text: 'Decision', fill: '#ffffff', stroke: '#171717', strokeWidth: 2, fontSize: 16 };
    const text: CanvasElement = { ...shape, id: mintId(), kind: 'text', x: 240, text: 'Architecture', fill: 'transparent', strokeWidth: 0 };
    const changes = [{ kind: 'replace', value: { recordKind: 'view', record: { ...view, canvasElements: [shape, text] } } }];
    const document = { ...before, views: [{ ...view, canvasElements: [shape, text] }] };
    expect(h.tool('document_validate', { document })).toMatchObject({ ok: true });
    expect(h.tool('proposal_submit', { ...h.request, changes })).toMatchObject({ ok: true, proposal: { status: 'pending' } });
    expect(h.session.getState().document!.views[0].canvasElements).toBeUndefined();
    expect(await h.agents.proposals.accept(h.request.operationId, h.agents.reviewer)).toMatchObject({ ok: true, proposal: { status: 'accepted' } });
    expect(h.session.getState().document!.elements).toHaveLength(0);
    expect(h.session.getState().document!.views[0].canvasElements).toEqual([shape, text]);
    // Supplying only the nested object's ID still discovers its complete containing
    // view so a provider can preserve sibling fields during record replacement.
    expect(h.agents.context(true, { ids: [shape.id] }).records).toEqual([{ id: view.id, type: 'views', data: { ...view, canvasElements: [shape, text] } }]);
    expect(h.session.undoStack).toHaveLength(1);
    expect((await h.session.undo()).status).toBe('applied');
    expect(h.session.getState().document!.views[0].canvasElements).toBeUndefined();
  });
  it('discovers registered schemas and proposes custom components using readable aliases', async () => {
    const h = await setup([{manifest: {id: 'example/cards', version: '1.0.0', dependencies: [], capabilities: ['components', 'schemas']}, contributions: [
      {id: 'example/card', kind: 'schema', version: '1.0.0', capabilities: [], value: {type: 'object', required: ['text'], properties: {text: {type: 'string'}}}},
      {id: 'example/card', kind: 'component', version: '1.0.0', capabilities: [], value: {validate: (entity: {data: {text?: unknown}}) => typeof entity.data.text === 'string' ? [] : [{code: 'example/missing-text', message: 'Card requires text', path: ['data', 'text'], severity: 'error'}]}},
    ]}]);
    const schemas = h.tool('component_schemas', {}) as {schemas: {type: string; schema: unknown}[]};
    expect(schemas.schemas.find(schema => schema.type === 'example/card')?.schema).toMatchObject({required: ['text']});
    expect(h.tool('diagram_create', {...h.request, diagram: {viewId: h.session.getState().document!.views[0].id, components: [{id: 'review-card', type: 'example/card', data: {text: 'Inspect this boundary'}}]}})).toMatchObject({ok: true, proposal: {status: 'pending'}});
    expect(h.session.getState().document!.elements).toHaveLength(0);
    expect(await h.agents.proposals.accept(h.request.operationId, h.agents.reviewer)).toMatchObject({ok: true, proposal: {status: 'accepted'}});
    expect(h.session.getState().document!.elements[0].component).toMatchObject({type: 'example/card', data: {text: 'Inspect this boundary'}});
    expect(h.session.undoStack).toHaveLength(1);
  });
  it('plans readable diagram aliases for review without requiring agents to mint internal records', async () => {
    const h = await setup();
    const schemas = h.tool('component_schemas', {}) as {schemas: {type: string}[]};
    const result = h.tool('diagram_create', {...h.request, diagram: {
      viewId: h.session.getState().document!.views[0].id,
      components: [{id: 'api', type: schemas.schemas[0].type, label: 'Public API'}],
      annotations: [{id: 'explanation', text: 'Review the API boundary', attachedTo: ['api']}],
    }}) as {ok: boolean; elementIds: Record<string, string>};
    expect(result.ok).toBe(true); expect(result.elementIds.api).toBeDefined();
    const retry = h.tool('diagram_create', {...h.request, diagram: {
      components: [{label: 'Public API', type: schemas.schemas[0].type, id: 'api'}],
      annotations: [{text: 'Review the API boundary', attachedTo: ['api'], id: 'explanation'}],
      viewId: h.session.getState().document!.views[0].id,
    }});
    expect(retry).toEqual(result);
    expect(h.tool('diagram_create', {...h.request, diagram: {components: []}})).toMatchObject({ok: false, code: 'operation-id-reused'});
    expect(h.session.getState().document?.elements).toHaveLength(0);
    const preview = h.agents.proposals.preview(h.request.operationId);
    expect(preview.status).toBe('ready');
    if (preview.status === 'ready') expect(preview.document.views[0].notes[0].text).toBe('Review the API boundary');
    const accepted = await h.agents.proposals.accept(h.request.operationId, h.agents.reviewer);
    expect(accepted.ok).toBe(true);
    expect(h.session.getState().document?.elements[0].label).toBe('Public API');
    expect(h.session.getState().document?.views[0].notes[0].text).toBe('Review the API boundary');
    expect(h.session.undoStack).toHaveLength(1);
    await h.session.undo();
    expect(h.session.getState().document?.elements).toHaveLength(0);
    expect(h.session.getState().document?.views[0].notes).toHaveLength(0);
  });
  it('uses paired identity, persists attribution and applies one undoable reviewed transaction', async () => {
    const h = await setup();
    expect(h.tool('proposal_submit', { ...h.request, actor: { ...agent, actorId: 'forged' } })).toMatchObject({ ok: true, proposal: { actor: agent, status: 'pending' } });
    expect(h.session.getState().document?.elements).toHaveLength(0);
    const accepted = await h.agents.proposals.accept(h.request.operationId, h.agents.reviewer);
    expect(accepted).toMatchObject({ ok: true, proposal: { status: 'accepted', receipt: { proposal: { operationId: h.request.operationId, actor: agent } } } });
    if (!accepted.ok) throw new Error('Proposal was not accepted');
    const db = new StudioDatabase(h.dbName);
    await db.open();
    const receipt = accepted.proposal.receipt as { operationId: string };
    expect((await db.operations.get([h.request.scope.projectId!, receipt.operationId]))?.result).toMatchObject({ proposal: { operationId: h.request.operationId, actor: agent } });
    db.close();
    expect(h.session.getState().document?.elements[0]).toEqual(h.element);
    expect(h.session.undoStack).toHaveLength(1);
    expect(h.session.undoStack[0].label).toBe(h.request.label);
    await h.agents.proposals.accept(h.request.operationId, h.agents.reviewer);
    expect(h.session.undoStack).toHaveLength(1);
    expect((await h.session.undo()).status).toBe('applied');
    expect(h.session.getState().document?.elements).toHaveLength(0);
  });

  it('preserves human changes when a review becomes stale and revokes disconnected tool callbacks', async () => {
    const h = await setup(); h.tool('proposal_submit', h.request);
    const view = h.session.getState().document!.views[0];
    await h.session.apply([{ kind: 'replace', value: { recordKind: 'view', record: { ...view, label: 'Human edit' } } }], 'Human edit');
    expect(await h.agents.proposals.accept(h.request.operationId, h.agents.reviewer)).toMatchObject({ ok: true, proposal: { status: 'conflict' } });
    expect(h.session.getState().document?.views[0].label).toBe('Human edit');
    expect(h.session.getState().document?.elements).toHaveLength(0);
    const oldHandle = bridge.handle!; h.agents.disconnect();
    expect(() => oldHandle({ requestId: 'old', tool: 'board_inspect', input: {} }, agent)).toThrow('no longer active');
    expect(bridge.dispose).toHaveBeenCalled();
  });

  it('provides actionable validation and component metadata without editing the board', async () => {
    const h = await setup();
    expect(h.tool('board_inspect', {})).toMatchObject({ scope: h.request.scope, revision: h.request.expectedRevision, format: 'studio-model/1', truncated: false });
    expect(h.tool('component_schemas', {})).toMatchObject({ format: 'studio-model/1' });
    const validation = h.tool('document_validate', { document: { schema: 'unknown' } }) as { ok: boolean; issues: unknown[] };
    expect(validation.ok).toBe(false); expect(validation.issues.length).toBeGreaterThan(0);
    expect(h.session.getState().document?.elements).toHaveLength(0);
  });

  it('conflicts after switching branches and preserves automatic drafting when reviewing main', async () => {
    const h = await setup(); h.tool('proposal_submit', h.request);
    const projectId = h.session.getState().projectId!;
    const mainBranchId = h.session.getState().mainBranchId!;
    expect((await h.session.switchBranch(mainBranchId)).status).toBe('ready');
    expect(await h.agents.proposals.accept(h.request.operationId, h.agents.reviewer)).toMatchObject({ ok: true, proposal: { status: 'conflict' } });
    const onMain = h.session.getState();
    const mainRequest = { ...h.request, operationId: 'main-proposal', scope: { projectId, branchId: mainBranchId }, expectedRevision: onMain.workingRevision };
    expect(h.tool('proposal_submit', mainRequest)).toMatchObject({ ok: true, proposal: { status: 'pending' } });
    expect(await h.agents.proposals.accept('main-proposal', h.agents.reviewer)).toMatchObject({ ok: true, proposal: { status: 'accepted' } });
    expect(h.session.getState().branchId).not.toBe(mainBranchId);
    expect(h.session.getState().document?.elements).toHaveLength(1);
    expect(h.session.undoStack).toHaveLength(1);
  });
});
