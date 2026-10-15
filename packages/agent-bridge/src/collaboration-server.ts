import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ExecutionSupervisor, type ExecutionIdentity, type ExecutionProcess } from './execution.js';
import type { LocalAgentProvider, ProviderEventPayload } from './providers.js';
import { isBridgeRequest } from './index.js';

export type CollaborationMessage = { readonly messageId: string; readonly target: 'task' | 'clarification' | 'proposal-revision'; readonly text: string };
export type CollaborationStartRequest = { readonly version: 1; readonly identity: ExecutionIdentity; readonly provider: LocalAgentProvider; readonly prompt: string; readonly providerSessionId?: string; readonly mode?: 'task' | 'question' };
export type ProviderAvailability = { readonly id: LocalAgentProvider; readonly available: boolean; readonly detail: string };
export type StartMetadata = { readonly provider: LocalAgentProvider; readonly mode: 'task' | 'question'; readonly providerSessionId?: string };
export type CollaborationBoundRequest = { readonly version: 1; readonly identity: ExecutionIdentity };
export type CollaborationSendRequest = CollaborationBoundRequest & { readonly message: CollaborationMessage };
export type BrowserAuthorityPayload = { readonly kind: 'authorize' | 'tool'; readonly data: unknown };
export type BrowserAuthorityRequest = { readonly version: 1; readonly requestId: string; readonly identity: ExecutionIdentity; readonly payload: BrowserAuthorityPayload };
export type CollaborationEvent = { readonly version: 1; readonly cursor: number; readonly identity: ExecutionIdentity; readonly provider: LocalAgentProvider; readonly payload: ProviderEventPayload };
export type ExecutionBackend = {
  readonly providerCapabilities?: readonly ProviderAvailability[];
  launch(context: {
    readonly identity: ExecutionIdentity; readonly provider: LocalAgentProvider; readonly prompt: string;
    readonly mode: 'task' | 'question'; readonly providerSessionId?: string;
    /** Private to the trusted backend; never returned by a browser endpoint. */
    readonly capability: string; readonly signal: AbortSignal;
    readonly emit: (payload: ProviderEventPayload) => void;
    readonly relay: (capability: string, payload: unknown) => Promise<unknown>;
  }): Promise<{ readonly process: ExecutionProcess; readonly send: (message: CollaborationMessage) => Promise<{ readonly delivered: boolean; readonly acknowledged: boolean }> }>;
};
export type CollaborationServerOptions = {
  readonly port?: number; readonly allowedOrigins: readonly string[]; readonly now: () => number;
  readonly pairingTtlMs: number; readonly sessionTtlMs: number; readonly leaseMs: number; readonly expiryIntervalMs: number;
  readonly maxEventRecords: number; readonly maxEventBytes: number; readonly backend: ExecutionBackend;
  readonly requestTimeoutMs: number; readonly maxBrowserRequests: number;
  /** Bounded process metadata/tombstones for this pairing lifetime. Restart rotates all transport secrets. */
  readonly maxSessionAttempts?: number;
  /** Authored host validates durable task authority before any process is launched. */
  readonly authorize: (identity: ExecutionIdentity, metadata: StartMetadata) => Promise<boolean>;
  /** Must recheck identity and eligibility inside any atomic authored write transaction. */
  readonly relay: (identity: ExecutionIdentity, payload: unknown, signal: AbortSignal) => Promise<unknown>;
};
export type LocalCollaborationServer = {
  readonly url: string; readonly pairingSecret: string; readonly pairingExpiresAt: number;
  /** Node-only RPC; the browser can answer queued requests but cannot choose or enqueue authority. */
  requestBrowser(identity: ExecutionIdentity, payload: BrowserAuthorityPayload, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
};
type Attempt = { identity: ExecutionIdentity; provider: LocalAgentProvider; mode: 'task' | 'question'; abort: AbortController; hasProcess?: boolean; finished?: boolean; capability?: string; terminal?: Extract<ProviderEventPayload, { kind: 'attempt-ended' }>; send?: (message: CollaborationMessage) => Promise<{ readonly delivered: boolean; readonly acknowledged: boolean }> };
type ArchivedAttempt = { readonly identity: ExecutionIdentity; readonly provider: LocalAgentProvider; readonly mode: 'task' | 'question'; readonly cancellation: 'none' | 'acknowledged' };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 200): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const identityKeys = ['taskId', 'attemptId', 'projectId', 'branchId', 'boardId', 'actorId', 'generation'];
function identity(value: unknown): value is ExecutionIdentity {
  return record(value) && Object.keys(value).length === identityKeys.length && identityKeys.every(key => Object.hasOwn(value, key)) && identityKeys.slice(0, -1).every(key => text(value[key])) && Number.isSafeInteger(value.generation) && (value.generation as number) >= 1;
}
function same(a: ExecutionIdentity, b: ExecutionIdentity) { return identityKeys.every(key => a[key as keyof ExecutionIdentity] === b[key as keyof ExecutionIdentity]); }
function equal(a: string, b: string) { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
const readOnlyTool = (payload: unknown) => record(payload) && typeof payload.tool === 'string' && ['board_inspect', 'component_schemas', 'document_validate', 'proposal_status', 'clarification_request'].includes(payload.tool);
function body(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0;
    const cleanup = () => { request.off('data', receive); request.off('end', end); request.off('error', fail); request.off('aborted', abort); };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const abort = () => fail(new Error('Aborted request'));
    const receive = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1048576) { fail(new Error('Body limit')); request.resume(); } else chunks.push(chunk);
    };
    const end = () => { cleanup(); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Invalid JSON')); } };
    request.on('data', receive); request.once('end', end); request.once('error', fail); request.once('aborted', abort);
  });
}

/** A browser-authenticated loopback execution service. It owns process fences, never board documents. */
export async function startCollaborationServer(options: CollaborationServerOptions): Promise<LocalCollaborationServer> {
  if (options.port !== undefined && (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65535)) throw new RangeError('Port must be an integer between 0 and 65535');
  const maxSessionAttempts = options.maxSessionAttempts ?? 10000;
  if (!Number.isSafeInteger(maxSessionAttempts) || maxSessionAttempts < 1 || maxSessionAttempts > 100000) throw new RangeError('Invalid session attempt limit');
  for (const value of [options.pairingTtlMs, options.sessionTtlMs, options.leaseMs, options.expiryIntervalMs, options.maxEventRecords, options.maxEventBytes, options.requestTimeoutMs, options.maxBrowserRequests]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Explicit positive service limits are required');
  }
  if (options.maxEventBytes < 1024) throw new RangeError('Event budget must fit a diagnostic record');
  const origins = new Set(options.allowedOrigins.map(origin => {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new TypeError('Exact browser origins required');
    return origin;
  }));
  if (!origins.size) throw new TypeError('A browser origin is required');
  const availableProviders = options.backend.providerCapabilities ?? [];
  if (availableProviders.length > 3 || new Set(availableProviders.map(provider => provider.id)).size !== availableProviders.length || availableProviders.some(provider => !['claude', 'codex', 'agy'].includes(provider.id) || typeof provider.available !== 'boolean' || !text(provider.detail, 2000))) throw new TypeError('Invalid provider availability descriptors');
  const providers = availableProviders.map(provider => ({ id: provider.id, available: provider.available, detail: provider.detail }));
  const supervisor = new ExecutionSupervisor(options.now, options.leaseMs);
  if (!Number.isFinite(options.now())) throw new TypeError('Finite monotonic clock required');
  const attempts = new Map<string, Attempt>();
  const archived = new Map<string, ArchivedAttempt>();
  let acceptedAttempts = 0;
  const capabilities = new Map<string, Attempt>();
  const events: { event: CollaborationEvent; bytes: number }[] = [];
  let eventBytes = 0, cursor = 0, closed = false, pairedOnce = false, host = '';
  const pairingSecret = randomBytes(32).toString('hex');
  const sessionId = randomUUID();
  const pairingExpiresAt = options.now() + options.pairingTtlMs;
  let session: { token: string; origin: string; expiresAt: number } | null = null;
  type Mail = {
    request: BrowserAuthorityRequest; sessionToken: string; deadline: number;
    resolve: (value: unknown) => void; reject: (error: Error) => void; cleanup: () => void;
    fingerprint?: string;
  };
  const mailbox = new Map<string, Mail>();
  const rejectMail = (id: string, error: string) => {
    const mail = mailbox.get(id); if (!mail) return;
    mailbox.delete(id); mail.cleanup(); if (mail.fingerprint === undefined) mail.reject(new Error(error));
  };
  const clearMail = (error: string) => { for (const id of mailbox.keys()) rejectMail(id, error); };
  const respond = (response: ServerResponse, status: number, value: unknown) => {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value));
  };
  const publish = (attempt: Attempt, payload: ProviderEventPayload) => {
    if (payload.kind === 'attempt-ended') {
      // A provider terminal flag is not process-close evidence. Publish only after finished settles.
      if (!attempt.finished) attempt.terminal = { kind: 'attempt-ended', outcome: payload.outcome, cancellationAcknowledged: payload.cancellationAcknowledged };
      return;
    }
    if (session && options.now() >= session.expiresAt) { session = null; clearMail('Browser session expired'); fenceAll(); }
    if (closed || attempt.finished || attempt.abort.signal.aborted || !supervisor.permits(attempt.identity)) return;
    if (!Number.isSafeInteger(cursor + 1)) { fenceAll(); return; }
    let event: CollaborationEvent = { version: 1, cursor: cursor + 1, identity: { ...attempt.identity }, provider: attempt.provider, payload };
    let bytes: number;
    try { bytes = Buffer.byteLength(JSON.stringify(event)); } catch { return; }
    if (bytes > options.maxEventBytes) {
      event = { ...event, payload: { kind: 'diagnostic', code: 'record-too-large', message: 'Provider event exceeded the configured buffer limit' } };
      bytes = Buffer.byteLength(JSON.stringify(event));
      // Extreme identity lengths may still exceed the budget; do not advance the delivered cursor.
      if (bytes > options.maxEventBytes) return;
    }
    cursor = event.cursor;
    events.push({ event: JSON.parse(JSON.stringify(event)) as CollaborationEvent, bytes }); eventBytes += bytes;
    while (events.length > options.maxEventRecords || eventBytes > options.maxEventBytes) eventBytes -= events.shift()!.bytes;
  };
  const archive = (attempt: Attempt) => {
    if (!attempt.finished) return;
    if (attempt.capability) capabilities.delete(attempt.capability);
    attempt.capability = undefined; attempt.send = undefined;
    try { supervisor.archive(attempt.identity); } catch { return; } // Settlement may be one promise turn behind close.
    attempts.delete(attempt.identity.attemptId);
    archived.set(attempt.identity.attemptId, { identity: attempt.identity, provider: attempt.provider, mode: attempt.mode, cancellation: attempt.abort.signal.aborted ? 'acknowledged' : 'none' });
  };
  const finish = (attempt: Attempt, rejected: boolean, startupRejected = false) => {
    if (attempt.finished) return;
    const terminal = attempt.terminal;
    attempt.terminal = undefined;
    // Preserve the final receipt in the bounded event window before removing live execution state.
    if (!closed && Number.isSafeInteger(cursor + 1)) {
      const event: CollaborationEvent = { version: 1, cursor: ++cursor, identity: { ...attempt.identity }, provider: attempt.provider,
        payload: { kind: 'attempt-ended', outcome: startupRejected ? 'failed' : attempt.abort.signal.aborted ? 'cancelled' : rejected ? 'failed' : terminal?.outcome ?? 'failed', cancellationAcknowledged: !startupRejected && (attempt.abort.signal.aborted || terminal?.cancellationAcknowledged === true) } };
      const bytes = Buffer.byteLength(JSON.stringify(event));
      if (bytes <= options.maxEventBytes) {
        events.push({ event, bytes }); eventBytes += bytes;
        while (events.length > options.maxEventRecords || eventBytes > options.maxEventBytes) eventBytes -= events.shift()!.bytes;
      } else --cursor;
    }
    attempt.finished = true;
    if (attempt.capability) capabilities.delete(attempt.capability);
    // Supervisor observes the same finished promise; archive once that observer has settled too.
    queueMicrotask(() => archive(attempt));
  };
  const fence = (attempt: Attempt) => {
    // stop synchronously closes supervisor eligibility before its first awaited cancellation.
    const cancellation = supervisor.stop(attempt.identity);
    attempt.abort.abort();
    for (const [id, mail] of mailbox) if (same(mail.request.identity, attempt.identity)) rejectMail(id, 'Execution revoked');
    return cancellation;
  };
  const fenceAll = () => { clearMail('Browser session revoked'); for (const attempt of attempts.values()) { attempt.abort.abort(); void supervisor.stop(attempt.identity).catch(() => {}); } };
  const sweep = () => {
    if (session && options.now() >= session.expiresAt) { session = null; fenceAll(); }
    for (const attempt of attempts.values()) {
      if (attempt.finished) archive(attempt);
      else if (!supervisor.permits(attempt.identity) && !attempt.abort.signal.aborted) void fence(attempt).catch(() => {});
    }
    for (const [id, mail] of mailbox) if (mail.fingerprint === undefined && options.now() >= mail.deadline) rejectMail(id, 'Browser request timed out');
  };
  const getAttempt = (value: unknown): Attempt | null => {
    if (!identity(value)) return null;
    const attempt = attempts.get(value.attemptId);
    return attempt && same(attempt.identity, value) ? attempt : null;
  };
  const requestBrowser = (binding: ExecutionIdentity, payload: BrowserAuthorityPayload, signal: AbortSignal): Promise<unknown> => {
    try {
      sweep();
      if (closed || !session || !identity(binding) || !record(payload) || !['authorize', 'tool'].includes(payload.kind) || !Object.hasOwn(payload, 'data') || signal.aborted) throw new Error('Invalid or revoked browser request');
      if (payload.kind === 'tool' && !supervisor.permits(binding)) throw new Error('Execution fence is closed');
      if (payload.kind === 'tool' && attempts.get(binding.attemptId)?.mode === 'question' && !readOnlyTool(payload.data)) throw new Error('Question execution is read-only');
      if ([...mailbox.values()].filter(mail => mail.fingerprint === undefined).length >= options.maxBrowserRequests) throw new Error('Browser request queue is full');
      const request: BrowserAuthorityRequest = { version: 1, requestId: randomUUID(), identity: { ...binding }, payload };
      const serialized = JSON.stringify(request);
      if (Buffer.byteLength(serialized) > 1048576) throw new Error('Browser request exceeded body limit');
      const captured = JSON.parse(serialized) as BrowserAuthorityRequest;
      const owner = session.token;
      return new Promise((resolve, reject) => {
        const abort = () => rejectMail(request.requestId, 'Browser request aborted');
        const timeout = setTimeout(() => rejectMail(request.requestId, 'Browser request timed out'), options.requestTimeoutMs); timeout.unref();
        const cleanup = () => { clearTimeout(timeout); signal.removeEventListener('abort', abort); };
        mailbox.set(request.requestId, { request: captured, sessionToken: owner, deadline: options.now() + options.requestTimeoutMs, resolve, reject, cleanup });
        signal.addEventListener('abort', abort, { once: true });
      });
    } catch (error) { return Promise.reject(error); }
  };
  const server = createServer((request, response) => {
    void (async () => {
      if (closed) return respond(response, 503, { error: 'closed' });
      if (request.headers.host !== host) return respond(response, 403, { error: 'invalid-host' });
      if (request.method === 'POST' && request.url === '/v1/agent/tool') {
        if (request.headers.origin !== undefined) return respond(response, 403, { error: 'agent-origin-forbidden' });
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) return respond(response, 415, { error: 'json-required' });
        sweep();
        const authorization = request.headers.authorization;
        const attempt = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? capabilities.get(authorization.slice(7)) : undefined;
        if (!attempt) return respond(response, 401, { error: 'invalid-agent-capability' });
        if (!supervisor.permits(attempt.identity)) return respond(response, 409, { error: 'attempt-fenced' });
        const input = await body(request);
        if (!isBridgeRequest(input)) return respond(response, 400, { error: 'invalid-tool-request' });
        if (attempt.mode === 'question' && !readOnlyTool(input)) return respond(response, 403, { requestId: input.requestId, error: 'Question execution is read-only' });
        const abort = new AbortController();
        const revoke = () => abort.abort();
        const disconnected = () => { if (!response.writableEnded) abort.abort(); };
        attempt.abort.signal.addEventListener('abort', revoke, { once: true });
        response.once('close', disconnected);
        const timeout = setTimeout(revoke, options.requestTimeoutMs); timeout.unref();
        try {
          sweep();
          if (attempt.abort.signal.aborted || !supervisor.permits(attempt.identity)) throw new Error('Execution revoked');
          const aborted = new Promise<never>((_, reject) => {
            if (abort.signal.aborted) reject(new Error('Tool request aborted'));
            else abort.signal.addEventListener('abort', () => reject(new Error('Tool request aborted')), { once: true });
          });
          const result = await Promise.race([options.relay(attempt.identity, { requestId: input.requestId, tool: input.tool, input: input.input }, abort.signal), aborted]);
          sweep();
          if (abort.signal.aborted || !supervisor.permits(attempt.identity)) throw new Error('Execution revoked before tool result delivery');
          return respond(response, 200, { requestId: input.requestId, result });
        } catch {
          return respond(response, 409, { requestId: input.requestId, error: 'Tool request revoked, expired or failed' });
        } finally {
          clearTimeout(timeout); attempt.abort.signal.removeEventListener('abort', revoke); response.off('close', disconnected);
        }
      }
      const origin = request.headers.origin;
      if (typeof origin !== 'string' || !origins.has(origin)) return respond(response, 403, { error: 'invalid-origin' });
      response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
      const parsed = new URL(request.url ?? '/', `http://${host}`);
      if (request.method === 'POST' && !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) return respond(response, 415, { error: 'json-required' });
      sweep();
      if (request.method === 'POST' && parsed.pathname === '/v1/pair') {
        const input = await body(request);
        if (!record(input) || input.version !== 1 || !text(input.secret, 256) || pairedOnce || options.now() >= pairingExpiresAt || !equal(input.secret, pairingSecret)) return respond(response, 403, { error: 'invalid-pairing' });
        pairedOnce = true; session = { token: randomBytes(32).toString('hex'), origin, expiresAt: options.now() + options.sessionTtlMs };
        return respond(response, 200, { version: 1, token: session.token, expiresAt: session.expiresAt });
      }
      const token = request.headers.authorization;
      if (!session || origin !== session.origin || typeof token !== 'string' || !token.startsWith('Bearer ') || !equal(token.slice(7), session.token)) return respond(response, 401, { error: 'invalid-session' });
      if (request.method === 'GET' && parsed.pathname === '/v1/status') return respond(response, 200, { version: 1, sessionId, providers, attempts: [...attempts.values()].map(attempt => ({ identity: attempt.identity, provider: attempt.provider, mode: attempt.mode, eligible: supervisor.permits(attempt.identity), cancellation: supervisor.cancellation(attempt.identity) })), archivedAttempts: archived.size, sessionAttemptLimit: maxSessionAttempts });
      if (request.method === 'GET' && parsed.pathname === '/v1/requests') return respond(response, 200, { version: 1, requests: [...mailbox.values()].filter(mail => mail.sessionToken === session!.token && mail.fingerprint === undefined).map(mail => mail.request) });
      if (request.method === 'GET' && parsed.pathname === '/v1/events') {
        const after = Number(parsed.searchParams.get('after') ?? '0');
        if (!Number.isSafeInteger(after) || after < 0 || after > cursor) return respond(response, 400, { error: 'invalid-cursor' });
        const first = events[0]?.event.cursor ?? cursor + 1;
        if (after < first - 1) return respond(response, 409, { version: 1, error: 'event-gap', earliestCursor: first, latestCursor: cursor });
        return respond(response, 200, { version: 1, cursor, events: events.filter(item => item.event.cursor > after).map(item => item.event) });
      }
      if (request.method !== 'POST') return respond(response, 404, { error: 'unknown-endpoint' });
      const input = await body(request);
      if (!record(input) || input.version !== 1) return respond(response, 400, { error: 'invalid-body' });
      if (parsed.pathname === '/v1/results') {
        const mail = typeof input.requestId === 'string' ? mailbox.get(input.requestId) : undefined;
        if (!mail || mail.sessionToken !== session.token || !identity(input.identity) || !same(mail.request.identity, input.identity) || Object.hasOwn(input, 'result') === Object.hasOwn(input, 'error') || input.error !== undefined && !text(input.error, 1048576)) return respond(response, 400, { error: 'invalid-browser-result' });
        const fingerprint = JSON.stringify({ result: input.result, error: input.error });
        if (mail.fingerprint !== undefined) return respond(response, mail.fingerprint === fingerprint ? 200 : 409, { version: 1, duplicate: true });
        if (mail.request.payload.kind === 'tool' && !supervisor.permits(mail.request.identity)) { rejectMail(mail.request.requestId, 'Execution revoked'); return respond(response, 409, { error: 'attempt-fenced' }); }
        mail.fingerprint = fingerprint; mail.cleanup();
        if (input.error !== undefined) mail.reject(new Error(input.error as string)); else mail.resolve(input.result);
        // Keep a bounded completed receipt window for exact replay recognition.
        const completed = [...mailbox.entries()].filter(([, entry]) => entry.fingerprint !== undefined);
        while (completed.length > options.maxBrowserRequests) mailbox.delete(completed.shift()![0]);
        return respond(response, 200, { version: 1, received: true });
      }
      if (parsed.pathname === '/v1/disconnect') { session = null; fenceAll(); return respond(response, 200, { version: 1, fenced: true }); }
      if (parsed.pathname === '/v1/start') {
        if (!identity(input.identity) || !['claude', 'codex', 'agy'].includes(String(input.provider)) || typeof input.provider !== 'string' || !text(input.prompt, 1048576)) return respond(response, 400, { error: 'invalid-start' });
        if (input.mode !== undefined && input.mode !== 'task' && input.mode !== 'question' || input.providerSessionId !== undefined && !text(input.providerSessionId)) return respond(response, 400, { error: 'invalid-start-metadata' });
        if (providers.some(provider => provider.id === input.provider && !provider.available)) return respond(response, 409, { error: 'provider-unavailable' });
        if (archived.has(input.identity.attemptId)) return respond(response, 409, { error: 'execution-identity-reused' });
        if (acceptedAttempts >= maxSessionAttempts) return respond(response, 409, { error: 'session-attempt-limit', message: 'Restart the local service and pair explicitly to clear bounded transport history.' });
        const metadata: StartMetadata = Object.freeze({ provider: input.provider as LocalAgentProvider, mode: input.mode === 'question' ? 'question' : 'task', ...(input.providerSessionId === undefined ? {} : { providerSessionId: input.providerSessionId as string }) });
        const authorized = Object.freeze({ ...input.identity });
        if (await options.authorize(authorized, metadata) !== true) return respond(response, 403, { error: 'task-not-authorized' });
        // Authorization may involve I/O. Recheck session lifetime and ownership afterwards.
        sweep(); if (!session || !equal(token.slice(7), session.token)) return respond(response, 401, { error: 'session-expired' });
        if (archived.has(authorized.attemptId) || acceptedAttempts >= maxSessionAttempts) return respond(response, 409, { error: acceptedAttempts >= maxSessionAttempts ? 'session-attempt-limit' : 'execution-identity-reused' });
        const attempt: Attempt = { identity: authorized, provider: metadata.provider, mode: metadata.mode, abort: new AbortController() };
        const capability = randomBytes(32).toString('hex');
        let lease;
        try {
          lease = await supervisor.start(authorized, async () => {
            ++acceptedAttempts;
            attempts.set(authorized.attemptId, attempt);
            capabilities.set(capability, attempt);
            attempt.capability = capability;
            const running = await options.backend.launch({ identity: authorized, provider: attempt.provider, mode: metadata.mode, ...(metadata.providerSessionId === undefined ? {} : { providerSessionId: metadata.providerSessionId }), prompt: input.prompt as string, capability, signal: attempt.abort.signal,
              emit: payload => publish(attempt, payload),
              relay: async (providedCapability, payload) => {
                sweep();
                if (!equal(providedCapability, capability) || attempt.abort.signal.aborted || !supervisor.permits(authorized)) throw new Error('Task capability revoked');
                if (attempt.mode === 'question' && !readOnlyTool(payload)) throw new Error('Question execution is read-only');
                const result = await options.relay(authorized, payload, attempt.abort.signal);
                sweep();
                if (attempt.abort.signal.aborted || !supervisor.permits(authorized)) throw new Error('Task capability revoked before result delivery');
                return result;
              },
            });
            attempt.hasProcess = true;
            attempt.send = running.send;
            void running.process.finished.then(() => finish(attempt, false), () => finish(attempt, true));
            return running.process;
          }, { reserveBoard: metadata.mode !== 'question' });
        } catch { attempt.abort.abort(); if (!attempt.hasProcess && attempts.get(authorized.attemptId) === attempt) { finish(attempt, true, true); archive(attempt); } return respond(response, 409, { error: 'execution-not-started' }); }
        if (!session || options.now() >= session.expiresAt) { void fence(attempt); return respond(response, 401, { error: 'session-expired' }); }
        return respond(response, 200, { version: 1, lease });
      }
      const attempt = getAttempt(input.identity);
      const receipt = identity(input.identity) ? archived.get(input.identity.attemptId) : undefined;
      if (!attempt && receipt && same(receipt.identity, input.identity as ExecutionIdentity)) {
        if (parsed.pathname === '/v1/stop') return respond(response, 200, { version: 1, fenced: true, cancellation: 'acknowledged' });
        if (parsed.pathname === '/v1/heartbeat' || parsed.pathname === '/v1/send') return respond(response, 409, { error: 'explicit-resume-required' });
      }
      if (!attempt) return respond(response, 400, { error: 'invalid-binding' });
      if (parsed.pathname === '/v1/stop') { const outcome = await fence(attempt); return respond(response, 200, { version: 1, fenced: true, cancellation: outcome }); }
      if (parsed.pathname === '/v1/heartbeat') {
        try { return respond(response, 200, { version: 1, lease: supervisor.renew(attempt.identity) }); }
        catch { return respond(response, 409, { error: 'explicit-resume-required' }); }
      }
      if (parsed.pathname === '/v1/send') {
        const message = input.message;
        if (!record(message) || !text(message.messageId) || !text(message.text, 1048576) || !['task', 'clarification', 'proposal-revision'].includes(String(message.target)) || typeof message.target !== 'string') return respond(response, 400, { error: 'invalid-message' });
        if (!supervisor.permits(attempt.identity) || !attempt.send) return respond(response, 409, { error: 'attempt-fenced' });
        const outcome = await attempt.send(message as unknown as CollaborationMessage);
        sweep();
        if (!supervisor.permits(attempt.identity)) return respond(response, 409, { error: 'attempt-fenced' });
        return respond(response, 200, { version: 1, delivered: outcome.delivered === true, acknowledged: outcome.delivered === true && outcome.acknowledged === true });
      }
      return respond(response, 404, { error: 'unknown-endpoint' });
    })().catch(error => { respond(response, error instanceof Error && error.message === 'Body limit' ? 413 : 400, { error: 'invalid-request' }); });
  });
  server.maxConnections = 128;
  server.headersTimeout = Math.min(options.requestTimeoutMs, 10000);
  server.requestTimeout = Math.min(options.requestTimeoutMs, 120000);
  server.keepAliveTimeout = 5000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback server unavailable');
  host = `127.0.0.1:${address.port}`;
  const timer = setInterval(() => { try { sweep(); } catch { fenceAll(); } }, options.expiryIntervalMs); timer.unref();
  let closing: Promise<void> | undefined;
  return { url: `http://${host}`, pairingSecret, pairingExpiresAt, requestBrowser,
    close() {
      if (closing) return closing;
      closed = true; session = null; clearInterval(timer); fenceAll();
      closing = (async () => {
        const stopped = supervisor.dispose();
        await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
        await stopped;
      })();
      return closing;
    },
  };
}
