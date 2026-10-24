import { access, readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalExecutionBackend, type LocalRuntimeOptions } from '@canvas-one/agent-bridge/runtime';
import type { ManagedProcess } from '@canvas-one/agent-bridge/process';
import type { ExecutionBackend } from '@canvas-one/agent-bridge/collaboration-server';
import type { ProviderEventPayload } from '@canvas-one/agent-bridge';

type LaunchOptions = Parameters<NonNullable<LocalRuntimeOptions['launchProcess']>>[0];
type Context = Parameters<ExecutionBackend['launch']>[0];
type Worker = { options: LaunchOptions; writes: string[]; process: ManagedProcess; output: (value: unknown, newline?: boolean) => void; close: (code?: number | null, error?: Error) => void };
const workers: Worker[] = [];
const completions: Promise<void>[] = [];
afterEach(async () => { for (const worker of workers.splice(0)) worker.close(); await Promise.allSettled(completions.splice(0)); vi.useRealTimers(); });

function launcher(options: { cancelCloses?: boolean; failWrites?: boolean; rpcError?: string } = {}) {
  return vi.fn((args: LaunchOptions): ManagedProcess => {
    const writes: string[] = [];
    let closed = false, inputEnded = false;
    let resolve!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
    let reject!: (error: Error) => void;
    let acknowledgeClose!: () => void;
    const finished = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done, fail) => { resolve = done; reject = fail; });
    void finished.catch(() => {});
    const closeReceipt = new Promise<void>(done => { acknowledgeClose = done; });
    const close = (code: number | null = 0, error?: Error) => {
      if (closed) return;
      closed = true; acknowledgeClose();
      if (error) reject(error); else resolve({ code, signal: code === null ? 'SIGTERM' : null });
    };
    const output = (value: unknown, newline = true) => args.onOutput(JSON.stringify(value) + (newline ? '\n' : ''));
    const process: ManagedProcess = {
      finished,
      write: vi.fn(line => {
        if (closed || inputEnded || options.failWrites) throw new Error('Fake input is closed');
        writes.push(line);
        if (args.command !== 'codex') return;
        const value = JSON.parse(line) as { id?: string; method?: string; params?: Record<string, unknown> };
        if (!value.id) return;
        queueMicrotask(() => {
          if (options.rpcError === value.method) { output({ id: value.id, error: { code: -32000, message: 'Fixture failure' } }); return; }
          const result = value.method === 'initialize' ? { userAgent: 'fixture' } : value.method === 'thread/start' || value.method === 'thread/resume' ? { thread: { id: value.params?.threadId ?? 'thread-fixture' } } : value.method === 'turn/start' ? { turn: { id: 'turn-fixture' } } : value.method === 'turn/steer' ? { turnId: value.params?.expectedTurnId } : {};
          output({ id: value.id, result });
        });
      }),
      endInput: vi.fn(() => { inputEnded = true; }),
      cancel: vi.fn(async () => { if (options.cancelCloses !== false) close(null); await closeReceipt; }),
    };
    workers.push({ options: args, writes, process, output, close });
    return process;
  });
}
function context(provider: 'claude' | 'codex' | 'agy', overrides: Partial<Context> = {}) {
  const controller = new AbortController(), events: ProviderEventPayload[] = [];
  const value: Context = {
    identity: { taskId: 'task', attemptId: 'attempt', actorId: 'agent', generation: 1, projectId: 'project', branchId: 'branch', boardId: 'board' },
    provider, prompt: 'Describe the selected board', mode: 'task', capability: 'private-capability-must-not-appear-in-argv', signal: controller.signal,
    emit: payload => { events.push(payload); }, relay: vi.fn(async () => ({ ok: true })), ...overrides,
  };
  return { value, controller, events };
}
function backend(launchProcess: NonNullable<LocalRuntimeOptions['launchProcess']>, acknowledgementTimeoutMs = 30_000) {
  return createLocalExecutionBackend({ mcpCommand: '/trusted/canvas-cli', mcpArgs: ['/trusted/main.mjs'], serviceUrl: () => 'http://127.0.0.1:4318', launchProcess, models: { claude: 'claude-opus-5-5', codex: 'gpt-6-sol' }, acknowledgementTimeoutMs });
}
async function start(provider: 'claude' | 'codex', overrides: Partial<Context> = {}, launch = launcher()) {
  const ctx = context(provider, overrides);
  const run = await backend(launch).launch(ctx.value);
  completions.push(run.process.finished);
  return { ...ctx, run, worker: workers.at(-1)!, launch };
}
const claudeResult = { type: 'result', subtype: 'success', is_error: false, result: 'Done', permission_denials: [] };

describe('local runtime adapters with fake managed processes', () => {
  it('rejects malformed CLI service options before binding or printing a descriptor', async () => {
    const cli = fileURLToPath(new URL('../../../packages/cli/dist/main.js', import.meta.url));
    for (const args of [['--port', 'NaN'], ['--port', '65536'], ['--port'], ['--origin'], ['--origin', 'http://localhost:5173/path'], ['--unknown', 'value'], ['--port', '0', '--port', '1']]) {
      const child = spawn(process.execPath, [cli, 'collaborate', ...args], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
      let output = ''; child.stdout.on('data', chunk => { output += chunk.toString(); });
      const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', value => resolve(value)); });
      expect(code).toBe(1); expect(output).toBe('');
    }
  });
  it('bounds MCP input before newline and recovers at the next record boundary', async () => {
    const cli = fileURLToPath(new URL('../../../packages/cli/dist/main.js', import.meta.url));
    const child = spawn(process.execPath, [cli, 'mcp-v1'], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let output = ''; child.stdout.on('data', chunk => { output += chunk.toString(); });
    const closed = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code)); });
    child.stdin.end('x'.repeat(1048577) + '\n' + JSON.stringify({ jsonrpc: '2.0', id: 'initialization', method: 'initialize', params: {} }) + '\n');
    expect(await closed).toBe(0);
    const records = output.trim().split('\n').map(line => JSON.parse(line));
    expect(records.filter(record => record.error?.code === -32700)).toHaveLength(1);
    expect(records.find(record => record.id === 'initialization')).toHaveProperty('result');
  });
  it('boots the built CLI service without inference and shuts down after SIGTERM', async () => {
    const cli = fileURLToPath(new URL('../../../packages/cli/dist/main.js', import.meta.url));
    const child = spawn(process.execPath, [cli, 'collaborate', '--port', '0', '--origin', 'http://localhost:5173'], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
    try {
      const descriptor = await new Promise<Record<string, unknown>>((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('CLI startup timed out')), 5000);
        child.once('error', () => { clearTimeout(timer); reject(new Error('CLI could not launch')); });
        child.once('close', () => { clearTimeout(timer); reject(new Error('CLI closed before startup')); });
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
          if (output.length > 64 * 1024) { clearTimeout(timer); reject(new Error('CLI descriptor exceeded its size limit')); return; }
          try { const value = JSON.parse(output); clearTimeout(timer); resolve(value); } catch { /* Wait for a complete descriptor. */ }
        });
      });
      expect(Object.keys(descriptor).sort()).toEqual(['leaseMs', 'pairingSecret', 'pairingValidForMs', 'url', 'version']);
      expect(descriptor.version).toBe(1);
      expect(descriptor.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(typeof descriptor.pairingSecret).toBe('string');
      expect(descriptor).not.toHaveProperty('capability');
      expect(descriptor).not.toHaveProperty('agentToken');
      child.kill('SIGTERM');
      await expect(closed).resolves.toEqual({ code: 0, signal: null });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await closed;
    }
  });
  it('launches Claude in an isolated directory with private MCP config, no secret argv and explicit resume', async () => {
    const h = await start('claude', { providerSessionId: 'explicit-claude-session' });
    expect(h.worker.options.command).toBe('claude');
    expect(h.worker.options.cwd).toContain('canvas-one-agent-');
    expect(h.worker.options.args).toEqual(expect.arrayContaining(['--resume', 'explicit-claude-session', '--model', 'claude-opus-5-5', '--tools', '', '--strict-mcp-config']));
    expect(h.worker.options.args.join(' ')).not.toContain(h.value.capability);
    const configIndex = h.worker.options.args.indexOf('--mcp-config');
    const configPath = h.worker.options.args[configIndex + 1]!;
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    expect(config.mcpServers.canvas_one.env).toEqual({ CANVAS_ONE_AGENT_TOKEN: h.value.capability });
    expect(config.mcpServers.canvas_one.args).toEqual(['/trusted/main.mjs', 'mcp-v1', '--bridge', 'http://127.0.0.1:4318']);
    expect(JSON.parse(h.worker.writes[0]!)).toMatchObject({ type: 'user', message: { content: h.value.prompt } });
    h.worker.output(claudeResult); h.worker.close(); await h.run.process.finished;
    await expect(access(h.worker.options.cwd)).rejects.toThrow();
  });

  it('launches Codex app-server with scoped dynamic tools and exact explicit session IDs', async () => {
    const h = await start('codex', { providerSessionId: 'explicit-codex-thread' });
    expect(h.worker.options.args).toEqual(['app-server', '--stdio', '-c', 'mcp_servers={}']);
    expect(h.worker.options.args.join(' ')).not.toContain(h.value.capability);
    const requests = h.worker.writes.map(line => JSON.parse(line));
    expect(requests.find(value => value.method === 'thread/resume')).toMatchObject({ params: { threadId: 'explicit-codex-thread', model: 'gpt-6-sol' } });
    expect(requests.find(value => value.method === 'turn/start')).toMatchObject({ params: { threadId: 'explicit-codex-thread', clientUserMessageId: 'attempt' } });
    expect(h.events).toContainEqual({ kind: 'session', sessionId: 'explicit-codex-thread' });
    h.worker.output({ method: 'turn/completed', params: { threadId: 'explicit-codex-thread', turn: { id: 'turn-fixture', status: 'completed' } } });
    await h.run.process.finished;
    expect(h.events.at(-1)).toMatchObject({ kind: 'attempt-ended', outcome: 'succeeded', cancellationAcknowledged: false });
    await expect(access(h.worker.options.cwd)).rejects.toThrow();
  });

  it('keeps question tools read-only for both providers and closes Claude question input after a response', async () => {
    for (const provider of ['claude', 'codex'] as const) {
      const h = await start(provider, { mode: 'question' });
      if (provider === 'claude') {
        const names = h.worker.options.args[h.worker.options.args.indexOf('--allowedTools') + 1]!;
        expect(names).toContain('board_inspect');
        for (const name of ['proposal_submit', 'diagram_create', 'action_submit']) expect(names).not.toContain(name);
        h.worker.output(claudeResult);
        expect(h.worker.process.endInput).toHaveBeenCalledOnce();
        h.worker.close();
      } else {
        const startRequest = h.worker.writes.map(line => JSON.parse(line)).find(value => value.method === 'thread/start');
        const names = startRequest.params.dynamicTools.map((tool: { name: string }) => tool.name);
        expect(names).toContain('board_inspect');
        for (const name of ['proposal_submit', 'diagram_create', 'action_submit']) expect(names).not.toContain(name);
        h.worker.output({ method: 'turn/completed', params: { threadId: 'thread-fixture', turn: { id: 'turn-fixture', status: 'completed' } } });
      }
      await h.run.process.finished;
    }
  });

  it('rejects unsupported agy and already-revoked work before launching a process', async () => {
    const launch = launcher();
    const agy = context('agy');
    await expect(backend(launch).launch(agy.value)).rejects.toThrow('blocked');
    const revoked = context('claude'); revoked.controller.abort();
    await expect(backend(launch).launch(revoked.value)).rejects.toThrow('revoked');
    expect(launch).not.toHaveBeenCalled();
  });

  it('does not acknowledge cancellation before managed process close and acknowledges it after close', async () => {
    const h = await start('codex', {}, launcher({ cancelCloses: false }));
    h.controller.abort();
    expect(h.worker.process.cancel).toHaveBeenCalled();
    expect(h.events.some(event => event.kind === 'attempt-ended')).toBe(false);
    h.worker.close(null);
    await h.run.process.finished;
    expect(h.events.at(-1)).toEqual({ kind: 'attempt-ended', outcome: 'cancelled', cancellationAcknowledged: true });
  });

  it('classifies aborted active Claude work as cancelled only after actual close', async () => {
    const h = await start('claude', {}, launcher({ cancelCloses: false }));
    h.controller.abort();
    expect(h.events.some(event => event.kind === 'attempt-ended')).toBe(false);
    h.worker.close(null);
    await h.run.process.finished;
    expect(h.events.at(-1)).toEqual({ kind: 'attempt-ended', outcome: 'cancelled', cancellationAcknowledged: true });
  });

  it('handles close-time process rejection as failure, with acknowledgement only for explicitly revoked work', async () => {
    for (const revoked of [false, true]) {
      const h = await start('claude', {}, launcher({ cancelCloses: false }));
      if (revoked) h.controller.abort();
      h.worker.close(null, new Error('Failure observed on process close'));
      await h.run.process.finished;
      expect(h.events.at(-1)).toEqual({ kind: 'attempt-ended', outcome: revoked ? 'cancelled' : 'failed', cancellationAcknowledged: revoked });
    }
  });

  it('flushes a valid Claude final record without a newline before classifying the exit', async () => {
    const h = await start('claude');
    h.worker.output(claudeResult, false); h.worker.close();
    await h.run.process.finished;
    expect(h.events).toContainEqual({ kind: 'provider-result', outcome: 'succeeded', cancellationAcknowledged: false });
    expect(h.events.at(-1)).toMatchObject({ kind: 'attempt-ended', outcome: 'succeeded' });
  });

  it('requires explicit Claude feedback acknowledgement after the current response', async () => {
    const h = await start('claude');
    const message = { messageId: 'feedback-1', target: 'proposal-revision' as const, text: 'Revise this proposal' };
    expect(await h.run.send(message)).toEqual({ delivered: false, acknowledged: false });
    h.worker.output(claudeResult);
    const sent = h.run.send(message);
    expect(JSON.parse(h.worker.writes.at(-1)!)).toMatchObject({ uuid: 'feedback-1', message: { content: message.text } });
    h.worker.output({ type: 'user', uuid: 'feedback-1', message: { content: message.text } });
    await expect(sent).resolves.toEqual({ delivered: true, acknowledged: true });
    h.worker.output(claudeResult); h.worker.close(); await h.run.process.finished;
  });

  it('reports unacknowledged Claude delivery on timeout and settles it when the process closes', async () => {
    const launch = launcher();
    const ctx = context('claude');
    const run = await backend(launch, 5).launch(ctx.value); completions.push(run.process.finished);
    const worker = workers.at(-1)!;
    worker.output(claudeResult);
    await expect(run.send({ messageId: 'no-ack', target: 'clarification', text: 'Please clarify' })).resolves.toEqual({ delivered: true, acknowledged: false });
    worker.output(claudeResult);
    const pending = run.send({ messageId: 'close-before-ack', target: 'clarification', text: 'Another clarification' });
    worker.close(); await run.process.finished;
    await expect(pending).resolves.toEqual({ delivered: true, acknowledged: false });
  });
  it('does not acknowledge a repeated Claude instruction from another message ID', async () => {
    const launch = launcher(), ctx = context('claude');
    const run = await backend(launch, 5).launch(ctx.value); completions.push(run.process.finished);
    const worker = workers.at(-1)!; worker.output(claudeResult);
    const sent = run.send({ messageId: 'current-feedback', target: 'clarification', text: 'Repeated text' });
    worker.output({ type: 'user', uuid: 'old-message', message: { content: 'Repeated text' } });
    await expect(sent).resolves.toEqual({ delivered: true, acknowledged: false });
    worker.close(); await run.process.finished;
  });

  it('reports Codex steering acknowledgement/failure and does not silently turn feedback into a new task', async () => {
    const h = await start('codex');
    expect(await h.run.send({ messageId: 'new-task', target: 'task', text: 'New work' })).toEqual({ delivered: false, acknowledged: false });
    expect(await h.run.send({ messageId: 'feedback', target: 'clarification', text: 'Clarify' })).toEqual({ delivered: true, acknowledged: true });
    expect(h.worker.writes.map(line => JSON.parse(line)).find(value => value.method === 'turn/steer')).toMatchObject({ params: { expectedTurnId: 'turn-fixture', clientUserMessageId: 'feedback' } });
    h.worker.output({ method: 'turn/completed', params: { threadId: 'thread-fixture', turn: { id: 'turn-fixture', status: 'completed' } } }); await h.run.process.finished;
    const denied = await start('codex', {}, launcher({ rpcError: 'turn/steer' }));
    await expect(denied.run.send({ messageId: 'denied', target: 'clarification', text: 'Clarify' })).rejects.toThrow('rejected');
    denied.worker.close(1); await denied.run.process.finished;
  });
  it('retains atomic host tool failure despite a later successful Codex turn', async () => {
    const h = await start('codex', { relay: async () => ({ status: 'failed', code: 'ineligible' }) });
    h.worker.output({ id: 'tool-request', method: 'item/tool/call', params: { threadId: 'thread-fixture', turnId: 'turn-fixture', callId: 'call', namespace: null, tool: 'action_submit', arguments: {} } });
    await vi.waitFor(() => expect(h.worker.writes.map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ id: 'tool-request', result: expect.objectContaining({ success: false }) })));
    h.worker.output({ method: 'turn/completed', params: { threadId: 'thread-fixture', turn: { id: 'turn-fixture', status: 'completed' } } });
    await h.run.process.finished;
    expect(h.events.at(-1)).toMatchObject({ kind: 'attempt-ended', outcome: 'failed' });
  });

  it('cleans up startup failures without disclosing capability in diagnostics', async () => {
    const launch = launcher({ rpcError: 'initialize' });
    const ctx = context('codex');
    await expect(backend(launch).launch(ctx.value)).rejects.toThrow('rejected');
    const worker = workers.at(-1)!;
    expect(worker.process.cancel).toHaveBeenCalled();
    await expect(access(worker.options.cwd)).rejects.toThrow();
    expect(JSON.stringify(ctx.events)).not.toContain(ctx.value.capability);
  });
});
