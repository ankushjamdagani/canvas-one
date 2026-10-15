import { randomUUID } from 'node:crypto';
import { AGENT_TOOLS, loopbackBridgeUrl, type AgentTool, type BridgeReply } from '@canvas-one/agent-bridge';
export type AgentClientOptions = { readonly url: string; readonly token: string; readonly protocol?: 'bridge' | 'collaboration-v1' };
export async function callBoardTool(options: AgentClientOptions, tool: AgentTool, input: unknown, requestId: string = randomUUID(), signal?: AbortSignal): Promise<unknown> {
  if (!options.token) throw new TypeError('An agent bridge token is required');
  const endpoint = options.protocol === 'collaboration-v1' ? '/v1/agent/tool' : '/agent/request';
  const response = await fetch(loopbackBridgeUrl(options.url) + endpoint, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + options.token}, body: JSON.stringify({requestId, tool, input}), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(65000)]) : AbortSignal.timeout(65000)});
  const reply = await response.json() as BridgeReply & {error?: string};
  if (!response.ok || reply.error) throw new Error(reply.error ?? `Bridge returned ${response.status}`);
  return reply.result;
}
type RpcRequest = { readonly jsonrpc: '2.0'; readonly id?: string | number | null; readonly method: string; readonly params?: unknown };
export type McpSession = { handle(input: unknown): Promise<unknown | undefined>; dispose(): void };
/** MCP stdio lifecycle and tool dispatch; the transport writes exactly one JSON response per line. */
export function createMcpSession(call: (tool: AgentTool, input: unknown, signal: AbortSignal) => Promise<unknown>): McpSession {
  let initialized = false;
  const pending = new Map<string | number, AbortController>();
  let disposed = false;
  return {async handle(input) {
    const request = input as Partial<RpcRequest> | null;
    const id = request?.id ?? null;
    const error = (code: number, message: string) => ({jsonrpc: '2.0', id, error: {code, message}});
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || (request.id !== undefined && request.id !== null && typeof request.id !== 'string' && typeof request.id !== 'number')) return error(-32600, 'Invalid Request');
    if (request.id === undefined) {
      if (request.method === 'notifications/initialized') initialized = true;
      if (request.method === 'notifications/cancelled') {
        const cancelled = (request.params as {requestId?: unknown} | undefined)?.requestId;
        if (typeof cancelled === 'string' || typeof cancelled === 'number') pending.get(cancelled)?.abort();
      }
      return undefined;
    }
    if (disposed) return error(-32000, 'MCP session is closed');
    const result = (value: unknown) => ({jsonrpc: '2.0', id, result: value});
    if (request.method === 'initialize') {
      const requested = (request.params as {protocolVersion?: unknown} | undefined)?.protocolVersion;
      return result({protocolVersion: requested === '2025-03-26' ? requested : '2025-11-25', capabilities: {tools: {}}, serverInfo: {name: 'canvas-one', version: '0.1.0'}});
    }
    if (request.method === 'ping') return result({});
    if (!initialized) return error(-32000, 'Complete MCP initialization before using tools');
    if (request.method === 'tools/list') return result({tools: AGENT_TOOLS.map(tool => ({...tool, annotations: {readOnlyHint: !['proposal_submit', 'diagram_create', 'action_submit'].includes(tool.name), destructiveHint: tool.name === 'action_submit', idempotentHint: true, openWorldHint: false}}))});
    if (request.method === 'tools/call') {
      const params = request.params as {name?: unknown; arguments?: unknown} | undefined;
      if (!AGENT_TOOLS.some(tool => tool.name === params?.name)) return error(-32602, 'Unknown tool');
      if (id === null || pending.has(id)) return error(-32600, 'Tool requests require a unique non-null ID');
      if (pending.size >= 100) return error(-32000, 'Too many pending tool requests');
      const controller = new AbortController(); pending.set(id, controller);
      try { const value = await call(params!.name as AgentTool, params?.arguments ?? {}, controller.signal); return controller.signal.aborted ? undefined : result({content: [{type: 'text', text: JSON.stringify(value)}], isError: false}); }
      catch (failure) { return result({content: [{type: 'text', text: failure instanceof Error ? failure.message : 'Tool request failed'}], isError: true}); }
      finally { pending.delete(id); }
    }
    return error(-32601, 'Method not found');
  }, dispose() { disposed = true; for (const controller of pending.values()) controller.abort(); pending.clear(); }};
}
