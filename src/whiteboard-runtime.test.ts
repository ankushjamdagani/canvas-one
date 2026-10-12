import { describe, expect, it, vi } from 'vitest';
import {
  applyBoardRecordChanges, createBoardRuntime, createComponentRendererRegistry,
  createExtensionRegistry, createExtensionHost, createIssue, createTestEditorAdapter, isExtensionVersionCompatible,
  lookupBoardRecord, validateBoardDocument,
  planBoardMoves, planBoardConnector,
  type AtomicCommitResult, type BoardDocument, type BoardRecordMap, type BoardTransaction,
  type DocumentValidationResult, type EditorProjection, type ExtensionDefinition, type ExtensionSchemaValidator,
} from '@canvas-one/whiteboard';

const document = (): BoardDocument => ({
  format: 'canvas-one/board', version: 1, id: 'architecture', title: 'Architecture',
  pages: [{ id: 'overview', name: 'Overview', extensions: {} }],
  entities: [{ id: 'service', type: 'example/service', data: { title: 'Service' }, extensions: {} }],
  placements: [{ id: 'service-box', pageId: 'overview', entityId: 'service', bounds: { x: 10, y: 20, width: 100, height: 50 }, extensions: {} }],
  connectors: [], assets: [], extensions: { 'unavailable/custom': { version: '3.2.1', data: { untouched: [1, 'two', { three: true }] } } },
});
const scope = { projectId: 'project', branchId: 'draft' };
const request = (revision = 0): BoardTransaction<BoardRecordMap> => ({
  operationId: `operation-${revision}`, scope, expectedRevision: revision,
  actor: { actorId: 'author', kind: 'local-human', displayName: 'Author' },
  changes: [{ kind: 'replace', value: { recordKind: 'placement', record: { ...document().placements[0], bounds: { x: 40, y: 60, width: 100, height: 50 } } } }],
});
const makeRuntime = (extra: Partial<Parameters<typeof createBoardRuntime<BoardDocument, BoardRecordMap>>[0]> = {}) => createBoardRuntime<BoardDocument, BoardRecordMap>({ document: document(), scope, validate: validateBoardDocument, apply: applyBoardRecordChanges, lookup: lookupBoardRecord, ...extra });

describe('headless whiteboard authoring authority', () => {
  it('cleans contributed resources when initial validation throws and rejects registration after disposal', () => {
    const cleanup = vi.fn();
    const definition: ExtensionDefinition = {manifest: {id: 'example/resources', version: '1.0.0', dependencies: [], capabilities: []}, contributions: [], dispose: cleanup};
    expect(() => makeRuntime({extensions: [definition], validate: () => {throw new Error('Initial validator failed');}})).toThrow('Initial validator failed');
    expect(cleanup).toHaveBeenCalledOnce();
    const runtime = makeRuntime(); runtime.dispose();
    expect(runtime.extensions.register(definition)).toMatchObject({ok: false, code: 'host-unavailable'});
  });
  it('runs registered component validation in the authoring path and rejects validator exceptions', async () => {
    const runtime = makeRuntime();
    const registration = runtime.extensions.register({manifest: {id: 'example/components', version: '1.0.0', dependencies: [], capabilities: ['validation']}, contributions: [{id: 'example/service', version: '1.0.0', kind: 'component', capabilities: ['validation'], value: {validate: () => {throw new Error('Broken custom validator');}}}]});
    expect(registration.ok).toBe(true);
    expect(await runtime.dispatch(request())).toMatchObject({status: 'invalid', issues: [{code: 'extension/validation-failed'}]});
    expect(runtime.getSnapshot().revision).toBe(0);
    if (registration.ok) registration.unregister();
    expect(await runtime.dispatch(request())).toMatchObject({status: 'applied'});
    runtime.dispose();
    expect(runtime.extensions.list()).toEqual([]);
  });
  it('validates readable identifiers and preserves unknown namespaced extension JSON losslessly', () => {
    const input = document(); const loaded = validateBoardDocument(JSON.parse(JSON.stringify(input)));
    expect(loaded).toEqual({ ok: true, document: input });
    const changed = applyBoardRecordChanges(input, request().changes);
    expect(changed.ok && changed.document.extensions).toEqual(input.extensions);
    expect(input.placements[0].bounds.x).toBe(10);
  });
  it('rejects malformed geometry, JSON and cross-page endpoints with actionable paths', () => {
    const input = document();
    const invalid = validateBoardDocument({ ...input, placements: [{ ...input.placements[0], bounds: { x: 0, y: 0, width: -1, height: 1 } }], connectors: [{ id: 'link', pageId: 'other-page', source: { placementId: 'service-box' }, target: { placementId: 'missing' }, extensions: {} }] });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['invalid-geometry', 'dangling-reference', 'cross-page-reference']));
    expect(validateBoardDocument({ ...input, entities: [{ ...input.entities[0], data: () => {} }] }).ok).toBe(false);
  });
  it('rejects duplicate record changes and validates references at the atomic batch boundary', () => {
    const input = document();
    expect(applyBoardRecordChanges(input, [...request().changes, ...request().changes])).toMatchObject({ ok: false, issues: [{ code: 'duplicate-change' }] });
    expect(applyBoardRecordChanges(input, [{ kind: 'remove', recordKind: 'entity', id: 'service' }]).ok).toBe(false);
    expect(applyBoardRecordChanges(input, [{ kind: 'remove', recordKind: 'entity', id: 'service' }, { kind: 'remove', recordKind: 'placement', id: 'service-box' }]).ok).toBe(true);
  });
  it('plans neutral moves and connectors with page/identity/geometry validation', () => {
    expect(planBoardMoves(document(), 'overview', [{ id: 'service-box', position: { x: 40, y: 60 } }])).toMatchObject({ ok: true, changes: [{ kind: 'replace', value: { recordKind: 'placement', record: { bounds: { x: 40, y: 60 } } } }] });
    expect(planBoardMoves(document(), 'other-page', [{ id: 'service-box', position: { x: 40, y: 60 } }]).ok).toBe(false);
    expect(planBoardMoves(document(), 'overview', [{ id: 'service-box', position: { x: NaN, y: 60 } }]).ok).toBe(false);
    expect(planBoardConnector(document(), 'overview', 'self', { placementId: 'service-box' }, { placementId: 'service-box' }).ok).toBe(true);
    expect(planBoardConnector(document(), 'overview', 'missing', { placementId: 'missing' }, { placementId: 'service-box' }).ok).toBe(false);
  });
  it('publishes stable immutable snapshots and detached forward/inverse transactions', async () => {
    const initial = document(); const onCommitted = vi.fn(); const runtime = makeRuntime({ document: initial, onCommitted });
    const before = runtime.getSnapshot(); expect(runtime.getSnapshot()).toBe(before);
    (initial.extensions['unavailable/custom'] as { data: unknown }).data = null;
    expect(runtime.getSnapshot().document.extensions['unavailable/custom'].data).not.toBeNull();
    const listener = vi.fn(); const unsubscribe = runtime.subscribe(listener);
    expect(await runtime.dispatch(request())).toMatchObject({ status: 'applied', revision: 1 });
    expect(runtime.getSnapshot().document.placements[0].bounds.x).toBe(40);
    expect(Object.isFrozen(runtime.getSnapshot().document.placements[0].bounds)).toBe(true);
    expect(onCommitted.mock.calls[0][0].inverseChanges[0].value.record.bounds.x).toBe(10);
    expect(onCommitted.mock.calls[0][0].request.actor.actorId).toBe('author');
    expect(listener).toHaveBeenCalledTimes(2); unsubscribe();
  });
  it('keeps a failed atomic commit out of authored state and post-commit observations', async () => {
    const onCommitted = vi.fn(); const runtime = makeRuntime({ commit: async () => ({ status: 'failed', error: 'quota' }), onCommitted });
    const result = await runtime.dispatch(request());
    expect(result).toMatchObject({ status: 'failed', needsReload: false });
    expect(runtime.getSnapshot()).toMatchObject({ revision: 0, busy: false });
    expect(runtime.getSnapshot().document.placements[0].bounds.x).toBe(10);
    expect(onCommitted).not.toHaveBeenCalled();
  });
  it('serializes in-flight writes and fences disposed instances from late completion', async () => {
    let finish!: (value: AtomicCommitResult<BoardDocument>) => void;
    const runtime = makeRuntime({ commit: () => new Promise((resolve) => { finish = resolve; }) });
    const listener = vi.fn(); runtime.subscribe(listener);
    const first = runtime.dispatch(request());
    expect(await runtime.dispatch({ ...request(), operationId: 'another' })).toEqual({ status: 'busy' });
    runtime.dispose(); const applied = applyBoardRecordChanges(document(), request().changes); if (!applied.ok) throw new Error('apply'); finish({ status: 'applied', document: applied.document, revision: 1 });
    expect(await first).toMatchObject({ status: 'applied', revision: 1 });
    expect(runtime.getSnapshot()).toMatchObject({ disposed: true, revision: 0 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(await runtime.dispatch(request())).toEqual({ status: 'disposed' });
  });
  it('checks scopes and stale revisions, replays identical receipts and rejects reused identities', async () => {
    const commit = vi.fn(async (prepared) => ({ status: 'applied' as const, document: prepared.document, revision: 1 }));
    const runtime = makeRuntime({ commit });
    expect(await runtime.dispatch({ ...request(), scope: { ...scope, branchId: 'other' } })).toMatchObject({ status: 'invalid' });
    expect(await runtime.dispatch(request(2))).toEqual({ status: 'stale', actualRevision: 0 });
    const first = await runtime.dispatch(request());
    expect(await runtime.dispatch(request())).toBe(first);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(await runtime.dispatch({ ...request(), label: 'Different request' })).toMatchObject({ status: 'invalid', issues: [{ code: 'operation-conflict' }] });
  });
  it('requires reload after storage conflicts and malformed authoritative results', async () => {
    const runtime = makeRuntime({ commit: async () => ({ status: 'stale', actualRevision: 8 }) });
    expect(await runtime.dispatch(request())).toEqual({ status: 'stale', actualRevision: 8 });
    expect(runtime.getSnapshot().needsReload).toBe(true);
    expect(await runtime.dispatch(request())).toMatchObject({ status: 'failed', needsReload: true });
    const malformed = makeRuntime({ commit: async (prepared) => ({ status: 'applied', revision: 19, document: prepared.document }) });
    expect(await malformed.dispatch(request())).toMatchObject({ status: 'failed', needsReload: true });
    expect(malformed.getSnapshot().revision).toBe(0);
  });
  it('isolates observers and provides undo intent without recursively creating undo commands', async () => {
    const error = new Error('observer'); const report = vi.fn(); let inverse: BoardTransaction<BoardRecordMap>['changes'] = [];
    const runtime = makeRuntime({ onObserverError: report, onCommitted: (prepared) => { inverse = prepared.inverseChanges; throw error; } });
    runtime.subscribe(() => { throw error; });
    expect(await runtime.dispatch(request())).toMatchObject({ status: 'applied' });
    expect(await runtime.dispatch({ ...request(1), changes: inverse, intent: 'undo', historyEntryId: 'entry' })).toMatchObject({ status: 'applied', revision: 2 });
    expect(runtime.getSnapshot().document.placements[0].bounds.x).toBe(10);
    expect(report).toHaveBeenCalledWith(error);
  });
  it('fences uncertain thrown writes and rejects divergent authoritative content', async () => {
    const uncertain = makeRuntime({ commit: async () => { throw new Error('Connection lost after write'); } });
    expect(await uncertain.dispatch(request())).toMatchObject({ status: 'failed', needsReload: true });
    expect(uncertain.getSnapshot()).toMatchObject({ revision: 0, needsReload: true });
    const divergent = makeRuntime({ commit: async () => ({ status: 'applied', document: document(), revision: 1 }) });
    expect(await divergent.dispatch(request())).toMatchObject({ status: 'failed', needsReload: true });
  });
});

describe('trusted extension and independent renderer registration', () => {
  const extension = (id: string, dependencies: ExtensionDefinition['manifest']['dependencies'] = []): ExtensionDefinition => ({ manifest: { id, version: '1.2.0', dependencies, capabilities: ['document'] }, contributions: [{ id: `${id}/component`, kind: 'component', version: '1.0.0', capabilities: ['renderable'], value: { schema: { type: 'object' } } }] });
  it('rejects duplicates and missing or incompatible dependencies atomically', () => {
    const registry = createExtensionRegistry();
    expect(registry.register(extension('example/base')).ok).toBe(true);
    expect(registry.register(extension('example/base'))).toMatchObject({ ok: false, code: 'duplicate-extension' });
    expect(registry.register(extension('example/missing', [{ id: 'unavailable/base', version: '1.0.0' }]))).toMatchObject({ ok: false, code: 'missing-dependency' });
    expect(registry.register(extension('example/incompatible', [{ id: 'example/base', version: '^2.0.0' }]))).toMatchObject({ ok: false, code: 'incompatible-version' });
    expect(registry.list()).toHaveLength(1);
    expect(registry.require('unavailable/extension', '1.0.0').supported).toBe(false);
  });
  it('unregisters dependents first, cleans up once and prevents stale cleanup handles removing a replacement', () => {
    const registry = createExtensionRegistry(); const cleanup = vi.fn();
    const base = registry.register({ ...extension('example/base'), dispose: cleanup });
    const dependent = registry.register(extension('example/dependent', [{ id: 'example/base', version: '^1.0.0' }]));
    if (!base.ok || !dependent.ok) throw new Error('registration');
    expect(base.unregister()).toMatchObject({ ok: false, code: 'required-by-extension' });
    expect(dependent.unregister().ok).toBe(true); expect(base.unregister().ok).toBe(true); base.unregister();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(registry.register(extension('example/base')).ok).toBe(true); base.unregister();
    expect(registry.list()).toHaveLength(1);
  });
  it('implements bounded caret compatibility including zero-major versions', () => {
    expect(isExtensionVersionCompatible('1.2.3', '^1.0.0')).toBe(true);
    expect(isExtensionVersionCompatible('0.2.4', '^0.2.1')).toBe(true);
    expect(isExtensionVersionCompatible('0.3.0', '^0.2.1')).toBe(false);
    expect(isExtensionVersionCompatible('0.0.2', '^0.0.1')).toBe(false);
    expect(isExtensionVersionCompatible('1.0.0', '*')).toBe(false);
  });
  it('preserves component data when an adapter renderer is missing and allows independently registered UI', () => {
    const registry = createComponentRendererRegistry<() => string>(); const render = () => 'Custom UI';
    expect(registry.resolve('example/editor', 'example/custom')).toEqual({ status: 'placeholder', label: 'Missing renderer: example/custom' });
    const unregister = registry.register('example/editor', 'example/custom', render);
    expect(registry.resolve('example/editor', 'example/custom')).toEqual({ status: 'ready', renderer: render });
    expect(() => registry.register('example/editor', 'example/custom', render)).toThrow('Duplicate renderer');
    unregister(); unregister(); expect(registry.resolve('example/editor', 'example/custom').status).toBe('placeholder');
  });
});

describe('extension host lifecycle and dispatch', () => {
  const schemaExtension = (schemaId: string, validator: ExtensionSchemaValidator, dispose?: () => void): ExtensionDefinition => ({
    manifest: { id: `example/${schemaId}`, version: '1.0.0', dependencies: [], capabilities: ['schema'] },
    contributions: [{ id: `example/${schemaId}`, kind: 'schema', version: '1.0.0', capabilities: [], value: validator, dispose }],
  });
  const commandExtension = (id: string, handler: (input: unknown) => Promise<{ ok: true; output: unknown } | { ok: false; code: string; message: string }>, dispose?: () => void): ExtensionDefinition => ({
    manifest: { id: `example/${id}`, version: '1.0.0', dependencies: [], capabilities: ['command'] },
    contributions: [{ id: `example/${id}/cmd`, kind: 'command', version: '1.0.0', capabilities: [], value: handler, dispose }],
  });
  const toolExtension = (id: string, handler: (input: unknown) => Promise<{ ok: true; output: unknown } | { ok: false; code: string; message: string }>, dispose?: () => void): ExtensionDefinition => ({
    manifest: { id: `example/${id}`, version: '1.0.0', dependencies: [], capabilities: ['tool'] },
    contributions: [{ id: `example/${id}/tool`, kind: 'tool', version: '1.0.0', capabilities: [], value: handler, dispose }],
  });

  it('validates extension records via registered schema, preserves unknown, rejects when validator issues', () => {
    const host = createExtensionHost();
    const validator = vi.fn(((data, path) =>
      typeof data === 'string' ? [] : [createIssue('bad-type', 'expected string', path)]) satisfies ExtensionSchemaValidator);

    const reg = host.register(schemaExtension('str-schema', validator));
    expect(reg.ok).toBe(true);

    // Valid data - no issues
    expect(host.validateExtensionRecords({ 'example/str-schema': { version: '1.0.0', data: 'hello' } }, ['extensions'])).toHaveLength(0);

    // Invalid data - schema issues propagate
    const issues = host.validateExtensionRecords({ 'example/str-schema': { version: '1.0.0', data: 42 } }, ['extensions']);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('bad-type');

    // Unknown extension (no schema registered) - preserved without issues
    expect(host.validateExtensionRecords({ 'other/unknown': { version: '3', data: { anything: true } } }, ['extensions'])).toHaveLength(0);

    // Mixed: known invalid + unknown preserved = only known issue
    const mixed = host.validateExtensionRecords(
      { 'example/str-schema': { version: '1.0.0', data: 99 }, 'unregistered/ext': { version: '1', data: null } },
      ['extensions'],
    );
    expect(mixed).toHaveLength(1);
    expect(validator).toHaveBeenCalledTimes(3);
    const future = {'example/str-schema': {version: '2.0.0', data: {opaque: 'retain'}}};
    expect(host.validateExtensionRecords(future, ['extensions'])).toMatchObject([{code: 'extension/incompatible-version', path: ['extensions', 'example/str-schema', 'version']}]);
    expect(validator).toHaveBeenCalledTimes(3);
    expect(future['example/str-schema'].data).toEqual({opaque: 'retain'});
  });

  it('registered schema contribution affects authored board validation via composed validator', async () => {
    const host = createExtensionHost();
    let reject = false;
    host.register(schemaExtension('board-schema', (_data, path) =>
      reject ? [createIssue('schema-rejected', 'rejected by schema', path)] : []));

    const composedValidate = (input: unknown): DocumentValidationResult<BoardDocument> => {
      const base = validateBoardDocument(input);
      if (!base.ok) return base;
      const issues = host.validateExtensionRecords(base.document.extensions, ['extensions']);
      return issues.length ? { ok: false, issues } : base;
    };

    const doc = (): BoardDocument => ({ ...document(), extensions: { 'example/board-schema': { version: '1.0.0', data: { value: 1 } } } });

    // Construct with reject=false so initial validate passes
    const runtime = createBoardRuntime<BoardDocument, BoardRecordMap>({
      document: doc(), scope, validate: composedValidate, apply: applyBoardRecordChanges, lookup: lookupBoardRecord,
    });

    // reject=false: dispatch succeeds
    expect(await runtime.dispatch(request())).toMatchObject({ status: 'applied' });

    // reject=true: post-apply validate now rejects via the extension schema, failing authoring
    reject = true;
    expect(await runtime.dispatch(request(1))).toMatchObject({ status: 'invalid', issues: [{ code: 'schema-rejected' }] });
  });

  it('dispatches registered command and tool, fails explicitly for missing, cleans up on unregister', async () => {
    const host = createExtensionHost();
    const commandCleanup = vi.fn();
    const toolCleanup = vi.fn();
    const commandHandler = vi.fn(async (input: unknown) => ({ ok: true as const, output: { echo: input } }));
    const toolHandler = vi.fn(async (input: unknown) => ({ ok: true as const, output: { result: input } }));

    const cmdReg = host.register(commandExtension('runner', commandHandler, commandCleanup));
    const toolReg = host.register(toolExtension('tooler', toolHandler, toolCleanup));
    if (!cmdReg.ok || !toolReg.ok) throw new Error('registration failed');

    // Command callable
    const cmdResult = await host.dispatchCommand('example/runner/cmd', { x: 1 });
    expect(cmdResult).toMatchObject({ ok: true, output: { echo: { x: 1 } } });

    // Tool callable
    const toolResult = await host.callTool('example/tooler/tool', 'ping');
    expect(toolResult).toMatchObject({ ok: true, output: { result: 'ping' } });

    // Explicit failure for unregistered
    expect(await host.dispatchCommand('example/missing', {})).toMatchObject({ ok: false, code: 'missing-contribution' });
    expect(await host.callTool('example/missing', {})).toMatchObject({ ok: false, code: 'missing-contribution' });

    // Cleanup runs on unregister; after cleanup the contribution is gone
    cmdReg.unregister();
    expect(commandCleanup).toHaveBeenCalledTimes(1);
    expect(await host.dispatchCommand('example/runner/cmd', {})).toMatchObject({ ok: false, code: 'missing-contribution' });

    // Dispose cleans up remaining
    const errors = host.dispose();
    expect(errors).toHaveLength(0);
    expect(toolCleanup).toHaveBeenCalledTimes(1);
  });

  it('execution provider retrieved when registered, undefined when missing, disposed with host', () => {
    const host = createExtensionHost();
    expect(host.getExecutionProvider('example/ep/provider')).toBeUndefined();

    const execute = vi.fn(async () => ({ ok: true as const, output: 'run' }));
    const cleanup = vi.fn();
    const reg = host.register({
      manifest: { id: 'example/ep', version: '1.0.0', dependencies: [], capabilities: [] },
      contributions: [{ id: 'example/ep/provider', kind: 'execution-provider', version: '1.0.0', capabilities: [], value: { execute }, dispose: cleanup }],
    });
    if (!reg.ok) throw new Error('registration');

    const provider = host.getExecutionProvider('example/ep/provider');
    expect(provider).toBeDefined();
    expect(provider!.execute).toBe(execute);

    host.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(host.getExecutionProvider('example/ep/provider')).toBeUndefined();
  });
});

describe('engine-neutral editor conformance', () => {
  const projection: EditorProjection = { pageId: 'overview', objects: [{ id: 'box', entityId: 'service', componentType: 'example/service', bounds: { x: 10, y: 20, width: 100, height: 50 }, data: null, anchors: { out: { x: 110, y: 45 } } }], connectors: [] };
  it('exercises projection, selection, viewport, coordinates, hit testing, bounds and anchors', () => {
    const adapter = createTestEditorAdapter(); const onIntent = vi.fn();
    expect(adapter.project(projection).supported).toBe(false);
    expect(adapter.mount(null, { onIntent }).supported).toBe(true); adapter.project(projection);
    adapter.setSelection(['box', 'box', 'missing']); expect(adapter.getSelection()).toEqual({ supported: true, value: ['box'] });
    adapter.setViewport({ x: 40, y: 80, zoom: 2 });
    expect(adapter.boardToScreen({ x: 10, y: 20 })).toEqual({ supported: true, value: { x: 60, y: 120 } });
    expect(adapter.screenToBoard({ x: 60, y: 120 })).toEqual({ supported: true, value: { x: 10, y: 20 } });
    expect(adapter.hitTest({ x: 20, y: 30 })).toEqual({ supported: true, value: 'box' });
    expect(adapter.getBounds('box')).toEqual({ supported: true, value: projection.objects[0].bounds });
    expect(adapter.getConnectionAnchor({ placementId: 'box', anchorId: 'out' })).toEqual({ supported: true, value: { x: 110, y: 45 } });
    adapter.simulate({ kind: 'move', placements: [{ id: 'box', position: { x: 40, y: 50 } }] }); expect(onIntent).toHaveBeenCalledTimes(1);
    adapter.project({ ...projection, objects: [] }); expect(adapter.getSelection()).toEqual({ supported: true, value: [] });
    adapter.dispose(); expect(adapter.getBounds('box').supported).toBe(false);
  });
  it('reports unsupported capabilities and rotated geometry without inventing success', () => {
    const adapter = createTestEditorAdapter({ unsupportedCapabilities: ['overlays'] }); adapter.mount(null, { onIntent: () => {} });
    adapter.project({ ...projection, objects: [{ ...projection.objects[0], rotation: 90 }] });
    const bounds = adapter.getBounds('box'); if (!bounds.supported || !bounds.value) throw new Error('bounds');
    expect(bounds.value.width).toBeCloseTo(50); expect(bounds.value.height).toBeCloseTo(100);
    expect(adapter.setOverlays([])).toMatchObject({ supported: false });
    expect(adapter.capabilities.overlays.supported).toBe(false);
    expect(adapter.setViewport({ x: 0, y: 0, zoom: 0 }).supported).toBe(false);
  });
});
