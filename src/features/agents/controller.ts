import { ProposalController, boundAgentContext, type AgentActor, type AgentIssue, type ModelProvider,
  type Proposal, type ProposalRequest, type ComponentSchema } from '@canvas-one/agents';
import { pairBrowserBridge, type BridgeConnection } from '@canvas-one/agent-bridge/browser';
import type { BridgeParticipant, BridgeRequest } from '@canvas-one/agent-bridge';
import { validateDocument, type Document, type RecordChange } from '@canvas-one/system-design';
import type { SessionController } from '../session/controller';
import { CATALOG_ENTRIES } from '../catalog/catalog';
import { diagramRequestSchema, planSystemDesignDiagram, type DiagramRequest } from '@canvas-one/system-design/authoring/diagram';
import { CANVAS_ELEMENT_KINDS } from '../../domain/studio/model';

/** Visual objects are nested view records, not executable catalog components. */
export const canvasElementSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'kind', 'x', 'y', 'width', 'height', 'text', 'fill', 'stroke', 'strokeWidth', 'fontSize'],
  properties: {
    id: { type: 'string', format: 'uuid' }, kind: { type: 'string', enum: CANVAS_ELEMENT_KINDS },
    x: { type: 'number', minimum: -1000000, maximum: 1000000 }, y: { type: 'number', minimum: -1000000, maximum: 1000000 },
    width: { type: 'number', minimum: 32, maximum: 2000 }, height: { type: 'number', minimum: 24, maximum: 2000 },
    text: { type: 'string', maxLength: 4000 },
    fill: { type: 'string', pattern: '^(#[0-9a-fA-F]{6}|transparent)$' }, stroke: { type: 'string', pattern: '^(#[0-9a-fA-F]{6}|transparent)$' },
    strokeWidth: { type: 'number', minimum: 0, maximum: 12 }, fontSize: { type: 'number', minimum: 8, maximum: 96 },
  },
} as const;

export type AgentSessionState = {
  readonly status: 'disconnected' | 'pairing' | 'connected' | 'reconnecting';
  readonly participant: BridgeParticipant | null;
  readonly proposals: readonly Proposal<RecordChange>[];
  readonly error: string | null;
};
export type AgentSelection = { readonly ids: readonly string[]; readonly viewId?: string | null };

/** App composition binding; authored state and transaction authority remain in SessionController. */
export class SystemAgentSession {
  readonly proposals: ProposalController<Document, RecordChange>;
  private connection: BridgeConnection | null = null;
  private generation = 0;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private state: AgentSessionState = { status: 'disconnected', participant: null, proposals: [], error: null };

  constructor(private readonly session: SessionController, private readonly selection: () => AgentSelection = () => ({ ids: [] })) {
    this.proposals = new ProposalController({
      getSnapshot: () => {
        const state = session.getState();
        return state.document && state.projectId && state.branchId && state.workingRevision !== null
          ? { document: state.document, scope: { projectId: state.projectId, branchId: state.branchId }, revision: state.workingRevision }
          : null;
      },
      validate: (_document, changes) => {
        const result = session.previewChanges(changes);
        return result.ok ? [] : result.issues;
      },
      canReview: (actor) => actor.kind === 'human' && actor.actorId === session.getActor().actorId,
      preparePreview: (_document, changes) => session.previewChanges(changes),
      apply: async (request) => {
        const result = await session.applyReviewedProposal(request, request.acceptedBy);
        if (result.status === 'applied') return { status: 'applied', receipt: result };
        const issues: readonly AgentIssue[] = 'issues' in result ? result.issues
          : [{ code: result.status, message: result.status === 'stale' ? 'Board revision changed; regenerate the proposal' : 'Session could not apply this proposal', path: [] }];
        return { status: result.status === 'stale' ? 'stale' : result.status === 'invalid' ? 'invalid' : 'failed', issues };
      },
    }, { maxProposals: 200 });
    this.unsubscribe = this.proposals.subscribe(() => this.update({ proposals: this.proposals.list() }));
  }

  getState = (): AgentSessionState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  get reviewer(): AgentActor {
    const actor = this.session.getActor();
    return { ...actor, kind: 'human' };
  }

  async pair(url: string, code: string): Promise<void> {
    if (this.disposed) return;
    this.disconnect();
    const generation = ++this.generation;
    this.update({ status: 'pairing', error: null });
    try {
      const connection = await pairBrowserBridge({ url, code,
        handle: (request, participant) => {
          if (this.disposed || generation !== this.generation) throw new Error('Agent pairing is no longer active');
          return this.handleTool(request, participant);
        },
        onStatus: (status) => { if (!this.disposed && generation === this.generation) this.update({ status }); },
      });
      if (this.disposed || generation !== this.generation) { connection.dispose(); return; }
      this.connection = connection;
      this.update({ participant: connection.participant, status: 'connected' });
    } catch {
      if (!this.disposed && generation === this.generation) this.update({ status: 'disconnected', participant: null,
        error: 'Could not pair. Check the bridge address, short-lived code and allowed browser origin.' });
    }
  }

  disconnect(): void {
    this.generation++;
    this.connection?.dispose(); this.connection = null;
    this.update({ status: 'disconnected', participant: null });
  }

  /** Paired bridge supplies attribution; request input can never choose its actor. */
  /** Trusted task host supplies attribution after checking durable attempt authority. */
  executeReviewedTool(request: BridgeRequest, participant: BridgeParticipant): unknown { return this.handleTool(request, participant); }

  private handleTool(request: BridgeRequest, participant: BridgeParticipant): unknown {
    const input = request.input && typeof request.input === 'object' && !Array.isArray(request.input)
      ? request.input as Record<string, unknown> : {};
    switch (request.tool) {
      case 'clarification_request': throw new Error('Task-bound clarification requires the conversation service');
      case 'board_inspect': return this.context(input.selectionOnly === true);
      case 'component_schemas': return { schemas: this.schemas(), format: 'studio-model/1',
        diagramSchema: diagramRequestSchema, canvasElementSchema, canvasElementLimit: 200,
        operations: ['insert', 'replace', 'remove'], guidance: 'Use diagram_create with readable component aliases and optional positions for executable component layout. Visual-only shapes and standalone text live in View.canvasElements (optional array, maximum 200); use canvasElementSchema and replace the COMPLETE containing view through proposal_submit (Suggest) or action_submit (explicit Live grant). Preserve every other view field and visual object. Use UUID ids for new objects. Object-scoped requests may update/delete only captured existing objects in the same view; creation requires Whole board and a new request. Validate the resulting document before submitting.' };
      case 'diagram_create': {
        const state = this.session.getState();
        if (!state.document) throw new Error('Open a project before creating a diagram');
        const { diagram, changes: _changes, actor: _actor, ...identity } = input;
        const submitted = this.proposals.submitPlanned({ ...identity, input: diagram, actor: participant } as Omit<ProposalRequest<RecordChange>, 'changes'> & {input: unknown}, () => {
          const planned = planSystemDesignDiagram(state.document!, diagram as DiagramRequest, () => crypto.randomUUID(), {customComponentTypes: this.session.discoverComponents().filter(component => component.schema !== null).map(component => component.type)});
          return planned.ok ? { ok: true, changes: planned.changes, metadata: { elementIds: planned.elementIds, placementIds: planned.placementIds, annotationIds: planned.annotationIds, assumptions: planned.assumptions } } : planned;
        });
        return { ...submitted, ...submitted.metadata };
      }
      case 'document_validate': return validateDocument(input.document);
      case 'proposal_submit': return this.proposals.submit({ ...input, actor: participant } as ProposalRequest<RecordChange>);
      case 'proposal_status': return typeof input.operationId === 'string' ? this.proposals.inspect(input.operationId) : null;
      case 'action_submit': throw new Error('Task-bound live actions require the conversation service; this connection supports reviewed proposals only');
    }
  }

  context(selectionOnly = false, startingSelection?: AgentSelection) {
    const state = this.session.getState();
    if (!state.document || !state.projectId || !state.branchId || state.workingRevision === null) throw new Error('Open a project before inspecting its board');
    const selected = startingSelection ?? this.selection();
    const ids = new Set(selected.ids);
    const document = state.document;
    const collections = ['elements', 'connections', 'relations', 'schemas', 'fixtures', 'refinements', 'scenarios', 'views'] as const;
    const containingViews = new Set(document.views.filter(view => view.id === selected.viewId ||
      [...view.notes, ...view.groups, ...(view.canvasElements ?? [])].some(record => ids.has(record.id))).map(view => view.id));
    const records = collections.flatMap((type) => document[type].filter((record) => !selectionOnly || ids.has(record.id) ||
      (type === 'views' && containingViews.has(record.id))).map((record) => ({ id: record.id, type, data: record })));
    return { format: document.schema, documentId: document.id, title: document.title,
      selection: selected, ...boundAgentContext({ scope: { projectId: state.projectId, branchId: state.branchId }, revision: state.workingRevision,
        records, assetReferences: [] }) };
  }

  schemas(): readonly ComponentSchema[] {
    return [...CATALOG_ENTRIES.map((entry) => ({ type: `system-design/${entry.entryId}`, version: '1',
      schema: { title: entry.label, description: 'System-design element. Catalog metadata provides compatible ports and default behavior.',
        type: 'object', required: ['id', 'label', 'description', 'visualKind', 'behavior', 'ports'],
        properties: { id: { type: 'string', format: 'uuid' }, label: { type: 'string' }, description: { type: 'string' },
          visualKind: { const: entry.visualKind }, behavior: { type: 'object' }, ports: { type: 'array' } },
        catalog: entry } })), ...this.session.discoverComponents()];
  }

  /** Optional trusted host model adapter; credentials stay in the provider implementation. */
  async proposeWithModel(provider: ModelProvider, instruction: string): Promise<void> {
    const context = this.context();
    const output = await provider.generateProposal({ instruction, context, schemas: this.schemas() });
    if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('Model must return a proposal object');
    const request = output as Record<string, unknown>;
    const result = this.proposals.submit({ ...request, scope: context.scope, expectedRevision: context.revision,
      actor: { actorId: `model:${provider.id}`, displayName: provider.id, kind: 'agent' } } as ProposalRequest<RecordChange>);
    if (!result.ok) throw new Error(result.issues.map(({ message }) => message).join('; '));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disconnect(); this.disposed = true;
    this.unsubscribe(); this.proposals.dispose(); this.listeners.clear();
  }
  private update(update: Partial<AgentSessionState>): void {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }
}
