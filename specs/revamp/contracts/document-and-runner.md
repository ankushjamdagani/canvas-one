# RV-02d — Document schema and runner boundary

Status: proposed contract, 2026-09-22; requires Claude review. This is a specification, not implemented TypeScript. Implementation remains held. References: [execution fixtures](execution-slices.md), [identity](run-identity.md), [limits](storage-and-limits.md).

## Representation and validation

`studio-model/1` is the new authored schema. Portable container version 9 is separate. Records below are closed: unknown properties/kinds/versions reject, never silently strip. `Id` is a lowercase canonical UUID; constructors generate it, import preserves it. IDs are unique across all independently identified members of one document, including nested members. `Ref` always names an ID of the specified kind. JSON values are finite, plain, bounded and surrogate-valid as in canonical-json-v1. No executable strings, expressions, HTML, credentials or arbitrary extension bag.

Two validation levels share one schema. **Storable** requires correct types/bounds/IDs/references; incomplete behavior is represented explicitly by `unmodeled`, not missing fields. Empty documents, empty scenarios and missing behavior can autosave/checkpoint. **Runnable** additionally requires complete scope, supported executable behavior, compatible ports, nonempty inputs and explicit terminal policy. Readiness errors never prevent preserving a structurally valid incomplete design. Import with dangling references fails before insertion. Deletion is a compound operation with an explicit dependency preview; it removes/replaces affected references atomically or rejects.

| Record | Exact fields (all required unless `?`) |
|---|---|
| Document | `schema:'studio-model/1', id, title, elements:Element[], connections:Connection[], relations:Relation[], schemas:PayloadSchema[], fixtures:Fixture[], refinements:Refinement[], scenarios:Scenario[], views:View[]` |
| Element | `id, label, description, visualKind, ports:Port[], behavior:Behavior` |
| Port | `id, label, direction:'in'|'out', channel:'call'|'message'|'data'|'event', schemaId, responseSchemaId:Id|null` |
| Endpoint | `elementId, portId` |
| Connection | `id, label, kind:'call'|'message'|'data', source:Endpoint, target:Endpoint, config` (discriminated below) |
| Relation | `id, label` and either `{kind:'contains',parentId,childId}`, `{kind:'deployed-on',elementId,hostId}`, or `{kind:'descriptive',sourceId,targetId}` |
| Fixture | `id, schemaId, value:Json` |
| View | `id, label, placements:Placement[], connectionIds:Id[], relationIds:Id[], groups:Group[], notes:Note[]` |
| Placement | `id, elementId, x, y, width, expanded:boolean` |
| Group | `id, label, elementIds:Id[], collapsed:boolean` |
| Note | `id, text, x, y, width, tone:'paper'|'neutral', attachedElementIds:Id[]` |

`visualKind` is exactly the current 29-kind catalog in `src/domain/execution.ts:VALID_KINDS`, plus `state-machine`, `data-pipeline`, `host`. It never selects behavior. One element occurs at most once in a view; view groups are one-level, non-overlapping sets of placed elements. Views can show only connections whose endpoints are placed; notes may attach only to placed elements. View groups are not executable containment. A `contains` relation is an acyclic single-parent forest. `deployed-on` connects a resource element to a host behavior; at most one direct host per resource, no placement inference from drawing geometry. Descriptive relations have no runtime effect. Multiple connections may share elements if ports differ; duplicate `(kind,source port,target port)` rejects. Synchronous call cycles reject; message cycles are allowed only under finite runtime budgets.

Payload schemas are a deliberately small closed grammar: `{id,label,shape}` where shape is `{type:'string'|'boolean'|'number'|'integer',nullable:boolean}`, `{type:'record',nullable,fields:[{id,key,optional:boolean,shape}]}`, or `{type:'list',nullable,items:shape,maxItems}`. No recursive schema references, union inference, coercion or prototype keys (`__proto__`, `prototype`, `constructor`). Record keys are unique, unknown payload fields reject. Number means finite double; integer means safe integer. Nullable is explicit, missing optional fields differ from null. Port compatibility requires identical normalized shapes (ignoring field IDs/labels and sorting record fields by key), not merely equal display names. Call ports require a non-null response schema; other channels require null. Call responses reuse their initiating correlation, not a second authored reverse edge.

## Closed behavior vocabulary

Every behavior has `kind` and `version:1`. No implicit behavior derives from an icon. A resource profile is explicit; logical behavior alone has no capacity metric.

| Kind | Additional fields and semantics |
|---|---|
| `unmodeled` | `reason:string`; legal to store, cannot be reached in a runnable scenario except behind an explicit boundary fixture |
| `resource` | `config:ResourceConfig`; six retained resource variants below |
| `machine` | `states:[{id,label}], initialStateId, contextSchemaId, initialContextFixtureId, transitions:Transition[]`; transitions ordered, first matching rule wins |
| `pipeline` | `inputSchemaId, outputSchemaId, errorSchemaId, operations:Operation[]`; ordered operations, each row keeps immutable input row identity |
| `decision` | `inputSchemaId, cases:[{id,guard,outputPortId,value:Value}], fallback:{outputPortId,value:Value}`; ordered first matching case, exactly one output |
| `host` | no additional fields; availability comes from scenario fault schedule |

`ResourceConfig` is a copied, versioned schema contract, not an import of a legacy runtime type: common `capacity, concurrency, queueLimit, failureRate, maxRetries, retryDelayMs`; variant `type:'source'|'processor'`, `type:'storage',writeCapacity`, `type:'router',strategy:'round-robin'|'weighted'|'conditional'`, `type:'cache',mode:'fixed'|'lru',hitRate,entries,ttlMs`, or `type:'broker',delivery:'competing'|'broadcast'`. Preserve current numeric validation ranges and exact semantics in `src/domain/execution.ts:validateBehavior`; `failureRate`/`hitRate` are percentages, capacity is work units per second per slot, retries exclude initial attempt. These fields all enter identity even when an individual retained variant currently ignores one. Removing redundant fields is a later version change, not an implementer cleanup.

Connection config: `data` has `{}`. `call` has `{latencyMs,returnLatencyMs,weight,condition:RouteCondition|null,fallback:boolean}`. `message` has `{latencyMs,ackDelayMs,messageTtlMs,weight,condition:RouteCondition|null,fallback:boolean}`. RouteCondition is `{field:'class'|'operation'|'tag',value:string}`; class uses stable class ID. Preserve current edge numeric ranges; weight must additionally be <=1e6 to bound normalized sums. Retained outgoing selection order is stable edge ID order. Behavioral connection configs are timed only; logical runners use their routing conditions but produce no synthetic delay measurements.

`Path` is an array of literal record keys or nonnegative integer list indices, never a dotted executable expression. `Value` is `{kind:'literal',value:Json}` or `{kind:'read',source:'input'|'context',path:Path}`. Missing reads produce a typed missing value (only `exists` can test it); assignment of missing to a required target is a modeled error, not undefined JSON.

Guard grammar: `{op:'equals'|'notEquals',left:Value,right:Value}`, `{op:'exists',value:Value}`, `{op:'all'|'any',guards:Guard[]}`, `{op:'positiveInteger',value:Value}`, `{op:'nonEmpty',value:Value}`, `{op:'every',value:Value,itemGuard:Guard}`. Within `every`, `input` is the current item and `context` stays machine context. Arrays/objects compare by canonical JSON; primitive comparisons have no coercion. `all`/`any` require nonempty operands. `every` on empty input is true, so valid-cart uses both `nonEmpty` and `every`. Wrong operand types reject readiness when statically knowable, otherwise trace a modeled validation error. Depth/count limits apply to the entire expression tree.

Transition: `{id,fromStateId,eventPortId,guard:Guard|null,toStateId,effects:Effect[]}`. Effects are `{id,kind:'assign',path:Path,value:Value}`, `{id,kind:'request-id',path:Path}`, `{id,kind:'emit',portId,value:Value,correlation:'current'|'active-request'}`, or `{id,kind:'trace',code:string}`. Apply effects in order to a copied context; validate final context/emissions atomically before changing state or emitting anything. Request IDs derive from run-local root ID and a monotonic invocation counter, not wall clock/RNG. Active request ID must be read explicitly by guards; stale response policy in S01 is modeled using these rules. Event payload includes the response request ID as an explicit schema field. No hidden checkout-specific interpreter.

Operation has stable `id` and one of: `validate {schemaId}`, `trim {path}`, `map {fields:[{id,targetKey,value:Value}]}`, `filter {guard}`, `deduplicate {path}`, `group-sum {keyPath,valuePath,keyName,sumName}`. All operations preserve row provenance; filter exclusion and duplicates are explicit outcomes. `map` reads row as input, context is empty record; no overwriting duplicate target keys. `group-sum` requires string keys and safe integer amounts, checks each addition for overflow, sorts keys by UTF-16 code units. Validation errors route original row/provenance to the error output. A non-validation operation with wrong input type produces an explicit row error; it cannot silently coerce/drop. Whole-pipeline schema validation covers output and error ports.

## Scenarios, assertions and refinements

Scenario fields: `id,label,revision,mode:'logical'|'timed',scopeElementIds:Id[],entryPorts:Endpoint[],inputs:Input[],workloads:Workload[],faults:Fault[],boundaries:Boundary[],refinementSelections:Selection[],initialContexts:[{elementId,fixtureId}],assertions:Assertion[],seed,budgets,completion,assumptions:Assumption[]`. Revision is a nonnegative safe integer incremented on any scenario edit, including label; projections exclude label but include revision (conservative invalidation). There is no scenario enabled/required flag. Workload enablement remains supported inside a scenario and cannot disable its verification requirement.

Input: `{id,entry:Endpoint,fixtureId,journeyId:Id,atMs:number|null}`; array order is semantic. Logical inputs require null; timed inputs require nonnegative time. Logical external inputs are consumed one at a time after causally generated queue drains, enabling explicit response fixtures. Timed inputs share one event scheduler. Workload fields preserve current `WorkloadDefinition`/RequestClass fields from `src/domain/execution.ts`, normalize optional profile to `{kind:'steady'}` and interval to `null`, replace `entryNodeId` with `entry:Endpoint`; workload/class IDs are UUIDs. Initial generation may only target resource entry ports. Pure logical scenarios require empty workloads/faults. Timed scenarios require at least one finite input or enabled workload. Enabled workload produces arrivals only strictly before its horizon, preserving retained kernel boundary semantics; explicit inputs may occur exactly at horizon if declared.

Completion union: `{kind:'quiescent'}` logical only; `{kind:'horizon',horizonMs}` timed finite observation with in-flight work visible; `{kind:'drain',arrivalHorizonMs,deadlineMs}` timed with no new exogenous generation after arrival horizon, completes when all causal work settles or returns incomplete at deadline. Drain may not convert expired budget into success. The finite observation policy may pass assertions explicitly testing its remaining in-flight work. Logical mode has no elapsed-ms/throughput/utilization values.

Fault: `{id,hostId,downAtMs,upAtMs,detectionDelayMs,recoveryDetectionDelayMs,activePolicy:'fail',queuedPolicy:'reject',routeReset:'first-healthy'}`. S04 fixes the initial route reset policy; configurable alternatives need a later behavior version. Non-overlapping intervals per host, up>down. Failure/recovery and detection events precede completions at the same time only in fault-enabled scenarios. Ordinary no-fault runner ordering must remain bit-for-bit characterized. Already settled operations never settle twice; no orphan callback may occupy capacity after outage cancellation.

Boundary: `{id,source:Endpoint,schemaId,responses:[{id,requestFixtureId,responseFixtureId,delayMs:number|null,outcome:'succeeded'|'rejected'|'failed'|'expired'}]}`. Exact canonical request matching, declared list order for repeated matches, exhaustion is a modeled error. Logical delay null; timed delay required. Boundary ports must lie on selected scope crossings, and responses must satisfy the relevant response schema. No random implicit mock success.

Refinement: `{id,ownerElementId,memberElementIds:Id[],portMappings:[{id,outer:Endpoint,inner:Endpoint}]}`. Selection: `{refinementId,mode:'aggregate'|'refined'}`. Same-document only in v1; candidate snapshot pins content, no live external fetch. A member has at most one refinement owner; recursive containment/expansion rejects. Every crossing port has exactly one compatible mapping. Aggregate executes owner and excludes members; refined executes members and excludes owner behavior. Nested refinement is allowed only within expansion budgets and an acyclic ownership graph. Unselected visible elements stay unexecuted/uncovered.

Assertion: `{id,label,subject,operator:'equals'|'at-most'|'at-least',expected:Json}`. Subject union: `{kind:'final-state',elementId}`, `{kind:'context',elementId,path}`, `{kind:'output',port:Endpoint,path}`, `{kind:'count',scope:'root'|'message'|'element',elementId:Id|null,outcome:'generated'|'succeeded'|'rejected'|'failed'|'expired'|'inFlight'}`, `{kind:'trace-count',elementId,code}`, `{kind:'metric',elementId:Id|null,key:'throughput'|'meanLatencyMs'|'p95LatencyMs'|'utilization'}`. Output is ordered emitted value array; path can index it. Numeric comparison only for numeric subjects/expected values. Missing/unsupported metrics are unevaluated failures, never zero. Equality uses canonical JSON. A qualifying scenario requires >=1 assertion, >=1 consumed external input or generated workload root, and all assertions evaluated/passing. The compiler requires each assertion subject to belong to compiled scope; these conditions avoid vacuous empty runs but do not claim that author-written checks prove correctness or full coverage. Diagnostic runs may have zero assertions; badge is “Completed · no checks”, ineligible.

Assumption: `{id,key,value:Json,source:'author'|'template'|'measured',description}`. Key unique within scenario; value and source affect identity, description does not. A measured label is self-reported, not verified external measurement.

## Exhaustive projection inventory

The following classification is normative for every nested field above. Implementation must use closed schema descriptors and exhaustive type checking; adding a field without classification fails the contract test. `A` means authored snapshot only; `E` means scenario manifest when in closure; `L` means local repository only.

| Record | A fields | E fields |
|---|---|---|
| Document | title, views (all descendants) | schema, id; closure-filtered elements/connections/relations/schemas/fixtures/refinements; selected scenario |
| Element / Port | label, description, visualKind / label | all remaining fields |
| Connection / Relation | label; descriptive relations entirely | all remaining executable fields; contains only when used for refinement/fault resolution; deployed-on when resource/fault scope uses placement |
| PayloadSchema / nested record fields | label | all other fields, including IDs (conservative identity) |
| Scenario | label | all other fields; scope lists sorted as sets, inputs/fault schedules/operations/transitions remain ordered |
| Assertion / Assumption | label / description | all other fields |
| Fixture / Refinement / Behavior | none | all fields, recursively, including context, paths, effect order, null/default values |
| Workload / RequestClass | class name | all other fields including enablement, tags and ordered classes |

`L`: actor profiles, branch heads/revisions, operation receipts, history records, saved run state, view camera, panel/dock preferences, selection, runtime playback. These are not Document fields. Snapshots include all A and E content; manifest resolves only one scenario's closure, not the entire project. Assumptions and budget versions materialize before hashing. Schema/fixture dependencies are closed transitively. No unspecified metadata field exists.

## Runner and retained-kernel interfaces

Planned public boundary (readonly data, result unions, no callbacks capable of mutating editor):

```ts
compileScenario(snapshot: AuthoredSnapshot, scenarioId: Id, signal: AbortSignal):
  Promise<{status:'ready'; manifest:ExecutionManifest; plan:CompiledPlan}
    | {status:'invalid'|'analysis-limit'|'cancelled'; issues:Issue[]}>
startRun(request: {runId:Id; snapshotId:string; manifest:ExecutionManifest;
  plan:CompiledPlan}): RunHandle
type RunControl = {kind:'pause'|'resume'|'cancel'}
interface RunHandle {
  send(control: RunControl): void;
  events: AsyncIterable<RunUpdate>;
}
```

RunUpdate is `{kind:'state',runId,state}`, `{kind:'batch',runId,firstSequence,events:TraceEvent[],metrics:MetricSample|null}`, or `{kind:'terminal',runId,status:'completed'|'invalid'|'failed'|'cancelled'|'incomplete',checks:CheckResult[],summary:RunSummary,reason:string|null}`. Exactly one terminal message; monotonically increasing sequence; stale run IDs ignored by UI but retained by their own persistence session. Pause stops work at a safe scheduler boundary, not elapsed simulation time. Cancel acknowledges and terminates worker work; Reset is cancel then clear current display, never delete saved evidence. Runtime failure carries sanitized diagnostic detail, not a modeled success/failure result. Worker serializes arrays/records only; AbortSignal remains on controller side with an explicit cancel message.

TraceEvent exact fields: `{id:string,sequence:number,rootId:string,journeyId:Id,parentId:string|null,elementId:Id,portId:Id|null,kind:'input'|'dispatch'|'queued'|'started'|'settled'|'state'|'row'|'fault'|'ignored',code:string,payloadRef:string|null,atMs:number|null,outcome:'succeeded'|'rejected'|'failed'|'expired'|null}`. IDs derive from runId plus sequence; input/root IDs derive from declared input ID or workload ID plus ordinal. Message roots have their own root ID plus parent relation to initiating user root, preserving separate conservation. PayloadRef addresses an immutable per-run content-addressed payload table. Root/journey correlation never changes retry draws.

Retained adapter must add `admit(input:ResourceInput):Admission`, `peekNext():{atMs,phase,sequence}|null`, `stepNext():KernelDelta`, `interruptHost(hostId,atMs):KernelDelta`, and `snapshot():ResourceSummary`. ResourceInput is `{rootId,journeyId,parentEventId,entryElementId,requestClassId,operation:'read'|'write',key:string|null,tags:string[],payloadRef,atMs,deadlineMs}`. Admission is `{accepted:boolean,events:TraceEvent[]}`; rejection settles once. KernelDelta is `{events:TraceEvent[],outputs:PortEmission[]}` with emission `{source:Endpoint,rootId,journeyId,parentEventId,payloadRef,outcome,atMs}`. No aggregate-only success inference is allowed. These are required new capabilities, not claims about current OpenSimulationAdapter.

One scheduler owns global time and insertion sequence for S05. Each interpreter/adapter returns emissions/scheduled work; it cannot independently advance beyond the next global event. Compare timed events by `(atMs,phase,sequence)`: phase 0 faults/detection, phase 1 retained kernel events in their original relative order, phase 2 bridge dispatch, phase 3 external input. In no-fault standalone resource runs the adapter delegates original internal tie ordering unchanged. Composition must prove same results under chunked versus one-shot stepping; no double workload generation (finite bridge input disables internal generation for that workload). Fullstack business decisions consume payload fixtures, and per-root responses drive machine events, not aggregate throughput. Fail-at-outage is a versioned new kernel capability; retained no-fault golden tests remain mandatory.

Required acceptance: S01–S05 success/failure/boundary fixtures; schema mutation and exhaustive hash vectors; malformed references; inactive incomplete elements; all scenario eligibility including zero-check diagnostics; chunk-independent scheduling; retry RNG/FIFO/cache/broker regression invariants; cancellation at compiler and runner batch boundaries. No dispatch until review resolves this contract against the retained source.
