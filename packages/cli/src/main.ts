#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { startLocalBridge } from '@canvas-one/agent-bridge/server';
import { AGENT_TOOLS, type AgentTool } from '@canvas-one/agent-bridge';
import { callBoardTool, createMcpSession } from './index.js';
const args = process.argv.slice(2);
const command = args.shift() ?? 'help';
const option = (name: string): string | undefined => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
async function main(): Promise<void> {
  if (command === 'bridge') {
    const origins = args.flatMap((value, index) => value === '--origin' ? [args[index + 1]] : []).filter((value): value is string => !!value);
    const bridge = await startLocalBridge({allowedOrigins: origins.length ? origins : ['http://localhost:3000'], port: option('--port') ? Number(option('--port')) : undefined});
    process.stdout.write(JSON.stringify({url: bridge.url, pairingCode: bridge.pairingCode, pairingExpiresAt: new Date(bridge.pairingExpiresAt).toISOString(), agentToken: bridge.agentToken}, null, 2) + '\n');
    const stop = () => {void bridge.close().then(() => {process.exitCode = 0;});};
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return;
  }
  const options = {url: option('--bridge') ?? process.env.CANVAS_ONE_BRIDGE_URL ?? 'http://127.0.0.1:47831', token: option('--token') ?? process.env.CANVAS_ONE_AGENT_TOKEN ?? ''};
  if (command === 'mcp') {
    const session = createMcpSession((tool, input, signal) => callBoardTool(options, tool, input, undefined, signal));
    const lines = createInterface({input: process.stdin, crlfDelay: Infinity});
    for await (const line of lines) {
      try {
        if (line.length > 1048576) throw new Error('MCP message exceeds limit');
        void session.handle(JSON.parse(line)).then(response => {
          if (response !== undefined) process.stdout.write(JSON.stringify(response) + '\n');
        }).catch(() => process.stderr.write('MCP request failed\n'));
      } catch { process.stdout.write(JSON.stringify({jsonrpc: '2.0', id: null, error: {code: -32700, message: 'Parse error'}}) + '\n'); }
    }
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
  process.stdout.write('canvas-one-agent bridge --origin http://localhost:3000 [--port 47831]\ncanvas-one-agent call <tool> --input <json> [--file path] --token <bridge-token>\ncanvas-one-agent mcp --token <bridge-token>\n');
}
void main().catch(error => {process.stderr.write((error instanceof Error ? error.message : 'Agent command failed') + '\n'); process.exitCode = 1;});
