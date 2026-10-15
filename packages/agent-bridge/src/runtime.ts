import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexAppServerTransport } from './codex-transport.js';
import { launchManagedProcess, type ManagedProcess } from './process.js';
import { ProviderStreamNormalizer, type ProviderEventPayload } from './providers.js';
import { AGENT_TOOLS } from '@canvas-one/agents';
import { loopbackBridgeUrl } from './index.js';
import type { ExecutionBackend, CollaborationMessage } from './collaboration-server.js';

export type LocalRuntimeOptions = {
  /** The CLI bootstrap supplies its own installed MCP entry, never browser/provider arguments. */
  readonly mcpCommand: string;
  readonly mcpArgs: readonly string[];
  readonly serviceUrl: () => string;
  readonly models?: { readonly claude?: string; readonly codex?: string };
  readonly launchProcess?: typeof launchManagedProcess;
  readonly acknowledgementTimeoutMs?: number;
};
const readTools = AGENT_TOOLS.filter(tool => ['board_inspect', 'component_schemas', 'document_validate', 'proposal_status', 'clarification_request'].includes(tool.name));
const limits = { maxInputBytes: 4 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024, cancelGraceMs: 1000 };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const toolSucceeded = (value: unknown) => !(object(value) && (value.ok === false || value.success === false || typeof value.error === 'string' || ['failed', 'invalid', 'stale', 'missing', 'busy', 'conflict', 'rejected'].includes(String(value.status))));

/** CLI sign-in remains CLI-owned. agy's blocked board-tool transport is explicit, never silently bypassed. */
export function createLocalExecutionBackend(options: LocalRuntimeOptions): ExecutionBackend {
  const launch = options.launchProcess ?? launchManagedProcess;
  const acknowledgementMs = options.acknowledgementTimeoutMs ?? 30000;
  if (!Number.isSafeInteger(acknowledgementMs) || acknowledgementMs < 1) throw new RangeError('Invalid acknowledgement timeout');
  return {
    providerCapabilities: [
      { id: 'claude', available: true, detail: 'Local signed-in Claude CLI; refinement after the current response.' },
      { id: 'codex', available: true, detail: 'Local signed-in Codex app-server with scoped board tools.' },
      { id: 'agy', available: false, detail: 'Installed agy currently denies scoped MCP board tools. Support is blocked until this control path is verified.' },
    ],
    async launch(context) {
      if (context.signal.aborted) throw new Error('Execution was revoked before startup');
      if (context.provider === 'agy') throw new Error('agy board-tool transport is blocked; no permission bypass is enabled');
      const cwd = await mkdtemp(join(tmpdir(), 'canvas-one-agent-'));
      let child: ManagedProcess | undefined;
      const cleanup = () => rm(cwd, { recursive: true, force: true });
      try {
        if (context.provider === 'codex') {
          let transport!: CodexAppServerTransport;
          let threadId = '', turnId = '', terminal = false;
          let toolFailure = false;
          let terminalOutcome: 'succeeded' | 'failed' | 'cancelled' = 'failed';
          const emit = (payload: ProviderEventPayload) => context.emit(payload);
          const tools = context.mode === 'question' ? readTools : AGENT_TOOLS;
          transport = new CodexAppServerTransport({
            write: line => { child!.write(line); },
            onEvent: event => {
              if (event.kind === 'diagnostic' && event.code === 'connection-closed') { void child?.cancel().catch(() => {}); return; }
              if (event.kind === 'text') emit({ kind: 'text', text: event.delta, format: 'delta' });
              else if (event.kind === 'diagnostic' && event.code !== 'connection-closed') emit({ kind: 'diagnostic', code: 'provider-error', message: event.message });
              else if (event.kind === 'turn-ended') {
                terminal = true;
                terminalOutcome = event.outcome === 'completed' ? toolFailure ? 'failed' : 'succeeded' : event.outcome === 'interrupted' ? 'cancelled' : 'failed';
                emit({ kind: 'provider-result', outcome: terminalOutcome, cancellationAcknowledged: event.cancellationAcknowledged });
                // Completed app-server turns keep no worker alive awaiting a hidden instruction.
                void child!.cancel().catch(() => {});
              }
            },
            boardTools: {
              names: tools.map(tool => tool.name),
              handle: async (request, signal) => {
                if (signal.aborted || context.signal.aborted) return { success: false, value: { error: 'Execution revoked' } };
                emit({ kind: 'tool', toolId: request.callId, name: request.tool, phase: 'started' });
                try {
                  const value = await context.relay(context.capability, { requestId: request.callId, tool: request.tool, input: request.input });
                  const success = !signal.aborted && !context.signal.aborted && toolSucceeded(value);
                  if (!success) toolFailure = true;
                  emit({ kind: 'tool', toolId: request.callId, name: request.tool, phase: success ? 'completed' : 'failed' });
                  return { success, value };
                } catch {
                  toolFailure = true;
                  emit({ kind: 'tool', toolId: request.callId, name: request.tool, phase: 'failed' });
                  return { success: false, value: { error: 'Board authority rejected or revoked the request' } };
                }
              },
            },
          });
          child = launch({ command: 'codex', args: ['app-server', '--stdio', '-c', 'mcp_servers={}'], cwd, limits,
            onOutput: text => transport.receive(text), onDiagnostic: () => {} });
          const abort = () => { transport.detachSession(); void child!.cancel().catch(() => {}); };
          context.signal.addEventListener('abort', abort, { once: true });
          if (context.signal.aborted) abort();
          const finished = child.finished.then(result => {
            if (!terminal && !context.signal.aborted) emit({ kind: 'diagnostic', code: 'process-exit', message: 'Codex ended without a completed turn; check local sign-in and CLI compatibility.' });
            emit({ kind: 'attempt-ended', outcome: context.signal.aborted ? 'cancelled' : terminal ? terminalOutcome : 'failed', cancellationAcknowledged: context.signal.aborted });
            void result;
          }, () => { emit({ kind: 'attempt-ended', outcome: context.signal.aborted ? 'cancelled' : 'failed', cancellationAcknowledged: context.signal.aborted }); }).finally(async () => {
            context.signal.removeEventListener('abort', abort); transport.close(); await cleanup();
          });
          await transport.initialize();
          const config = { model: options.models?.codex ?? 'gpt-6-sol', cwd };
          threadId = context.providerSessionId ? await transport.resumeThread(context.providerSessionId, config) : await transport.startThread(config);
          emit({ kind: 'session', sessionId: threadId });
          turnId = await transport.startTurn(threadId, context.prompt, context.identity.attemptId);
          return {
            process: { finished, cancel: () => child!.cancel() },
            send: async message => {
              if (terminal || context.signal.aborted || message.target === 'task') return { delivered: false, acknowledged: false };
              const receipt = await transport.steer(threadId, turnId, message.text, message.messageId);
              return { delivered: true, acknowledged: receipt.acknowledged };
            },
          };
        }

        const toolNames = (context.mode === 'question' ? readTools : AGENT_TOOLS).map(tool => `mcp__canvas_one__${tool.name}`);
        const configPath = join(cwd, 'board-mcp.json');
        await writeFile(configPath, JSON.stringify({ mcpServers: { canvas_one: {
          command: options.mcpCommand, args: [...options.mcpArgs, 'mcp-v1', '--bridge', loopbackBridgeUrl(options.serviceUrl())],
          env: { CANVAS_ONE_AGENT_TOKEN: context.capability },
        } } }), { mode: 0o600 });
        let parser = new ProviderStreamNormalizer('claude', { taskId: context.identity.taskId, attemptId: context.identity.attemptId });
        let rawPending = '', turnActive = true, sawResult = false;
        let latestOutcome: 'succeeded' | 'failed' | 'cancelled' = 'failed';
        const pending = new Map<string, { finish: (value: { delivered: boolean; acknowledged: boolean }) => void; timer: ReturnType<typeof setTimeout> }>();
        const emit = (payload: ProviderEventPayload) => context.emit(payload);
        const settleMessages = () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.finish({ delivered: true, acknowledged: false }); } pending.clear(); };
        const output = (chunk: string) => {
          rawPending += chunk;
          if (rawPending.length > 1024 * 1024 && !rawPending.includes('\n')) throw new Error('Claude record exceeded its size limit');
          let newline: number;
          while ((newline = rawPending.indexOf('\n')) >= 0) {
            const line = rawPending.slice(0, newline); rawPending = rawPending.slice(newline + 1);
            if (line.length > 1024 * 1024) throw new Error('Claude record exceeded its size limit');
            for (const event of parser.push(line + '\n')) { emit(event.payload); if (event.payload.kind === 'provider-result') { sawResult = true; turnActive = false; latestOutcome = event.payload.outcome; } }
            let value: unknown;
            try { value = JSON.parse(line); } catch { continue; }
            if (object(value) && value.type === 'result') {
              parser = new ProviderStreamNormalizer('claude', { taskId: context.identity.taskId, attemptId: context.identity.attemptId });
              if (context.mode === 'question') child!.endInput();
            }
            if (object(value) && value.type === 'user' && object(value.message)) {
              // Text equality cannot correlate repeated instructions or a late echo from another message.
              const entry = typeof value.uuid === 'string' ? [...pending.entries()].find(([id]) => value.uuid === id) : undefined;
              if (entry) { clearTimeout(entry[1].timer); pending.delete(entry[0]); entry[1].finish({ delivered: true, acknowledged: true }); }
            }
          }
        };
        const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--replay-user-messages',
          '--tools', '', '--allowedTools', toolNames.join(','), '--strict-mcp-config', '--mcp-config', configPath, '--setting-sources', '', '--disable-slash-commands'];
        if (options.models?.claude) args.push('--model', options.models.claude);
        if (context.providerSessionId) args.push('--resume', context.providerSessionId);
        child = launch({ command: 'claude', args, cwd, limits, onOutput: output, onDiagnostic: () => {} });
        const abort = () => { void child!.cancel().catch(() => {}); };
        context.signal.addEventListener('abort', abort, { once: true });
        if (context.signal.aborted) abort();
        const finished = child.finished.then(result => {
          // A valid final NDJSON record may be closed without a trailing newline.
          if (rawPending.trim()) output('\n');
          // A fresh per-turn decoder may have no terminal record after the last completed response.
          if (context.signal.aborted) emit({ kind: 'attempt-ended', outcome: 'cancelled', cancellationAcknowledged: true });
          else if (!sawResult || turnActive) for (const event of parser.finish(result.code)) emit(event.payload);
          else emit({ kind: 'attempt-ended', outcome: context.signal.aborted ? 'cancelled' : result.code === 0 ? latestOutcome : 'failed', cancellationAcknowledged: context.signal.aborted });
        }, () => { emit({ kind: 'attempt-ended', outcome: context.signal.aborted ? 'cancelled' : 'failed', cancellationAcknowledged: context.signal.aborted }); }).finally(async () => {
          context.signal.removeEventListener('abort', abort); settleMessages(); await cleanup();
        });
        child.write(JSON.stringify({ type: 'user', message: { role: 'user', content: context.prompt } }) + '\n');
        return {
          process: { finished, cancel: () => child!.cancel() },
          send: async (message: CollaborationMessage) => {
            if (context.signal.aborted || turnActive || message.target === 'task' || pending.has(message.messageId) || pending.size >= 16) return { delivered: false, acknowledged: false };
            turnActive = true;
            return new Promise(resolve => {
              const timer = setTimeout(() => { pending.delete(message.messageId); resolve({ delivered: true, acknowledged: false }); }, acknowledgementMs); timer.unref();
              pending.set(message.messageId, { finish: resolve, timer });
              try { child!.write(JSON.stringify({ type: 'user', uuid: message.messageId, message: { role: 'user', content: message.text } }) + '\n'); }
              catch { clearTimeout(timer); pending.delete(message.messageId); turnActive = false; resolve({ delivered: false, acknowledged: false }); }
            });
          },
        };
      } catch (error) {
        if (child) { await child.cancel().catch(() => {}); await child.finished.catch(() => {}); }
        await cleanup();
        throw error;
      }
    },
  };
}
