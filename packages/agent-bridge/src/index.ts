export { AGENT_TOOLS, type AgentTool } from '@canvas-one/agents';
import { AGENT_TOOLS, type AgentTool } from '@canvas-one/agents';
export type BridgeRequest = { readonly requestId: string; readonly tool: AgentTool; readonly input: unknown };
export type BridgeParticipant = { readonly actorId: string; readonly displayName: string; readonly kind: 'agent' };
export type BridgeReply = { readonly requestId: string; readonly result?: unknown; readonly error?: string };
export function loopbackBridgeUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new TypeError('Bridge URL must be a plain HTTP loopback origin');
  return url.origin;
}
export function isBridgeRequest(value: unknown): value is BridgeRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<BridgeRequest>;
  return typeof request.requestId === 'string' && request.requestId.length > 0 && request.requestId.length <= 200 && AGENT_TOOLS.some(tool => tool.name === request.tool) && Object.hasOwn(request, 'input');
}
