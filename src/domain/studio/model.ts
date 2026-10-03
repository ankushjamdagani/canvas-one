/**
 * Shared studio-model/1 TypeScript domain types.
 *
 * Ground rules and specifications from specs/revamp/contracts/model-and-runner.md:
 * - §1 Ground rules
 * - §2 Records
 * - §3 Payload schemas
 * - §4 Behaviors
 * - §6 Scenarios
 */

import { VALID_KINDS } from '../execution';

// ============================================================================
// §1 Ground rules
// ============================================================================

/**
 * Contract §1:
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
 * Contract §1:
 * - JSON values are finite, plain, bounded and surrogate-valid (as in canonical-json-v1).
 */
export type JsonPrimitive = string | number | boolean | null;
export type Json =
  | JsonPrimitive
  | readonly Json[]
  | { readonly [key: string]: Json };

// ============================================================================
// §2 Records
// ============================================================================

/**
 * Contract §2: Document field list.
 */
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
 * Contract §2: visualKind catalog.
 * Exactly the 29-kind catalog in src/domain/execution.ts:VALID_KINDS plus
 * 'state-machine', 'data-pipeline', 'host', and (D52) 'linked-project'.
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

/**
 * Contract §2: Port
 * id, label, direction:'in'|'out', channel:'call'|'message'|'data'|'event', schemaId, responseSchemaId:Id|null
 */
export type Port = {
  readonly id: Id;
  readonly label: string;
  readonly direction: PortDirection;
  readonly channel: PortChannel;
  readonly schemaId: Id;
  readonly responseSchemaId: Id | null;
  /** D53: absent means the node's default protocol for the channel (see protocols.ts). */
  readonly protocol?: import('./protocols').Protocol;
};

/**
 * Contract §2: Endpoint
 * elementId, portId
 */
export type Endpoint = {
  readonly elementId: Id;
  readonly portId: Id;
};

/**
 * Contract §2: Element
 * id, label, description, visualKind, ports:Port[], behavior:Behavior, linkedProjectId? (D52)
 */
export type Element = {
  readonly id: Id;
  readonly label: string;
  readonly description: string;
  readonly visualKind: VisualKind;
  readonly ports: readonly Port[];
  readonly behavior: Behavior;
  /**
   * D52: the project this node stands for, on `linked-project` elements only. A reference by id
   * (never a copy), omitted otherwise so older snapshot hashes are unchanged, and never part of
   * the run manifest.
   */
  readonly linkedProjectId?: Id;
};

// ----------------------------------------------------------------------------
// Connections and Connection Config (§2 & §4)
// ----------------------------------------------------------------------------

export const ROUTE_CONDITION_FIELDS = ['class', 'operation', 'tag'] as const;
export type RouteConditionField = (typeof ROUTE_CONDITION_FIELDS)[number];

/**
 * Contract §4: RouteCondition
 * field:'class'|'operation'|'tag', value
 */
export type RouteCondition = {
  readonly field: RouteConditionField;
  readonly value: string;
};

/**
 * Contract §4 & §6: ResourceCallMetadata
 * Call/message edges from non-resource behavior into a resource need
 * ResourceCallMetadata={requestClassId:Id,requestClassLabel:string,operation:'read'|'write',key:string|null,tags:string[],deadlineDurationMs:number}
 */
export type ResourceCallMetadata = {
  readonly requestClassId: Id;
  /** Presentation only; 1–60 Unicode code points. */
  readonly requestClassLabel: string;
  readonly operation: 'read' | 'write';
  readonly key: string | null;
  readonly tags: readonly string[];
  readonly deadlineDurationMs: number;
};

/**
 * Contract §4: Connection config for data channel.
 * data: {}
 */
export type DataConnectionConfig = {
  // §4: data: {}
};

/**
 * Contract §4: Connection config for call channel.
 * call: {latencyMs,returnLatencyMs,weight,condition:RouteCondition|null,fallback:boolean,resource:ResourceCallMetadata|null}
 */
export type CallConnectionConfig = {
  readonly latencyMs: number;
  readonly returnLatencyMs: number;
  readonly weight: number;
  readonly condition: RouteCondition | null;
  readonly fallback: boolean;
  readonly resource: ResourceCallMetadata | null;
  /**
   * D49: the caller's retry policy for this call. Absent or null means no retries
   * (connections created before D49 have no field).
   */
  readonly retry?: CallRetryPolicy | null;
};

/** D49: caller retry policy (model-and-runner.md §4). */
export type CallRetryPolicy = {
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly backoffMultiplier: number;
  readonly maxBackoffMs: number;
  readonly jitter: boolean;
  readonly attemptTimeoutMs: number | null;
};

/**
 * Contract §4: Connection config for message channel.
 * message: {latencyMs,ackDelayMs,messageTtlMs,weight,condition:RouteCondition|null,fallback:boolean,resource:ResourceCallMetadata|null}
 */
export type MessageConnectionConfig = {
  readonly latencyMs: number;
  readonly ackDelayMs: number;
  readonly messageTtlMs: number;
  readonly weight: number;
  readonly condition: RouteCondition | null;
  readonly fallback: boolean;
  readonly resource: ResourceCallMetadata | null;
};

export type ConnectionConfig =
  | DataConnectionConfig
  | CallConnectionConfig
  | MessageConnectionConfig;

export const CONNECTION_KINDS = ['call', 'message', 'data'] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export type CallConnection = {
  readonly id: Id;
  readonly label: string;
  readonly kind: 'call';
  readonly source: Endpoint;
  readonly target: Endpoint;
  readonly config: CallConnectionConfig;
};

export type MessageConnection = {
  readonly id: Id;
  readonly label: string;
  readonly kind: 'message';
  readonly source: Endpoint;
  readonly target: Endpoint;
  readonly config: MessageConnectionConfig;
};

export type DataConnection = {
  readonly id: Id;
  readonly label: string;
  readonly kind: 'data';
  readonly source: Endpoint;
  readonly target: Endpoint;
  readonly config: DataConnectionConfig;
};

/**
 * Contract §2: Connection (discriminated union per §4)
 * id, label, kind:'call'|'message'|'data', source:Endpoint, target:Endpoint, config (§4)
 */
export type Connection = CallConnection | MessageConnection | DataConnection;

// ----------------------------------------------------------------------------
// Relations (§2)
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

/**
 * Contract §2: Relation (discriminated union)
 * id, label plus one of:
 * - {kind:'contains',parentId,childId}
 * - {kind:'deployed-on',elementId,hostId}
 * - {kind:'descriptive',sourceId,targetId}
 */
export type Relation =
  | ContainsRelation
  | DeployedOnRelation
  | DescriptiveRelation;

// ----------------------------------------------------------------------------
// Fixtures (§2)
// ----------------------------------------------------------------------------

/**
 * Contract §2: Fixture
 * id, schemaId, value:Json
 */
export type Fixture = {
  readonly id: Id;
  readonly schemaId: Id;
  readonly value: Json;
};

// ----------------------------------------------------------------------------
// Views, Placements, Groups, Notes (§2)
// ----------------------------------------------------------------------------

/**
 * Contract §2: Placement
 * id, elementId, x, y, width, expanded:boolean
 */
export type Placement = {
  readonly id: Id;
  readonly elementId: Id;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly expanded: boolean;
};

/**
 * Contract §2: Group
 * id, label, elementIds:Id[], collapsed:boolean
 */
export type Group = {
  readonly id: Id;
  readonly label: string;
  readonly elementIds: readonly Id[];
  readonly collapsed: boolean;
};

/** `paper` is the yellow default; the rest are colours a user can pick for a comment. */
export const NOTE_TONES = ['paper', 'neutral', 'sky', 'mint', 'rose', 'lilac'] as const;
export type NoteTone = (typeof NOTE_TONES)[number];

/**
 * Contract §2: Note
 * id, text, x, y, width, tone:NoteTone, attachedElementIds:Id[]
 */
export type Note = {
  readonly id: Id;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly tone: NoteTone;
  readonly attachedElementIds: readonly Id[];
};

/**
 * Contract §2: View
 * id, label, placements:Placement[], connectionIds:Id[], relationIds:Id[], groups:Group[], notes:Note[]
 */
export type View = {
  readonly id: Id;
  readonly label: string;
  readonly placements: readonly Placement[];
  readonly connectionIds: readonly Id[];
  readonly relationIds: readonly Id[];
  readonly groups: readonly Group[];
  readonly notes: readonly Note[];
};

// ----------------------------------------------------------------------------
// Document (§2)
// ----------------------------------------------------------------------------

/**
 * Contract §2: Document
 * schema:'studio-model/1', id, title, elements:Element[], connections:Connection[],
 * relations:Relation[], schemas:PayloadSchema[], fixtures:Fixture[],
 * refinements:Refinement[], scenarios:Scenario[], views:View[]
 */
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
};

// ============================================================================
// §3 Payload schemas
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

/**
 * Contract §3: Scalar shape (nullable is required)
 * {type:'string'|'boolean'|'number'|'integer',nullable:boolean}
 */
export type ScalarShape =
  | StringScalarShape
  | BooleanScalarShape
  | NumberScalarShape
  | IntegerScalarShape;

/**
 * Contract §3: Record field
 * {id,key,optional:boolean,shape}
 */
export type RecordField = {
  readonly id: Id;
  readonly key: string;
  readonly optional: boolean;
  readonly shape: Shape;
};

/**
 * Contract §3: Record shape (nullable is required)
 * {type:'record',nullable,fields:[{id,key,optional:boolean,shape}]}
 */
export type RecordShape = {
  readonly type: 'record';
  readonly nullable: boolean;
  readonly fields: readonly RecordField[];
};

/**
 * Contract §3: List shape (nullable is required)
 * {type:'list',nullable,items:shape,maxItems}
 */
export type ListShape = {
  readonly type: 'list';
  readonly nullable: boolean;
  readonly items: Shape;
  readonly maxItems: number;
};

/**
 * Contract §3: Scalar-union shape (nullable is required)
 * {type:'scalar-union',nullable,types:('string'|'boolean'|'number'|'integer')[]}
 */
export type ScalarUnionShape = {
  readonly type: 'scalar-union';
  readonly nullable: boolean;
  readonly types: readonly ScalarType[];
};

/**
 * Contract §3: Shape union
 */
export type Shape =
  | ScalarShape
  | RecordShape
  | ListShape
  | ScalarUnionShape;

/**
 * Contract §3: PayloadSchema
 * PayloadSchema={id,label,shape}
 */
export type PayloadSchema = {
  readonly id: Id;
  readonly label: string;
  readonly shape: Shape;
};

// ============================================================================
// §4 Behaviors
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
// ResourceConfig (§4)
// ----------------------------------------------------------------------------

export type ResourceConfigBase = {
  readonly capacity: number;
  readonly concurrency: number;
  readonly queueLimit: number;
  readonly failureRate: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  /**
   * D49: 'fixed' takes exactly 1/capacity per slot; 'exponential' draws a seeded
   * exponential time with that mean. Absent means 'fixed' (configs created before D49).
   */
  readonly serviceTime?: 'fixed' | 'exponential' | 'lognormal';
  /** D50: stdev / mean for 'lognormal' (heavy tail), 0.1..10; present only for it. */
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

/**
 * Contract §4: ResourceConfig (copied, versioned contract)
 * Common fields: capacity, concurrency, queueLimit, failureRate, maxRetries, retryDelayMs.
 * Variants:
 * - type:'source'|'processor'
 * - type:'storage',writeCapacity
 * - type:'router',strategy:'round-robin'|'weighted'|'conditional'
 * - type:'cache',mode:'fixed'|'lru',hitRate,entries,ttlMs
 * - type:'broker',delivery:'competing'|'broadcast'
 */
export type ResourceConfig =
  | SourceOrProcessorResourceConfig
  | StorageResourceConfig
  | RouterResourceConfig
  | CacheResourceConfig
  | BrokerResourceConfig;

// ----------------------------------------------------------------------------
// Values and Guards (§4)
// ----------------------------------------------------------------------------

/**
 * Contract §4: Path
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

/**
 * Contract §4: Value
 * {kind:'literal',value:Json} | {kind:'read',source:'input'|'context',path:Path}
 * | {kind:'record',fields:[{key:string,value:Value}]} | {kind:'list',items:Value[]}
 * | {kind:'outcome'}
 */
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

/**
 * Contract §4: Guard
 * - {op:'equals'|'notEquals',left:Value,right:Value}
 * - {op:'exists',value:Value}
 * - {op:'all'|'any',guards:Guard[]} (nonempty)
 * - {op:'positiveInteger',value:Value}
 * - {op:'nonEmpty',value:Value}
 * - {op:'every',value:Value,itemGuard:Guard}
 */
export type Guard =
  | EqualsGuard
  | ExistsGuard
  | AllOrAnyGuard
  | PositiveIntegerGuard
  | NonEmptyGuard
  | EveryGuard;

// ----------------------------------------------------------------------------
// Transitions and Effects (§4)
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
 * Contract §4: {id,kind:'request-id',path:Path}
 * ID derived from the run-local root ID plus a monotonic counter (no clock or RNG).
 * The runner derives it in runner/machine.ts (run-identity.md §1/§2).
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

/**
 * Contract §4: Transition
 * Transition={id,fromStateId,eventPortId,guard:Guard|null,toStateId,effects:Effect[]}
 */
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
// Operations (§4)
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
// Decision Cases (§4)
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
// Behavior Variants (§4)
// ----------------------------------------------------------------------------

/**
 * Contract §4: unmodeled
 * {kind:'unmodeled',version:1,reason}
 */
export type UnmodeledBehavior = {
  readonly kind: 'unmodeled';
  readonly version: 1;
  readonly reason: string;
};

/**
 * Contract §4: resource
 * {kind:'resource',version:1,config:ResourceConfig,entryPortId}
 */
export type ResourceBehavior = {
  readonly kind: 'resource';
  readonly version: 1;
  readonly config: ResourceConfig;
  readonly entryPortId: Id;
};

/**
 * Contract §4: machine
 * {kind:'machine',version:1,states:[{id,label}],initialStateId,contextSchemaId,initialContextFixtureId,transitions:Transition[],responseBindings:[{id,callPortId,eventPortId}]}
 */
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

/**
 * Contract §4: pipeline
 * {kind:'pipeline',version:1,inputSchemaId,outputSchemaId,errorSchemaId,inputPortId,outputPortId,errorPortId,operations:Operation[]}
 */
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

/**
 * Contract §4: decision
 * {kind:'decision',version:1,inputSchemaId,inputPortId,cases:[{id,guard,outputPortId,value:Value}],fallback:{outputPortId,value:Value}}
 */
export type DecisionBehavior = {
  readonly kind: 'decision';
  readonly version: 1;
  readonly inputSchemaId: Id;
  readonly inputPortId: Id;
  readonly cases: readonly DecisionCase[];
  readonly fallback: DecisionFallback;
};

/**
 * Contract §4: host
 * {kind:'host',version:1}
 */
export type HostBehavior = {
  readonly kind: 'host';
  readonly version: 1;
};

/**
 * Contract §4: Behavior discriminated union
 */
export type Behavior =
  | UnmodeledBehavior
  | ResourceBehavior
  | MachineBehavior
  | PipelineBehavior
  | DecisionBehavior
  | HostBehavior;

// ============================================================================
// §6 Scenarios
// ============================================================================

export type ScenarioMode = 'logical' | 'timed';

/**
 * Contract §6: Scenario Budgets
 * budgets={maxEvents,maxTraceRows,maxTraceBytes,maxScheduledEvents,maxLiveRoots}
 * storage.md §6 bounds are enforced by validate.ts; runner defaults are in runner/types.ts.
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
// Inputs (§6)
// ----------------------------------------------------------------------------

export type InputBindingSource = {
  readonly port: Endpoint;
  readonly journeyId: Id;
  readonly occurrence: number;
  readonly path: Path;
};

/**
 * Contract §6: InputBinding
 * InputBinding={targetPath:Path,source:{port:Endpoint,journeyId:Id,occurrence:number,path:Path}}
 */
export type InputBinding = {
  readonly targetPath: Path;
  readonly source: InputBindingSource;
};

/**
 * Contract §6: ResourceMetadata
 * ResourceMetadata={requestClassId:Id,operation:'read'|'write',key:string|null,tags:string[],deadlineMs:number}
 */
export type ResourceMetadata = {
  readonly requestClassId: Id;
  readonly operation: 'read' | 'write';
  readonly key: string | null;
  readonly tags: readonly string[];
  readonly deadlineMs: number;
};

/**
 * Contract §6: Input
 * Input={id,entry:Endpoint,fixtureId,journeyId:Id,atMs:number|null,payloadBindings:InputBinding[],resource:ResourceMetadata|null}
 */
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
// Workloads (§6)
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
 * D50: a workload's arrival rate over its arrival window. `burst` runs at `peakRate`
 * between `startMs` and `endMs` (from the run start) and at `rate` otherwise; `ramp` moves
 * linearly from `rate` to `endRate` over the arrival window.
 */
export type WorkloadProfile =
  | { readonly kind: 'steady' }
  | { readonly kind: 'burst'; readonly peakRate: number; readonly startMs: number; readonly endMs: number }
  | { readonly kind: 'ramp'; readonly endRate: number };

/**
 * Contract §6: Workload
 * Workloads keep the current WorkloadDefinition/RequestClass fields, with interval null,
 * entryNodeId replaced by entry:Endpoint, UUID workload/class IDs, and a steady, burst or
 * ramp profile (D50).
 */
export type Workload = {
  readonly id: Id;
  readonly entry: Endpoint;
  readonly enabled: boolean;
  readonly rate: number;
  readonly profile: WorkloadProfile;
  readonly timeoutMs: number;
  readonly intervalMs: null;
  readonly classes: readonly RequestClass[];
};

// ----------------------------------------------------------------------------
// Faults (§6)
// ----------------------------------------------------------------------------

/**
 * Contract §6: Fault
 * Fault={id,hostId,downAtMs,upAtMs,detectionDelayMs,recoveryDetectionDelayMs,activePolicy:'fail',queuedPolicy:'reject',routeReset:'first-healthy'}
 */
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
// Boundaries (§6)
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
   * D51: true = this response answers every matching request instead of being used once
   * (§6: "the first unused matching response is consumed"). Absent means once.
   */
  readonly repeat?: boolean;
  readonly outcome: TransportOutcome;
};

/**
 * Contract §6: Boundary
 * Boundary={id,source:Endpoint,schemaId,responses:[{id,match:Guard,responseFixtureId,payloadBindings:[{targetPath:Path,requestPath:Path}],delayMs:number|null,afterInputId:Id|null,outcome:'succeeded'|'rejected'|'failed'|'expired'}]}
 */
export type Boundary = {
  readonly id: Id;
  readonly source: Endpoint;
  readonly schemaId: Id;
  readonly responses: readonly BoundaryResponse[];
};

// ----------------------------------------------------------------------------
// Refinement and Selection (§6)
// ----------------------------------------------------------------------------

export type PortMapping = {
  readonly id: Id;
  readonly outer: Endpoint;
  readonly inner: Endpoint;
};
export type RefinementPortMapping = PortMapping;

/**
 * Contract §6: Refinement
 * Refinement={id,ownerElementId,memberElementIds:Id[],portMappings:[{id,outer:Endpoint,inner:Endpoint}]}
 */
export type Refinement = {
  readonly id: Id;
  readonly ownerElementId: Id;
  readonly memberElementIds: readonly Id[];
  readonly portMappings: readonly PortMapping[];
};

/**
 * Contract §6: Selection
 * Selection={refinementId,mode:'aggregate'|'refined'}
 */
export type Selection = {
  readonly refinementId: Id;
  readonly mode: 'aggregate' | 'refined';
};
export type RefinementSelection = Selection;

// ----------------------------------------------------------------------------
// Completion (§6)
// ----------------------------------------------------------------------------

export const COMPLETION_KINDS = ['quiescent', 'horizon', 'drain'] as const;
export type CompletionKind = (typeof COMPLETION_KINDS)[number];

export type QuiescentCompletionPolicy = {
  readonly kind: 'quiescent';
};

export type HorizonCompletionPolicy = {
  readonly kind: 'horizon';
  readonly horizonMs: number;
};

export type DrainCompletionPolicy = {
  readonly kind: 'drain';
  readonly arrivalHorizonMs: number;
  readonly deadlineMs: number;
};

/**
 * Contract §6: Completion
 * - {kind:'quiescent'}: logical only
 * - {kind:'horizon',horizonMs}: timed
 * - {kind:'drain',arrivalHorizonMs,deadlineMs}: timed
 */
export type CompletionPolicy =
  | QuiescentCompletionPolicy
  | HorizonCompletionPolicy
  | DrainCompletionPolicy;

// ----------------------------------------------------------------------------
// Initial Contexts (§6)
// ----------------------------------------------------------------------------

export type InitialContext = {
  readonly elementId: Id;
  readonly fixtureId: Id;
};
export type ScenarioInitialContext = InitialContext;

// ----------------------------------------------------------------------------
// Assertions (§6)
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

/**
 * Contract §6: Assertion Subject
 * - {kind:'final-state',elementId}
 * - {kind:'context',elementId,path:Path}
 * - {kind:'output',port:Endpoint,path:Path}
 * - {kind:'count',scope:'root'|'message'|'element',elementId:Id|null,outcome:'generated'|'succeeded'|'rejected'|'failed'|'expired'|'inFlight'}
 * - {kind:'trace-count',elementId,code:string}
 * - {kind:'metric',elementId:Id,key:'throughput'|'meanLatencyMs'|'p95LatencyMs'|'utilization'}
 */
export type AssertionSubject =
  | FinalStateSubject
  | ContextSubject
  | OutputSubject
  | CountSubject
  | TraceCountSubject
  | MetricSubject;

export const ASSERTION_OPERATORS = ['equals', 'at-most', 'at-least'] as const;
export type AssertionOperator = (typeof ASSERTION_OPERATORS)[number];

/**
 * Contract §6: Assertion
 * Assertion={id,label,subject,operator:'equals'|'at-most'|'at-least',expected:Json}
 */
export type Assertion = {
  readonly id: Id;
  readonly label: string;
  readonly subject: AssertionSubject;
  readonly operator: AssertionOperator;
  readonly expected: Json;
};

// ----------------------------------------------------------------------------
// Assumptions (§6)
// ----------------------------------------------------------------------------

export const ASSUMPTION_SOURCES = ['author', 'template', 'measured'] as const;
export type AssumptionSource = (typeof ASSUMPTION_SOURCES)[number];

/**
 * Contract §6: Assumption
 * Assumption={id,key,value:Json,source:'author'|'template'|'measured',description}
 */
export type Assumption = {
  readonly id: Id;
  readonly key: string;
  readonly value: Json;
  readonly source: AssumptionSource;
  readonly description: string;
};

// ----------------------------------------------------------------------------
// Scenario (§6)
// ----------------------------------------------------------------------------

/**
 * Contract §6: Scenario
 * Scenario={id,label,revision,mode:'logical'|'timed',scopeElementIds:Id[],
 * entryPorts:Endpoint[],inputs:Input[],workloads:Workload[],faults:Fault[],
 * boundaries:Boundary[],refinementSelections:Selection[],
 * initialContexts:[{elementId,fixtureId}],assertions:Assertion[],seed,
 * budgets,completion,assumptions:Assumption[]}
 */
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
  readonly completion: CompletionPolicy;
  readonly assumptions: readonly Assumption[];
};
