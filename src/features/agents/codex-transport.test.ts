import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexAppServerTransport, type CodexTransportEvent, type CodexBoardTools } from '@canvas-one/agent-bridge';

type WireRecord = { id?: string; method?: string; params?: Record<string, unknown> };
const cleanup: CodexAppServerTransport[] = [];
afterEach(() => { for (const transport of cleanup.splice(0)) transport.close(); vi.useRealTimers(); });
function fixture(options: { maxRecordChars?: number; requestTimeoutMs?: number; maxPendingRequests?: number; boardTools?: CodexBoardTools } = {}) {
  const sent: WireRecord[] = [], events: CodexTransportEvent[] = [];
  const transport = new CodexAppServerTransport({ write: line => { sent.push(JSON.parse(line)); }, onEvent: event => { events.push(event); }, ...options });
  cleanup.push(transport);
  const answer = (request: WireRecord, result: unknown) => transport.receive(JSON.stringify({ id: request.id, result }) + '\n');
  const notification = (method: string, params: unknown) => transport.receive(JSON.stringify({ method, params }) + '\n');
  async function ready() {
    const pending = transport.initialize();
    expect(sent.at(-1)?.method).toBe('initialize');
    answer(sent.at(-1)!, { userAgent: 'codex/0.155.1' });
    await pending;
  }
  async function thread(id = 'thread-1') {
    const pending = transport.startThread({ model: 'explicit-model', cwd: '/tmp/fixture' });
    answer(sent.at(-1)!, { thread: { id } });
    return pending;
  }
  async function turn(id = 'turn-1') {
    const pending = transport.startTurn('thread-1', 'Make a proposal', 'message-1');
    answer(sent.at(-1)!, { turn: { id } });
    return pending;
  }
  return { transport, sent, events, answer, notification, ready, thread, turn };
}

describe('Codex app-server pure wire transport (no CLI runtime inference)', () => {
  it('initializes before selected-thread work and serializes the exact safe protocol subset', async () => {
    const f = fixture();
    await expect(f.transport.startThread({ model: 'model', cwd: '/tmp' })).rejects.toThrow('Initialize');
    await f.ready();
    expect(f.sent[0]).toMatchObject({ method: 'initialize', params: { clientInfo: { name: 'canvas-one' }, capabilities: { experimentalApi: false, requestAttestation: false } } });
    expect(f.sent[1]).toEqual({ method: 'initialized' });
    await f.thread();
    expect(f.sent[2]).toMatchObject({ method: 'thread/start', params: { model: 'explicit-model', allowProviderModelFallback: false, sandbox: 'read-only', approvalPolicy: 'never', config: { mcp_servers: {} }, environments: [] } });
    expect(f.sent[2]?.params?.config).toMatchObject({ web_search: 'disabled', features: { shell_tool: false, unified_exec: false, apps: false, plugins: false, browser_use: false, browser_use_external: false, in_app_browser: false, computer_use: false, view_image: false, multi_agent: false, workspace_dependencies: false, code_mode_host: false, code_mode: false, code_mode_only: false } });
    await f.turn();
    expect(f.sent[3]).toMatchObject({ method: 'turn/start', params: { threadId: 'thread-1', clientUserMessageId: 'message-1', input: [{ type: 'text', text: 'Make a proposal', text_elements: [] }] } });
  });

  it('uses exact thread and expected turn IDs for steering and separates interrupt acceptance from cancellation', async () => {
    const f = fixture(); await f.ready(); await f.thread(); await f.turn();
    const steer = f.transport.steer('thread-1', 'turn-1', 'Revise the proposal', 'message-2');
    expect(f.sent.at(-1)).toMatchObject({ method: 'turn/steer', params: { threadId: 'thread-1', expectedTurnId: 'turn-1', clientUserMessageId: 'message-2' } });
    f.answer(f.sent.at(-1)!, { turnId: 'turn-1' });
    await expect(steer).resolves.toEqual({ turnId: 'turn-1', acknowledged: true });
    const interrupt = f.transport.interrupt('thread-1', 'turn-1');
    expect(f.sent.at(-1)).toMatchObject({ method: 'turn/interrupt', params: { threadId: 'thread-1', turnId: 'turn-1' } });
    f.answer(f.sent.at(-1)!, {});
    await expect(interrupt).resolves.toEqual({ requested: true, cancellationAcknowledged: false });
    expect(f.events).toEqual([]);
    f.notification('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } });
    expect(f.events.at(-1)).toEqual({ kind: 'turn-ended', threadId: 'thread-1', turnId: 'turn-1', outcome: 'interrupted', cancellationAcknowledged: true });
  });

  it('correlates concurrent out-of-order responses and rejects provider errors', async () => {
    const f = fixture(); await f.ready(); await f.thread(); await f.turn();
    const steer = f.transport.steer('thread-1', 'turn-1', 'Change label', 'message-2');
    const steerRequest = f.sent.at(-1)!;
    const interrupt = f.transport.interrupt('thread-1', 'turn-1');
    f.answer(f.sent.at(-1)!, {});
    f.transport.receive(JSON.stringify({ id: steerRequest.id, error: { code: -32000, message: 'sensitive provider detail' } }) + '\n');
    await expect(interrupt).resolves.toMatchObject({ requested: true });
    await expect(steer).rejects.toThrow('rejected');
    expect(JSON.stringify(f.events)).not.toContain('sensitive');
  });

  it('buffers early current-thread notifications until turn ID is established and ignores stale turns/reasoning', async () => {
    const f = fixture(); await f.ready(); await f.thread();
    const pending = f.transport.startTurn('thread-1', 'Prompt', 'message-1');
    const request = f.sent.at(-1)!;
    f.notification('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'old-turn', itemId: 'item', delta: 'stale' });
    f.notification('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item', delta: 'Visible' });
    f.notification('item/reasoning/textDelta', { threadId: 'thread-1', turnId: 'turn-1', delta: 'private' });
    expect(f.events).toEqual([]);
    f.answer(request, { turn: { id: 'turn-1' } }); await pending;
    expect(f.events).toEqual([{ kind: 'text', threadId: 'thread-1', turnId: 'turn-1', itemId: 'item', delta: 'Visible' }]);
    f.notification('turn/completed', { threadId: 'thread-1', turn: { id: 'old-turn', status: 'completed' } });
    expect(f.events).toHaveLength(1);
  });

  it('detaches before switching sessions and ignores late responses/notifications', async () => {
    const f = fixture(); await f.ready(); await f.thread();
    const pending = f.transport.startTurn('thread-1', 'Prompt', 'message');
    const oldRequest = f.sent.at(-1)!;
    f.transport.detachSession();
    await expect(pending).rejects.toThrow('detached');
    f.answer(oldRequest, { turn: { id: 'stale-turn' } });
    f.notification('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'stale-turn', itemId: 'item', delta: 'stale' });
    await f.thread('thread-2');
    expect(f.events).toEqual([]);
    await expect(f.transport.startTurn('thread-1', 'Prompt', 'message')).rejects.toThrow('selected session');
  });

  it('resumes only the explicit requested thread and rejects mismatched IDs', async () => {
    const f = fixture(); await f.ready();
    const pending = f.transport.resumeThread('explicit-thread', { model: 'model', cwd: '/tmp' });
    expect(f.sent.at(-1)).toMatchObject({ method: 'thread/resume', params: { threadId: 'explicit-thread', excludeTurns: true } });
    f.answer(f.sent.at(-1)!, { thread: { id: 'wrong-thread' } });
    await expect(pending).rejects.toThrow('mismatched');
  });

  it('supports explicit ephemeral fixture threads without changing global configuration', async () => {
    const f = fixture(); await f.ready();
    const pending = f.transport.startThread({ model: 'model', cwd: '/tmp/isolated-fixture', ephemeral: true });
    const request = f.sent.at(-1)!;
    f.answer(request, { thread: { id: 'fixture-thread' } }); await pending;
    expect(request).toMatchObject({ params: { ephemeral: true, cwd: '/tmp/isolated-fixture' } });
  });

  it('closes on malformed successful start responses because remote execution state is uncertain', async () => {
    const threadFixture = fixture(); await threadFixture.ready();
    const threadPending = threadFixture.transport.startThread({ model: 'model', cwd: '/tmp' });
    threadFixture.answer(threadFixture.sent.at(-1)!, { thread: {} });
    await expect(threadPending).rejects.toThrow('invalid');
    await expect(threadFixture.transport.startThread({ model: 'model', cwd: '/tmp' })).rejects.toThrow('closed');
    const turnFixture = fixture(); await turnFixture.ready(); await turnFixture.thread();
    const turnPending = turnFixture.transport.startTurn('thread-1', 'Prompt', 'message');
    turnFixture.answer(turnFixture.sent.at(-1)!, { turn: {} });
    await expect(turnPending).rejects.toThrow('invalid');
    await expect(turnFixture.transport.startTurn('thread-1', 'Prompt', 'message')).rejects.toThrow('closed');
  });

  it('rejects invalid/currently active targets and mismatched steering acknowledgements', async () => {
    const f = fixture(); await f.ready(); await f.thread(); await f.turn();
    await expect(f.transport.startTurn('thread-1', 'Prompt', 'message')).rejects.toThrow('already active');
    await expect(f.transport.interrupt('thread-1', 'wrong-turn')).rejects.toThrow('active turn');
    await expect(f.transport.startThread({ model: 'model', cwd: '/tmp' })).rejects.toThrow('active');
    const pending = f.transport.steer('thread-1', 'turn-1', 'Prompt', 'message');
    f.answer(f.sent.at(-1)!, { turnId: 'wrong-turn' });
    await expect(pending).rejects.toThrow('different turn');
  });

  it('fails closed on malformed/oversized records and does not echo wire contents', async () => {
    for (const wire of ['{"secret":"sensitive" broken}\n', 'x'.repeat(513)]) {
      const f = fixture({ maxRecordChars: 512 }); await f.ready();
      f.transport.receive(wire);
      expect(f.events.some(event => event.kind === 'diagnostic' && event.code === 'protocol-error')).toBe(true);
      expect(JSON.stringify(f.events)).not.toContain('sensitive');
      await expect(f.transport.startThread({ model: 'model', cwd: '/tmp' })).rejects.toThrow('closed');
    }
  });

  it('times out with no inferred cancellation and fences uncertain control state', async () => {
    vi.useFakeTimers();
    const f = fixture({ requestTimeoutMs: 10 }); await f.ready(); await f.thread(); await f.turn();
    const pending = f.transport.interrupt('thread-1', 'turn-1');
    const rejection = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10); await rejection;
    expect(f.events.some(event => event.kind === 'turn-ended')).toBe(false);
    await expect(f.transport.steer('thread-1', 'turn-1', 'Prompt', 'message')).rejects.toThrow('closed');
  });

  it('bounds pending requests and early-notification storage', async () => {
    const f = fixture({ maxPendingRequests: 1 }); await f.ready(); await f.thread(); await f.turn();
    const pending = f.transport.interrupt('thread-1', 'turn-1');
    await expect(f.transport.steer('thread-1', 'turn-1', 'Prompt', 'message')).rejects.toThrow('pending request limit');
    f.answer(f.sent.at(-1)!, {}); await pending;
    f.notification('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } });
    const start = f.transport.startTurn('thread-1', 'Prompt', 'message');
    for (let index = 0; index < 33; index++) f.notification('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-2', itemId: 'item', delta: 'Text' });
    await expect(start).rejects.toThrow('detached');
    expect(f.events.some(event => event.kind === 'diagnostic' && event.code === 'protocol-error')).toBe(true);
  });

  it('rejects unsupported server tool/approval requests instead of granting permission', async () => {
    const f = fixture(); await f.ready();
    f.transport.receive(JSON.stringify({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: {} }) + '\n');
    expect(f.sent.at(-1)).toEqual({ id: 'approval-1', error: { code: -32601, message: 'Canvas One has no handler for this server request' } });
  });

  it('registers only explicit board tools and relays exact scoped calls/results', async () => {
    const handle: CodexBoardTools['handle'] = vi.fn(async request => ({ success: true, value: request.tool === 'board_inspect' ? { revision: 1 } : { status: 'pending', authoredWrites: 0 } }));
    const f = fixture({ boardTools: { names: ['board_inspect', 'proposal_submit'], handle } });
    await f.ready(); await f.thread(); await f.turn();
    expect(f.sent[0]?.params?.capabilities).toEqual({ experimentalApi: true, requestAttestation: false });
    expect((f.sent[2]?.params?.dynamicTools as { type: string; name: string }[]).map(tool => [tool.type, tool.name])).toEqual([['function', 'board_inspect'], ['function', 'proposal_submit']]);
    for (const [index, tool] of ['board_inspect', 'proposal_submit'].entries()) {
      f.transport.receive(JSON.stringify({ id: `request-${index}`, method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1', callId: `call-${index}`, namespace: null, tool, arguments: {} } }) + '\n');
      await vi.waitFor(() => expect(f.sent.at(-1)).toMatchObject({ id: `request-${index}`, result: { success: true, contentItems: [{ type: 'inputText' }] } }));
      const calls = vi.mocked(handle).mock.calls;
      expect(calls[index]?.[0]).toMatchObject({ threadId: 'thread-1', turnId: 'turn-1', callId: `call-${index}`, tool, input: {}, epoch: 0 });
      expect(calls[index]?.[1]).toBeInstanceOf(AbortSignal);
    }
  });

  it('buffers early tool calls until the exact active turn is identified', async () => {
    const handle: CodexBoardTools['handle'] = vi.fn(async () => ({ success: true, value: { revision: 1 } }));
    const f = fixture({ boardTools: { names: ['board_inspect'], handle } }); await f.ready(); await f.thread();
    const pending = f.transport.startTurn('thread-1', 'Prompt', 'message');
    const turnRequest = f.sent.at(-1)!;
    for (const [id, turnId] of [['stale', 'old-turn'], ['current', 'turn-1']]) f.transport.receive(JSON.stringify({ id, method: 'item/tool/call', params: { threadId: 'thread-1', turnId, callId: id, namespace: null, tool: 'board_inspect', arguments: {} } }) + '\n');
    expect(handle).not.toHaveBeenCalled();
    f.answer(turnRequest, { turn: { id: 'turn-1' } }); await pending;
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));
    expect(vi.mocked(handle).mock.calls[0]?.[0]).toMatchObject({ callId: 'current' });
    expect(f.sent).toContainEqual({ id: 'stale', error: { code: -32000, message: 'Canvas One turn is not active' } });
  });

  it('never invokes handlers for shell tools, disabled tools or stale targets', async () => {
    const handle: CodexBoardTools['handle'] = vi.fn(async () => ({ success: true, value: {} }));
    const f = fixture({ boardTools: { names: ['board_inspect'], handle } }); await f.ready(); await f.thread(); await f.turn();
    for (const [tool, threadId, turnId] of [['shell', 'thread-1', 'turn-1'], ['proposal_submit', 'thread-1', 'turn-1'], ['board_inspect', 'old-thread', 'turn-1'], ['board_inspect', 'thread-1', 'old-turn']]) {
      f.transport.receive(JSON.stringify({ id: `${tool}-${threadId}-${turnId}`, method: 'item/tool/call', params: { threadId, turnId, callId: 'call', namespace: null, tool, arguments: {} } }) + '\n');
      expect(f.sent.at(-1)).toHaveProperty('error');
    }
    expect(handle).not.toHaveBeenCalled();
    expect(() => fixture({ boardTools: { names: ['shell' as never], handle } })).toThrow('Only Canvas One');
  });

  it('aborts detached handlers and never forwards their late results', async () => {
    let resolve!: (result: { success: boolean; value: unknown }) => void;
    const handle: CodexBoardTools['handle'] = vi.fn(() => new Promise<{ success: boolean; value: unknown }>(done => { resolve = done; }));
    const f = fixture({ boardTools: { names: ['board_inspect'], handle } }); await f.ready(); await f.thread(); await f.turn();
    f.transport.receive(JSON.stringify({ id: 'request', method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1', callId: 'call', namespace: null, tool: 'board_inspect', arguments: {} } }) + '\n');
    const signal = vi.mocked(handle).mock.calls[0]?.[1] as AbortSignal;
    f.transport.detachSession();
    expect(signal.aborted).toBe(true);
    expect(f.sent.at(-1)).toMatchObject({ id: 'request', error: { code: -32000 } });
    const sentCount = f.sent.length;
    resolve({ success: true, value: { secret: 'old-board' } });
    await Promise.resolve(); await Promise.resolve();
    expect(f.sent).toHaveLength(sentCount);
    expect(JSON.stringify(f.sent)).not.toContain('old-board');
  });

  it('fails closed on malformed calls without invoking the handler', async () => {
    const handle: CodexBoardTools['handle'] = vi.fn(async () => ({ success: true, value: {} }));
    const f = fixture({ boardTools: { names: ['board_inspect'], handle } }); await f.ready(); await f.thread(); await f.turn();
    f.transport.receive(JSON.stringify({ id: 'request', method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1', tool: 'board_inspect', arguments: {} } }) + '\n');
    expect(handle).not.toHaveBeenCalled();
    expect(f.sent.at(-1)).toMatchObject({ id: 'request', error: { code: -32602 } });
    await expect(f.transport.startTurn('thread-1', 'Prompt', 'message')).rejects.toThrow('closed');
  });

  it('rejects duplicate call IDs and bounds pending handlers', async () => {
    const handle: CodexBoardTools['handle'] = vi.fn(() => new Promise<{ success: boolean; value: unknown }>(() => {}));
    const f = fixture({ maxPendingRequests: 1, boardTools: { names: ['board_inspect'], handle } }); await f.ready(); await f.thread(); await f.turn();
    for (const callId of ['first', 'first', 'second']) f.transport.receive(JSON.stringify({ id: `request-${f.sent.length}`, method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1', callId, namespace: null, tool: 'board_inspect', arguments: {} } }) + '\n');
    expect(handle).toHaveBeenCalledTimes(1);
    expect(f.sent.at(-1)).toMatchObject({ error: { message: 'Canvas One tool request limit exceeded' } });
  });

  it('returns unsuccessful host results faithfully and rejects calls without a handler', async () => {
    const handle: CodexBoardTools['handle'] = vi.fn(async () => ({ success: false, value: { code: 'forbidden' } }));
    const f = fixture({ boardTools: { names: ['proposal_submit'], handle } }); await f.ready(); await f.thread(); await f.turn();
    const wire = { id: 'request', method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1', callId: 'call', namespace: null, tool: 'proposal_submit', arguments: {} } };
    f.transport.receive(JSON.stringify(wire) + '\n');
    await vi.waitFor(() => expect(f.sent.at(-1)).toEqual({ id: 'request', result: { contentItems: [{ type: 'inputText', text: '{"code":"forbidden"}' }], success: false } }));
    const unavailable = fixture(); await unavailable.ready(); await unavailable.thread(); await unavailable.turn();
    unavailable.transport.receive(JSON.stringify(wire) + '\n');
    expect(unavailable.sent.at(-1)).toMatchObject({ error: { code: -32601 } });
  });

  it('times out hanging tool work without forwarding success or keeping authority alive', async () => {
    vi.useFakeTimers();
    const handle: CodexBoardTools['handle'] = vi.fn(() => new Promise<{ success: boolean; value: unknown }>(() => {}));
    const f = fixture({ requestTimeoutMs: 10, boardTools: { names: ['board_inspect'], handle } }); await f.ready(); await f.thread(); await f.turn();
    f.transport.receive(JSON.stringify({ id: 'request', method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1', callId: 'call', namespace: null, tool: 'board_inspect', arguments: {} } }) + '\n');
    await vi.advanceTimersByTimeAsync(10);
    expect(vi.mocked(handle).mock.calls[0]?.[1].aborted).toBe(true);
    await expect(f.transport.startTurn('thread-1', 'Prompt', 'message')).rejects.toThrow('closed');
  });

  it('handles split CRLF responses and write failures', async () => {
    const f = fixture();
    const pending = f.transport.initialize();
    const response = JSON.stringify({ id: f.sent.at(-1)?.id, result: { userAgent: 'fixture' } }) + '\r\n';
    f.transport.receive(response.slice(0, 12)); f.transport.receive(response.slice(12)); await pending;
    const events: CodexTransportEvent[] = [];
    const broken = new CodexAppServerTransport({ write: () => { throw new Error('pipe closed'); }, onEvent: event => { events.push(event); } }); cleanup.push(broken);
    await expect(broken.initialize()).rejects.toThrow('could not be written');
    expect(events.at(-1)).toMatchObject({ code: 'connection-closed' });
  });
});
