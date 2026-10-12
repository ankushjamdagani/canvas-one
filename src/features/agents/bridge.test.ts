import { afterEach, describe, expect, it } from 'vitest';
import { startLocalBridge, type LocalBridge } from '@canvas-one/agent-bridge/server';
import { callBoardTool, createMcpSession } from '@canvas-one/cli';
import { loopbackBridgeUrl } from '@canvas-one/agent-bridge';

let bridge: LocalBridge | undefined;
afterEach(async () => { await bridge?.close(); bridge = undefined; });
const origin = 'http://localhost:3000';
async function pair(code: string, from = origin) {
  return fetch(bridge!.url + '/pair', {method: 'POST', headers: {Origin: from, 'Content-Type': 'application/json'}, body: JSON.stringify({code})});
}
async function browser(path: string, token: string, body?: unknown, from = origin) {
  return fetch(bridge!.url + path, {method: body === undefined ? 'GET' : 'POST', headers: {Origin: from, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
}
describe('paired loopback bridge', () => {
  it('requires an exact allowed origin and one short-lived code, with distinct authenticated roles', async () => {
    bridge = await startLocalBridge({port: 0, allowedOrigins: [origin]});
    expect((await pair(bridge.pairingCode, 'https://untrusted.example')).status).toBe(403);
    expect((await pair('incorrect')).status).toBe(403);
    const paired = await pair(bridge.pairingCode);
    expect(paired.status).toBe(200);
    const credentials = await paired.json();
    expect(credentials.participant.kind).toBe('agent');
    expect((await pair(bridge.pairingCode)).status).toBe(403);
    expect((await browser('/browser/requests', bridge.agentToken)).status).toBe(401);
    expect((await browser('/browser/requests', credentials.token, undefined, 'http://localhost:3001')).status).toBe(403);
    expect((await browser('/browser/requests', credentials.token)).status).toBe(200);
  });
  it('relays requests, replays unanswered delivery and returns duplicate results without another browser edit', async () => {
    bridge = await startLocalBridge({port: 0, allowedOrigins: [origin]});
    const {token} = await (await pair(bridge.pairingCode)).json();
    const client = {url: bridge.url, token: bridge.agentToken};
    const answer = callBoardTool(client, 'proposal_submit', {operationId: 'proposal-1'}, 'request-1');
    let requests: unknown[] = [];
    for (let attempt = 0; attempt < 20 && !requests.length; attempt++) {
      requests = await (await browser('/browser/requests', token)).json();
      if (!requests.length) await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(requests).toHaveLength(1);
    expect(await (await browser('/browser/requests', token)).json()).toEqual(requests);
    expect((await browser('/browser/result', token, {requestId: 'request-1', result: {status: 'pending'}})).status).toBe(200);
    expect(await answer).toEqual({status: 'pending'});
    expect(await callBoardTool(client, 'proposal_submit', {operationId: 'proposal-1'}, 'request-1')).toEqual({status: 'pending'});
    expect(await (await browser('/browser/requests', token)).json()).toEqual([]);
    await expect(callBoardTool(client, 'board_inspect', {}, 'request-1')).rejects.toThrow('identity reused');
    await expect(callBoardTool({...client, token: 'wrong'}, 'board_inspect', {})).rejects.toThrow('Invalid agent session');
  });
  it('rejects expired pairing and non-loopback URLs', async () => {
    bridge = await startLocalBridge({port: 0, allowedOrigins: [origin], pairingTtlMs: -1});
    expect((await pair(bridge.pairingCode)).status).toBe(403);
    expect(() => loopbackBridgeUrl('https://127.0.0.1:1234')).toThrow();
    expect(() => loopbackBridgeUrl('http://example.com:1234')).toThrow();
    expect(() => loopbackBridgeUrl('http://secret@127.0.0.1:1234')).toThrow();
  });
});
describe('MCP stdio session', () => {
  it('handles ping and cancellation while a tool is pending, and bounds concurrency', async () => {
    let cancelled = false;
    const session = createMcpSession((_tool, _input, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { cancelled = true; reject(new Error('Cancelled')); }, {once: true});
    }));
    await session.handle({jsonrpc: '2.0', method: 'notifications/initialized'});
    const pending = session.handle({jsonrpc: '2.0', id: 10, method: 'tools/call', params: {name: 'board_inspect'}});
    expect(await session.handle({jsonrpc: '2.0', id: 11, method: 'ping'})).toMatchObject({result: {}});
    expect(await session.handle({jsonrpc: '2.0', id: 10, method: 'tools/call', params: {name: 'board_inspect'}})).toMatchObject({error: {code: -32600}});
    await session.handle({jsonrpc: '2.0', method: 'notifications/cancelled', params: {requestId: 10}});
    await pending;
    expect(cancelled).toBe(true);
    session.dispose();
  });
  it('negotiates initialization, discovers tools and forwards review proposals with structured errors', async () => {
    const calls: unknown[] = [];
    const session = createMcpSession(async (tool, input) => {calls.push({tool, input}); if (tool === 'proposal_status') throw new Error('No paired board'); return {status: 'pending'};});
    expect(await session.handle({jsonrpc: '2.0', id: 1, method: 'tools/list'})).toMatchObject({error: {code: -32000}});
    expect(await session.handle({jsonrpc: '2.0', id: 2, method: 'initialize', params: {protocolVersion: '2025-11-25'}})).toMatchObject({result: {protocolVersion: '2025-11-25', capabilities: {tools: {}}}});
    expect(await session.handle({jsonrpc: '2.0', method: 'notifications/initialized'})).toBeUndefined();
    expect(await session.handle({jsonrpc: '2.0', id: 3, method: 'tools/list'})).toMatchObject({result: {tools: expect.arrayContaining([expect.objectContaining({name: 'proposal_submit'})])}});
    expect(await session.handle({jsonrpc: '2.0', id: 4, method: 'tools/call', params: {name: 'proposal_submit', arguments: {operationId: 'p'}}})).toMatchObject({result: {isError: false}});
    expect(calls).toEqual([{tool: 'proposal_submit', input: {operationId: 'p'}}]);
    expect(await session.handle({jsonrpc: '2.0', id: 5, method: 'tools/call', params: {name: 'proposal_status', arguments: {operationId: 'p'}}})).toMatchObject({result: {isError: true, content: [{text: 'No paired board'}]}});
  });
});
