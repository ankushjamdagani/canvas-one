#!/usr/bin/env node
import { StringDecoder } from 'node:string_decoder';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { startCollaborationServer } from '@canvas-one/agent-bridge/collaboration-server';
import { createLocalExecutionBackend } from '@canvas-one/agent-bridge/runtime';
import { startLocalBridge } from '@canvas-one/agent-bridge/server';
import { AGENT_TOOLS, type AgentTool } from '@canvas-one/agent-bridge';
import { callBoardTool, createMcpSession } from './index.js';
const args = process.argv.slice(2);
const command = args.shift() ?? 'help';
const option = (name: string): string | undefined => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
function serviceOptions(kind: 'collaborate' | 'bridge'): { origins: string[]; port?: number; claude?: string; codex?: string } {
  const values = new Map<string, string>(), origins: string[] = [];
  const allowed = kind === 'collaborate' ? ['--origin', '--port', '--claude-model', '--codex-model'] : ['--origin', '--port'];
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!flag || !allowed.includes(flag) || !value || value.startsWith('--') || value.includes('\0') || (flag !== '--origin' && values.has(flag))) throw new Error('Service options require supported flags and explicit values');
    if (flag === '--origin') {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) throw new Error('An exact HTTP browser origin is required');
      origins.push(value);
    } else { if (value.length > 200) throw new Error('Service option exceeds its limit'); values.set(flag, value); }
  }
  const rawPort = values.get('--port');
  const port = rawPort === undefined ? undefined : Number(rawPort);
  if (rawPort !== undefined && (!/^\d{1,5}$/.test(rawPort) || !Number.isSafeInteger(port) || port! < 0 || port! > 65535)) throw new Error('Port must be an integer between 0 and 65535');
  return { origins: origins.length ? origins : ['http://localhost:3000'], port, claude: values.get('--claude-model'), codex: values.get('--codex-model') };
}
async function main(): Promise<void> {
  if (command === 'collaborate') {
    const settings = serviceOptions('collaborate');
    let service!: Awaited<ReturnType<typeof startCollaborationServer>>;
    const backend = createLocalExecutionBackend({
      mcpCommand: process.execPath, mcpArgs: [fileURLToPath(import.meta.url)], serviceUrl: () => service.url,
      models: { claude: settings.claude, codex: settings.codex },
    });
    service = await startCollaborationServer({
      allowedOrigins: settings.origins,
      port: settings.port, now: () => performance.now(),
      pairingTtlMs: 5 * 60_000, sessionTtlMs: 8 * 60 * 60_000,
      leaseMs: 15_000, expiryIntervalMs: 1000, requestTimeoutMs: 30_000,
      maxEventRecords: 2000, maxEventBytes: 4 * 1024 * 1024, maxBrowserRequests: 64, backend,
      authorize: async (identity, metadata) => {
        const abort = new AbortController();
        const result = await service.requestBrowser(identity, { kind: 'authorize', data: metadata }, abort.signal);
        return result === true;
      },
      relay: (identity, data, signal) => service.requestBrowser(identity, { kind: 'tool', data }, signal),
    });
    process.stdout.write(JSON.stringify({ version: 1, url: service.url, pairingSecret: service.pairingSecret, pairingValidForMs: 5 * 60_000, leaseMs: 15_000 }, null, 2) + '\n');
    const stop = () => { void service.close().then(() => { process.exitCode = 0; }).catch(() => { process.exitCode = 1; }); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return;
  }
  if (command === 'bridge') {
    const settings = serviceOptions('bridge');
    const bridge = await startLocalBridge({allowedOrigins: settings.origins, port: settings.port});
    process.stdout.write(JSON.stringify({url: bridge.url, pairingCode: bridge.pairingCode, pairingExpiresAt: new Date(bridge.pairingExpiresAt).toISOString(), agentToken: bridge.agentToken}, null, 2) + '\n');
    const stop = () => {void bridge.close().then(() => {process.exitCode = 0;});};
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return;
  }
  const options = {url: option('--bridge') ?? process.env.CANVAS_ONE_BRIDGE_URL ?? 'http://127.0.0.1:47831', token: option('--token') ?? process.env.CANVAS_ONE_AGENT_TOKEN ?? ''};
  if (command === 'mcp' || command === 'mcp-v1') {
    const session = createMcpSession((tool, input, signal) => callBoardTool({ ...options, protocol: command === 'mcp-v1' ? 'collaboration-v1' : 'bridge' }, tool, input, undefined, signal));
    const decoder = new StringDecoder('utf8');
    let pending = '', discard = false;
    const parseError = () => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
    const handle = (line: string) => {
      if (!line.trim()) return;
      try {
        void session.handle(JSON.parse(line)).then(response => {
          if (response !== undefined) process.stdout.write(JSON.stringify(response) + '\n');
        }).catch(() => process.stderr.write('MCP request failed\n'));
      } catch { parseError(); }
    };
    const consume = (chunk: string) => {
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf('\n', start), end = newline < 0 ? chunk.length : newline;
        if (!discard) {
          if (pending.length + end - start > 1048576) { pending = ''; discard = true; parseError(); }
          else pending += chunk.slice(start, end);
        }
        if (newline < 0) break;
        if (!discard) handle(pending);
        pending = ''; discard = false; start = newline + 1;
      }
    };
    for await (const chunk of process.stdin) consume(decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    consume(decoder.end()); if (pending && !discard) handle(pending);
    session.dispose();
    return;
  }
  if (command === 'call') {
    const tool = args[0];
    if (!AGENT_TOOLS.some(item => item.name === tool)) throw new Error('Choose a tool from: ' + AGENT_TOOLS.map(item => item.name).join(', '));
    const input = option('--file') ? JSON.parse(await readFile(option('--file')!, 'utf8')) : JSON.parse(option('--input') ?? '{}');
    process.stdout.write(JSON.stringify(await callBoardTool(options, tool as AgentTool, input, option('--request-id')), null, 2) + '\n');
    return;
  }
  process.stdout.write('canvas-one-agent collaborate --origin http://localhost:3000 [--port 47831] [--claude-model model] [--codex-model model]\ncanvas-one-agent bridge --origin http://localhost:3000 [--port 47831]\ncanvas-one-agent call <tool> --input <json> [--file path] --token <bridge-token>\ncanvas-one-agent mcp --token <bridge-token>\n');
}
void main().catch(error => {process.stderr.write((error instanceof Error ? error.message : 'Agent command failed') + '\n'); process.exitCode = 1;});
