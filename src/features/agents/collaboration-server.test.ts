import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from 'node:http';
import { startCollaborationServer, type CollaborationServerOptions, type ExecutionBackend, type LocalCollaborationServer } from '@canvas-one/agent-bridge/collaboration-server';

const origin = 'http://localhost:5173';
const identity = { taskId: 'task', attemptId: 'attempt', projectId: 'project', branchId: 'branch', boardId: 'board', actorId: 'claude', generation: 1 };
const servers: LocalCollaborationServer[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await server.close(); });
function http(server: LocalCollaborationServer, path: string, options: { token?: string; body?: unknown; origin?: string | null; host?: string; contentType?: string } = {}): Promise<{ status: number; body: Record<string, any> }> {
  const url = new URL(server.url + path);
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (options.origin !== null) headers.Origin = options.origin ?? origin;
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.host) headers.Host = options.host;
    if (options.body !== undefined) headers['Content-Type'] = options.contentType ?? 'application/json';
    const req = request(url, { method: options.body === undefined ? 'GET' : 'POST', headers }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => { try { resolve({ status: response.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }); } catch (error) { reject(error); } });
    });
    req.on('error', reject); if (options.body !== undefined) req.write(JSON.stringify(options.body)); req.end();
  });
}
async function setup(overrides: Partial<CollaborationServerOptions> = {}) {
  let now = 0;
  const contexts = new Map<string, Parameters<ExecutionBackend['launch']>[0]>();
  const finishes = new Map<string, () => void>();
  const cancel = vi.fn();
  const send = vi.fn(async () => ({ delivered: true, acknowledged: false }));
  const backend: ExecutionBackend = { async launch(context) {
    contexts.set(context.identity.attemptId, context);
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    finishes.set(context.identity.attemptId, finish);
    return { process: { finished, cancel: async () => { cancel(); finish(); } }, send };
  } };
  const relay = vi.fn(async (_identity, _payload, _signal) => ({ ok: true }));
  const server = await startCollaborationServer({ allowedOrigins: [origin], now: () => now, pairingTtlMs: 1000, sessionTtlMs: 2000, leaseMs: 100, expiryIntervalMs: 60000, maxEventRecords: 2, maxEventBytes: 4096, requestTimeoutMs: 5000, maxBrowserRequests: 5, backend, relay, authorize: async () => true, ...overrides });
  servers.push(server);
  const pair = await http(server, '/v1/pair', { body: { version: 1, secret: server.pairingSecret } });
  expect(pair.status).toBe(200);
  const token = pair.body.token as string;
  const start = () => http(server, '/v1/start', { token, body: { version: 1, identity, provider: 'claude', prompt: 'Draw flow' } });
  return { server, token, start, contexts, finishes, cancel, send, relay, setTime: (value: number) => { now = value; } };
}

describe('authenticated local collaboration service', () => {
  it('requires boolean authorization and exposes only declared public adapter fields', async () => {
    const denied = await setup({ authorize: (async () => 'truthy') as unknown as CollaborationServerOptions['authorize'] });
    expect((await denied.start()).status).toBe(403);
    const provider = { id: 'claude' as const, available: true, detail: 'Fixture', capability: 'private-extra' };
    const descriptors = await setup({ backend: { providerCapabilities: [provider], launch: async () => { throw new Error('Unused'); } } });
    expect(JSON.stringify((await http(descriptors.server, '/v1/status', { token: descriptors.token })).body)).not.toContain('private-extra');
    const h = await setup(); await h.start();
    const outcome = { delivered: true, acknowledged: true, capability: h.contexts.get('attempt')!.capability };
    h.send.mockResolvedValueOnce(outcome);
    const sent = await http(h.server, '/v1/send', { token: h.token, body: { version: 1, identity, message: { messageId: 'message', target: 'clarification', text: 'Clarify' } } });
    expect(sent.body).toEqual({ version: 1, delivered: true, acknowledged: true });
    expect(JSON.stringify(sent.body)).not.toContain(outcome.capability);
  });
  it('publishes final close evidence before archival and preserves exact Stop receipts and tombstones', async () => {
    const h = await setup({ maxSessionAttempts: 2 }); await h.start();
    const ctx = h.contexts.get('attempt')!;
    ctx.emit({ kind: 'attempt-ended', outcome: 'succeeded', cancellationAcknowledged: false });
    expect((await http(h.server, '/v1/events?after=0', { token: h.token })).body.events).toHaveLength(0);
    h.finishes.get('attempt')!();
    const events = await http(h.server, '/v1/events?after=0', { token: h.token });
    expect(events.body.events.at(-1).payload).toEqual({ kind: 'attempt-ended', outcome: 'succeeded', cancellationAcknowledged: false });
    const status = await http(h.server, '/v1/status', { token: h.token });
    expect(status.body.sessionId).toMatch(/^[a-f0-9-]{36}$/); expect(status.body.archivedAttempts).toBe(1); expect(status.body.attempts).toEqual([]);
    expect((await http(h.server, '/v1/stop', { token: h.token, body: { version: 1, identity } })).body.cancellation).toBe('acknowledged');
    expect((await http(h.server, '/v1/stop', { token: h.token, body: { version: 1, identity: { ...identity, boardId: 'wrong' } } })).status).toBe(400);
    expect((await http(h.server, '/v1/agent/tool', { token: ctx.capability, origin: null, body: { requestId: 'read', tool: 'board_inspect', input: {} } })).status).toBe(401);
    expect((await h.start()).status).toBe(409);
    const next = { ...identity, attemptId: 'next', generation: 2 };
    expect((await http(h.server, '/v1/start', { token: h.token, body: { version: 1, identity: next, provider: 'claude', prompt: 'Resume' } })).status).toBe(200);
    h.finishes.get('next')!();
    const exceeded = await http(h.server, '/v1/start', { token: h.token, body: { version: 1, identity: { ...next, attemptId: 'third', generation: 3 }, provider: 'claude', prompt: 'More' } });
    expect(exceeded.body.error).toBe('session-attempt-limit');
  });
  it('archives settled workers so a session can complete more than 1000 attempts', async () => {
    const h = await setup({ maxSessionAttempts: 1100 });
    for (let index = 0; index < 1001; index++) {
      const value = { ...identity, attemptId: `attempt-${index}`, generation: index + 1 };
      expect((await http(h.server, '/v1/start', { token: h.token, body: { version: 1, identity: value, provider: 'claude', prompt: 'Fixture' } })).status).toBe(200);
      h.finishes.get(value.attemptId)!();
    }
    const result = await http(h.server, '/v1/status', { token: h.token });
    expect(result.body.archivedAttempts).toBe(1001); expect(result.body.attempts).toEqual([]);
  }, 15000);
  it('enforces Origin, exact loopback Host, bearer authentication, JSON content and single-use secret', async () => {
    const { server, token } = await setup();
    expect(server.pairingSecret).toMatch(/^[a-f0-9]{64}$/);
    for (const options of [{ origin: 'http://evil.example' }, { origin: null }, { host: 'evil.example' }, { host: '127.0.0.1:1' }]) expect((await http(server, '/v1/status', { token, ...options })).status).toBe(403);
    expect((await http(server, '/v1/status')).status).toBe(401);
    expect((await http(server, '/v1/status', { token: 'incorrect' })).status).toBe(401);
    expect((await http(server, '/v1/pair', { body: { version: 1, secret: server.pairingSecret } })).status).toBe(403);
    expect((await http(server, '/v1/start', { token, body: {}, contentType: 'text/plain' })).status).toBe(415);
    expect((await http(server, '/v1/start', { token, body: { version: 1, identity: { ...identity, boardId: null }, provider: 'claude', prompt: 'Draw' } })).status).toBe(400);
  });
  it('launches only host-authorized identity and never exposes the provider capability to browser responses', async () => {
    const allowed = vi.fn(async () => false);
    const denied = await setup({ authorize: allowed });
    expect((await denied.start()).status).toBe(403); expect(denied.contexts.size).toBe(0);
    const active = await setup(); const result = await active.start();
    expect(result.status).toBe(200);
    const context = active.contexts.get('attempt')!;
    expect(context.identity).toEqual(identity); expect(context.capability).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result.body)).not.toContain(context.capability);
    await expect(context.relay('wrong', {})).rejects.toThrow('revoked');
    expect(active.relay).not.toHaveBeenCalled();
    expect(await context.relay(context.capability, { operationId: 'operation' })).toEqual({ ok: true });
  });
  it('fences Stop before cancellation and drops late output and relay results', async () => {
    let deliver!: (value: unknown) => void;
    const relay = vi.fn(() => new Promise(resolve => { deliver = resolve; }));
    const active = await setup({ relay }); await active.start();
    const context = active.contexts.get('attempt')!;
    context.emit({ kind: 'text', text: 'Before stop', format: 'delta' });
    const pending = context.relay(context.capability, {});
    const stopped = await http(active.server, '/v1/stop', { token: active.token, body: { version: 1, identity } });
    expect(stopped.body).toMatchObject({ fenced: true, cancellation: 'acknowledged' }); expect(context.signal.aborted).toBe(true);
    context.emit({ kind: 'text', text: 'Late', format: 'delta' }); deliver({ ok: true });
    await expect(pending).rejects.toThrow('revoked');
    const events = await http(active.server, '/v1/events?after=0', { token: active.token });
    expect(events.body.events).toHaveLength(2); expect(events.body.events[0].payload.text).toBe('Before stop');
    expect(events.body.events[1].payload).toEqual({ kind: 'attempt-ended', outcome: 'cancelled', cancellationAcknowledged: true });
    expect((await http(active.server, '/v1/heartbeat', { token: active.token, body: { version: 1, identity } })).status).toBe(409);
  });
  it('expires leases, rejects renewal/reuse and requires a new generation and attempt for explicit resume', async () => {
    const active = await setup(); await active.start(); active.setTime(100);
    expect((await http(active.server, '/v1/heartbeat', { token: active.token, body: { version: 1, identity } })).status).toBe(409);
    expect(active.contexts.get('attempt')!.signal.aborted).toBe(true);
    expect((await active.start()).status).toBe(409);
    expect((await http(active.server, '/v1/start', { token: active.token, body: { version: 1, identity: { ...identity, attemptId: 'resumed', generation: 2 }, provider: 'codex', prompt: 'Resume explicitly' } })).status).toBe(200);
    const wrongScope = { ...identity, attemptId: 'resumed', generation: 2, boardId: 'other' };
    expect((await http(active.server, '/v1/heartbeat', { token: active.token, body: { version: 1, identity: wrongScope } })).status).toBe(400);
  });
  it('bounds event retention with monotonic cursors and reports an explicit history gap', async () => {
    const active = await setup(); await active.start();
    for (let i = 0; i < 3; i++) active.contexts.get('attempt')!.emit({ kind: 'text', text: `Message ${i}`, format: 'delta' });
    const gap = await http(active.server, '/v1/events?after=0', { token: active.token });
    expect(gap.status).toBe(409); expect(gap.body).toMatchObject({ error: 'event-gap', earliestCursor: 2, latestCursor: 3 });
    const retained = await http(active.server, '/v1/events?after=1', { token: active.token });
    expect(retained.body.events.map((event: { cursor: number }) => event.cursor)).toEqual([2, 3]);
    expect((await http(active.server, '/v1/events?after=-1', { token: active.token })).status).toBe(400);
  });
  it('accepts authenticated targeted messages and renewals while disconnect revokes every session attempt', async () => {
    const active = await setup(); await active.start(); active.setTime(50);
    const renewed = await http(active.server, '/v1/heartbeat', { token: active.token, body: { version: 1, identity } });
    expect(renewed.body.lease.deadline).toBe(150);
    const message = { messageId: 'reply', target: 'clarification', text: 'Use service A' };
    expect((await http(active.server, '/v1/send', { token: active.token, body: { version: 1, identity, message } })).body).toMatchObject({ delivered: true, acknowledged: false });
    expect(active.send).toHaveBeenCalledWith(message);
    expect((await http(active.server, '/v1/disconnect', { token: active.token, body: { version: 1 } })).body.fenced).toBe(true);
    expect(active.contexts.get('attempt')!.signal.aborted).toBe(true);
    expect((await http(active.server, '/v1/status', { token: active.token })).status).toBe(401);
  });
  it('expires the session independently of lease traffic and rejects oversized request bodies', async () => {
    const active = await setup({ sessionTtlMs: 80 }); await active.start(); active.setTime(80);
    active.contexts.get('attempt')!.emit({ kind: 'text', text: 'After session expiry', format: 'delta' });
    expect(active.contexts.get('attempt')!.signal.aborted).toBe(true);
    expect((await http(active.server, '/v1/status', { token: active.token })).status).toBe(401);
    const other = await setup();
    expect((await http(other.server, '/v1/start', { token: other.token, body: { version: 1, identity, provider: 'claude', prompt: 'x'.repeat(1048576) } })).status).toBe(413);
  });
  it('round-trips host authorization and tool RPC through the authenticated browser mailbox', async () => {
    let active!: Awaited<ReturnType<typeof setup>>;
    active = await setup({
      authorize: async binding => (await active.server.requestBrowser(binding, { kind: 'authorize', data: { action: 'start' } }, new AbortController().signal)) === true,
      relay: (binding, payload, signal) => active.server.requestBrowser(binding, { kind: 'tool', data: payload }, signal),
    });
    const start = active.start();
    let queued!: Record<string, any>;
    await vi.waitFor(async () => {
      const requests = await http(active.server, '/v1/requests', { token: active.token });
      expect(requests.body.requests).toHaveLength(1); queued = requests.body.requests[0];
    });
    expect(queued.identity).toEqual(identity); expect(queued.payload.kind).toBe('authorize');
    expect((await http(active.server, '/v1/requests', { token: active.token, origin: 'http://evil.example' })).status).toBe(403);
    const reply = { version: 1, requestId: queued.requestId, identity, result: true };
    expect((await http(active.server, '/v1/results', { token: active.token, body: reply, origin: 'http://evil.example' })).status).toBe(403);
    expect((await http(active.server, '/v1/results', { token: active.token, body: reply })).status).toBe(200);
    expect((await start).status).toBe(200);
    expect((await http(active.server, '/v1/results', { token: active.token, body: reply })).body.duplicate).toBe(true);
    expect((await http(active.server, '/v1/results', { token: active.token, body: { ...reply, result: false } })).status).toBe(409);
    const context = active.contexts.get('attempt')!;
    const relay = context.relay(context.capability, { tool: 'board_inspect', input: {} });
    const requests = await http(active.server, '/v1/requests', { token: active.token });
    const tool = requests.body.requests[0]; expect(tool.payload.kind).toBe('tool');
    expect((await http(active.server, '/v1/results', { token: active.token, body: { version: 1, requestId: tool.requestId, identity: { ...identity, boardId: 'other' }, result: {} } })).status).toBe(400);
    expect((await http(active.server, '/v1/results', { token: active.token, body: { version: 1, requestId: tool.requestId, identity, result: { revision: 1 } } })).status).toBe(200);
    expect(await relay).toEqual({ revision: 1 });
  });
  it('bounds and times out browser requests while explicit abort removes them', async () => {
    const active = await setup({ maxBrowserRequests: 1, requestTimeoutMs: 100 });
    const abort = new AbortController();
    const pending = active.server.requestBrowser(identity, { kind: 'authorize', data: {} }, abort.signal);
    const rejected = expect(pending).rejects.toThrow('timed out');
    await expect(active.server.requestBrowser(identity, { kind: 'authorize', data: {} }, new AbortController().signal)).rejects.toThrow('queue is full');
    active.setTime(100);
    expect((await http(active.server, '/v1/requests', { token: active.token })).body.requests).toHaveLength(0);
    await rejected;
    const nextAbort = new AbortController();
    const next = active.server.requestBrowser(identity, { kind: 'authorize', data: {} }, nextAbort.signal);
    const nextRejected = expect(next).rejects.toThrow('aborted'); nextAbort.abort(); await nextRejected;
    expect((await http(active.server, '/v1/requests', { token: active.token })).body.requests).toHaveLength(0);
    await expect(active.server.requestBrowser(identity, { kind: 'tool', data: {} }, new AbortController().signal)).rejects.toThrow('fence');
  });
  it('revokes pending tool mailbox calls on Stop and all startup calls on browser disconnect', async () => {
    let active!: Awaited<ReturnType<typeof setup>>;
    active = await setup({ relay: (binding, payload, signal) => active.server.requestBrowser(binding, { kind: 'tool', data: payload }, signal) });
    await active.start(); const context = active.contexts.get('attempt')!;
    const pending = context.relay(context.capability, {}); const rejected = expect(pending).rejects.toThrow(/revoked|aborted/);
    expect((await http(active.server, '/v1/requests', { token: active.token })).body.requests).toHaveLength(1);
    await http(active.server, '/v1/stop', { token: active.token, body: { version: 1, identity } }); await rejected;
    expect((await http(active.server, '/v1/requests', { token: active.token })).body.requests).toHaveLength(0);
    const startup = active.server.requestBrowser({ ...identity, attemptId: 'startup', generation: 2 }, { kind: 'authorize', data: {} }, new AbortController().signal);
    const startupRejected = expect(startup).rejects.toThrow('revoked');
    await http(active.server, '/v1/disconnect', { token: active.token, body: { version: 1 } }); await startupRejected;
  });
  it('accepts private agent tools only through backend capability and derives the immutable task binding', async () => {
    let active!: Awaited<ReturnType<typeof setup>>;
    active = await setup({ relay: (binding, payload, signal) => active.server.requestBrowser(binding, { kind: 'tool', data: payload }, signal) });
    await active.start(); const context = active.contexts.get('attempt')!;
    const tool = { requestId: 'local-mcp-tool', tool: 'board_inspect', input: {} };
    expect((await http(active.server, '/v1/agent/tool', { token: active.token, origin: null, body: tool })).status).toBe(401);
    expect((await http(active.server, '/v1/agent/tool', { token: context.capability, body: tool })).status).toBe(403);
    expect((await http(active.server, '/v1/agent/tool', { token: context.capability, origin: null, body: { ...tool, tool: 'shell_execute' } })).status).toBe(400);
    const operation = http(active.server, '/v1/agent/tool', { token: context.capability, origin: null, body: tool });
    let queued!: Record<string, any>;
    await vi.waitFor(async () => { const requests = await http(active.server, '/v1/requests', { token: active.token }); expect(requests.body.requests).toHaveLength(1); queued = requests.body.requests[0]; });
    expect(queued.identity).toEqual(identity); expect(queued.payload.data).toEqual(tool);
    await http(active.server, '/v1/results', { token: active.token, body: { version: 1, requestId: queued.requestId, identity, result: { title: 'Board' } } });
    expect((await operation).body).toEqual({ requestId: tool.requestId, result: { title: 'Board' } });
    await http(active.server, '/v1/stop', { token: active.token, body: { version: 1, identity } });
    // Closed-worker archival destroys the private capability rather than retaining a fenced credential.
    expect((await http(active.server, '/v1/agent/tool', { token: context.capability, origin: null, body: tool })).status).toBe(401);
  });
  it('authorizes explicit provider-session continuation and separates read-only questions from editing execution', async () => {
    const authorize = vi.fn(async () => true);
    const active = await setup({ authorize }); await active.start();
    const questionIdentity = { ...identity, taskId: 'question', attemptId: 'question' };
    const started = await http(active.server, '/v1/start', { token: active.token, body: { version: 1, identity: questionIdentity, provider: 'codex', mode: 'question', providerSessionId: 'explicit-session', prompt: 'What does this mean?' } });
    expect(started.status).toBe(200);
    expect(authorize).toHaveBeenLastCalledWith(questionIdentity, { provider: 'codex', mode: 'question', providerSessionId: 'explicit-session' });
    const context = active.contexts.get('question')!;
    expect(context.mode).toBe('question'); expect(context.providerSessionId).toBe('explicit-session');
    for (const tool of ['proposal_submit', 'diagram_create', 'action_submit']) {
      await expect(context.relay(context.capability, { tool, input: {} })).rejects.toThrow('read-only');
      expect((await http(active.server, '/v1/agent/tool', { token: context.capability, origin: null, body: { requestId: `deny-${tool}`, tool, input: {} } })).status).toBeGreaterThanOrEqual(400);
    }
    expect(await context.relay(context.capability, { tool: 'board_inspect', input: {} })).toEqual({ ok: true });
    expect((await http(active.server, '/v1/status', { token: active.token })).body.attempts.filter((item: { eligible: boolean }) => item.eligible)).toHaveLength(2);
    expect((await http(active.server, '/v1/start', { token: active.token, body: { version: 1, identity: { ...identity, attemptId: 'invalid' }, provider: 'claude', mode: ['question'], prompt: 'Invalid mode' } })).status).toBe(400);
    expect((await http(active.server, '/v1/start', { token: active.token, body: { version: 1, identity: { ...identity, attemptId: 'invalid' }, provider: 'claude', providerSessionId: 'x'.repeat(201), prompt: 'Invalid session' } })).status).toBe(400);
  });
  it('returns explicit provider availability and refuses a known blocked provider before authorization', async () => {
    const authorize = vi.fn(async () => true), launch = vi.fn();
    const providerCapabilities = [{ id: 'agy' as const, available: false, detail: 'Scoped MCP transport remains blocked; installation and sign-in are not checked here.' }];
    const active = await setup({ authorize, backend: { providerCapabilities, launch } });
    expect((await http(active.server, '/v1/status', { token: active.token })).body.providers).toEqual(providerCapabilities);
    expect((await http(active.server, '/v1/start', { token: active.token, body: { version: 1, identity, provider: 'agy', prompt: 'Draw' } })).body.error).toBe('provider-unavailable');
    expect(authorize).not.toHaveBeenCalled(); expect(launch).not.toHaveBeenCalled();
  });
});
