/**
 * Shared studio-model/1 TypeScript domain types: the document, its records,
 * payload schemas, behaviors and scenarios.
 */

import type { BulkArrival } from '../bulk-arrivals.js';
import { VALID_KINDS } from '../component-kinds.js';

// ============================================================================
// Ground rules
// ============================================================================

/**
 * - Id is a lowercase canonical UUID string. Constructors generate it; import preserves it.
 * - Ref always names an ID of a specified kind.
 *
 * Plain string aliases are chosen here for simplicity, ergonomic compatibility with
 * JSON parsing and serialization, zero-overhead runtime interop, and avoiding constructor/cast
 * ceremonies across the codebase while retaining clear semantic documentation in type signatures.
 */
export type Id = string;
export type Ref<_Kind extends string = string> = string;

/**
 * - JSON values are finite, plain, bounded and surrogate-valid (as in canonical-json-v1).
 */
export type JsonPrimitive = string | number | boolean | null;
export type Json =
  | JsonPrimitive
  | readonly Json[]
  | { readonly [key: string]: Json };

// ============================================================================
// Records
// ============================================================================

/** Top-level document fields, in canonical order. */
export const DOCUMENT_FIELDS = [
  'schema',
  'id',
  'title',
  'elements',
  'connections',
  'relations',
  'schemas',
  'fixtures',
  'refinements',
  'scenarios',
  'views',
] as const;

/**
 * The visual kind catalog: the kinds in `VALID_KINDS` (src/domain/execution.ts) plus
 * 'state-machine', 'data-pipeline', 'host', and 'linked-project'.
 */
export const VISUAL_KINDS = [
  ...VALID_KINDS,
  'state-machine',
  'data-pipeline',
  'host',
  'linked-project',
] as const;

export type VisualKind = (typeof VISUAL_KINDS)[number];

export const PORT_DIRECTIONS = ['in', 'out'] as const;
export type PortDirection = (typeof PORT_DIRECTIONS)[number];

export const PORT_CHANNELS = ['call', 'message', 'data', 'event'] as const;
export type PortChannel = (typeof PORT_CHANNELS)[number];

// ----------------------------------------------------------------------------
// Port settings
// ----------------------------------------------------------------------------

export const DELIVERY_GUARANTEES = ['at-most-once', 'at-least-once', 'exactly-once'] as const;
export type DeliveryGuarantee = (typeof DELIVERY_GUARANTEES)[number];

export const MESSAGE_ORDERINGS = ['none', 'per-key', 'global'] as const;
export type MessageOrdering = (typeof MESSAGE_ORDERINGS)[number];

/**
 * An inbound call endpoint. Declared (shown to callers, checked by advisories, never simulated):
 * expectedP95Ms, availabilityPct, idempotent. Simulated (resource nodes only, they override the
 * node's own behavior for this endpoint): rateLimit, failureRate, serviceTimeMs, maxConcurrency
 * (calls beyond it are rejected) and responseBytes.
 */
export type CallInSettings = {
  readonly expectedP95Ms?: number;
  readonly availabilityPct?: number;
  readonly idempotent?: boolean;
  readonly maxConcurrency?: number;
  readonly rateLimit?: { readonly rps: number; readonly burst: number };
  readonly failureRate?: number;
  readonly serviceTimeMs?: number;
  /** Size of the reply in bytes; with a link bandwidth it adds transfer time on the way back. */
  readonly responseBytes?: number;
};

/**
 * An inbound message endpoint. Simulated: ackDelayMs (the receiver confirms a delivery this long
 * after it arrives; default 0) and messageTtlMs (a message expires this long after it was published;
 * default 5 minutes). Declared: delivery and ordering.
 */
export type MessageInSettings = {
  readonly ackDelayMs?: number;
  readonly messageTtlMs?: number;
  readonly delivery?: DeliveryGuarantee;
  readonly ordering?: MessageOrdering;
};

/** An inbound data endpoint. Declared only. */
export type DataInSettings = {
  readonly throughputPerSec?: number;
  readonly maxStalenessMs?: number;
};

/**
 * An outbound call endpoint, the caller's contract for calling one downstream endpoint. Simulated:
 * retry, circuit breaker, in-flight limit, hedging and request size. Only simulated (resource) nodes have
 * out-port settings; the calls an unsimulated node makes use a default read request with a 60 s deadline.
 */
export type CallOutSettings = {
  readonly retry?: CallRetryPolicy;
  /** After this many consecutive failures the caller stops calling for `openMs`, then probes. */
  readonly circuitBreaker?: CircuitBreakerPolicy;
  /** Calls beyond this many outstanding through this endpoint fail fast. */
  readonly maxInFlight?: number;
  /** An attempt unanswered after `afterMs` is sent again; the first success wins. */
  readonly hedge?: { readonly afterMs: number };
  /** Size of each request in bytes; with a link bandwidth it adds transfer time. */
  readonly requestBytes?: number;
};

/** The caller's circuit breaker. */
export type CircuitBreakerPolicy = {
  readonly failureThreshold: number;
  readonly openMs: number;
  readonly halfOpenProbes: number;
};

/**
 * An outbound message endpoint. `confirm: false` makes the publisher fire and forget instead of
 * waiting for the receiver's acknowledgement; `batch` holds publishes until `size` have gathered
 * or `windowMs` has passed, then sends them over one hop.
 */
export type MessageOutSettings = {
  readonly confirm?: boolean;
  readonly batch?: { readonly size: number; readonly windowMs: number };
  readonly requestBytes?: number;
};

export type PortSettings =
  | CallInSettings
  | MessageInSettings
  | DataInSettings
  | CallOutSettings
  | MessageOutSettings;

export type Port = {
  readonly id: Id;
  readonly label: string;
  readonly direction: PortDirection;
  readonly channel: PortChannel;
  readonly schemaId: Id;
  readonly responseSchemaId: Id | null;
  /** How this port is spoken to; null only on `event` ports, which can't be connected. */
  readonly protocol: import('./protocols.js').Protocol | null;
  /** Expectations and behavior of this endpoint (see PortSettings); absent when none are set. */
  readonly settings?: PortSettings;
  /** The endpoint path or name within the protocol (`/orders`, a topic, a procedure). Absent means none. */
  readonly path?: string;
};

export type Endpoint = {
  readonly elementId: Id;
  readonly portId: Id;
};

/** Authored custom content, independent of its host renderer and executable behavior. */
export type CustomComponent = Omit<import('@canvas-one/whiteboard').BoardEntity, 'id'>;
export type Element = {
  readonly id: Id;
  readonly label: string;
  readonly description: string;
  readonly visualKind: VisualKind;
  readonly ports: readonly Port[];
  readonly behavior: Behavior;
  /**
   * The project this node stands for, on `linked-project` elements only. A reference by id
   * (never a copy), omitted otherwise so older snapshot hashes are unchanged, and never part of
   * the run manifest.
   */
  readonly linkedProjectId?: Id;
  readonly component?: CustomComponent;
};

// ----------------------------------------------------------------------------
// Connections and Connection Config
// ----------------------------------------------------------------------------

export const ROUTE_CONDITION_FIELDS = ['class', 'operation', 'tag'] as const;
export type RouteConditionField = (typeof ROUTE_CONDITION_FIELDS)[number];

export type RouteCondition = {
  readonly field: RouteConditionField;
  readonly value: string;
};

/** Caller retry policy. */
export type CallRetryPolicy = {
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly backoffMultiplier: number;
  readonly maxBackoffMs: number;
  readonly jitter: boolean;
  readonly attemptTimeoutMs: number | null;
};

// ----------------------------------------------------------------------------
// Link classes: where the two ends of a connection sit relative to each other.
// ----------------------------------------------------------------------------

export const LINK_CLASSES = ['same-host', 'same-az', 'cross-az', 'cross-region', 'internet'] as const;
export type LinkClass = (typeof LINK_CLASSES)[number];

/** One-way latency a link class stands for, in ms (assumptions, shown in the inspector). */
export const LINK_CLASS_LATENCY_MS: Readonly<Record<LinkClass, number>> = {
  'same-host': 1,
  'same-az': 2,
  'cross-az': 5,
  'cross-region': 80,
  internet: 120,
};

/**
 * Connection config for the data channel (no settings).
 */
export type DataConnectionConfig = {
};

/**
 * A call connection is the link and the route: wire delay both ways, and how a node with several
 * routes picks one. What the caller sends and how it retries live on its out-port; what the callee
 * promises lives on its in-port. `linkClass` is the preset the latencies came from (null = custom).
 */
export type CallConnectionConfig = {
  readonly latencyMs: number;
  readonly returnLatencyMs: number;
  readonly linkClass: LinkClass | null;
  /** Each leg takes up to this much longer, uniformly at random (0 = steady). */
  readonly jitterMs: number;
  /** Percent of legs that never arrive (0 = reliable). */
  readonly lossRate: number;
  /** Link bandwidth in kilobits per second; null = unlimited. Transfer time needs payload sizes on the ports. */
  readonly bandwidthKbps: number | null;
  readonly weight: number;
  readonly condition: RouteCondition | null;
  readonly fallback: boolean;
};

/** A message connection is the link and the route; acknowledgement and TTL live on the receiving in-port. */
export type MessageConnectionConfig = {
  readonly latencyMs: number;
  readonly linkClass: LinkClass | null;
  readonly jitterMs: number;
  readonly lossRate: number;
  readonly bandwidthKbps: number | null;
  readonly weight: number;
  readonly condition: RouteCondition | null;
  readonly fallback: boolean;
};

export type ConnectionConfig =
  | DataConnectionConfig
  | CallConnectionConfig
  | MessageConnectionConfig;

export const CONNECTION_KINDS = ['call', 'message', 'data'] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export type CallConnection = {
  readonly id: Id;
  readonly kind: 'call';
  readonly source: Endpoint;
  readonly target: Endpoint;
  readonly config: CallConnectionConfig;
};

export type MessageConnection = {
  readonly id: Id;
  readonly kind: 'message';
  readonly source: Endpoint;
  readonly target: Endpoint;
  readonly config: MessageConnectionConfig;
};

export type DataConnection = {
  readonly id: Id;
  readonly kind: 'data';
  readonly source: Endpoint;
  readonly target: Endpoint;
  readonly config: DataConnectionConfig;
};

export type Connection = CallConnection | MessageConnection | DataConnection;

// ----------------------------------------------------------------------------
// Relations
// ----------------------------------------------------------------------------

export const RELATION_KINDS = ['contains', 'deployed-on', 'descriptive'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export type ContainsRelation = {
  readonly id: Id;
  readonly label: string;
  readonly kind: 'contains';
  readonly parentId: Id;
  readonly childId: Id;
};

export type DeployedOnRelation = {
  readonly id: Id;
  readonly label: string;
  readonly kind: 'deployed-on';
  readonly elementId: Id;
  readonly hostId: Id;
};

export type DescriptiveRelation = {
  readonly id: Id;
  readonly label: string;
  readonly kind: 'descriptive';
  readonly sourceId: Id;
  readonly targetId: Id;
};

export type Relation =
  | ContainsRelation
  | DeployedOnRelation
  | DescriptiveRelation;

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

export type Fixture = {
  readonly id: Id;
  readonly schemaId: Id;
  readonly value: Json;
};

// ----------------------------------------------------------------------------
// Views, Placements, Groups, Notes
// ----------------------------------------------------------------------------

export type Placement = {
  readonly id: Id;
  readonly elementId: Id;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly expanded: boolean;
};

export type Group = {
  readonly id: Id;
  readonly label: string;
  readonly elementIds: readonly Id[];
  readonly collapsed: boolean;
};

/** `paper` is the yellow default; the rest are colours a user can pick for a comment. */
export const NOTE_TONES = ['paper', 'neutral', 'sky', 'mint', 'rose', 'lilac'] as const;
export type NoteTone = (typeof NOTE_TONES)[number];

export type Note = {
  readonly id: Id;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly tone: NoteTone;
  readonly attachedElementIds: readonly Id[];
};

export const CANVAS_ELEMENT_KINDS = ['rectangle', 'rounded-rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'text'] as const;
export type CanvasElementKind = (typeof CANVAS_ELEMENT_KINDS)[number];
/** Visual-only authoring; never participates in executable system semantics. */
export type CanvasElement = {
  readonly id: Id;
  readonly kind: CanvasElementKind;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text: string;
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly fontSize: number;
};

export type View = {
  readonly id: Id;
  readonly label: string;
  readonly placements: readonly Placement[];
  readonly connectionIds: readonly Id[];
  readonly relationIds: readonly Id[];
  readonly groups: readonly Group[];
  readonly notes: readonly Note[];
  /** Omitted on older documents to preserve their canonical bytes. */
  readonly canvasElements?: readonly CanvasElement[];
};

// ----------------------------------------------------------------------------
// Document
// ----------------------------------------------------------------------------

export type Document = {
  readonly schema: 'studio-model/1';
  readonly id: Id;
  readonly title: string;
  readonly elements: readonly Element[];
  readonly connections: readonly Connection[];
  readonly relations: readonly Relation[];
  readonly schemas: readonly PayloadSchema[];
  readonly fixtures: readonly Fixture[];
  readonly refinements: readonly Refinement[];
  readonly scenarios: readonly Scenario[];
  readonly views: readonly View[];
  readonly extensions?: import('@canvas-one/whiteboard').ExtensionRecords;
};

// ============================================================================
// Payload schemas
// ============================================================================

export const SCALAR_TYPES = ['string', 'boolean', 'number', 'integer'] as const;
export type ScalarType = (typeof SCALAR_TYPES)[number];

export type StringScalarShape = {
  readonly type: 'string';
  readonly nullable: boolean;
};

export type BooleanScalarShape = {
  readonly type: 'boolean';
  readonly nullable: boolean;
};

export type NumberScalarShape = {
  readonly type: 'number';
  readonly nullable: boolean;
};

export type IntegerScalarShape = {
  readonly type: 'integer';
  readonly nullable: boolean;
};

export type ScalarShape =
  | StringScalarShape
  | BooleanScalarShape
  | NumberScalarShape
  | IntegerScalarShape;

export type RecordField = {
  readonly id: Id;
  readonly key: string;
  readonly optional: boolean;
  readonly shape: Shape;
};

export type RecordShape = {
  readonly type: 'record';
  readonly nullable: boolean;
  readonly fields: readonly RecordField[];
};

export type ListShape = {
  readonly type: 'list';
  readonly nullable: boolean;
  readonly items: Shape;
  readonly maxItems: number;
};

export type ScalarUnionShape = {
  readonly type: 'scalar-union';
  readonly nullable: boolean;
  readonly types: readonly ScalarType[];
};

export type Shape =
  | ScalarShape
  | RecordShape
  | ListShape
  | ScalarUnionShape;

export type PayloadSchema = {
  readonly id: Id;
  readonly label: string;
  readonly shape: Shape;
};

// ============================================================================
// Behaviors
// ============================================================================

export const BEHAVIOR_KINDS = [
  'unmodeled',
  'resource',
  'machine',
  'pipeline',
  'decision',
  'host',
] as const;

export type BehaviorKind = (typeof BEHAVIOR_KINDS)[number];

// ----------------------------------------------------------------------------
// ResourceConfig
// ----------------------------------------------------------------------------

export type ResourceConfigBase = {
  readonly capacity: number;
  readonly concurrency: number;
  readonly queueLimit: number;
  readonly failureRate: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  /**
   * 'fixed' takes exactly 1/capacity per slot; 'exponential' draws a seeded
   * exponential time with that mean. Absent means 'fixed'.
   */
  readonly serviceTime?: 'fixed' | 'exponential' | 'lognormal';
  /** Stdev / mean for 'lognormal' (heavy tail), 0.1..10; present only for it. */
  readonly serviceTimeCv?: number;
};

export type SourceOrProcessorResourceConfig = ResourceConfigBase & {
  readonly type: 'source' | 'processor';
};

export type StorageResourceConfig = ResourceConfigBase & {
  readonly type: 'storage';
  readonly writeCapacity: number;
};

export type RouterResourceConfig = ResourceConfigBase & {
  readonly type: 'router';
  readonly strategy: 'round-robin' | 'weighted' | 'conditional';
};

export type CacheResourceConfig = ResourceConfigBase & {
  readonly type: 'cache';
  readonly mode: 'fixed' | 'lru';
  readonly hitRate: number;
  readonly entries: number;
  readonly ttlMs: number;
};

export type BrokerResourceConfig = ResourceConfigBase & {
  readonly type: 'broker';
  readonly delivery: 'competing' | 'broadcast';
};

export type ResourceConfig =
  | SourceOrProcessorResourceConfig
  | StorageResourceConfig
  | RouterResourceConfig
  | CacheResourceConfig
  | BrokerResourceConfig;

// ----------------------------------------------------------------------------
// Values and Guards
// ----------------------------------------------------------------------------

/**
 * Path is an array of literal keys or non-negative list indices, never a dotted string.
 */
export type Path = readonly (string | number)[];

export const VALUE_KINDS = ['literal', 'read', 'record', 'list', 'outcome'] as const;
export type ValueKind = (typeof VALUE_KINDS)[number];

export type LiteralValue = {
  readonly kind: 'literal';
  readonly value: Json;
};

export type ReadValue = {
  readonly kind: 'read';
  readonly source: 'input' | 'context';
  readonly path: Path;
};

export type RecordValueField = {
  readonly key: string;
  readonly value: Value;
};

export type RecordValue = {
  readonly kind: 'record';
  readonly fields: readonly RecordValueField[];
};

export type ListValue = {
  readonly kind: 'list';
  readonly items: readonly Value[];
};

export type OutcomeValue = {
  readonly kind: 'outcome';
};

export type Value =
  | LiteralValue
  | ReadValue
  | RecordValue
  | ListValue
  | OutcomeValue;

export const GUARD_OPS = [
  'equals',
  'notEquals',
  'exists',
  'all',
  'any',
  'positiveInteger',
  'nonEmpty',
  'every',
] as const;
export type GuardOp = (typeof GUARD_OPS)[number];

export type EqualsGuard = {
  readonly op: 'equals' | 'notEquals';
  readonly left: Value;
  readonly right: Value;
};

export type ExistsGuard = {
  readonly op: 'exists';
  readonly value: Value;
};

export type AllOrAnyGuard = {
  readonly op: 'all' | 'any';
  readonly guards: readonly Guard[];
};

export type PositiveIntegerGuard = {
  readonly op: 'positiveInteger';
  readonly value: Value;
};

export type NonEmptyGuard = {
  readonly op: 'nonEmpty';
  readonly value: Value;
};

export type EveryGuard = {
  readonly op: 'every';
  readonly value: Value;
  readonly itemGuard: Guard;
};

export type Guard =
  | EqualsGuard
  | ExistsGuard
  | AllOrAnyGuard
  | PositiveIntegerGuard
  | NonEmptyGuard
  | EveryGuard;

// ----------------------------------------------------------------------------
// Transitions and Effects
// ----------------------------------------------------------------------------

export const TRANSPORT_OUTCOMES = ['succeeded', 'rejected', 'failed', 'expired'] as const;
export type TransportOutcome = (typeof TRANSPORT_OUTCOMES)[number];

export type EmitCorrelation =
  | { readonly kind: 'current' }
  | { readonly kind: 'context-request'; readonly path: Path };

export type AssignEffect = {
  readonly id: Id;
  readonly kind: 'assign';
  readonly path: Path;
  readonly value: Value;
};

/**
 * Writes a request ID at `path`. The ID is derived from the run-local root ID plus a monotonic counter (no clock or RNG).
 * The runner derives it in runner/machine.ts.
 */
export type RequestIdEffect = {
  readonly id: Id;
  readonly kind: 'request-id';
  readonly path: Path;
};

export type EmitEffect = {
  readonly id: Id;
  readonly kind: 'emit';
  readonly portId: Id;
  readonly value: Value;
  readonly correlation: EmitCorrelation;
};

export type ReplyEffect = {
  readonly id: Id;
  readonly kind: 'reply';
  readonly value: Value;
  readonly outcome: TransportOutcome;
};

export type ScheduleEventEffect = {
  readonly id: Id;
  readonly kind: 'schedule-event';
  readonly delayMs: number;
  readonly eventPortId: Id;
  readonly value: Value;
};

export type TraceEffect = {
  readonly id: Id;
  readonly kind: 'trace';
  readonly code: string;
};

export type Effect =
  | AssignEffect
  | RequestIdEffect
  | EmitEffect
  | ReplyEffect
  | ScheduleEventEffect
  | TraceEffect;

export type MachineState = {
  readonly id: Id;
  readonly label: string;
};

export type Transition = {
  readonly id: Id;
  readonly fromStateId: Id;
  readonly eventPortId: Id;
  readonly guard: Guard | null;
  readonly toStateId: Id;
  readonly effects: readonly Effect[];
};

export type MachineResponseBinding = {
  readonly id: Id;
  readonly callPortId: Id;
  readonly eventPortId: Id;
};

// ----------------------------------------------------------------------------
// Operations
// ----------------------------------------------------------------------------

export const OPERATION_KINDS = [
  'validate',
  'trim',
  'map',
  'filter',
  'deduplicate',
  'group-sum',
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

export type ValidateOperation = {
  readonly id: Id;
  readonly kind: 'validate';
  readonly schemaId: Id;
};

export type TrimOperation = {
  readonly id: Id;
  readonly kind: 'trim';
  readonly path: Path;
};

export type MapOperationField = {
  readonly id: Id;
  readonly targetKey: string;
  readonly value: Value;
};

export type MapOperation = {
  readonly id: Id;
  readonly kind: 'map';
  readonly fields: readonly MapOperationField[];
};

export type FilterOperation = {
  readonly id: Id;
  readonly kind: 'filter';
  readonly guard: Guard;
};

export type DeduplicateOperation = {
  readonly id: Id;
  readonly kind: 'deduplicate';
  readonly path: Path;
};

export type GroupSumOperation = {
  readonly id: Id;
  readonly kind: 'group-sum';
  readonly keyPath: Path;
  readonly valuePath: Path;
  readonly keyName: string;
  readonly sumName: string;
};

export type Operation =
  | ValidateOperation
  | TrimOperation
  | MapOperation
  | FilterOperation
  | DeduplicateOperation
  | GroupSumOperation;

// ----------------------------------------------------------------------------
// Decision Cases
// ----------------------------------------------------------------------------

export type DecisionCase = {
  readonly id: Id;
  readonly guard: Guard;
  readonly outputPortId: Id;
  readonly value: Value;
};

export type DecisionFallback = {
  readonly outputPortId: Id;
  readonly value: Value;
};

// ----------------------------------------------------------------------------
// Behavior Variants
// ----------------------------------------------------------------------------

export type UnmodeledBehavior = {
  readonly kind: 'unmodeled';
  readonly version: 1;
  readonly reason: string;
};

export type ResourceBehavior = {
  readonly kind: 'resource';
  readonly version: 1;
  readonly config: ResourceConfig;
  readonly entryPortId: Id;
};

export type MachineBehavior = {
  readonly kind: 'machine';
  readonly version: 1;
  readonly states: readonly MachineState[];
  readonly initialStateId: Id;
  readonly contextSchemaId: Id;
  readonly initialContextFixtureId: Id;
  readonly transitions: readonly Transition[];
  readonly responseBindings: readonly MachineResponseBinding[];
};

export type PipelineBehavior = {
  readonly kind: 'pipeline';
  readonly version: 1;
  readonly inputSchemaId: Id;
  readonly outputSchemaId: Id;
  readonly errorSchemaId: Id;
  readonly inputPortId: Id;
  readonly outputPortId: Id;
  readonly errorPortId: Id;
  readonly operations: readonly Operation[];
};

export type DecisionBehavior = {
  readonly kind: 'decision';
  readonly version: 1;
  readonly inputSchemaId: Id;
  readonly inputPortId: Id;
  readonly cases: readonly DecisionCase[];
  readonly fallback: DecisionFallback;
};

export type HostBehavior = {
  readonly kind: 'host';
  readonly version: 1;
};

export type Behavior =
  | UnmodeledBehavior
  | ResourceBehavior
  | MachineBehavior
  | PipelineBehavior
  | DecisionBehavior
  | HostBehavior;

// ============================================================================
// Scenarios
// ============================================================================

export type ScenarioMode = 'logical' | 'timed';

/**
 * Scenario budgets.
 * budgets={maxEvents,maxTraceRows,maxTraceBytes,maxScheduledEvents,maxLiveRoots}
 * Bounds are enforced by validate.ts; runner defaults are in runner/types.ts.
 */
export type ScenarioBudgets = {
  readonly maxEvents: number;
  readonly maxTraceRows: number;
  readonly maxTraceBytes: number;
  readonly maxScheduledEvents: number;
  readonly maxLiveRoots: number;
};
export type Budgets = ScenarioBudgets;

// ----------------------------------------------------------------------------
// Inputs
// ----------------------------------------------------------------------------

export type InputBindingSource = {
  readonly port: Endpoint;
  readonly journeyId: Id;
  readonly occurrence: number;
  readonly path: Path;
};

export type InputBinding = {
  readonly targetPath: Path;
  readonly source: InputBindingSource;
};

export type ResourceMetadata = {
  readonly requestClassId: Id;
  readonly operation: 'read' | 'write';
  readonly key: string | null;
  readonly tags: readonly string[];
  readonly deadlineMs: number;
};

export type Input = {
  readonly id: Id;
  readonly entry: Endpoint;
  readonly fixtureId: Id;
  readonly journeyId: Id;
  readonly atMs: number | null;
  readonly payloadBindings: readonly InputBinding[];
  readonly resource: ResourceMetadata | null;
};
export type ScenarioInput = Input;

// ----------------------------------------------------------------------------
// Workloads
// ----------------------------------------------------------------------------

export type KeyDistribution = {
  readonly kind: 'uniform' | 'hot';
  readonly catalogSize: number;
  readonly hotSubset: number;
  readonly hotShare: number;
};

export type RequestClass = {
  readonly id: Id;
  readonly name: string;
  readonly weight: number;
  readonly operation: 'read' | 'write';
  readonly tags: readonly string[];
  readonly keyDistribution: KeyDistribution;
};

/**
 * The arrival rate of a stream over time. `burst` runs at `peakRate` between `startMs`
 * and `endMs` (from the run start) and at the base rate otherwise; `ramp` moves linearly from the
 * base rate to `endRate` over `rampMs` and then holds `endRate`.
 */
export type WorkloadProfile =
  | { readonly kind: 'steady' }
  | { readonly kind: 'burst'; readonly peakRate: number; readonly startMs: number; readonly endMs: number }
  | { readonly kind: 'ramp'; readonly endRate: number; readonly rampMs: number };

/** A bulk of N requests; the run's cycle for this source completes when all N have settled. */
export type BulkEmission = {
  readonly mode: 'bulk';
  readonly requests: number;
  readonly arrival: BulkArrival;
};

/** Requests at a rate with no end; the run goes on until the user presses Stop. */
export type StreamEmission = {
  readonly mode: 'stream';
  readonly ratePerSecond: number;
  readonly profile: WorkloadProfile;
};

export type Emission = BulkEmission | StreamEmission;

/**
 * A source: where requests enter, when it starts (`startDelayMs` from the run start), and what it
 * emits (a bulk of N or an endless stream). Keeps the RequestClass fields; entry is an Endpoint,
 * IDs are UUIDs.
 */
export type Workload = {
  readonly id: Id;
  readonly entry: Endpoint;
  readonly enabled: boolean;
  readonly startDelayMs: number;
  readonly emission: Emission;
  readonly timeoutMs: number;
  readonly classes: readonly RequestClass[];
};

// ----------------------------------------------------------------------------
// Faults
// ----------------------------------------------------------------------------

export type Fault = {
  readonly id: Id;
  readonly hostId: Id;
  readonly downAtMs: number;
  readonly upAtMs: number;
  readonly detectionDelayMs: number;
  readonly recoveryDetectionDelayMs: number;
  readonly activePolicy: 'fail';
  readonly queuedPolicy: 'reject';
  readonly routeReset: 'first-healthy';
};

// ----------------------------------------------------------------------------
// Boundaries
// ----------------------------------------------------------------------------

export type BoundaryPayloadBinding = {
  readonly targetPath: Path;
  readonly requestPath: Path;
};

export type BoundaryResponse = {
  readonly id: Id;
  readonly match: Guard;
  readonly responseFixtureId: Id;
  readonly payloadBindings: readonly BoundaryPayloadBinding[];
  readonly delayMs: number | null;
  readonly afterInputId: Id | null;
  /**
   * True = this response answers every matching request instead of being used once
   * Otherwise the first unused matching response is consumed. Absent means once.
   */
  readonly repeat?: boolean;
  readonly outcome: TransportOutcome;
};

export type Boundary = {
  readonly id: Id;
  readonly source: Endpoint;
  readonly schemaId: Id;
  readonly responses: readonly BoundaryResponse[];
};

// ----------------------------------------------------------------------------
// Refinement and Selection
// ----------------------------------------------------------------------------

export type PortMapping = {
  readonly id: Id;
  readonly outer: Endpoint;
  readonly inner: Endpoint;
};
export type RefinementPortMapping = PortMapping;

export type Refinement = {
  readonly id: Id;
  readonly ownerElementId: Id;
  readonly memberElementIds: readonly Id[];
  readonly portMappings: readonly PortMapping[];
};

export type Selection = {
  readonly refinementId: Id;
  readonly mode: 'aggregate' | 'refined';
};
export type RefinementSelection = Selection;

// ----------------------------------------------------------------------------
// Initial Contexts
// ----------------------------------------------------------------------------

export type InitialContext = {
  readonly elementId: Id;
  readonly fixtureId: Id;
};
export type ScenarioInitialContext = InitialContext;

// ----------------------------------------------------------------------------
// Assertions
// ----------------------------------------------------------------------------

export const ASSERTION_SUBJECT_KINDS = [
  'final-state',
  'context',
  'output',
  'count',
  'trace-count',
  'metric',
] as const;
export type AssertionSubjectKind = (typeof ASSERTION_SUBJECT_KINDS)[number];

export type FinalStateSubject = {
  readonly kind: 'final-state';
  readonly elementId: Id;
};

export type ContextSubject = {
  readonly kind: 'context';
  readonly elementId: Id;
  readonly path: Path;
};

export type OutputSubject = {
  readonly kind: 'output';
  readonly port: Endpoint;
  readonly path: Path;
};

export const COUNT_SUBJECT_SCOPES = ['root', 'message', 'element'] as const;
export type CountSubjectScope = (typeof COUNT_SUBJECT_SCOPES)[number];

export const COUNT_SUBJECT_OUTCOMES = [
  'generated',
  'succeeded',
  'rejected',
  'failed',
  'expired',
  'inFlight',
] as const;
export type CountSubjectOutcome = (typeof COUNT_SUBJECT_OUTCOMES)[number];

export type CountSubject = {
  readonly kind: 'count';
  readonly scope: CountSubjectScope;
  readonly elementId: Id | null;
  readonly outcome: CountSubjectOutcome;
};

export type TraceCountSubject = {
  readonly kind: 'trace-count';
  readonly elementId: Id;
  readonly code: string;
};

export const METRIC_SUBJECT_KEYS = [
  'throughput',
  'meanLatencyMs',
  'p95LatencyMs',
  'utilization',
] as const;
export type MetricSubjectKey = (typeof METRIC_SUBJECT_KEYS)[number];

export type MetricSubject = {
  readonly kind: 'metric';
  readonly elementId: Id;
  readonly key: MetricSubjectKey;
};

export type AssertionSubject =
  | FinalStateSubject
  | ContextSubject
  | OutputSubject
  | CountSubject
  | TraceCountSubject
  | MetricSubject;

export const ASSERTION_OPERATORS = ['equals', 'at-most', 'at-least'] as const;
export type AssertionOperator = (typeof ASSERTION_OPERATORS)[number];

export type Assertion = {
  readonly id: Id;
  readonly label: string;
  readonly subject: AssertionSubject;
  readonly operator: AssertionOperator;
  readonly expected: Json;
};

// ----------------------------------------------------------------------------
// Assumptions
// ----------------------------------------------------------------------------

export const ASSUMPTION_SOURCES = ['author', 'template', 'measured'] as const;
export type AssumptionSource = (typeof ASSUMPTION_SOURCES)[number];

export type Assumption = {
  readonly id: Id;
  readonly key: string;
  readonly value: Json;
  readonly source: AssumptionSource;
  readonly description: string;
};

// ----------------------------------------------------------------------------
// Scenario
// ----------------------------------------------------------------------------

export type Scenario = {
  readonly id: Id;
  readonly label: string;
  readonly revision: number;
  readonly mode: ScenarioMode;
  readonly scopeElementIds: readonly Id[];
  readonly entryPorts: readonly Endpoint[];
  readonly inputs: readonly Input[];
  readonly workloads: readonly Workload[];
  readonly faults: readonly Fault[];
  readonly boundaries: readonly Boundary[];
  readonly refinementSelections: readonly Selection[];
  readonly initialContexts: readonly InitialContext[];
  readonly assertions: readonly Assertion[];
  readonly seed: number;
  readonly budgets: ScenarioBudgets;
  readonly assumptions: readonly Assumption[];
};
