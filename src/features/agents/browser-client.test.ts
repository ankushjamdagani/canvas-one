import { describe, expect, it, vi } from 'vitest';
import { CollaborationBrowserClient, CollaborationClientError } from '@canvas-one/agent-bridge';

const token = 'a'.repeat(64), secret = 'b'.repeat(64);
const identity = { taskId: 'task', attemptId: 'attempt', projectId: 'project', branchId: 'branch', boardId: 'board', actorId: 'claude', generation: 1 };
const requestId = 'da631547-cb8c-4b69-86c2-a82dc331a341';
const mail = { version: 1 as const, requestId, identity, payload: { kind: 'tool' as const, data: { tool: 'board_inspect', input: {} } } };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function setup(reply: unknown = { version: 1 }, status = 200) {
  let now = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response(reply, status));
  const client = new CollaborationBrowserClient({ url: 'http://127.0.0.1:47831', fetch, now: () => now });
  return { client, fetch, setTime: (value: number) => { now = value; } };
}
describe('browser collaboration v1 client', () => {
  it('pairs without cached bearer credentials and sends only explicitly supplied tokens', async () => {
    const { client, fetch } = setup({ version: 1, token, expiresAt: 1000 });
    expect(await client.pair(secret)).toEqual({ token, expiresAt: 1000 });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json' } });
    expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization');
    fetch.mockResolvedValueOnce(response({ version: 1, sessionId: 'service-one', providers: [], attempts: [] }));
    expect(await client.status(token)).toEqual({ sessionId: 'service-one', providers: [], attempts: [] });
    expect(fetch.mock.calls[1]?.[1]?.headers).toEqual({ Authorization: `Bearer ${token}` });
  });
  it('returns pre-request monotonic timestamps and validates exact lease identity', async () => {
    const active = setup(); active.setTime(20);
    active.fetch.mockImplementationOnce(async () => { active.setTime(100); return response({ version: 1, lease: { ...identity, deadline: 120 } }); });
    expect(await active.client.start(token, { identity, provider: 'claude', prompt: 'Draw', providerSessionId: 'known-session' })).toEqual({ lease: { ...identity, deadline: 120 }, requestStartedAt: 20 });
    expect(JSON.parse(active.fetch.mock.calls[0]?.[1]?.body as string)).toMatchObject({ version: 1, providerSessionId: 'known-session' });
    active.fetch.mockResolvedValueOnce(response({ version: 1, lease: { ...identity, boardId: 'foreign', deadline: 200 } }));
    await expect(active.client.heartbeat(token, identity)).rejects.toMatchObject({ code: 'invalid-response' });
    active.fetch.mockResolvedValueOnce(response({ version: 1, lease: { ...identity, deadline: 200 } }));
    expect((await active.client.heartbeat(token, identity)).requestStartedAt).toBe(100);
  });
  it('surfaces history gaps explicitly and rejects unordered, foreign-version or fabricated events', async () => {
    const active = setup({ version: 1, error: 'event-gap', earliestCursor: 5, latestCursor: 8 }, 409);
    await expect(active.client.events(token, 0)).rejects.toMatchObject({ code: 'event-gap', status: 409, gap: { earliestCursor: 5, latestCursor: 8 } });
    const event = { version: 1, cursor: 1, identity, provider: 'claude', payload: { kind: 'text', text: 'Hello', format: 'delta' } };
    active.fetch.mockResolvedValueOnce(response({ version: 1, cursor: 1, events: [event] }));
    expect((await active.client.events(token, 0)).events).toEqual([event]);
    for (const invalid of [
      { version: 1, cursor: 1, events: [event, event] },
      { version: 1, cursor: 1, events: [{ ...event, version: 2 }] },
      { version: 1, cursor: 1, events: [{ ...event, payload: { kind: 'reasoning', text: 'Hidden' } }] },
      { version: 1, cursor: 1, events: [{ ...event, identity: { ...identity, generation: '1' } }] },
    ]) { active.fetch.mockResolvedValueOnce(response(invalid)); await expect(active.client.events(token, 0)).rejects.toMatchObject({ code: 'invalid-response' }); }
  });
  it('validates mailbox identities and replies using the returned trusted binding', async () => {
    const active = setup({ version: 1, requests: [mail] });
    expect(await active.client.requests(token)).toEqual([mail]);
    active.fetch.mockResolvedValueOnce(response({ version: 1, received: true }));
    await active.client.result(token, mail, { result: { title: 'Board' } });
    expect(JSON.parse(active.fetch.mock.calls[1]?.[1]?.body as string)).toEqual({ version: 1, requestId, identity, result: { title: 'Board' } });
    active.fetch.mockResolvedValueOnce(response({ version: 1, duplicate: true }));
    await expect(active.client.result(token, mail, { result: {} })).resolves.toBeUndefined();
    active.fetch.mockResolvedValueOnce(response({ version: 1, requests: [{ ...mail, payload: { kind: 'execute-shell', data: {} } }] }));
    await expect(active.client.requests(token)).rejects.toMatchObject({ code: 'invalid-response' });
    await expect(active.client.result(token, mail, { result: {}, error: 'both' } as { result: unknown })).rejects.toMatchObject({ code: 'invalid-input' });
  });
  it('preserves delivery acknowledgement semantics, cancellation outcome and explicit disconnect', async () => {
    const active = setup({ version: 1, delivered: true, acknowledged: false });
    const message = { messageId: 'message', target: 'clarification' as const, text: 'Use A' };
    expect(await active.client.send(token, identity, message)).toEqual({ delivered: true, acknowledged: false });
    active.fetch.mockResolvedValueOnce(response({ version: 1, delivered: false, acknowledged: true }));
    await expect(active.client.send(token, identity, message)).rejects.toMatchObject({ code: 'invalid-response' });
    active.fetch.mockResolvedValueOnce(response({ version: 1, fenced: true, cancellation: 'failed' }));
    expect(await active.client.stop(token, identity)).toEqual({ fenced: true, cancellation: 'failed' });
    active.fetch.mockResolvedValueOnce(response({ version: 1, fenced: true }));
    await expect(active.client.disconnect(token)).resolves.toBeUndefined();
    expect(active.fetch).toHaveBeenCalledTimes(4);
  });
  it('validates structured availability without assuming installation or accepting coerced booleans', async () => {
    const provider = { id: 'agy', available: false, detail: 'MCP transport blocked; installation is separate.' };
    const active = setup({ version: 1, sessionId: 'service-one', providers: [provider], attempts: [{ identity, provider: 'claude', mode: 'task', eligible: true, cancellation: 'none' }] });
    expect((await active.client.status(token)).providers).toEqual([provider]);
    active.fetch.mockResolvedValueOnce(response({ version: 1, providers: [{ ...provider, available: 'false' }], attempts: [] }));
    await expect(active.client.status(token)).rejects.toMatchObject({ code: 'invalid-response' });
  });
  it('propagates aborts and classifies network/HTTP failures without retries or implicit Resume', async () => {
    const active = setup(); const abort = new AbortController(); abort.abort();
    await expect(active.client.status(token, abort.signal)).rejects.toMatchObject({ code: 'aborted' }); expect(active.fetch).not.toHaveBeenCalled();
    const next = new AbortController();
    active.fetch.mockImplementationOnce(async (_url, options) => { expect(options?.signal).toBe(next.signal); next.abort(); throw new Error('Aborted'); });
    await expect(active.client.status(token, next.signal)).rejects.toMatchObject({ code: 'aborted' });
    active.fetch.mockRejectedValueOnce(new Error('No connection'));
    await expect(active.client.status(token)).rejects.toMatchObject({ code: 'network' });
    active.fetch.mockResolvedValueOnce(response({ error: 'explicit-resume-required' }, 409));
    await expect(active.client.heartbeat(token, identity)).rejects.toMatchObject({ code: 'http', status: 409 });
    expect(active.fetch).toHaveBeenCalledTimes(3);
    expect(new CollaborationClientError('http', 'Failed', 409)).toBeInstanceOf(Error);
  });
  it('rejects unsafe URLs, unbound inputs, unsupported versions and unserializable payloads', async () => {
    for (const url of ['https://127.0.0.1', 'http://localhost:47831', 'http://127.0.0.1/path', 'http://user:secret@127.0.0.1']) expect(() => new CollaborationBrowserClient({ url, fetch, now: () => 0 })).toThrow(CollaborationClientError);
    const active = setup();
    await expect(active.client.start(token, { identity: { ...identity, actorId: '' }, provider: 'claude', prompt: 'Draw' })).rejects.toMatchObject({ code: 'invalid-input' });
    const circular: { self?: unknown } = {}; circular.self = circular;
    await expect(active.client.result(token, mail, { result: circular })).rejects.toMatchObject({ code: 'invalid-input' });
    expect(active.fetch).not.toHaveBeenCalled();
    active.fetch.mockResolvedValueOnce(response({ version: 2, providers: [], attempts: [] })); await expect(active.client.status(token)).rejects.toMatchObject({ code: 'invalid-response' });
  });
});
