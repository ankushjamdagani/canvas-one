import type { ExecutionIdentity, ExecutionLease } from './execution.js';
import type { ProviderEventPayload, LocalAgentProvider } from './providers.js';
import type { BrowserAuthorityRequest, CollaborationEvent, CollaborationMessage, CollaborationStartRequest, ProviderAvailability } from './collaboration-server.js';

export type CollaborationClientErrorCode = 'invalid-input' | 'network' | 'aborted' | 'invalid-response' | 'http' | 'event-gap';
export class CollaborationClientError extends Error {
  constructor(readonly code: CollaborationClientErrorCode, message: string, readonly status?: number, readonly gap?: { readonly earliestCursor: number; readonly latestCursor: number }) { super(message); this.name = 'CollaborationClientError'; }
}
export type CollaborationStatus = { readonly sessionId: string; readonly providers: readonly ProviderAvailability[]; readonly attempts: readonly { readonly identity: ExecutionIdentity; readonly provider: LocalAgentProvider; readonly mode: 'task' | 'question'; readonly eligible: boolean; readonly cancellation: 'none' | 'requested' | 'acknowledged' | 'failed' }[] };
export type LeaseAcknowledgement = { readonly lease: ExecutionLease; readonly requestStartedAt: number };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 200): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const integer = (value: unknown): value is number => number(value) && Number.isSafeInteger(value);
const enumValue = (value: unknown, values: readonly string[]) => typeof value === 'string' && values.includes(value);
const identityFields = ['taskId', 'attemptId', 'projectId', 'branchId', 'boardId', 'actorId', 'generation'];
function identity(value: unknown): value is ExecutionIdentity {
  return object(value) && Object.keys(value).length === identityFields.length && identityFields.slice(0, -1).every(key => text(value[key])) && integer(value.generation) && value.generation > 0;
}
const provider = (value: unknown): value is LocalAgentProvider => enumValue(value, ['claude', 'codex', 'agy']);
const same = (a: ExecutionIdentity, b: ExecutionIdentity) => identityFields.every(key => a[key as keyof ExecutionIdentity] === b[key as keyof ExecutionIdentity]);
const invalidInput = () => new CollaborationClientError('invalid-input', 'Invalid collaboration request');
const invalidResponse = () => new CollaborationClientError('invalid-response', 'Invalid collaboration service response');
function payload(value: unknown): value is ProviderEventPayload {
  if (!object(value)) return false;
  switch (value.kind) {
    case 'session': return text(value.sessionId);
    case 'text': return typeof value.text === 'string' && enumValue(value.format, ['delta', 'message']);
    case 'tool': return text(value.toolId) && text(value.name) && enumValue(value.phase, ['started', 'completed', 'failed']);
    case 'diagnostic': return enumValue(value.code, ['malformed-record', 'record-too-large', 'provider-error', 'tool-denied', 'incomplete-stream', 'process-exit']) && typeof value.message === 'string';
    case 'provider-result': case 'attempt-ended': return enumValue(value.outcome, ['succeeded', 'failed', 'cancelled']) && typeof value.cancellationAcknowledged === 'boolean';
    default: return false;
  }
}
function mailbox(value: unknown): value is BrowserAuthorityRequest {
  return object(value) && value.version === 1 && typeof value.requestId === 'string' && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value.requestId) && identity(value.identity) && object(value.payload) && enumValue(value.payload.kind, ['authorize', 'tool']) && Object.hasOwn(value.payload, 'data');
}

/** Stateless bearer transport: the caller owns tokens and durable tasks. No automatic Resume or renewal. */
export class CollaborationBrowserClient {
  private readonly url: string;
  private lastTime = -Infinity;
  constructor(private readonly options: { readonly url: string; readonly fetch: typeof fetch; readonly now: () => number }) {
    let url: URL;
    try { url = new URL(options.url); } catch { throw invalidInput(); }
    // The server binds IPv4 loopback and checks this exact Host; aliases cannot work safely.
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw invalidInput();
    this.url = url.origin;
  }
  private async request(path: string, token: string | null, data: unknown, signal?: AbortSignal): Promise<{ value: Record<string, unknown>; requestStartedAt: number }> {
    if (signal?.aborted) throw new CollaborationClientError('aborted', 'Collaboration request aborted');
    if (token !== null && !/^[a-f0-9]{64}$/.test(token)) throw invalidInput();
    let serialized: string | undefined;
    try { if (data !== undefined) serialized = JSON.stringify(data); } catch { throw invalidInput(); }
    if (serialized !== undefined && new TextEncoder().encode(serialized).byteLength > 1048576) throw invalidInput();
    const requestStartedAt = this.options.now();
    if (!number(requestStartedAt) || requestStartedAt < this.lastTime) throw invalidInput(); this.lastTime = requestStartedAt;
    let response: Response;
    try {
      response = await this.options.fetch(this.url + path, { method: serialized === undefined ? 'GET' : 'POST', headers: { ...(token === null ? {} : { Authorization: `Bearer ${token}` }), ...(serialized === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: serialized, credentials: 'omit', cache: 'no-store', redirect: 'error', signal });
    } catch {
      throw signal?.aborted ? new CollaborationClientError('aborted', 'Collaboration request aborted') : new CollaborationClientError('network', 'Local collaboration service is unavailable');
    }
    if (signal?.aborted) throw new CollaborationClientError('aborted', 'Collaboration request aborted');
    let value: unknown;
    try { value = await response.json(); } catch { throw signal?.aborted ? new CollaborationClientError('aborted', 'Collaboration request aborted') : invalidResponse(); }
    if (signal?.aborted) throw new CollaborationClientError('aborted', 'Collaboration request aborted');
    if (!object(value)) throw invalidResponse();
    if (!response.ok) {
      if (response.status === 409 && value.version === 1 && value.error === 'event-gap' && integer(value.earliestCursor) && integer(value.latestCursor) && value.earliestCursor <= value.latestCursor + 1) throw new CollaborationClientError('event-gap', 'Collaboration events are no longer retained', 409, { earliestCursor: value.earliestCursor, latestCursor: value.latestCursor });
      throw new CollaborationClientError('http', text(value.error, 2000) ? value.error : 'Collaboration request failed', response.status);
    }
    if (value.version !== 1) throw invalidResponse();
    return { value, requestStartedAt };
  }
  async pair(secret: string, signal?: AbortSignal): Promise<{ readonly token: string; readonly expiresAt: number }> {
    if (!/^[a-f0-9]{64}$/.test(secret)) throw invalidInput();
    const { value } = await this.request('/v1/pair', null, { version: 1, secret }, signal);
    if (typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token) || !number(value.expiresAt)) throw invalidResponse();
    return { token: value.token, expiresAt: value.expiresAt };
  }
  async status(token: string, signal?: AbortSignal): Promise<CollaborationStatus> {
    const { value } = await this.request('/v1/status', token, undefined, signal);
    if (!text(value.sessionId) || !Array.isArray(value.providers) || !Array.isArray(value.attempts) || value.providers.some(item => !object(item) || !provider(item.id) || typeof item.available !== 'boolean' || !text(item.detail, 2000)) || new Set(value.providers.map(item => item.id)).size !== value.providers.length || value.attempts.some(item => !object(item) || !identity(item.identity) || !provider(item.provider) || !enumValue(item.mode, ['task', 'question']) || typeof item.eligible !== 'boolean' || !enumValue(item.cancellation, ['none', 'requested', 'acknowledged', 'failed']))) throw invalidResponse();
    return { sessionId: value.sessionId, providers: value.providers as ProviderAvailability[], attempts: value.attempts as unknown as CollaborationStatus['attempts'] };
  }
  private lease(value: Record<string, unknown>, expected: ExecutionIdentity): ExecutionLease {
    if (!object(value.lease) || !number(value.lease.deadline)) throw invalidResponse();
    const { deadline, ...binding } = value.lease;
    if (!identity(binding) || !same(binding, expected)) throw invalidResponse();
    return { ...binding, deadline };
  }
  async start(token: string, input: Omit<CollaborationStartRequest, 'version'>, signal?: AbortSignal): Promise<LeaseAcknowledgement> {
    if (!input || !identity(input.identity) || !provider(input.provider) || !text(input.prompt, 1048576) || input.mode !== undefined && !enumValue(input.mode, ['task', 'question']) || input.providerSessionId !== undefined && !text(input.providerSessionId)) throw invalidInput();
    const expected = { ...input.identity };
    const { value, requestStartedAt } = await this.request('/v1/start', token, { version: 1, identity: expected, provider: input.provider, prompt: input.prompt, ...(input.mode === undefined ? {} : { mode: input.mode }), ...(input.providerSessionId === undefined ? {} : { providerSessionId: input.providerSessionId }) }, signal);
    return { lease: this.lease(value, expected), requestStartedAt };
  }
  async heartbeat(token: string, binding: ExecutionIdentity, signal?: AbortSignal): Promise<LeaseAcknowledgement> {
    if (!identity(binding)) throw invalidInput(); const expected = { ...binding };
    const { value, requestStartedAt } = await this.request('/v1/heartbeat', token, { version: 1, identity: expected }, signal);
    return { lease: this.lease(value, expected), requestStartedAt };
  }
  async send(token: string, binding: ExecutionIdentity, message: CollaborationMessage, signal?: AbortSignal): Promise<{ readonly delivered: boolean; readonly acknowledged: boolean }> {
    if (!identity(binding) || !message || !text(message.messageId) || !text(message.text, 1048576) || !enumValue(message.target, ['task', 'clarification', 'proposal-revision'])) throw invalidInput();
    const { value } = await this.request('/v1/send', token, { version: 1, identity: binding, message }, signal);
    if (typeof value.delivered !== 'boolean' || typeof value.acknowledged !== 'boolean' || value.acknowledged && !value.delivered) throw invalidResponse();
    return { delivered: value.delivered, acknowledged: value.acknowledged };
  }
  async stop(token: string, binding: ExecutionIdentity, signal?: AbortSignal): Promise<{ readonly fenced: true; readonly cancellation: 'acknowledged' | 'failed' }> {
    if (!identity(binding)) throw invalidInput();
    const { value } = await this.request('/v1/stop', token, { version: 1, identity: binding }, signal);
    if (value.fenced !== true || !enumValue(value.cancellation, ['acknowledged', 'failed'])) throw invalidResponse();
    return { fenced: true, cancellation: value.cancellation as 'acknowledged' | 'failed' };
  }
  async events(token: string, after: number, signal?: AbortSignal): Promise<{ readonly cursor: number; readonly events: readonly CollaborationEvent[] }> {
    if (!integer(after)) throw invalidInput();
    const { value } = await this.request(`/v1/events?after=${after}`, token, undefined, signal);
    if (!integer(value.cursor) || value.cursor < after || !Array.isArray(value.events)) throw invalidResponse();
    let prior = after;
    for (const event of value.events) {
      if (!object(event) || event.version !== 1 || !integer(event.cursor) || event.cursor !== prior + 1 || event.cursor > value.cursor || !identity(event.identity) || !provider(event.provider) || !payload(event.payload)) throw invalidResponse();
      prior = event.cursor;
    }
    if (prior !== value.cursor) throw invalidResponse();
    return { cursor: value.cursor, events: value.events as CollaborationEvent[] };
  }
  async requests(token: string, signal?: AbortSignal): Promise<readonly BrowserAuthorityRequest[]> {
    const { value } = await this.request('/v1/requests', token, undefined, signal);
    if (!Array.isArray(value.requests) || !value.requests.every(mailbox) || new Set(value.requests.map(item => item.requestId)).size !== value.requests.length) throw invalidResponse();
    return value.requests;
  }
  async result(token: string, request: BrowserAuthorityRequest, reply: { readonly result: unknown } | { readonly error: string }, signal?: AbortSignal): Promise<void> {
    if (!mailbox(request) || !object(reply) || Object.hasOwn(reply, 'result') === Object.hasOwn(reply, 'error') || 'error' in reply && !text(reply.error, 1048576) || 'result' in reply && reply.result === undefined) throw invalidInput();
    const result = 'error' in reply ? { error: reply.error } : { result: reply.result };
    const { value } = await this.request('/v1/results', token, { version: 1, requestId: request.requestId, identity: request.identity, ...result }, signal);
    if (value.received !== true && value.duplicate !== true) throw invalidResponse();
  }
  async disconnect(token: string, signal?: AbortSignal): Promise<void> {
    const { value } = await this.request('/v1/disconnect', token, { version: 1 }, signal);
    if (value.fenced !== true) throw invalidResponse();
  }
}
