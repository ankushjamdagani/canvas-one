import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { CanvasConversationStore, type CanvasConversationStoreOptions } from './canvas-conversations';

const scope = { projectId: 'project', boardId: 'board', branchId: 'working' };
const stores: CanvasConversationStore[] = [];
let nextId = 0;
function open(options: CanvasConversationStoreOptions = {}, selectedScope = scope) {
  const store = new CanvasConversationStore(selectedScope, { broadcast: false, mintId: () => `id-${++nextId}`, now: () => 100, ...options });
  stores.push(store);
  return store;
}
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });

describe('canvas conversation metadata', () => {
  it('reopens resolved threads before new AI work so active requests cannot disappear from the canvas', async () => {
    const indexedDB = new IDBFactory(), store = open({ indexedDB });
    const thread = await store.create({ anchor: { x: 0, y: 0 } });
    await store.setResolved(thread.id, true);
    await store.attachTask(thread.id, 'new-request');
    expect(store.getState().threads[0]?.resolved).toBe(false);
    await store.setResolved(thread.id, true);
    const requestId = await store.enqueueRequest(thread.id, { text: 'Wait for the writer', providerId: 'claude', permissionMode: 'write', writeBehavior: 'suggest' });
    expect(store.getState().threads[0]?.resolved).toBe(false);
    await store.setResolved(thread.id, true);
    await store.attachQueuedTask(thread.id, requestId, 'started-request');
    const reload = open({ indexedDB }); await reload.ready;
    expect(reload.getState().threads[0]).toMatchObject({ resolved: false, taskIds: ['new-request', 'started-request'], queuedRequests: [] });
  });
  it('persists distinct comments, explicit targets and durable task references without authoring diagram records', async () => {
    const indexedDB = new IDBFactory();
    const first = open({ indexedDB });
    const thread = await first.create({ targetIds: ['node-a', 'node-a', 'node-b'], anchor: { x: 120, y: 240 } });
    await first.appendMessage(thread.id, { text: '**Why** is this slow?' });
    await first.attachTask(thread.id, 'durable-task');
    await first.attachTask(thread.id, 'durable-task');
    const reloaded = open({ indexedDB });
    await reloaded.ready;
    expect(reloaded.getState()).toMatchObject({ loaded: true, error: null, threads: [{ targetIds: ['node-a', 'node-b'], anchor: { x: 120, y: 240 }, messages: [{ text: '**Why** is this slow?', author: { kind: 'human' } }], taskIds: ['durable-task'], aiEngaged: true }] });
    expect(reloaded.getState().threads[0]).not.toHaveProperty('permission');
    expect(Object.isFrozen(reloaded.getState().threads[0]?.messages)).toBe(true);
  });

  it('serializes read-modify-write transactions across stores without losing unrelated threads or messages', async () => {
    const indexedDB = new IDBFactory();
    const first = open({ indexedDB }), second = open({ indexedDB });
    await Promise.all([first.ready, second.ready]);
    const [a, b] = await Promise.all([
      first.create({ title: 'A', anchor: { x: 1, y: 2 } }),
      second.create({ title: 'B', anchor: { x: 3, y: 4 } }),
    ]);
    await Promise.all([
      first.appendMessage(a.id, { text: 'First comment' }),
      second.appendMessage(a.id, { text: 'Second comment' }),
      first.attachTask(b.id, 'task-b'),
    ]);
    await first.refresh();
    expect(first.getState().threads).toHaveLength(2);
    expect(first.getState().threads.find(thread => thread.id === a.id)?.messages.map(message => message.text)).toEqual(['First comment', 'Second comment']);
    expect(first.getState().threads.find(thread => thread.id === b.id)?.taskIds).toEqual(['task-b']);
  });

  it('keeps other boards and branches isolated and preserves scope until explicitly reattached', async () => {
    const indexedDB = new IDBFactory();
    const first = open({ indexedDB });
    const thread = await first.create({ targetIds: ['deleted-node'], anchor: { x: 0, y: 0 } });
    await first.moveAnchor(thread.id, { x: 55, y: 88 });
    await first.setResolved(thread.id, true);
    expect(first.getState().threads[0]).toMatchObject({ targetIds: ['deleted-node'], anchor: { x: 55, y: 88 }, resolved: true });
    const other = open({ indexedDB }, { ...scope, branchId: 'main' });
    await other.ready;
    expect(other.getState().threads).toEqual([]);
    await first.setScope(thread.id, []);
    expect(first.getState().threads[0]?.targetIds).toEqual([]);
  });

  it('stores raw Markdown as data and tracks unread AI replies independently of resolution', async () => {
    const store = open({ indexedDB: new IDBFactory() });
    const thread = await store.create({ anchor: { x: 0, y: 0 } });
    await store.setResolved(thread.id, true);
    await store.appendMessage(thread.id, { text: '<script>not executable</script>', author: { id: 'ai-1', name: 'AI', kind: 'ai' } });
    expect(store.getState().threads[0]).toMatchObject({ unread: true, resolved: false, messages: [{ text: '<script>not executable</script>' }] });
    await store.markRead(thread.id);
    expect(store.getState().threads[0]?.unread).toBe(false);
    await store.markUnread(thread.id);
    await store.setTitle(thread.id, 'Architecture review');
    expect(store.getState().threads[0]).toMatchObject({ unread: true, title: 'Architecture review' });
    await store.setResolved(thread.id, true);
    expect(store.getState().threads[0]?.messages).toHaveLength(1);
  });

  it('leaves published metadata unchanged on invalid updates and permits subsequent valid updates', async () => {
    const store = open({ indexedDB: new IDBFactory() });
    const thread = await store.create({ anchor: { x: 0, y: 0 } });
    const snapshot = store.getState();
    await expect(store.appendMessage('missing', { text: 'hello' })).rejects.toThrow('could not be found');
    expect(store.getState().threads).toBe(snapshot.threads);
    expect(store.getState().error).toContain('could not be found');
    await expect(store.moveAnchor(thread.id, { x: Infinity, y: 0 })).rejects.toThrow('valid canvas position');
    await store.appendMessage(thread.id, { text: 'Retry succeeds' });
    expect(store.getState().error).toBeNull();
    expect(store.getState().threads[0]?.messages).toHaveLength(1);
  });

  it('does not overwrite unknown stored data after a validation failure', async () => {
    const indexedDB = new IDBFactory();
    const databaseName = 'corrupt-comments';
    const store = open({ indexedDB, databaseName });
    await store.ready;
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(databaseName, 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const badData = { key: JSON.stringify([scope.projectId, scope.branchId, scope.boardId]), version: 999, threads: ['unknown'] };
    await new Promise<void>((resolve, reject) => { const transaction = db.transaction('boards', 'readwrite'); transaction.objectStore('boards').put(badData); transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); });
    await store.refresh();
    expect(store.getState().error).toContain('preserved');
    await expect(store.create({ anchor: { x: 1, y: 2 } })).rejects.toThrow('preserved');
    const actual = await new Promise<unknown>((resolve, reject) => { const request = db.transaction('boards').objectStore('boards').get(badData.key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    expect(actual).toEqual(badData);
    db.close();
  });

  it('durably queues explicit requests with their original permission and scope without launching tasks', async () => {
    const indexedDB = new IDBFactory();
    const first = open({ indexedDB }), second = open({ indexedDB });
    const thread = await first.create({ anchor: { x: 0, y: 0 }, targetIds: ['node-a'] });
    const [a, b] = await Promise.all([
      first.enqueueRequest(thread.id, { text: '  Update node A  ', providerId: 'claude', permissionMode: 'write', writeBehavior: 'live', targetIds: ['node-a'], branchId: 'original-draft' }),
      second.enqueueRequest(thread.id, { text: 'Explain this', providerId: 'codex', permissionMode: 'read', writeBehavior: 'suggest', targetIds: [] }),
    ]);
    await first.setScope(thread.id, ['node-b']);
    const reload = open({ indexedDB });
    await reload.ready;
    expect(reload.getState().threads[0]).toMatchObject({ targetIds: ['node-b'], taskIds: [], queuedRequests: [
      { id: a, text: 'Update node A', providerId: 'claude', permissionMode: 'write', writeBehavior: 'live', targetIds: ['node-a'], branchId: 'original-draft' },
      { id: b, permissionMode: 'read', targetIds: [] },
    ] });
    await reload.removeQueuedRequest(thread.id, a);
    expect(reload.getState().threads[0]?.queuedRequests.map(request => request.id)).toEqual([b]);
    await expect(reload.enqueueRequest(thread.id, { text: '', providerId: 'claude', permissionMode: 'write', writeBehavior: 'suggest' })).rejects.toThrow('valid waiting request');
    await expect(reload.enqueueRequest(thread.id, { text: 'x'.repeat(64_001), providerId: 'claude', permissionMode: 'write', writeBehavior: 'suggest' })).rejects.toThrow('64,000');
  });

  it('loads metadata written before queued requests existed without resetting messages', async () => {
    const indexedDB = new IDBFactory();
    const databaseName = 'legacy-comments';
    const first = open({ indexedDB, databaseName });
    const thread = await first.create({ anchor: { x: 0, y: 0 } });
    await first.appendMessage(thread.id, { text: 'Original comment' });
    const { queuedRequests: _queue, ...legacyThread } = first.getState().threads[0]!;
    const key = JSON.stringify([scope.projectId, scope.branchId, scope.boardId]);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(databaseName, 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => { const transaction = db.transaction('boards', 'readwrite'); transaction.objectStore('boards').put({ key, version: 1, threads: [legacyThread] }); transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); });
    await first.refresh();
    expect(first.getState().threads[0]).toMatchObject({ messages: [{ text: 'Original comment' }], queuedRequests: [] });
    db.close();
  });

  it('atomically consumes a waiting request when its durable task is linked before launch', async () => {
    const indexedDB = new IDBFactory();
    const first = open({ indexedDB }), second = open({ indexedDB });
    const thread = await first.create({ anchor: { x: 0, y: 0 } });
    const request = await first.enqueueRequest(thread.id, { text: 'Update', providerId: 'claude', permissionMode: 'write', writeBehavior: 'suggest' });
    const results = await Promise.allSettled([
      first.attachQueuedTask(thread.id, request, 'task-a'),
      second.attachQueuedTask(thread.id, request, 'task-b'),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const reload = open({ indexedDB });
    await reload.ready;
    expect(reload.getState().threads[0]).toMatchObject({ queuedRequests: [], taskIds: ['task-a'] });
  });

  it('retains last-known target labels after reload and explicitly replaces them on reattachment', async () => {
    const indexedDB = new IDBFactory();
    const first = open({ indexedDB });
    const thread = await first.create({ anchor: { x: 0, y: 0 }, targetIds: ['deleted-api'], targetNames: { 'deleted-api': 'Checkout API', unrelated: 'Do not retain' } });
    const reload = open({ indexedDB });
    await reload.ready;
    expect(reload.getState().threads[0]?.targetNames).toEqual({ 'deleted-api': 'Checkout API' });
    await reload.setScope(thread.id, ['new-api'], { 'new-api': 'Replacement API' });
    expect(reload.getState().threads[0]?.targetNames).toEqual({ 'new-api': 'Replacement API' });
    await expect(reload.setScope(thread.id, ['new-api'], { 'new-api': 'x'.repeat(501) })).rejects.toThrow('500');
    await reload.setScope(thread.id, []);
    expect(reload.getState().threads[0]?.targetNames).toEqual({});
  });
});
