import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isBridgeRequest, type BridgeParticipant, type BridgeReply, type BridgeRequest } from './index.js';
type Pending = {request: BridgeRequest; fingerprint: string; reply?: BridgeReply; expiresAt: number; waiters: Set<(reply: BridgeReply) => void>};
export type LocalBridge = { readonly url: string; readonly pairingCode: string; readonly pairingExpiresAt: number; readonly agentToken: string; close(): Promise<void> };
function equal(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 1048576) throw new Error('Request too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** Loopback request relay only. The paired browser owns validation, review and all authored writes. */
export async function startLocalBridge(options: {readonly port?: number; readonly allowedOrigins: readonly string[]; readonly pairingTtlMs?: number; readonly sessionTtlMs?: number}): Promise<LocalBridge> {
  const allowed = new Set(options.allowedOrigins.map(origin => {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || origin !== url.origin) throw new TypeError('Supply exact HTTP(S) origins');
    return origin;
  }));
  if (!allowed.size) throw new TypeError('An allowed browser origin is required');
  const pairingCode = randomBytes(6).toString('hex');
  const agentToken = randomBytes(32).toString('hex');
  const pairingExpiresAt = Date.now() + (options.pairingTtlMs ?? 120000);
  const participant: BridgeParticipant = {actorId: randomUUID(), displayName: 'Local agent', kind: 'agent'};
  let paired: {token: string; origin: string; expiresAt: number} | null = null;
  let usedCode = false;
  const pending = new Map<string, Pending>();
  const respond = (response: ServerResponse, status: number, body: unknown): void => { response.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); response.end(JSON.stringify(body)); };
  const server = createServer((request, response) => {
    void (async () => {
      const origin = request.headers.origin;
      if (origin && !allowed.has(origin)) return respond(response, 403, {error: 'Origin is not allowed'});
      const host = request.headers.host ?? '';
      if (!/^127\.0\.0\.1:\d+$/.test(host)) return respond(response, 403, {error: 'Invalid loopback host'});
      if (origin) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); response.setHeader('Access-Control-Allow-Private-Network', 'true'); }
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
      const path = request.url;
      if (path === '/pair' && request.method === 'POST') {
        if (!origin || !allowed.has(origin)) return respond(response, 403, {error: 'Browser origin required'});
        const body = await readBody(request) as {code?: unknown};
        if (usedCode || Date.now() > pairingExpiresAt || typeof body.code !== 'string' || !equal(body.code, pairingCode)) return respond(response, 403, {error: 'Pairing code invalid or expired'});
        usedCode = true;
        paired = {token: randomBytes(32).toString('hex'), origin, expiresAt: Date.now() + (options.sessionTtlMs ?? 3600000)};
        return respond(response, 200, {token: paired.token, participant});
      }
      if (!paired || Date.now() > paired.expiresAt) return respond(response, 410, {error: 'No active paired browser'});
      const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      if (path?.startsWith('/browser/')) {
        if (origin !== paired.origin || !equal(token, paired.token)) return respond(response, 401, {error: 'Invalid browser session'});
        if (path === '/browser/disconnect' && request.method === 'POST') { paired = null; return respond(response, 200, {}); }
        if (path === '/browser/requests' && request.method === 'GET') return respond(response, 200, [...pending.values()].filter(item => !item.reply && item.expiresAt > Date.now()).map(item => item.request));
        if (path === '/browser/result' && request.method === 'POST') {
          const reply = await readBody(request) as BridgeReply;
          const found = pending.get(reply.requestId);
          if (!found || (Object.hasOwn(reply, 'result') === Object.hasOwn(reply, 'error')) || (reply.error !== undefined && typeof reply.error !== 'string')) return respond(response, 400, {error: 'Unknown or invalid result'});
          if (!found.reply) { found.reply = reply; for (const finish of found.waiters) finish(reply); found.waiters.clear(); }
          return respond(response, 200, {});
        }
      } else if (path === '/agent/request' && request.method === 'POST') {
        if (origin || !equal(token, agentToken)) return respond(response, 401, {error: 'Invalid agent session'});
        const body = await readBody(request);
        if (!isBridgeRequest(body)) return respond(response, 400, {error: 'Invalid tool request'});
        const fingerprint = JSON.stringify(body);
        let found = pending.get(body.requestId);
        if (found && found.fingerprint !== fingerprint) return respond(response, 409, {error: 'Request identity reused with different input'});
        if (!found) {
          for (const [id, item] of pending) if (item.expiresAt < Date.now() && !item.waiters.size) pending.delete(id);
          if (pending.size >= 1000 || [...pending.values()].filter(item => !item.reply).length >= 100) return respond(response, 429, {error: 'Request queue is full'});
          found = {request: body, fingerprint, expiresAt: Date.now() + 60000, waiters: new Set()}; pending.set(body.requestId, found);
        }
        if (found.reply) return respond(response, 200, found.reply);
        const entry = found;
        if (entry.expiresAt <= Date.now()) return respond(response, 408, {error: 'Browser did not answer before the request expired'});
        const finish = (reply: BridgeReply): void => { clearTimeout(timer); entry.waiters.delete(finish); if (!response.writableEnded) respond(response, 200, reply); };
        const timer = setTimeout(() => { entry.waiters.delete(finish); if (!response.writableEnded) respond(response, 408, {error: 'Browser did not answer before the request expired'}); }, entry.expiresAt - Date.now());
        entry.waiters.add(finish);
        response.on('close', () => {clearTimeout(timer); entry.waiters.delete(finish);});
        return;
      }
      respond(response, 404, {error: 'Unknown bridge endpoint'});
    })().catch(() => { if (!response.headersSent) respond(response, 400, {error: 'Invalid request body'}); });
  });
  await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(options.port ?? 47831, '127.0.0.1', resolve);});
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback binding failed');
  return {url: `http://127.0.0.1:${address.port}`, pairingCode, pairingExpiresAt, agentToken,
    close: () => new Promise<void>((resolve, reject) => {for (const item of pending.values()) for (const finish of item.waiters) finish({requestId: item.request.requestId, error: 'Bridge closed'}); pending.clear(); server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections();})};
}
