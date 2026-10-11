/** Framework-independent cancellation. Native AbortSignal satisfies this contract. */
export interface CancellationSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
}
export interface ExecutionContext { readonly signal?: CancellationSignal }
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export interface CommandMetadata {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly effect: 'query' | 'document' | 'session' | 'ui' | 'export' | 'execution';
  readonly details?: JsonValue;
}
export type Availability<Code extends string = string> =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly reason: string; readonly code: Code };
export type ExecutionResult<Value, Code extends string = string> =
  | { readonly status: 'done'; readonly value: Value }
  | { readonly status: 'disabled'; readonly reason: string; readonly code: Code };
export type PayloadCheck<Payload> =
  | { readonly valid: true; readonly value: Payload }
  | { readonly valid: false; readonly reason: string };
export type CommandErrorCode = 'duplicate' | 'unknown' | 'invalid-metadata' | 'invalid-payload' | 'cancelled';
export class CommandError extends Error {
  constructor(readonly code: CommandErrorCode, readonly commandId: string, message: string) {
    super(message);
    this.name = 'CommandError';
  }
}
function checkCancellation(id: string, signal?: CancellationSignal): void {
  if (signal?.aborted) throw new CommandError('cancelled', id, 'Command was cancelled');
}
/** Rechecks availability immediately before invoking the handler. Handler failures propagate unchanged. */
export async function executeAvailable<Value, Code extends string>(
  availability: () => Availability<Code>,
  handler: () => Value | Promise<Value>,
  context: ExecutionContext = {},
  commandId = '',
): Promise<ExecutionResult<Value, Code>> {
  checkCancellation(commandId, context.signal);
  const available = availability();
  if (!available.enabled) return { status: 'disabled', reason: available.reason, code: available.code };
  checkCancellation(commandId, context.signal);
  return { status: 'done', value: await handler() };
}
export interface CommandDefinition<Context, Payload, Value> {
  readonly metadata: CommandMetadata;
  readonly validate: (input: unknown) => PayloadCheck<Payload>;
  readonly availability: (context: Context, payload: Payload) => Availability;
  readonly execute: (payload: Payload, context: Context, execution: ExecutionContext) => Value | Promise<Value>;
}
export interface CommandRegistration { dispose(): void }
interface Registered<Context> {
  readonly metadata: CommandMetadata;
  readonly run: (input: unknown, context: Context, execution: ExecutionContext) => Promise<ExecutionResult<unknown>>;
}
function isJson(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  ancestors.add(value);
  const valid = Object.values(value).every(item => isJson(item, ancestors));
  ancestors.delete(value);
  return valid;
}
function copyMetadata(metadata: CommandMetadata): CommandMetadata {
  if (typeof metadata.id !== 'string' || !metadata.id.trim() ||
      typeof metadata.label !== 'string' || !metadata.label.trim() ||
      !['query', 'document', 'session', 'ui', 'export', 'execution'].includes(metadata.effect) ||
      (metadata.keywords !== undefined && (!Array.isArray(metadata.keywords) || metadata.keywords.some(keyword => typeof keyword !== 'string'))) ||
      !isJson(metadata)) {
    throw new CommandError('invalid-metadata', metadata.id, 'Command metadata must contain readable identifiers and JSON-safe values');
  }
  return JSON.parse(JSON.stringify(metadata)) as CommandMetadata;
}
/** Host-owned registry: discovery is descriptive, never an authorization boundary. */
export class CommandRegistry<Context> {
  private readonly entries = new Map<string, Registered<Context>>();
  register<Payload, Value>(definition: CommandDefinition<Context, Payload, Value>): CommandRegistration {
    const metadata = copyMetadata(definition.metadata);
    if (this.entries.has(metadata.id)) throw new CommandError('duplicate', metadata.id, 'Command identifier already registered');
    const entry: Registered<Context> = {
      metadata,
      run: async (input, context, execution) => {
        checkCancellation(metadata.id, execution.signal);
        const payload = definition.validate(input);
        if (!payload.valid) throw new CommandError('invalid-payload', metadata.id, payload.reason);
        return executeAvailable(
          () => definition.availability(context, payload.value),
          () => definition.execute(payload.value, context, execution), execution, metadata.id,
        );
      },
    };
    this.entries.set(metadata.id, entry);
    return { dispose: () => { if (this.entries.get(metadata.id) === entry) this.entries.delete(metadata.id); } };
  }
  discover(): readonly CommandMetadata[] {
    return [...this.entries.values()].map(entry => copyMetadata(entry.metadata));
  }
  async execute(id: string, input: unknown, context: Context, execution: ExecutionContext = {}): Promise<ExecutionResult<unknown>> {
    const entry = this.entries.get(id);
    if (!entry) throw new CommandError('unknown', id, 'Command is not registered');
    return entry.run(input, context, execution);
  }
  dispose(): void { this.entries.clear(); }
}
