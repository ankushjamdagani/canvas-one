import { describe, expect, it, vi } from 'vitest';
import type { Connection, Document, Element } from '../../domain/studio/model';
import type { AuthoredResult, RecordChange } from '../../persistence/studio/types';
import { applyDraft, cancelDraft, changeField, openDraft, validateDraft } from './draft';
import type { DraftSession } from './types';

function processorElement(overrides: Partial<Element> = {}): Element {
  return {
    id: 'el-1',
    label: 'Checkout service',
    description: '',
    visualKind: 'service',
    ports: [],
    behavior: {
      kind: 'resource',
      version: 1,
      entryPortId: 'p1',
      config: {
        type: 'processor',
        capacity: 2000,
        concurrency: 1,
        queueLimit: 0,
        failureRate: 0,
        maxRetries: 0,
        retryDelayMs: 0,
      },
    },
    ...overrides,
  };
}

function callConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'c-1',
    kind: 'call',
    source: { elementId: 'el-1', portId: 'p-out' },
    target: { elementId: 'el-2', portId: 'p-in' },
    config: {
      latencyMs: 10,
      returnLatencyMs: 5,
      weight: 1,
      condition: null,
      fallback: false,
      resource: null,
    },
    ...overrides,
  } as Connection;
}

function makeDocument(elements: Element[], connections: Connection[] = []): Document {
  return {
    schema: 'studio-model/1',
    id: 'doc-1',
    title: 'Doc',
    elements,
    connections,
    relations: [],
    schemas: [],
    fixtures: [],
    refinements: [],
    scenarios: [],
    views: [],
  };
}

function fakeSession(
  document: Document,
  workingRevision: number,
  applyImpl: (changes: readonly RecordChange[], label: string) => Promise<AuthoredResult>,
): DraftSession & { readonly applyMock: ReturnType<typeof vi.fn> } {
  const applyMock = vi.fn(applyImpl);
  return {
    getState: () => ({ workingRevision, document }),
    apply: applyMock,
    applyMock,
  };
}

describe('openDraft', () => {
  it('captures baseValues as raw strings for every field', () => {
    const el = processorElement();
    const doc = makeDocument([el]);
    const handle = openDraft('draft-1', { kind: 'element', ids: [el.id] }, 3, doc);
    expect(handle.status).toBe('clean');
    expect(handle.dirty).toBe(false);
    expect(handle.baseValues['config.capacity']).toBe('2000');
    expect(handle.baseValues.label).toBe('Checkout service');
  });

  it('throws on an empty target (commands.md §5: rejected)', () => {
    const doc = makeDocument([]);
    expect(() => openDraft('draft-1', { kind: 'element', ids: [] }, 1, doc)).toThrow();
  });

  it('marks the draft missing when the target does not exist', () => {
    const doc = makeDocument([]);
    const handle = openDraft('draft-1', { kind: 'element', ids: ['gone'] }, 1, doc);
    expect(handle.missing).toBe(true);
    expect(handle.status).toBe('stale');
  });


});

describe('changeField', () => {
  it('keeps raw strings, including incomplete numbers, without validating', () => {
    const el = processorElement();
    const doc = makeDocument([el]);
    let handle = openDraft('draft-1', { kind: 'element', ids: [el.id] }, 1, doc);
    handle = changeField(handle, 'config.capacity', '20-');
    expect(handle.values['config.capacity']).toBe('20-');
    expect(handle.dirty).toBe(true);
    expect(handle.status).toBe('editing');
    expect(handle.issues['config.capacity']).toBeUndefined();
  });

  it('recomputes dirty=false once a field is edited back to its base value', () => {
    const el = processorElement();
    const doc = makeDocument([el]);
    let handle = openDraft('draft-1', { kind: 'element', ids: [el.id] }, 1, doc);
    handle = changeField(handle, 'label', 'New name');
    expect(handle.dirty).toBe(true);
    handle = changeField(handle, 'label', 'Checkout service');
    expect(handle.dirty).toBe(false);
    expect(handle.status).toBe('clean');
  });
});

describe('validateDraft', () => {
  it('reports per-field issues and the first invalid field id', () => {
    const el = processorElement();
    const doc = makeDocument([el]);
    let handle = openDraft('draft-1', { kind: 'element', ids: [el.id] }, 1, doc);
    handle = changeField(handle, 'config.capacity', '0'); // out of [1,100000]
    handle = changeField(handle, 'label', '');
    const result = validateDraft(handle);
    expect(result.handle.status).toBe('invalid');
    expect(result.handle.issues['config.capacity']).toBeDefined();
    expect(result.handle.issues.label).toBeDefined();
    expect(result.firstInvalidFieldId).toBe('label'); // fields ordered [label, description, ...config]
  });
});

describe('cancelDraft', () => {
  it('restores base values and clears dirty/issues', () => {
    const el = processorElement();
    const doc = makeDocument([el]);
    let handle = openDraft('draft-1', { kind: 'element', ids: [el.id] }, 1, doc);
    handle = changeField(handle, 'label', 'Something else');
    handle = cancelDraft(handle);
    expect(handle.values.label).toBe('Checkout service');
    expect(handle.dirty).toBe(false);
    expect(handle.status).toBe('clean');
  });
});

describe('applyDraft', () => {
  it('submits exactly one changed-fields-only replace, as one session.apply call', async () => {
    const el = processorElement();
    const doc = makeDocument([el]);
    let handle = openDraft('draft-1', { kind: 'element', ids: [el.id] }, 5, doc);
    handle = changeField(handle, 'config.capacity', '3000');

    const session = fakeSession(doc, 5, async (changes) => {
      expect(changes).toHaveLength(1);
      const change = changes[0];
      expect(change.kind).toBe('replace');
      if (change.kind !== 'replace') throw new Error('unreachable');
      const record = change.value.record as Element;
      // Only the changed field differs; everything else is untouched.
      expect(record.behavior.kind === 'resource' && record.behavior.config.capacity).toBe(3000);
      expect(record.label).toBe('Checkout service');
      return {
        status: 'applied',
        operationId: 'op-1',
        projectRevision: 2,
        branchRevision: 6,
        changedIds: [el.id],
        undo: { entryId: 'u1', label: 'Edit Checkout service' },
        value: { kind: 'none' },
      };
    });

    const result = await applyDraft(handle, session);
    expect(session.applyMock).toHaveBeenCalledTimes(1);
    expect(result.handle.status).toBe('clean');
    expect(result.handle.dirty).toBe(false);
    expect(result.handle.baseValues['config.capacity']).toBe('3000');
  });

  it('keeps the draft on invalid Apply and focuses the first invalid field', async () => {
    const el = processorElement();
    const doc = makeDocument([el]);
    let handle = openDraft('draft-1', { kind: 'element', ids: [el.id] }, 5, doc);
    handle = changeField(handle, 'config.capacity', '999999'); // out of range

    const session = fakeSession(doc, 5, async () => {
      throw new Error('should not be called: client-side validation must gate this');
    });

    const result = await applyDraft(handle, session);
    expect(result.handle.status).toBe('invalid');
    expect(result.firstInvalidFieldId).toBe('config.capacity');
    expect(result.handle.values['config.capacity']).toBe('999999'); // text kept
  });

  it('is stale when the session working revision moved under the draft', async () => {
    const el = processorElement();
    const doc = makeDocument([el]);
    let handle = openDraft('draft-1', { kind: 'element', ids: [el.id] }, 5, doc);
    handle = changeField(handle, 'label', 'Renamed');

    const session = fakeSession(doc, 6 /* moved on */, async () => {
      throw new Error('should not submit a stale draft');
    });

    const result = await applyDraft(handle, session);
    expect(result.handle.status).toBe('stale');
    expect(result.handle.values.label).toBe('Renamed'); // text kept, never silently rebased
  });

  it('is stale/missing when the target was deleted elsewhere', async () => {
    const el = processorElement();
    const doc = makeDocument([el]);
    let handle = openDraft('draft-1', { kind: 'element', ids: [el.id] }, 5, doc);
    handle = changeField(handle, 'label', 'Renamed');

    const docWithoutTarget = makeDocument([]); // deleted
    const session = fakeSession(docWithoutTarget, 5, async () => {
      throw new Error('should not submit for a missing target');
    });

    const result = await applyDraft(handle, session);
    expect(result.handle.status).toBe('stale');
    expect(result.handle.missing).toBe(true);
    expect(result.handle.values.label).toBe('Renamed');
  });

  it('a clean (non-dirty) Apply submits nothing', async () => {
    const el = processorElement();
    const doc = makeDocument([el]);
    const handle = openDraft('draft-1', { kind: 'element', ids: [el.id] }, 5, doc);
    const session = fakeSession(doc, 5, async () => {
      throw new Error('must not submit when nothing changed');
    });
    const result = await applyDraft(handle, session);
    expect(session.applyMock).not.toHaveBeenCalled();
    expect(result.handle.status).toBe('clean');
  });

  it('throws if the session reports a null workingRevision right after an applied edit (contract violation)', async () => {
    const el = processorElement();
    const doc = makeDocument([el]);
    let handle = openDraft('draft-1', { kind: 'element', ids: [el.id] }, 5, doc);
    handle = changeField(handle, 'label', 'Renamed');

    let getStateCalls = 0;
    const session: DraftSession = {
      getState: () => {
        getStateCalls += 1;
        // First call (staleness check) sees revision 5; the post-apply call
        // that should observe the new revision instead reports null.
        return { workingRevision: getStateCalls === 1 ? 5 : null, document: doc };
      },
      apply: async () => ({
        status: 'applied',
        operationId: 'op-3',
        projectRevision: 2,
        branchRevision: 6,
        changedIds: [el.id],
        undo: { entryId: 'u3', label: 'Edit Checkout service' },
        value: { kind: 'none' },
      }),
    };

    await expect(applyDraft(handle, session)).rejects.toThrow('Contract violation');
  });

  it('connection: only changed fields are replaced', async () => {
    const conn = callConnection();
    const doc = makeDocument([processorElement({ id: 'el-1' }), processorElement({ id: 'el-2' })], [conn]);
    let handle = openDraft('draft-1', { kind: 'connection', ids: [conn.id] }, 1, doc);
    handle = changeField(handle, 'config.latencyMs', '25');

    const session = fakeSession(doc, 1, async (changes) => {
      const change = changes[0];
      if (change.kind !== 'replace') throw new Error('unreachable');
      const record = change.value.record as Connection;
      expect(record.kind).toBe('call');
      if (record.kind === 'call') {
        expect(record.config.latencyMs).toBe(25);
        expect(record.config.returnLatencyMs).toBe(5); // untouched
      }
      return {
        status: 'applied',
        operationId: 'op-2',
        projectRevision: 2,
        branchRevision: 2,
        changedIds: [conn.id],
        undo: { entryId: 'u2', label: 'Edit authorize' },
        value: { kind: 'none' },
      };
    });

    const result = await applyDraft(handle, session);
    expect(result.handle.status).toBe('clean');
  });
});
