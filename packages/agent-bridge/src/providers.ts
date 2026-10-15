/** Provider wire formats are version-specific. These parsers do not execute CLIs or grant board authority. */
export type LocalAgentProvider = 'claude' | 'codex' | 'agy';
export type CapabilityEvidence = 'verified-fixture' | 'unverified' | 'blocked';
export type ProviderCapabilities = Readonly<{
  protocol: 'claude-stream-json' | 'codex-exec-json' | 'agy-stream-json';
  streaming: CapabilityEvidence;
  explicitSessionContinuation: CapabilityEvidence;
  boardToolTransport: CapabilityEvidence;
  activeFeedback: CapabilityEvidence;
  cancellationAcknowledgement: CapabilityEvidence;
  interruptedRecovery: CapabilityEvidence;
}>;

/** Continuation is NOT interrupted recovery. Codex exec is NOT app-server turn support. */
export const LOCAL_PROVIDER_CAPABILITIES: Readonly<Record<LocalAgentProvider, ProviderCapabilities>> = {
  claude: { protocol: 'claude-stream-json', streaming: 'verified-fixture', explicitSessionContinuation: 'verified-fixture', boardToolTransport: 'verified-fixture', activeFeedback: 'unverified', cancellationAcknowledgement: 'unverified', interruptedRecovery: 'unverified' },
  codex: { protocol: 'codex-exec-json', streaming: 'verified-fixture', explicitSessionContinuation: 'verified-fixture', boardToolTransport: 'verified-fixture', activeFeedback: 'unverified', cancellationAcknowledgement: 'unverified', interruptedRecovery: 'unverified' },
  agy: { protocol: 'agy-stream-json', streaming: 'verified-fixture', explicitSessionContinuation: 'verified-fixture', boardToolTransport: 'blocked', activeFeedback: 'unverified', cancellationAcknowledgement: 'unverified', interruptedRecovery: 'unverified' },
};

export type ProviderEventPayload =
  | { readonly kind: 'session'; readonly sessionId: string }
  | { readonly kind: 'text'; readonly text: string; readonly format: 'delta' | 'message' }
  | { readonly kind: 'tool'; readonly toolId: string; readonly name: string; readonly phase: 'started' | 'completed' | 'failed' }
  | { readonly kind: 'diagnostic'; readonly code: 'malformed-record' | 'record-too-large' | 'provider-error' | 'tool-denied' | 'incomplete-stream' | 'process-exit'; readonly message: string }
  | { readonly kind: 'provider-result'; readonly outcome: 'succeeded' | 'failed' | 'cancelled'; readonly cancellationAcknowledged: boolean }
  | { readonly kind: 'attempt-ended'; readonly outcome: 'succeeded' | 'failed' | 'cancelled'; readonly cancellationAcknowledged: boolean };
export type ProviderEvent = Readonly<{
  version: 1;
  provider: LocalAgentProvider;
  taskId: string;
  attemptId: string;
  sequence: number;
  eventId: string;
  payload: ProviderEventPayload;
}>;
export type ProviderStreamContext = Readonly<{ taskId: string; attemptId: string }>;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined;
const string = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const list = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];

/** The supervisor must use these gates independently of a provider's prose or success flag. */
export type ProviderAttemptControl = {
  readonly providerSessionId: string;
  send: (message: { readonly messageId: string; readonly target: 'task' | 'clarification' | 'proposal-revision'; readonly text: string }) => Promise<{ readonly delivered: boolean; readonly acknowledged: boolean }>;
  cancel: () => Promise<{ readonly acknowledged: boolean }>;
};

/** Incremental NDJSON decoder. Unknown records (including reasoning) are ignored, never shown as activity. */
export class ProviderStreamNormalizer {
  private pending = '';
  private discardLine = false;
  private sequence = 0;
  private failed = false;
  private ended = false;
  private outcome: 'succeeded' | 'failed' | 'cancelled' = 'failed';
  private closed = false;
  private hadText = false;
  private streamedClaudeText = false;
  private readonly claudeTools = new Map<string, string>();
  private readonly agyTools = new Map<number, 'started' | 'completed' | 'failed'>();
  private readonly maxRecordChars: number;

  constructor(readonly provider: LocalAgentProvider, readonly context: ProviderStreamContext, options: { maxRecordChars?: number } = {}) {
    if (!context.taskId || !context.attemptId || context.taskId.length > 200 || context.attemptId.length > 200) throw new TypeError('Task and attempt IDs are required and bounded');
    this.maxRecordChars = options.maxRecordChars ?? 256 * 1024;
    if (!Number.isSafeInteger(this.maxRecordChars) || this.maxRecordChars < 128 || this.maxRecordChars > 1024 * 1024) throw new RangeError('Record limit must be between 128 and 1048576 characters');
  }

  push(chunk: string): ProviderEvent[] {
    if (this.closed) throw new Error('Provider stream is closed');
    const events: ProviderEvent[] = [];
    // Never retain a whole incoming chunk: scan records and cap the retained incomplete line.
    let start = 0;
    while (start < chunk.length) {
      const end = chunk.indexOf('\n', start);
      const stop = end < 0 ? chunk.length : end;
      if (!this.discardLine) {
        if (this.pending.length + stop - start > this.maxRecordChars) {
          this.pending = '';
          this.discardLine = true;
          this.error(events, 'record-too-large', 'Provider record exceeded the size limit');
        } else this.pending += chunk.slice(start, stop);
      }
      if (end < 0) break;
      if (!this.discardLine) this.parseLine(this.pending, events);
      this.pending = '';
      this.discardLine = false;
      start = end + 1;
    }
    return events;
  }

  /** Exit 0 cannot substitute for a terminal protocol record; signal termination is not a cancel receipt. */
  finish(exitCode: number | null): ProviderEvent[] {
    if (this.closed) return [];
    const events: ProviderEvent[] = [];
    if (this.pending && !this.discardLine) this.parseLine(this.pending, events);
    this.pending = '';
    this.closed = true;
    if (exitCode !== 0) this.error(events, 'process-exit', exitCode === null ? 'Provider process ended without an exit code' : `Provider process exited with code ${exitCode}`);
    if (!this.ended) {
      this.error(events, 'incomplete-stream', 'Provider stream ended without a terminal outcome');
    }
    this.emit(events, { kind: 'attempt-ended', outcome: this.failed ? 'failed' : this.outcome, cancellationAcknowledged: this.outcome === 'cancelled' });
    return events;
  }

  private emit(events: ProviderEvent[], payload: ProviderEventPayload): void {
    const sequence = ++this.sequence;
    events.push({ version: 1, provider: this.provider, ...this.context, sequence, eventId: `${this.context.attemptId}:${sequence}`, payload });
  }
  private error(events: ProviderEvent[], code: Extract<ProviderEventPayload, { kind: 'diagnostic' }>['code'], message: string): void {
    this.failed = true;
    this.emit(events, { kind: 'diagnostic', code, message });
  }
  private text(events: ProviderEvent[], value: unknown, format: 'delta' | 'message'): void {
    const text = string(value);
    if (text) { this.hadText = true; this.emit(events, { kind: 'text', text, format }); }
  }
  private end(events: ProviderEvent[], outcome: 'succeeded' | 'failed' | 'cancelled'): void {
    this.ended = true;
    this.outcome = this.failed ? 'failed' : outcome;
    this.emit(events, { kind: 'provider-result', outcome: this.outcome, cancellationAcknowledged: outcome === 'cancelled' });
  }
  private parseLine(line: string, events: ProviderEvent[]): void {
    if (!line.trim()) return;
    let value: RecordValue | undefined;
    try { value = record(JSON.parse(line)); } catch { /* No raw provider output in diagnostics. */ }
    if (!value) { this.error(events, 'malformed-record', 'Provider record was not a JSON object'); return; }
    if (this.ended) return; // One normalizer represents one execution attempt.
    if (this.provider === 'claude') this.claude(value, events);
    else if (this.provider === 'codex') this.codex(value, events);
    else this.agy(value, events);
  }
  private session(events: ProviderEvent[], value: unknown): void {
    const sessionId = string(value);
    if (sessionId && sessionId.length <= 200) this.emit(events, { kind: 'session', sessionId });
  }
  private tool(events: ProviderEvent[], id: unknown, name: unknown, phase: 'started' | 'completed' | 'failed'): void {
    const toolId = string(id), toolName = string(name);
    if (toolId && toolName) this.emit(events, { kind: 'tool', toolId, name: toolName, phase });
  }
  private claude(value: RecordValue, events: ProviderEvent[]): void {
    if (value.type === 'system' && value.subtype === 'init') this.session(events, value.session_id);
    if (value.type === 'stream_event') {
      const event = record(value.event), delta = record(event?.delta), block = record(event?.content_block);
      if (event?.type === 'content_block_delta' && delta?.type === 'text_delta') {
        this.streamedClaudeText = true;
        this.text(events, delta.text, 'delta');
      }
      if (event?.type === 'content_block_start' && block?.type === 'tool_use') this.claudeToolStart(block, events);
    }
    if (value.type === 'assistant') {
      for (const item of list(record(value.message)?.content)) {
        const block = record(item);
        if (block?.type === 'text' && !this.streamedClaudeText) this.text(events, block.text, 'message');
        if (block?.type === 'tool_use') this.claudeToolStart(block, events);
      }
      this.streamedClaudeText = false;
    }
    if (value.type === 'user') {
      for (const item of list(record(value.message)?.content)) {
        const block = record(item), id = string(block?.tool_use_id);
        if (block?.type !== 'tool_result' || !id) continue;
        const name = this.claudeTools.get(id);
        if (!name) continue;
        this.tool(events, id, name, block.is_error === true ? 'failed' : 'completed');
        this.claudeTools.delete(id);
        if (block.is_error === true) this.error(events, 'provider-error', 'Provider tool invocation failed');
      }
    }
    if (value.type === 'result') {
      if (list(value.permission_denials).length) this.error(events, 'tool-denied', 'Provider denied one or more tool actions');
      if (value.is_error !== false || value.subtype !== 'success') this.error(events, 'provider-error', 'Provider reported an unsuccessful result');
      if (!this.hadText) this.text(events, value.result, 'message');
      this.end(events, this.failed ? 'failed' : 'succeeded');
    }
  }
  private claudeToolStart(block: RecordValue, events: ProviderEvent[]): void {
    const id = string(block.id), name = string(block.name);
    if (!id || !name || this.claudeTools.has(id)) return;
    if (this.claudeTools.size >= 256) {
      this.error(events, 'record-too-large', 'Provider exceeded the active tool limit');
      return;
    }
    this.claudeTools.set(id, name);
    this.tool(events, id, name, 'started');
  }
  private codex(value: RecordValue, events: ProviderEvent[]): void {
    if (value.type === 'thread.started') this.session(events, value.thread_id);
    const item = record(value.item);
    if (value.type === 'item.completed' && item?.type === 'agent_message') this.text(events, item.text, 'message');
    if ((value.type === 'item.started' || value.type === 'item.completed') && item?.type === 'mcp_tool_call') {
      const failed = item.error != null || item.status === 'failed' || record(item.result)?.isError === true;
      this.tool(events, item.id, item.tool, failed ? 'failed' : value.type === 'item.started' ? 'started' : 'completed');
      if (failed) this.error(events, 'provider-error', 'Provider tool invocation failed');
    }
    // item.type=error can be a nonfatal CLI warning; do not classify it as a failed turn.
    if (value.type === 'turn.failed' || value.type === 'error') this.error(events, 'provider-error', 'Provider reported an execution error');
    if (value.type === 'turn.completed' || value.type === 'turn.failed') this.end(events, this.failed ? 'failed' : 'succeeded');
  }
  private agy(value: RecordValue, events: ProviderEvent[]): void {
    if (value.event === 'init') this.session(events, value.conversation_id);
    const step = record(value.step_update);
    if (value.event === 'step_update' && step?.step_type === 'agent_response') this.text(events, step.text_delta, 'delta');
    if (value.event === 'step_update' && step?.step_type === 'tool') {
      const index = step.step_index, name = string(step.tool_name);
      if (typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && name && name.length <= 200) {
        // ACTIVE/DONE were observed locally. Explicit failure/cancel states fail conservatively;
        // other states are ignored rather than guessed to mean "started".
        const phase = step.state === 'ACTIVE' ? 'started' : step.state === 'DONE' ? 'completed' : step.state === 'FAILED' || step.state === 'CANCELLED' ? 'failed' : undefined;
        if (phase) {
          const previous = this.agyTools.get(index);
          if (!previous && this.agyTools.size >= 256) this.error(events, 'record-too-large', 'Provider exceeded the tracked tool limit');
          else if (phase !== previous && !(phase === 'started' && previous)) {
            this.agyTools.set(index, phase);
            this.tool(events, String(index), name, phase);
            if (phase === 'failed') this.error(events, 'provider-error', 'Provider tool invocation failed');
          }
        }
      }
    }
    if (value.event === 'result') {
      const result = record(value.result);
      if (list(result?.denied_actions).length) this.error(events, 'tool-denied', 'Provider denied one or more tool actions');
      if (result?.status !== 'SUCCESS') this.error(events, 'provider-error', 'Provider reported an unsuccessful result');
      if (!this.hadText) this.text(events, result?.response, 'message');
      this.end(events, this.failed ? 'failed' : 'succeeded');
    }
  }
}
