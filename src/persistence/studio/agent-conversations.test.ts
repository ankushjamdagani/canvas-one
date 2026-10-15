import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { Dexie } from 'dexie';
import { StudioDatabase } from './db';
import { StudioConversationStorage, agentConversationKey, emptyConversationLedger, parseConversationLedger, serializeConversationLedger, MAX_CONVERSATION_BYTES, type ConversationLedger, type ConversationArtifact } from './agent-conversations';

const scope = { projectId: 'project', branchId: 'branch', boardId: 'board' };
const databases: Dexie[] = [];
function database(name = `conversation-${crypto.randomUUID()}`) { const db = new StudioDatabase(name); databases.push(db); return db; }
afterEach(async () => { const names = new Set(databases.map(db => db.name)); for (const db of databases.splice(0)) db.close(); for (const name of names) await Dexie.delete(name); });
const ledger = (revision = 1, eventsCursor = 1) => ({ ...emptyConversationLedger(scope), revision, eventsCursor, messages: [{ id: 'message', taskId: 'task', payload: { role: 'user', text: 'Add a queue' } }], proposals: [{ id: 'proposal', taskId: 'task', payload: { changes: [{ kind: 'add', id: 'queue' }] } }], operations: [{ taskId: 'task', operationId: 'operation', payload: { before: null, after: { id: 'queue' } } }] });

describe('durable conversation artifacts', () => {
  it('recovers held actions and exact clarification after recent history rollover, then records resolution', async () => {
    const storage = new StudioConversationStorage(database(), scope);
    const question: ConversationArtifact = { id: 'question', taskId: 'task', payload: { role: 'agent', attemptId: 'attempt', clarificationQuestionId: 'question-tool', text: 'Which queue?' } };
    const held = { taskId: 'task', operationId: 'held', payload: { result: { code: 'conflict' } } };
    let header = (await storage.commit(null, { ...emptyConversationLedger(scope), revision: 1, messages: [question], operations: [held] }))!;
    header = (await storage.commit(header.revision, { ...header, revision: 2, messages: [...header.messages, ...Array.from({ length: 100 }, (_, i) => ({ id: `later-${i}`, taskId: 'task', payload: { text: 'later' } }))], operations: [...header.operations, ...Array.from({ length: 100 }, (_, i) => ({ taskId: 'task', operationId: `done-${i}`, payload: { result: { ok: true } } }))] }))!;
    expect(header.operations.some(value => value.operationId === 'held')).toBe(false);
    expect(header.messages.some(value => value.id === 'question')).toBe(false);
    expect(await storage.loadOpenOperations()).toEqual([held]);
    expect(await storage.loadClarificationQuestion('task', 'attempt')).toEqual(question);
    expect(await storage.loadClarificationQuestion('task', 'other-attempt')).toBeNull();
    const ordinal = await storage.loadMessageOrdinal('later-50');
    expect((await storage.loadMessagesPage(ordinal!)).messages.at(-1)?.id).toBe('later-49');
    const newer = { ...question, id: 'new-question', payload: { ...question.payload as object, clarificationQuestionId: 'new-tool', text: 'Which region?' } };
    header = (await storage.commit(2, { ...header, revision: 3, messages: [...header.messages, newer], operations: [...header.operations, { ...held, payload: { ...held.payload, decision: 'skip-and-replan' } }] }))!;
    expect(await storage.loadOpenOperations()).toEqual([]);
    expect((await storage.loadOperation('held'))?.payload).toEqual({ result: { code: 'conflict' }, decision: 'skip-and-replan' });
    await storage.commit(3, { ...header, revision: 4, messages: [...header.messages, question] });
    expect(await storage.loadClarificationQuestion('task', 'attempt')).toEqual(newer);
    expect(await new StudioConversationStorage(database(), { ...scope, boardId: 'other' }).loadOpenOperations()).toEqual([]);
  });
  it('archives long histories, stable updates and starting context while acknowledging a bounded header', async () => {
    const db = database(), storage = new StudioConversationStorage(db, scope);
    const starting: ConversationArtifact = { id: 'start', taskId: 'task', payload: { id: 'start', role: 'user', text: 'Original task', delivery: 'delivered', startingContext: { ids: ['element'], viewId: 'view', omittedCount: 0 } } };
    let header = (await storage.commit(null, { ...emptyConversationLedger(scope), revision: 1, eventsCursor: 1, messages: [starting] }))!;
    const originalRow = await db.agentConversationArchive.where('[scopeKey+kind+state]').equals([storage.key, 'message', 'closed']).first();
    for (let batch = 0; batch < 12; batch++) {
      const additions = Array.from({ length: 100 }, (_, index) => ({ id: `message-${batch * 100 + index}`, taskId: 'task', payload: { text: 'Saved content' } }));
      header = (await storage.commit(header.revision, { ...header, revision: header.revision + 1, eventsCursor: header.eventsCursor + 1, messages: [...header.messages, ...additions] }))!;
    }
    expect(header.messages).toHaveLength(64);
    expect(header.hasArchivedMessages).toBe(true);
    expect(new TextEncoder().encode(serializeConversationLedger(header)).byteLength).toBeLessThanOrEqual(MAX_CONVERSATION_BYTES);
    expect(await db.agentConversationArchive.where('[scopeKey+kind+state]').equals([storage.key, 'message', 'closed']).count()).toBe(1201);
    const reopened = new StudioConversationStorage(db, scope);
    expect((await reopened.loadStartingMessage('task'))?.payload).toEqual(starting.payload);
    const latest = await reopened.loadMessagesPage();
    expect(latest.messages.map(item => item.id)).toEqual(Array.from({ length: 100 }, (_, index) => `message-${1100 + index}`));
    expect(latest.hasMore).toBe(true);
    const earlier = await reopened.loadMessagesPage(latest.before);
    expect(earlier.messages.map(item => item.id)).toEqual(Array.from({ length: 100 }, (_, index) => `message-${1000 + index}`));
    const updated = { ...starting, payload: { ...(starting.payload as Record<string, string>), delivery: 'acknowledged' } };
    header = (await storage.commit(header.revision, { ...header, revision: header.revision + 1, messages: [...header.messages, updated] }))!;
    expect((await db.agentConversationArchive.get(originalRow!.key))?.ordinal).toBe(originalRow?.ordinal);
    expect((await storage.loadStartingMessage('task'))?.payload).toEqual(updated.payload);
    const corruptContext = { ...starting, payload: { role: 'user', startingContext: { ids: ['other'], omittedCount: 0 } } };
    await expect(storage.commit(header.revision, { ...header, revision: header.revision + 1, messages: [...header.messages, corruptContext] })).rejects.toThrow('Starting context');
  });
  it('archives open and terminal proposals and operation receipts for scoped replay after header eviction', async () => {
    const storage = new StudioConversationStorage(database(), scope);
    const proposals = Array.from({ length: 100 }, (_, index) => ({ id: `proposal-${index}`, taskId: 'task', payload: { status: index === 0 ? 'pending' : 'accepted', label: `Proposal ${index}` } }));
    const operation = { taskId: 'task', operationId: 'operation', payload: { result: { ok: true } } };
    const header = (await storage.commit(null, { ...emptyConversationLedger(scope), revision: 1, proposals, operations: [operation] }))!;
    expect(header.proposals).toHaveLength(20);
    expect((await storage.loadOpenProposals()).map(item => item.id)).toEqual(['proposal-0']);
    expect(await storage.loadProposal('proposal-0')).toEqual(proposals[0]);
    expect(await storage.loadOperation('operation')).toEqual(operation);
    expect(await storage.loadTaskProposals('task')).toHaveLength(100);
    expect(await storage.loadTaskProposals('other')).toEqual([]);
    expect(await storage.commit(0, { ...header, revision: 2 })).toBeNull();
  });
  it('retains oversized full content in archive with an explicit recent-view notice', async () => {
    const storage = new StudioConversationStorage(database(), scope);
    const message = { id: 'large', taskId: 'task', payload: { text: 'x'.repeat(2 * MAX_CONVERSATION_BYTES) } };
    const header = (await storage.commit(null, { ...emptyConversationLedger(scope), revision: 1, messages: [message] }))!;
    expect(header.messages[0]?.payload).toMatchObject({ role: 'system', text: expect.stringContaining('saved in task history') });
    expect((await storage.loadMessagesPage()).messages[0]).toEqual(message);
    expect(header.hasArchivedMessages).toBe(true);
    expect(serializeConversationLedger(header).length).toBeLessThan(MAX_CONVERSATION_BYTES);
  });
  it('rolls back archive rows and cursor/header together if archive or header writes fail', async () => {
    const db = database(), storage = new StudioConversationStorage(db, scope);
    const first = (await storage.commit(null, { ...emptyConversationLedger(scope), revision: 1, eventsCursor: 7 }))!;
    const fail = () => { throw new Error('Disk failure'); };
    db.agentConversationArchive.hook('creating', fail);
    await expect(storage.commit(1, { ...first, revision: 2, eventsCursor: 8, messages: [{ id: 'new', payload: null }] })).rejects.toThrow('Disk failure');
    db.agentConversationArchive.hook('creating').unsubscribe(fail);
    expect(await db.agentConversationArchive.count()).toBe(0);
    expect(parseConversationLedger((await storage.load())!)?.eventsCursor).toBe(7);
    db.agentConversations.hook('updating', fail);
    await expect(storage.commit(1, { ...first, revision: 2, eventsCursor: 8, messages: [{ id: 'new', payload: null }] })).rejects.toThrow('Disk failure');
    db.agentConversations.hook('updating').unsubscribe(fail);
    expect(await db.agentConversationArchive.count()).toBe(0);
    expect(parseConversationLedger((await storage.load())!)?.eventsCursor).toBe(7);
  });
  it('migrates a pre-archive header without losing records omitted by a compacting caller', async () => {
    const storage = new StudioConversationStorage(database(), scope);
    expect(await storage.compareAndSwap(null, serializeConversationLedger(ledger()))).toBe(true);
    const header = (await storage.commit(1, { ...emptyConversationLedger(scope), revision: 2, eventsCursor: 2 }))!;
    expect(header.hasArchivedMessages).toBe(true);
    expect((await storage.loadMessagesPage()).messages).toEqual(ledger().messages);
    expect(await storage.loadProposal('proposal')).toEqual(ledger().proposals[0]);
  });
  it('resets event cursors only for an explicitly identified new service instance', async () => {
    const storage = new StudioConversationStorage(database(), scope);
    expect(await storage.compareAndSwap(null, serializeConversationLedger({ ...ledger(1, 20), eventsSessionId: 'service-one' }))).toBe(true);
    await expect(storage.compareAndSwap(1, serializeConversationLedger({ ...ledger(2, 0), eventsSessionId: 'service-one' }))).rejects.toThrow('cursor');
    expect(await storage.compareAndSwap(1, serializeConversationLedger({ ...ledger(2, 0), eventsSessionId: 'service-two' }))).toBe(true);
    expect(parseConversationLedger((await storage.load())!)?.messages).toHaveLength(1);
  });
  it('persists scoped artifacts independently and serializes competing CAS writers', async () => {
    const db = database(), first = new StudioConversationStorage(db, scope), second = new StudioConversationStorage(db, scope);
    expect(await first.load()).toBeNull();
    const serialized = serializeConversationLedger(ledger());
    const results = await Promise.all([first.compareAndSwap(null, serialized), second.compareAndSwap(null, serialized)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(parseConversationLedger((await second.load())!)?.messages[0]?.payload).toEqual({ role: 'user', text: 'Add a queue' });
    expect(await db.agentTaskLedgers.count()).toBe(0);
    expect(await db.preferences.count()).toBe(0);
    expect(await db.snapshots.count()).toBe(0);
    expect(await second.compareAndSwap(0, serializeConversationLedger(ledger(2)))).toBe(false);
    expect(await second.compareAndSwap(1, serialized)).toBe(false);
    expect(await second.compareAndSwap(1, serializeConversationLedger(ledger(2, 2)))).toBe(true);
    await expect(second.compareAndSwap(2, serializeConversationLedger(ledger(3, 1)))).rejects.toThrow('cursor');
  });
  it('rejects corrupt or cross-board rows without overwriting them', async () => {
    const db = database(), storage = new StudioConversationStorage(db, scope);
    expect(agentConversationKey({ projectId: 'a:b', branchId: 'c', boardId: 'd' })).not.toBe(agentConversationKey({ projectId: 'a', branchId: 'b:c', boardId: 'd' }));
    await expect(storage.compareAndSwap(null, serializeConversationLedger({ ...ledger(), scope: { ...scope, boardId: 'other' } }))).rejects.toThrow();
    const corrupt = { key: storage.key, revision: 1, serializedConversation: '{bad' };
    await db.agentConversations.put(corrupt);
    await expect(storage.load()).rejects.toThrow();
    await expect(storage.compareAndSwap(1, serializeConversationLedger(ledger(2)))).rejects.toThrow();
    expect(await db.agentConversations.get(storage.key)).toEqual(corrupt);
    expect(await new StudioConversationStorage(db, { ...scope, branchId: 'other' }).load()).toBeNull();
  });
  it('bounds payloads and rejects malformed schemas, duplicate identities and lossy JSON', () => {
    const good = ledger();
    for (const bad of [
      { ...good, extra: true }, { ...good, revision: -1 }, { ...good, eventsCursor: -1 },
      { ...good, messages: [good.messages[0], good.messages[0]] }, { ...good, operations: [good.operations[0], good.operations[0]] },
      { ...good, messages: Array.from({ length: 1001 }, (_, index) => ({ id: String(index), payload: null })) },
      { ...good, messages: [{ id: 'message', payload: '界'.repeat(MAX_CONVERSATION_BYTES / 2) }] },
    ]) expect(parseConversationLedger(JSON.stringify(bad))).toBeNull();
    for (const payload of [undefined, NaN, Infinity, () => {}, new Date(), { missing: undefined }, new Array(1)]) {
      expect(() => serializeConversationLedger({ ...good, messages: [{ id: 'message', payload }] } as unknown as typeof good)).toThrow();
    }
    expect(parseConversationLedger(JSON.stringify(good))).toEqual(good);
  });
  it('upgrades version2 additively, preserving every previous store and index', async () => {
    const name = `conversation-upgrade-${crypto.randomUUID()}`, old = new Dexie(name); databases.push(old);
    const stores = { projects: 'id, updatedAt', branches: '[projectId+id], projectId', snapshots: '[projectId+id], projectId', commits: '[projectId+id], projectId', publications: '[projectId+id], projectId, &[projectId+ordinal], &[projectId+versionKey]', checkpoints: '[projectId+id], projectId', runs: '[projectId+id], projectId, [projectId+fingerprint]', traceChunks: '[projectId+runId+index], [projectId+runId]', operations: '[projectId+id], projectId', parts: '[projectId+id+revision], projectId, [projectId+id]', preferences: 'key', agentTaskLedgers: 'key' };
    old.version(2).stores(stores); await old.open();
    const rows = Object.fromEntries(Object.keys(stores).map(table => [table, table === 'preferences' || table === 'agentTaskLedgers' ? { key: table, preserve: true } : table === 'traceChunks' ? { projectId: 'project', runId: 'run', index: 0, preserve: true } : table === 'parts' ? { projectId: 'project', id: table, revision: 1, preserve: true } : { projectId: 'project', id: table, ordinal: 1, versionKey: '1.0.0', preserve: true }]));
    const schemas = Object.fromEntries(old.tables.map(table => [table.name, { key: table.schema.primKey.keyPath, indexes: table.schema.indexes.map(index => ({ name: index.name, key: index.keyPath, unique: index.unique })) }]));
    for (const [table, row] of Object.entries(rows)) await old.table(table).put(row);
    old.close();
    const upgraded = database(name); await upgraded.open();
    expect(upgraded.verno).toBe(4);
    expect(upgraded.tables.map(table => table.name).sort()).toEqual([...Object.keys(stores), 'agentConversations', 'agentTaskActions', 'agentConversationArchive'].sort());
    for (const [table, row] of Object.entries(rows)) {
      expect(await upgraded.table(table).toArray()).toEqual([row]);
      expect({ key: upgraded.table(table).schema.primKey.keyPath, indexes: upgraded.table(table).schema.indexes.map(index => ({ name: index.name, key: index.keyPath, unique: index.unique })) }).toEqual(schemas[table]);
    }
    expect(await upgraded.agentConversations.count()).toBe(0);
    expect(await upgraded.agentConversationArchive.count()).toBe(0);
    expect(await upgraded.agentTaskActions.count()).toBe(0);
    expect(upgraded.agentTaskActions.schema.indexes.map(index => index.name)).toEqual(['projectId', '[projectId+branchId+boardId+taskId]', 'operationId']);
  });
});
