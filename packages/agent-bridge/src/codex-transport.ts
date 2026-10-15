/** Minimal app-server protocol subset verified against locally generated Codex 0.155.1 types.
 * Fake-wire tests prove serialization/correlation only, not installed CLI turn-control support.
 * Process launching, board tools, authentication and durable task authority live outside this transport.
 */
import { AGENT_TOOLS, type AgentTool } from '@canvas-one/agents';
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;
export type CodexTransportEvent =
  | { readonly kind: 'text'; readonly threadId: string; readonly turnId: string; readonly itemId: string; readonly delta: string }
  | { readonly kind: 'turn-ended'; readonly threadId: string; readonly turnId: string; readonly outcome: 'completed' | 'failed' | 'interrupted'; readonly cancellationAcknowledged: boolean }
  | { readonly kind: 'diagnostic'; readonly code: 'protocol-error' | 'request-error' | 'request-timeout' | 'connection-closed' | 'provider-error'; readonly message: string };
export type CodexThreadOptions = Readonly<{ model: string; cwd: string; ephemeral?: boolean }>;
export type CodexBoardToolRequest = Readonly<{
  threadId: string; turnId: string; callId: string; tool: AgentTool; input: Readonly<Record<string, unknown>>;
  /** Transport-owned generation. Host must also validate its own task/attempt authority atomically. */
  epoch: number;
}>;
export type CodexBoardTools = Readonly<{
  names: readonly AgentTool[];
  handle: (request: CodexBoardToolRequest, signal: AbortSignal) => Promise<{ readonly success: boolean; readonly value: unknown }>;
}>;
export type CodexTransportOptions = Readonly<{
  /** Must write a complete NDJSON record or reject. Owner wires stdout to receive() and exit to close(). */
  write: (line: string) => void | Promise<void>;
  onEvent: (event: CodexTransportEvent) => void;
  requestTimeoutMs?: number;
  maxPendingRequests?: number;
  maxRecordChars?: number;
  boardTools?: CodexBoardTools;
}>;
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

export class CodexAppServerTransport {
  private readonly pending = new Map<string, Pending>();
  private counter = 0;
  private buffer = '';
  private closed = false;
  private ready = false;
  private initializing = false;
  private selectingThread = false;
  private startingTurn = false;
  private epoch = 0;
  private threadId: string | null = null;
  private turnId: string | null = null;
  private earlyNotifications: ObjectValue[] = [];
  private earlyNotificationChars = 0;
  private readonly toolCalls = new Map<string, { controller: AbortController; requestId: string | number; timer: ReturnType<typeof setTimeout> }>();
  private readonly seenToolCalls = new Set<string>();
  private readonly enabledTools: readonly AgentTool[];
  private readonly timeout: number;
  private readonly maxPending: number;
  private readonly maxRecord: number;

  constructor(private readonly options: CodexTransportOptions) {
    this.timeout = options.requestTimeoutMs ?? 30_000;
    this.maxPending = options.maxPendingRequests ?? 16;
    this.maxRecord = options.maxRecordChars ?? 256 * 1024;
    if (!Number.isSafeInteger(this.timeout) || this.timeout < 1 || this.timeout > 120_000 || !Number.isSafeInteger(this.maxPending) || this.maxPending < 1 || this.maxPending > 128 || !Number.isSafeInteger(this.maxRecord) || this.maxRecord < 128 || this.maxRecord > 1024 * 1024) throw new RangeError('Invalid Codex transport limits');
    this.enabledTools = [...new Set(options.boardTools?.names ?? [])];
    if (this.enabledTools.some(name => !AGENT_TOOLS.some(tool => tool.name === name))) throw new TypeError('Only Canvas One board tools may be registered');
  }

  async initialize(): Promise<void> {
    if (this.ready || this.initializing) throw new Error('Codex initialization already started');
    this.initializing = true;
    try {
      const result = await this.request('initialize', { clientInfo: { name: 'canvas-one', title: 'Canvas One', version: '0.1.0' }, capabilities: { experimentalApi: this.enabledTools.length > 0, requestAttestation: false } });
      if (!object(result)) throw new Error('Invalid Codex initialize response');
      await this.write({ method: 'initialized' });
      this.ensureOpen();
      this.ready = true;
    } catch (error) {
      this.close('Codex initialization failed');
      throw error;
    } finally { this.initializing = false; }
  }

  async startThread(options: CodexThreadOptions): Promise<string> {
    return this.selectThread('thread/start', options);
  }
  async resumeThread(threadId: string, options: CodexThreadOptions): Promise<string> {
    if (!validId(threadId)) throw new TypeError('Explicit Codex thread ID is required');
    return this.selectThread('thread/resume', options, threadId);
  }
  private async selectThread(method: 'thread/start' | 'thread/resume', options: CodexThreadOptions, resumeId?: string): Promise<string> {
    this.ensureReady();
    if (this.selectingThread || this.startingTurn || this.turnId) throw new Error('Detach or finish the active Codex turn before selecting a thread');
    if (!validId(options.model) || !options.cwd || options.cwd.length > 4096 || !options.cwd.startsWith('/')) throw new TypeError('Explicit model and absolute working directory are required');
    if (options.ephemeral !== undefined && typeof options.ephemeral !== 'boolean') throw new TypeError('Ephemeral must be a boolean');
    this.selectingThread = true;
    const epoch = this.epoch;
    try {
      const result = object(await this.request(method, {
        ...(resumeId ? { threadId: resumeId, excludeTurns: true } : { allowProviderModelFallback: false }),
        model: options.model, cwd: options.cwd, approvalPolicy: 'never', sandbox: 'read-only',
        runtimeWorkspaceRoots: [], config: {
          mcp_servers: {}, web_search: 'disabled',
          features: {
            shell_tool: false, unified_exec: false, apps: false, plugins: false,
            browser_use: false, browser_use_external: false, in_app_browser: false,
            computer_use: false, view_image: false, multi_agent: false, workspace_dependencies: false,
            code_mode_host: false, code_mode: false, code_mode_only: false,
          },
        },
        ...(method === 'thread/start' ? {
          environments: [], experimentalRawEvents: false, ...(options.ephemeral !== undefined ? { ephemeral: options.ephemeral } : {}),
          ...(this.enabledTools.length ? { dynamicTools: AGENT_TOOLS.filter(tool => this.enabledTools.includes(tool.name)).map(tool => ({ type: 'function', name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) } : {}),
        } : {}),
      }));
      this.ensureEpoch(epoch);
      const id = object(result?.thread)?.id;
      if (!validId(id) || (resumeId && id !== resumeId)) { this.close('Codex returned an invalid or mismatched thread ID'); throw new Error('Codex returned an invalid or mismatched thread ID'); }
      this.threadId = id;
      return id;
    } finally { if (this.epoch === epoch) this.selectingThread = false; }
  }

  async startTurn(threadId: string, text: string, messageId: string): Promise<string> {
    this.ensureThread(threadId);
    this.validateMessage(text, messageId);
    if (this.startingTurn || this.turnId) throw new Error('A Codex turn is already active');
    this.startingTurn = true;
    const epoch = this.epoch;
    try {
      const result = object(await this.request('turn/start', { threadId, clientUserMessageId: messageId, input: [{ type: 'text', text, text_elements: [] }], environments: [] }));
      this.ensureEpoch(epoch);
      const id = object(result?.turn)?.id;
      if (!validId(id)) { this.close('Codex returned an invalid turn ID'); throw new Error('Codex returned an invalid turn ID'); }
      this.turnId = id;
      this.startingTurn = false;
      const early = this.earlyNotifications;
      this.earlyNotifications = [];
      this.earlyNotificationChars = 0;
      for (const entry of early) {
        if ('id' in entry) this.serverRequest(entry);
        else this.notification(entry);
      }
      return id;
    } finally {
      if (this.epoch === epoch) { this.startingTurn = false; this.earlyNotifications = []; this.earlyNotificationChars = 0; }
    }
  }

  async steer(threadId: string, turnId: string, text: string, messageId: string): Promise<{ readonly turnId: string; readonly acknowledged: true }> {
    this.ensureTurn(threadId, turnId);
    this.validateMessage(text, messageId);
    const epoch = this.epoch;
    const result = object(await this.request('turn/steer', { threadId, expectedTurnId: turnId, clientUserMessageId: messageId, input: [{ type: 'text', text, text_elements: [] }] }));
    this.ensureEpoch(epoch);
    if (result?.turnId !== turnId) { this.close('Codex steer response referenced a different turn'); throw new Error('Codex steer response referenced a different turn'); }
    return { turnId, acknowledged: true };
  }

  /** RPC acceptance is NOT cancellation acknowledgement; only interrupted turn completion establishes that. */
  async interrupt(threadId: string, turnId: string): Promise<{ readonly requested: true; readonly cancellationAcknowledged: false }> {
    this.ensureTurn(threadId, turnId);
    this.abortToolCalls();
    const epoch = this.epoch;
    const result = await this.request('turn/interrupt', { threadId, turnId });
    this.ensureEpoch(epoch);
    if (!object(result)) { this.close('Invalid Codex interrupt response'); throw new Error('Invalid Codex interrupt response'); }
    return { requested: true, cancellationAcknowledged: false };
  }

  /** Invalidates attribution before a board/session switch. Does not claim the provider stopped. */
  detachSession(): void {
    ++this.epoch;
    this.threadId = null;
    this.turnId = null;
    this.startingTurn = false;
    this.selectingThread = false;
    this.abortToolCalls();
    this.seenToolCalls.clear();
    for (const entry of this.earlyNotifications) if ('id' in entry) this.rejectServerRequest(entry.id, -32000, 'Canvas One session detached');
    this.earlyNotifications = [];
    this.earlyNotificationChars = 0;
    this.rejectPending('Codex session detached');
  }

  receive(chunk: string): void {
    if (this.closed) return;
    let start = 0;
    while (start < chunk.length && !this.closed) {
      const newline = chunk.indexOf('\n', start), end = newline < 0 ? chunk.length : newline;
      if (this.buffer.length + end - start > this.maxRecord) { this.protocolError('Codex record exceeded its size limit'); return; }
      this.buffer += chunk.slice(start, end);
      if (newline < 0) break;
      const line = this.buffer.trim();
      this.buffer = '';
      if (line) this.record(line);
      start = newline + 1;
    }
  }

  close(message = 'Codex connection closed'): void {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.buffer = '';
    this.detachSession();
    this.options.onEvent({ kind: 'diagnostic', code: 'connection-closed', message });
  }
  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)); }
    this.pending.clear();
  }
  private async request(method: string, params: ObjectValue): Promise<unknown> {
    this.ensureOpen();
    if (this.pending.size >= this.maxPending) throw new Error('Codex pending request limit exceeded');
    const id = `canvas-${++this.counter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.options.onEvent({ kind: 'diagnostic', code: 'request-timeout', message: `Codex ${method} request timed out` });
        reject(new Error(`Codex ${method} request timed out`));
        // A timed-out control request may still have executed. Prevent new turns on uncertain state.
        this.close('Codex request timed out; reconnect explicitly');
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      void this.write({ id, method, params }).catch(() => {
        const pending = this.pending.get(id);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(id); pending.reject(new Error('Codex request could not be written')); }
        this.close('Codex write failed');
      });
    });
  }
  private async write(value: ObjectValue): Promise<void> {
    this.ensureOpen();
    const encoded = JSON.stringify(value);
    if (encoded.length > this.maxRecord) throw new Error('Codex outgoing record exceeded its size limit');
    await this.options.write(encoded + '\n');
  }
  private record(line: string): void {
    let value: ObjectValue | undefined;
    try { value = object(JSON.parse(line)); } catch { /* Never echo raw wire data. */ }
    if (!value) { this.protocolError('Codex sent a malformed JSON record'); return; }
    if ('id' in value && 'method' in value) {
      this.serverRequest(value);
      return;
    }
    if ('id' in value) {
      if (typeof value.id !== 'string') return;
      const pending = this.pending.get(value.id);
      if (!pending) return; // Stale response from a detached generation.
      clearTimeout(pending.timer);
      this.pending.delete(value.id);
      if ('error' in value) {
        this.options.onEvent({ kind: 'diagnostic', code: 'request-error', message: 'Codex rejected a protocol request' });
        pending.reject(new Error('Codex rejected a protocol request'));
      } else if ('result' in value) pending.resolve(value.result);
      else { pending.reject(new Error('Malformed Codex response')); this.protocolError('Codex response had no result or error'); }
      return;
    }
    if (typeof value.method === 'string') this.notification(value);
  }
  private notification(value: ObjectValue): void {
    const params = object(value.params);
    if (!this.ready || !params || params.threadId !== this.threadId) return;
    if (this.startingTurn) {
      this.bufferEarly(value);
      return;
    }
    const turn = object(params.turn), turnId = turn?.id ?? params.turnId;
    if (!this.turnId || turnId !== this.turnId) return;
    if (value.method === 'item/agentMessage/delta' && validId(params.itemId) && typeof params.delta === 'string') {
      this.options.onEvent({ kind: 'text', threadId: this.threadId!, turnId: this.turnId, itemId: params.itemId, delta: params.delta });
    } else if (value.method === 'turn/completed') {
      if (turn?.status !== 'completed' && turn?.status !== 'failed' && turn?.status !== 'interrupted') { this.protocolError('Invalid Codex terminal turn status'); return; }
      const event: CodexTransportEvent = { kind: 'turn-ended', threadId: this.threadId!, turnId: this.turnId, outcome: turn.status, cancellationAcknowledged: turn.status === 'interrupted' };
      this.turnId = null;
      this.abortToolCalls();
      this.options.onEvent(event);
    } else if (value.method === 'error') {
      this.options.onEvent({ kind: 'diagnostic', code: 'provider-error', message: params.willRetry === true ? 'Codex reported an error and will retry' : 'Codex reported an execution error' });
    }
  }
  private bufferEarly(value: ObjectValue): void {
    const chars = JSON.stringify(value).length;
    if (this.earlyNotifications.length >= 32 || this.earlyNotificationChars + chars > this.maxRecord) { this.protocolError('Too many early Codex notifications or tool requests'); return; }
    this.earlyNotifications.push(value);
    this.earlyNotificationChars += chars;
  }
  private serverRequest(value: ObjectValue): void {
    if (!(typeof value.id === 'number' && Number.isSafeInteger(value.id)) && !validId(value.id)) { this.protocolError('Invalid Codex server request ID'); return; }
    if (value.method !== 'item/tool/call') {
      // Board tools never imply permission for arbitrary commands, files or provider approvals.
      this.rejectServerRequest(value.id, -32601, 'Canvas One has no handler for this server request');
      return;
    }
    const params = object(value.params), input = object(params?.arguments);
    if (!params || !validId(params.threadId) || !validId(params.turnId) || !validId(params.callId) || params.namespace !== null || !validId(params.tool) || !input) {
      this.rejectServerRequest(value.id, -32602, 'Invalid Canvas One board tool request');
      this.protocolError('Codex sent a malformed board tool request');
      return;
    }
    if (!this.ready || params.threadId !== this.threadId) { this.rejectServerRequest(value.id, -32000, 'Canvas One session is not active'); return; }
    if (!this.enabledTools.includes(params.tool as AgentTool) || !this.options.boardTools) { this.rejectServerRequest(value.id, -32601, 'Canvas One board tool is not enabled'); return; }
    if (this.startingTurn) { this.bufferEarly(value); return; }
    if (params.turnId !== this.turnId) { this.rejectServerRequest(value.id, -32000, 'Canvas One turn is not active'); return; }
    const epoch = this.epoch;
    const key = JSON.stringify([epoch, params.threadId, params.turnId, params.callId]);
    if (this.seenToolCalls.has(key)) { this.rejectServerRequest(value.id, -32000, 'Canvas One tool call ID was already used'); return; }
    if (this.toolCalls.size >= this.maxPending || this.seenToolCalls.size >= 256) { this.rejectServerRequest(value.id, -32000, 'Canvas One tool request limit exceeded'); return; }
    const controller = new AbortController();
    const request: CodexBoardToolRequest = { threadId: params.threadId, turnId: params.turnId, callId: params.callId, tool: params.tool as AgentTool, input, epoch };
    this.seenToolCalls.add(key);
    const timer = setTimeout(() => this.close('Canvas One board tool timed out; reconnect explicitly'), this.timeout);
    this.toolCalls.set(key, { controller, requestId: value.id, timer });
    const requestId = value.id;
    void (async () => {
      try {
        // Recheck immediately before the trusted handler; it owns the final atomic authority check.
        if (epoch !== this.epoch || request.threadId !== this.threadId || request.turnId !== this.turnId || controller.signal.aborted) throw new Error('Stale board tool request');
        const result = await this.options.boardTools!.handle(request, controller.signal);
        if (epoch !== this.epoch || request.threadId !== this.threadId || request.turnId !== this.turnId || controller.signal.aborted) return;
        if (!result || typeof result.success !== 'boolean') throw new Error('Invalid board tool result');
        const text = JSON.stringify(result.value);
        if (text === undefined || text.length > this.maxRecord / 2) throw new Error('Invalid or oversized board tool result');
        await this.write({ id: requestId, result: { contentItems: [{ type: 'inputText', text }], success: result.success } });
      } catch {
        if (!controller.signal.aborted && epoch === this.epoch && !this.closed) this.rejectServerRequest(requestId, -32000, 'Canvas One board tool failed');
      } finally { clearTimeout(timer); this.toolCalls.delete(key); }
    })();
  }
  private rejectServerRequest(id: unknown, code: number, message: string): void {
    if (this.closed) return;
    void this.write({ id, error: { code, message } }).catch(() => this.close('Codex server request response failed'));
  }
  private abortToolCalls(): void {
    for (const call of this.toolCalls.values()) {
      clearTimeout(call.timer);
      call.controller.abort();
      this.rejectServerRequest(call.requestId, -32000, 'Canvas One board tool authority was revoked');
    }
    this.toolCalls.clear();
  }
  private protocolError(message: string): void { this.options.onEvent({ kind: 'diagnostic', code: 'protocol-error', message }); this.close('Codex protocol failed'); }
  private ensureOpen(): void { if (this.closed) throw new Error('Codex connection is closed'); }
  private ensureReady(): void { this.ensureOpen(); if (!this.ready) throw new Error('Initialize Codex before starting work'); }
  private ensureEpoch(epoch: number): void { this.ensureOpen(); if (this.epoch !== epoch) throw new Error('Codex session changed'); }
  private ensureThread(threadId: string): void { this.ensureReady(); if (!validId(threadId) || threadId !== this.threadId || this.selectingThread) throw new Error('Codex thread does not match the selected session'); }
  private ensureTurn(threadId: string, turnId: string): void { this.ensureThread(threadId); if (!validId(turnId) || turnId !== this.turnId) throw new Error('Codex turn does not match the active turn'); }
  private validateMessage(text: string, messageId: string): void { if (!text.trim() || text.length > this.maxRecord / 2 || !validId(messageId)) throw new TypeError('A bounded message and explicit message ID are required'); }
}
