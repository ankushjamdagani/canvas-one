# Model schema and runner (RV-02c/d)

The authored schema `studio-model/1`, its execution semantics, the runner interface, and the five reference scenarios S01–S05. Fixture data: [`../fixtures/`](../fixtures/README.md). Identity: [run-identity.md](run-identity.md). Limits: [storage.md](storage.md).

## 1. Ground rules

- **Closed records.** Unknown properties, kinds or versions are rejected, never stripped. There is no extension bag and nothing executable: no expressions-as-strings, HTML or credentials.
- **IDs.** `Id` is a lowercase canonical UUID. Constructors generate it; import preserves it. IDs are unique across every independently identified member of a document, including nested ones. `Ref` always names an ID of a specified kind.
- **JSON values** are finite, plain, bounded and surrogate-valid (as in `canonical-json-v1`).
- **Two validation levels, one schema.**
  - *Storable:* types, bounds, IDs and references are correct. Missing behavior is explicit `unmodeled`, not an absent field. Empty documents and scenarios can autosave/checkpoint.
  - *Runnable:* also requires complete scope, supported behavior, compatible ports, nonempty inputs and an explicit completion policy. Readiness errors never block saving a structurally valid design.
- Import with dangling references fails before insertion. Deletion is a compound operation with a dependency preview; it removes/repairs affected references atomically or rejects.

## 2. Records

| Record | Fields (all required unless `?`) |
|---|---|
| Document | `schema:'studio-model/1', id, title, elements:Element[], connections:Connection[], relations:Relation[], schemas:PayloadSchema[], fixtures:Fixture[], refinements:Refinement[], scenarios:Scenario[], views:View[]` |
| Element | `id, label, description, visualKind, ports:Port[], behavior:Behavior` |
| Port | `id, label, direction:'in'\|'out', channel:'call'\|'message'\|'data'\|'event', schemaId, responseSchemaId:Id\|null` |
| Endpoint | `elementId, portId` |
| Connection | `id, label, kind:'call'\|'message'\|'data', source:Endpoint, target:Endpoint, config` (§4) |
| Relation | `id, label` plus one of `{kind:'contains',parentId,childId}`, `{kind:'deployed-on',elementId,hostId}`, `{kind:'descriptive',sourceId,targetId}` |
| Fixture | `id, schemaId, value:Json` |
| View | `id, label, placements:Placement[], connectionIds:Id[], relationIds:Id[], groups:Group[], notes:Note[]` |
| Placement | `id, elementId, x, y, width, expanded:boolean` |
| Group | `id, label, elementIds:Id[], collapsed:boolean` |
| Note | `id, text, x, y, width, tone:'paper'\|'neutral', attachedElementIds:Id[]` |

Structural rules:
- `visualKind` is exactly the current 29-kind catalog in `src/domain/execution.ts:VALID_KINDS` plus `state-machine`, `data-pipeline`, `host`. It never selects behavior.
- In a view: an element appears at most once; groups are one-level and non-overlapping; connections show only if both endpoints are placed; notes attach only to placed elements. View groups are not executable containment.
- `contains` forms an acyclic single-parent forest. `deployed-on` links a resource to a `host` behavior, at most one direct host per resource; placement is never inferred from drawing geometry. `descriptive` relations have no runtime effect.
- Several connections may join the same elements via different ports; a duplicate `(kind, source port, target port)` is rejected.
- A connection's kind must match both endpoint channels; there is no call-to-data coercion. Outbound event ports can't be wired; scheduled events and bound responses target inbound event ports directly.
- Synchronous call cycles are rejected. Message cycles are allowed under finite runtime budgets.

## 3. Payload schemas

`PayloadSchema={id,label,shape}`. Shapes:
- scalar `{type:'string'|'boolean'|'number'|'integer',nullable:boolean}` (`nullable` is required on every shape)
- `{type:'record',nullable,fields:[{id,key,optional:boolean,shape}]}`
- `{type:'list',nullable,items:shape,maxItems}`
- `{type:'scalar-union',nullable,types:('string'|'boolean'|'number'|'integer')[]}` — 2–4 distinct scalar types, `number` and `integer` not together. Admits mixed external data (e.g. S03's integer-or-string amount).

No record/list unions, union inference, recursive references or coercion. Prototype keys (`__proto__`, `prototype`, `constructor`) are rejected; record keys are unique; unknown payload fields are rejected. `number` = finite double; `integer` = safe integer. Nullability is explicit, and a missing optional field ≠ null.

Port compatibility = identical normalized shapes (ignore field IDs/labels, sort record fields by key). Call ports need a non-null response schema; other channels need null. A call response reuses its initiating correlation; there is no authored reverse edge.

## 4. Behaviors

Every behavior has `kind` and `version:1`. No behavior is implied by an icon. Logical behavior has no capacity metric unless an explicit resource profile exists.

| Kind | Fields and semantics |
|---|---|
| `unmodeled` | `reason`. Storable; reachable in a runnable scenario only behind a boundary fixture. |
| `resource` | `config:ResourceConfig, entryPortId` |
| `machine` | `states:[{id,label}], initialStateId, contextSchemaId, initialContextFixtureId, transitions:Transition[], responseBindings:[{id,callPortId,eventPortId}]`. Ordered transitions; first match wins. |
| `pipeline` | `inputSchemaId, outputSchemaId, errorSchemaId, inputPortId, outputPortId, errorPortId, operations:Operation[]`. Ordered operations; each row keeps its input identity. |
| `decision` | `inputSchemaId, inputPortId, cases:[{id,guard,outputPortId,value:Value}], fallback:{outputPortId,value:Value}`. First matching case; exactly one output. |
| `host` | No fields. Availability comes from the scenario fault schedule. |

**ResourceConfig** is a copied, versioned contract (not an import of the legacy type).
- Common fields: `capacity, concurrency, queueLimit, failureRate, maxRetries, retryDelayMs`.
- Variants: `type:'source'|'processor'`; `type:'storage',writeCapacity`; `type:'router',strategy:'round-robin'|'weighted'|'conditional'`; `type:'cache',mode:'fixed'|'lru',hitRate,entries,ttlMs`; `type:'broker',delivery:'competing'|'broadcast'`.
- Keep the numeric ranges and semantics of `src/domain/execution.ts:validateBehavior`: rates are percentages, capacity is work units/second per slot, and retries exclude the first attempt.
- All fields enter identity even if a variant ignores one. Removing redundant fields requires a version change.

**Connection config.**
- `data`: `{}`.
- `call`: `{latencyMs,returnLatencyMs,weight,condition:RouteCondition|null,fallback:boolean,resource:ResourceCallMetadata|null}`.
- `message`: `{latencyMs,ackDelayMs,messageTtlMs,weight,condition:RouteCondition|null,fallback:boolean,resource:ResourceCallMetadata|null}`.
- `condition` is `RouteCondition|null`, with `RouteCondition={field:'class'|'operation'|'tag',value}`; class matches by stable class ID. `resource` is `ResourceCallMetadata|null` (§6).
- Keep the current edge ranges; `weight` ≤ 1e6. Retained outgoing order is stable edge-ID order. Delays apply only in timed mode; logical runs use routing conditions but produce no delay measurements.

**Values and guards.**
- `Path` is an array of literal keys or non-negative list indices, never a dotted string.
- `Value`: `{kind:'literal',value:Json}` | `{kind:'read',source:'input'|'context',path:Path}` | `{kind:'record',fields:[{key:string,value:Value}]}` | `{kind:'list',items:Value[]}` | `{kind:'outcome'}`. `outcome` returns the current invocation's transport outcome (`succeeded|rejected|failed|expired`), or null before settlement. It is runtime context, never injected into payloads.
- Record constructor keys are unique and schema-validated.
- A missing read yields a typed missing value; only `exists` can test it. Assigning missing to a required target is a modeled error.
- `Guard`: `{op:'equals'|'notEquals',left:Value,right:Value}`, `{op:'exists',value:Value}`, `{op:'all'|'any',guards:Guard[]}` (nonempty), `{op:'positiveInteger',value:Value}`, `{op:'nonEmpty',value:Value}`, `{op:'every',value:Value,itemGuard:Guard}` (inside it, `input` is the current item and `context` stays the machine context). `every` on an empty list is true, which is why the valid-cart check pairs `nonEmpty` with `every`.
- Arrays and objects compare by canonical JSON; there is no coercion. A statically knowable type error rejects readiness; otherwise it traces a modeled validation error. Depth/node budgets apply to the whole tree.

**Transitions and effects.** `Transition={id,fromStateId,eventPortId,guard:Guard|null,toStateId,effects:Effect[]}`. Every effect has an `id`. `eventPortId` may be any inbound event/call/message/data port on the machine. Effects:
- `{id,kind:'assign',path:Path,value:Value}`
- `{id,kind:'request-id',path:Path}` — ID derived from the run-local root ID plus a monotonic counter (no clock or RNG)
- `{id,kind:'emit',portId,value:Value,correlation:{kind:'current'}|{kind:'context-request',path:Path}}`
- `{id,kind:'reply',value:Value,outcome:'succeeded'|'rejected'|'failed'|'expired'}` — settles the current initiating call frame exactly once
- `{id,kind:'schedule-event',delayMs,eventPortId,value:Value}` (delayMs 0–600000) — same-element inbound event port. Timed mode only; logical mode records `timer-awaits-explicit-input`, and the scenario must supply that input.
- `{id,kind:'trace',code:string}`

Effects apply in order to a copied context. The final context and all emissions are validated atomically before the state changes or anything is emitted. There is no hidden, domain-specific interpreter.

**Operations** (stable `id` each):
- `validate {schemaId}`
- `trim {path:Path}`
- `map {fields:[{id,targetKey,value:Value}]}` — reads the row as input, with empty context, and no duplicate target keys
- `filter {guard}`
- `deduplicate {path}`
- `group-sum {keyPath,valuePath,keyName,sumName}` — string keys, safe-integer amounts, overflow-checked, keys sorted by UTF-16 code unit

All operations preserve row provenance. Filtered and duplicate rows are explicit outcomes. Validation errors send the original row to the error output. A wrong-type input to any other operation is an explicit row error, never coerced or dropped. Whole-pipeline schema validation covers the output and error ports.

**Wiring.**
- A decision's `inputPortId` is an inbound data port matching `inputSchemaId`. Case/fallback ports are outbound data ports, and each value must match its port.
- A machine response binding maps each outbound call port to exactly one inbound event port on the same machine, with a compatible shape. Responses are delivered there with the original correlation; ports are never guessed by name.
- A pipeline's `inputPortId`, `outputPortId` and `errorPortId` must be data-channel ports whose shapes match its input, output and error schemas.
- A resource `entryPortId` is an inbound call/message port. Every retained resource outgoing edge names an explicit outbound port and the target's entry port. Multiple ports are legal, but selected routes are always explicit edges, never inferred from drawing order.
- `host` and `unmodeled` never dispatch.

## 5. Invocation semantics

- **Frames vs request IDs.** Each call creates a system-owned *frame ID*, used only to settle and route its response. `emit.correlation` sets the *application request ID*, which lives in invocation metadata and is never the frame ID or inserted into payloads. Authors put `requestId` in payloads explicitly. When a guard reads a response `requestId`, the call response schema and the bound event schema must both declare it identically, and the responder must return it. `context-request` correlation reads a nonempty string after prior effects; missing/null is a modeled error.
- **Invocation context.** Each invocation carries a frame ID, root/journey IDs, request ID, parent event ID and payload ref.
- **Propagation.**
  - Data edges forward the context unchanged. A call creates a child frame. A message creates a linked message root.
  - A reply may come from a descendant reached through data edges; it settles the still-open initiating frame. A double reply fails the run.
  - A machine applies one transition per event; ignored duplicates or stale replies use explicit trace-only self-transitions.
  - A decision picks one output. A pipeline emits ordered success/error arrays, **only when nonempty**; an empty branch emits nothing, and row outcomes stay available.
  - A resource completion emits the unchanged payload on its selected continuation routes. A terminal resource returns the unchanged payload as its response, with a separate transport outcome.
  - Business outcomes come from explicit decision/reply behavior, never from aggregate success counters.
- **Root accounting.**
  - Direct finite call/resource inputs create one user root.
  - An external event/data input is a control invocation. It becomes a user root only if it emits a call; the first call promotes it, and later synchronous calls share that root. Events that emit no call (duplicate submit, timeout) add no request count.
  - Internal response events never create roots.
  - Each message emission creates its own message root, linked to its parent; resource continuations don't duplicate it. Through a `broadcast` broker, each delivered consumer copy is its own message root linked to the same parent (D36).
  - A user root settles when all its synchronous frames settle. Outcome precedence: expired > failed > rejected > succeeded. Async message outcomes don't change the user root.
  - Malformed external input is an explicit rejected root. Control roots still get trace IDs for causality even when they're excluded from transport counters. The UI labels counts "Requests", not "User interactions".
  - Pure data runs (S03) can pass with zero transport roots.
- **Readiness rejects:** unbound call responses; effect lists that could reply twice; mismatched schemas; missing pipeline outputs (an output/error port that doesn't resolve; unconnected outputs are legal, D34). Mode coherence of inputs, completion and boundaries is also a readiness rule, never a save blocker (D32). Path-dependent double settlement and budget-exhausting message cycles fail or end incomplete at runtime.

## 6. Scenarios

`Scenario={id,label,revision,mode:'logical'|'timed',scopeElementIds:Id[],entryPorts:Endpoint[],inputs:Input[],workloads:Workload[],faults:Fault[],boundaries:Boundary[],refinementSelections:Selection[],initialContexts:[{elementId,fixtureId}],assertions:Assertion[],seed,budgets,completion,assumptions:Assumption[]}`.
- `revision` is a safe integer that increments on any edit, including a label change. Identity uses revision, not label.
- There is no enabled/required flag on scenarios. Workload enablement inside a scenario doesn't disable its verification requirement.
- `budgets={maxEvents,maxTraceRows,maxTraceBytes,maxScheduledEvents,maxLiveRoots}`. Limits are in [storage.md](storage.md).

**Inputs.**
- `Input={id,entry:Endpoint,fixtureId,journeyId:Id,atMs:number|null,payloadBindings:InputBinding[],resource:ResourceMetadata|null}`. Array order is semantic.
- `InputBinding={targetPath:Path,source:{port:Endpoint,journeyId:Id,occurrence:number,path:Path}}` reads an earlier emission (zero-based occurrence at that port/journey, in scheduler order). The source must already exist; forward or missing references are modeled errors. Bindings replace non-overlapping existing paths in a cloned schema-valid fixture, then the whole payload is validated.
- `ResourceMetadata={requestClassId:Id,operation:'read'|'write',key:string|null,tags:string[],deadlineMs:number}`, where `deadlineMs` is an absolute modeled time after the input. It is required when a finite input targets a resource directly, and null otherwise.
- Call/message edges from non-resource behavior into a resource need `ResourceCallMetadata={requestClassId:Id,operation:'read'|'write',key:string|null,tags:string[],deadlineDurationMs:number}` (positive, ≤600000), with the absolute deadline computed at admission. Resource→resource and →non-resource edges carry null (metadata is inherited). Class, key and tags are never inferred from payload property names. `requestClassId` in both metadata types is a scenario-local classification token, not a required reference to a workload class. `ResourceCallMetadata` also carries `requestClassLabel:string` (1–60 code points, D43): presentation only — excluded from the execution manifest and fingerprint like other labels; the UI reuses an existing (id, label) pair from the document or mints a new id for a new label. Workload admission uses its own declared class/operation/key/tags/deadline rules, never finite-input metadata.
- Logical mode: `atMs` is null. External inputs are consumed in declared order, one at a time after the causal queue drains; internal events run FIFO. A composition uses the timed scheduler only if every time-dependent effect declares a duration; otherwise it runs logically, with no latency metrics. Timed mode: `atMs` ≥ 0, one shared scheduler. Logical scenarios that reach resources reject readiness.
- Workloads keep the current `WorkloadDefinition`/RequestClass fields, with profile normalized to `{kind:'steady'}`, interval to `null`, `entryNodeId` replaced by `entry:Endpoint`, and UUID workload/class IDs. They can target only resource entry ports. Pure logical scenarios need empty workloads and faults. Timed scenarios need at least one finite input or enabled workload. Arrivals at the horizon are included (retained kernel behavior).

**Completion.**
- `{kind:'quiescent'}`: logical only.
- `{kind:'horizon',horizonMs}`: timed; in-flight work stays visible.
- `{kind:'drain',arrivalHorizonMs,deadlineMs}`: timed; no new arrivals after the horizon; completes when all causal work settles, or is incomplete at the deadline.

A finite-observation policy (horizon) may pass assertions that explicitly test its remaining in-flight work.

Drain never turns an expired budget into success. Logical mode has no elapsed/throughput/utilization values.

Logical completion needs all inputs consumed, the queue drained and all frames settled. A response waiting for a later input doesn't block that input; an unsettled frame after the last input makes the run incomplete. A UI timeout changes machine state but settles no frame.

**Faults (timed).** `Fault={id,hostId,downAtMs,upAtMs,detectionDelayMs,recoveryDetectionDelayMs,activePolicy:'fail',queuedPolicy:'reject',routeReset:'first-healthy'}`. Intervals per host don't overlap, and `up > down`.
- Admission to a host that is actually down is rejected immediately as unavailable (outcome `rejected`), whatever the queue capacity or router knowledge. Host state at admission is authoritative.
- `activePolicy`/`queuedPolicy` apply only to work present when the outage fires: active work fails once, queued work is rejected once, capacity is released, and completion callbacks are cancelled. Nothing settles twice, and no orphan callback holds capacity.
- At both failure detection and recovery detection, the router's eligible pool updates and a round-robin cursor resets to the first healthy outgoing edge in stable edge-ID order. Weighted routing keeps its seeded draw over the new pool; conditional routing applies its conditions/fallback. With no eligible route, the request is rejected as unavailable.
- Recovery admits new work only; it never resurrects settled work. Configurable alternatives need a new behavior version.
- Fault/detection events precede completions at equal time **only in fault-enabled scenarios**. No-fault ordering must stay bit-for-bit identical to the retained kernel.

**Service time.** One work unit per admitted attempt; each slot's local service time is `1000/capacity` ms (`writeCapacity` for storage writes). Queue wait, edge delay, downstream wait and retry delay are measured separately. No `workUnits` field and no zero-time resource interpreter.

**Boundaries.**
- `Boundary={id,source:Endpoint,schemaId,responses:[{id,match:Guard,responseFixtureId,payloadBindings:[{targetPath:Path,requestPath:Path}],delayMs:number|null,afterInputId:Id|null,outcome:'succeeded'|'rejected'|'failed'|'expired'}]}`.
- `match` evaluates the request as input with empty context. The first unused matching response in declared order is consumed; exhaustion or no match is a modeled error. There are no implicitly ignored fields, and authors may omit generated-ID comparisons.
- Bindings copy request fields into non-overlapping existing paths of a cloned schema-valid response. The full response must then satisfy the relevant response schema. This is how an echoed `requestId` works, without hidden injection.
- Logical: `delayMs` is null. `afterInputId` is null (deliver immediately) or holds the response until that input and its causal queue finish; if that input was already consumed, it delivers on the next dispatch. Timed: `delayMs` is required and `afterInputId` is null. Responses released at the same time follow originating request order.
- Boundary ports must lie on scope crossings. There is never an implicit random mock success.

**Refinement.**
- `Refinement={id,ownerElementId,memberElementIds:Id[],portMappings:[{id,outer:Endpoint,inner:Endpoint}]}` and `Selection={refinementId,mode:'aggregate'|'refined'}`.
- Same-document only in v1; the candidate snapshot pins content, with no live external fetch. Each member has at most one owner, and recursive ownership is rejected as a storable structural error (D33). Every crossing port has exactly one compatible mapping.
- Aggregate runs the owner and excludes members; refined runs the members and excludes the owner. Nesting is allowed within expansion budgets.
- Port mappings resolve transitively in both directions at runtime and during scope closure: outer-to-inner routing reaches the deepest selected member, and an inner mapped-port emission also activates connections authored at every mapped outer port.
- A selection whose owner is excluded by an outer aggregate selection is inert. The outer owner runs and every element inside its ownership subtree is excluded.
- After inert selections are removed, every connection crossing a refined owner boundary at any nesting depth requires a compatible mapping. Missing mappings reject readiness and the run as `invalid-refinement-selection`.
- Unselected visible elements stay uncovered. View expand/collapse never changes execution.

**Assertions and assumptions.**
- `Assertion={id,label,subject,operator:'equals'|'at-most'|'at-least',expected:Json}`. Subjects:
  - `{kind:'final-state',elementId}`
  - `{kind:'context',elementId,path:Path}`
  - `{kind:'output',port:Endpoint,path:Path}` (ordered emitted values)
  - `{kind:'count',scope:'root'|'message'|'element',elementId:Id|null,outcome:'generated'|'succeeded'|'rejected'|'failed'|'expired'|'inFlight'}`
  - `{kind:'trace-count',elementId,code:string}`
  - `{kind:'metric',elementId:Id,key:'throughput'|'meanLatencyMs'|'p95LatencyMs'|'utilization'}` (a null elementId is a schema error)
- `output` values are the ordered emitted array, which `path` can index. Equality uses canonical JSON. Numeric operators apply only to numbers. A missing or unsupported metric is an unevaluated failure, never zero. Assertion subjects must be in compiled scope.
- A qualifying scenario needs ≥1 assertion, ≥1 consumed input or workload root, and every assertion evaluated and passing. A zero-check diagnostic run shows "Completed · no checks" and is ineligible.
- `Assumption={id,key,value:Json,source:'author'|'template'|'measured',description}`. `key` is unique per scenario. `value` and `source` affect identity; `description` doesn't. "Measured" is self-reported.

## 7. Projection inventory

Normative for every nested field. Implementation uses closed schema descriptors, and adding an unclassified field fails the contract test. **A** = authored snapshot only; **E** = execution manifest when in closure; **L** = local repository only.

| Record | A fields | E fields |
|---|---|---|
| Document | title, views (all descendants) | schema, id; closure-filtered elements/connections/relations/schemas/fixtures/refinements; selected scenario |
| Element / Port | label, description, visualKind / label | everything else |
| Connection / Relation | label; descriptive relations entirely | executable fields; `contains` when used by refinement/fault resolution; `deployed-on` when resource/fault scope uses placement |
| PayloadSchema / fields | label | everything else, including IDs |
| Scenario | label | everything else. Scope lists and `entryPorts` are sorted as sets (`entryPorts` by elementId, then portId); inputs, faults, operations and transitions stay ordered. |
| Assertion / Assumption | label / description | everything else |
| Fixture / Refinement / Behavior | — | all fields recursively, including context, paths, effect order, nulls/defaults, and every §4 wiring field |
| Workload / RequestClass | class name | everything else, including enablement, tags and class order |

Snapshots contain all A and E content. A manifest resolves one scenario's closure only. Assumptions, budget versions and budget defaults materialize before hashing, and schema/fixture dependencies close transitively.

L: actor profiles, branch heads/revisions, operation receipts, history, saved runs, camera, panel/dock preferences, selection, playback. None of these are Document fields. All result records (including `rowOutcomes`) are L.

Part remapping must also cover machine `responseBindings`, pipeline and decision ports, resource `entryPortId` and `schedule-event.eventPortId`. Scenario-only input bindings aren't part content.

## 8. Runner interface

```ts
compileScenario(snapshot: AuthoredSnapshot, scenarioId: Id, signal: AbortSignal):
  Promise<{status:'ready'; manifest:ExecutionManifest; plan:{workerSessionId:Id; planId:Id}}
    | {status:'invalid'|'analysis-limit'|'cancelled'; issues:Issue[]}>
startRun(request: {runId:Id; snapshotId:string; manifest:ExecutionManifest;
  plan:{workerSessionId:Id; planId:Id}}): RunHandle
type RunControl = {kind:'pause'|'resume'|'cancel'}
interface RunHandle { send(control: RunControl): void; events: AsyncIterable<RunUpdate> }
```

- **Plan handles.** Compile and run share one worker session. The compiled plan never leaves the worker; the public plan is an opaque single-use handle. `startRun` verifies IDs/hashes against it. A worker restart, cancel or release invalidates all its handles, so a new plan must be compiled. Handles can't be imported or saved.
- **RunUpdate.**
  - `{kind:'state',runId,state:created|validating|running|paused}`
  - `{kind:'batch',runId,firstSequence,events:TraceEvent[],metrics:MetricSample|null}`
  - `{kind:'terminal',runId,status:completed|invalid|failed|cancelled|incomplete,checks:CheckResult[],summary:RunSummary,reason:string|null}`
- Exactly one terminal message, with monotonic sequences. Terminal statuses arrive only through that message; `state` updates never carry them. The UI ignores stale run IDs, but their own persistence session still saves them. The worker exchanges plain arrays/records only; the AbortSignal stays on the controller side and becomes an explicit cancel message. Pause stops at a safe scheduler boundary. Cancel terminates worker work. Reset = cancel, then clear the display (saved evidence is kept). A runtime failure carries a sanitized diagnostic, never a modeled result. Only terminal runs persist.
- **TraceEvent** `{id:string,sequence:number,rootId:string,journeyId:Id,parentId:string|null,elementId:Id,portId:Id|null,kind:'input'|'dispatch'|'queued'|'started'|'settled'|'state'|'row'|'fault'|'ignored',code:string,payloadRef:string|null,atMs:number|null,outcome:'succeeded'|'rejected'|'failed'|'expired'|null}`.
  - IDs derive from runId + sequence. Input/root IDs come from the input or workload ID + ordinal.
  - `payloadRef` points into an immutable per-run content-addressed payload table.
  - Root/journey correlation never changes retry draws.
- **Retained adapter** (new capabilities; the current `OpenSimulationAdapter` exposes only aggregates).
  - Methods: `admit(ResourceInput):Admission`, `peekNext():{atMs,phase,sequence}|null`, `stepNext():KernelDelta`, `interruptHost(hostId,atMs):KernelDelta`, `settleCall({frameId,outcome,payloadRef,atMs}):KernelDelta`, `snapshot():ResourceSummary`.
  - `ResourceInput={rootId,journeyId,parentEventId,entryElementId,requestClassId,operation:'read'|'write',key:string|null,tags:string[],payloadRef,atMs,deadlineMs}`.
  - `Admission={accepted:boolean,events:TraceEvent[],response:{outcome:'rejected',payloadRef:string}|null}`, where response is non-null exactly when the input is rejected. A rejection settles once.
  - `KernelDelta={events:TraceEvent[],outputs:PortEmission[]}`, with `PortEmission={source:Endpoint,rootId,journeyId,parentEventId,payloadRef,outcome,atMs,frameId:string|null}`. `atMs` includes the outbound edge's `latencyMs`.
  - No success is inferred from aggregates.
- **Bridge call frames** (resource → non-resource call continuation).
  - The emission carries a system `frameId`, and the parent waits as in retained call chains. The bridge settles the frame once via `settleCall`; the kernel applies `returnLatencyMs` and its existing child-response handling.
  - For bridge frames only, the parent adopts the child's outcome and returns the child's payload. Resource→resource handling is unchanged. A second settlement of a frame fails the run.
  - If an outage or expiry settles the parent while its bridge frame is open, the frame stays open until its descendants settle. The later `settleCall` is ignored, isn't a second settlement, and still counts toward root settlement and drain.
  - Message continuations to non-resource targets are ordinary message roots.
  - Readiness: a non-router resource with a bridge call continuation may have no other selectable call continuation (routers select exactly one route). Any call that can reach a resource needs identical request/response shapes.
  - The parent element counts a bridge child's non-succeeded outcome under that outcome. In a resource → resource → bridge chain, the outer resource keeps retained handling: a non-succeeded child fails it, and it returns its own payload.
- **Transport-only settlement.** Admission rejection (including unavailable host), outage fail/reject, deadline expiry and retry exhaustion return the frame's original request payload with the transport outcome. A bound response event therefore always carries a schema-valid payload, so guards read `requestId` and branch on `{kind:'outcome'}`.
- **One global scheduler.** It owns time and insertion sequence; interpreters and the adapter never advance past the next global event. Timed ordering is `(atMs, phase, sequence)`: phase 0 faults/detection, 1 retained kernel events (original relative order), 2 bridge dispatch, 3 external input. Standalone no-fault resource runs delegate tie ordering unchanged. Chunked and one-shot stepping must give identical results. A finite bridge input disables internal generation for that workload.

## 9. Results

- `Issue={code:string,path:(string|number)[],entityId:Id|null,severity:'error'|'warning',message:string}`. Codes are schema constants; messages are display text.
- `CheckResult={assertionId:Id,status:'passed'|'failed'|'unevaluated'|'error',actual:Json|null,reason:string|null}` (a null actual can be a real result; status/reason tell them apart).
- `RunSummary={mode:'logical'|'timed',consumedInputs:number,rootCounts:Counts,messageCounts:Counts,elementMetrics:ElementMetric[],finalStates:[{elementId,stateId,context:Json}],outputs:[{port:Endpoint,values:Json[]}],coverage:{includedElementIds:Id[],excludedElementIds:Id[]},processedEvents:number,elapsedMs:number|null,rowOutcomes}`.
  - `Counts={generated,succeeded,rejected,failed,expired,inFlight}` (non-negative safe integers), conserved separately for roots and messages.
  - Invalid inputs count as consumed inputs and rejected roots. An accepted business response never counts fulfillment success twice.
- `ElementMetric={elementId:Id|null,scope:'root'|'message'|'element',key:string,value:number|null,unit:'count'|'ms'|'requests/s'|'ratio',available:boolean,reason:string|null,windowStartMs:number|null,windowEndMs:number|null}`.
  - Closed key catalog: the six counts, `acknowledged`, `throughput`, `meanLatencyMs`, `p95LatencyMs`, `utilization`, `queued`, `active`, `cacheHits/Misses/Entries/Evictions/Expirations`.
  - Rates and latency follow retained accounting. Utilization = occupied time ÷ (slots × window); it is unavailable for logical and non-resource elements. Queue, active and cache gauges are end-of-window values. Quantiles use successful observations only (none → unavailable, not zero). Acknowledgement ≠ completion.
  - Each exposed key needs its own regression fixture.
- `MetricSample={atMs:number|null,metrics:ElementMetric[]}`. `ResourceSummary={atMs:number,rootCounts:Counts,messageCounts:Counts,metrics:ElementMetric[],pendingEvents:number,liveRoots:number}`. `AuthoredSnapshot={id:string,document:Document}`.
- **Row provenance** is result metadata, never added to payloads.
  - Each list row gets `{inputEventId:string,index:number}`; `group-sum` records the ordered union of contributing rows.
  - `rowOutcomes:[{elementId,operationId,inputRows:[{inputEventId,index}],outcome:'emitted'|'filtered'|'duplicate'|'error',outputIndex:number|null,errorCode:'schema-mismatch'|'wrong-type'|'missing-path'|'integer-overflow'|null}]`. `outputIndex` indexes the pipeline's success output array and is null for non-emitted outcomes. `filtered` and `duplicate` carry a null `errorCode`.
  - Invalid rows go to the error port unchanged, so `errorSchemaId` must accept them (a mismatch fails the run).

## 10. Reuse vs new work

| Area | Retained | New |
|---|---|---|
| Resource/service flow | `simulation/open/kernel.ts`: heap/RNG, FIFO/concurrency, retries, cache, broker, accounting tests | Current-schema adapter, per-root trace hooks, finite external inputs, explicit completion |
| Frontend state | — | Machine interpreter, typed events, guards, effects, response fixtures |
| Data flow | — | Operation vocabulary, row provenance, deterministic aggregation |
| Infrastructure | Probabilistic failure | Placement constraints, scheduled outage/detection/recovery, unavailable admission |
| Fullstack | Call/message accounting | One scheduler/causal bridge, refinement selection, correlation |

`OpenSimulation.advance()` stops at the configured duration and may keep in-flight work: keep that finite-horizon meaning, and never read `finished` as "all drained". Kernel extensions need separate review against all retained invariant tests. The existing `executionSignature` is a worker reset string; don't reuse it as run identity.

Out of scope: arbitrary source execution, eval/expressions, general SQL/ETL, DOM rendering, provider-specific infrastructure emulation and live collaboration. Extending the vocabulary beyond these fixtures is a later explicit decision.

## 11. Reference scenarios

Fixtures in `../fixtures/` encode these. Each must pass exactly; a trivial example per family doesn't satisfy R13.

**S01 — checkout machine.** States `editing → submitting → succeeded | failed`; context `{items, active, error}`; `validCart = nonEmpty ∧ every quantity positiveInteger`.

| State + event | Result |
|---|---|
| editing/failed + submit, invalid cart | stay; trace; no command |
| editing/failed + submit, valid cart | submitting; new request ID; emit one create-order call |
| submitting + submit | stay; `ignored-duplicate`; no command |
| submitting + matching success response | succeeded; clear active |
| submitting + matching rejected response or timeout | failed; set error; clear active |
| any + response for inactive request | `stale-response`; no change |

Cases:
- Empty cart → 0 commands, editing.
- Two submits + accepted response → 1 command, succeeded. The response is released after the second submit (`afterInputId`).
- Submit + timeout + resubmit + accepted → 2 request IDs, succeeded; the first response arrives late and is ignored as stale.

Backend idempotence is not inferred from UI duplicate prevention.

**S02 — order processing.** Call-entry machine → validate pipeline → payment decision → reply machine. On allow, the reply machine emits a fulfillment message and replies accepted, in that order. Payment is an explicit fixture.

| Case | Expected |
|---|---|
| Deny | root rejected=1; no message |
| Allow | root succeeded=1; message generated=1, succeeded=1; the accepted reply is separate from fulfillment |
| Fulfillment failure (regression) | the user root stays accepted; the message failure is recorded separately |
| Transport retry, max 2 | ≤ 3 attempts |

A payment-timeout fixture yields an expired reply. Business retry and idempotence are separate configuration. Default resource values offered by templates are visibly tagged assumptions.

**S03 — records pipeline.** Operations: validate → trim region → deduplicate orderId → group-sum by region. Input `amountMinor` is scalar-union integer|string; `validate` requires integer.

| Row | orderId | region | amountMinor |
|---|---|---|---|
| r1 | a | ` EU ` | 1000 |
| r2 | a | `EU` | 1000 |
| r3 | b | `US` | 2500 |
| r4 | c | `EU` | `"bad"` |
| r5 | d | `EU` | 500 |

Expected: errors=[r4]; duplicate=[r2] (first valid row kept); retained=[r1,r3,r5]; EU=1500, US=2500, keys sorted. Accounting: 5 = 1 invalid + 1 duplicate + 3 retained. Every aggregate lists its source rows. No joins or loops.

**S04 — host failover.**
- *Failover.* Instances A/B on hosts H1/H2 behind a round-robin router. Capacity 10 (100 ms service), one slot each, no queue or retry. Arrivals at 0, 1, 2, 3, 4, 5 s. H1 is down 2–4 s, with 1 s failure and recovery detection. Expected: t0→A ✓, t1→B ✓, t2→A rejected (host down, router not yet updated), t3→B ✓, t4→B ✓, t5→A ✓ (the cursor reset at recovery detection). Totals: generated 6, succeeded 5, rejected 1.
- *Active/queued outage.* One instance on H1, capacity 1 (1000 ms), concurrency 1, queueLimit 1. x arrives at 0 (active), y at 0.25 (queued); H1 is down 0.5–1.5; z arrives at 1.6. Expected at 0.5: x failed once, y rejected once, nothing active/queued/in flight. The cancelled completion at t=1 adds no outcome. z succeeds at 2.6. Totals: 3 generated, 1 succeeded, 1 failed, 1 rejected.
- *Outage at completion.* Same setup, with the outage at exactly t=1 (x's completion time): the outage phase comes first, so x fails exactly once.
- The route cursor advances on every selection, including a rejected one.
- Host placement is acyclic, and conflicting placements fail readiness.
- A `deployed-on` relation constrains a resource; it is not a service call.

**S05 — fullstack composition.** Checkout machine → API capacity (resource on an API host) → bridge call → S02-style business flow → fulfillment message via broker → worker.
- *Success:* 1 UI success, 1 accepted user root, 1 completed fulfillment message. The message root links to the user root, and one interaction doesn't become three successes.
- *Outage then retry:* the host is down at the first submit → transport rejection → UI failed, with no fulfillment. After recovery, an explicit resubmit mints a new request ID under the same journey and succeeds.
- An optional S03 transform may sit inside fulfillment with schema-matched ports.
- Aggregate and refined service configurations are exclusive per scenario. Mismatched ports, recursive refinement or running both paths is invalid. Expanding the canvas changes neither the trace nor the fingerprint.

Runtime tests must also check trace-level facts the authored assertions don't cover: S03 row provenance, S04 per-arrival routes/timestamps, S05 distinct request IDs, shared journey and message-root linkage.

## 12. Delivery order and acceptance

1. Document/port/scenario validators, trace envelope, fixture and budget validation.
2. S01 machine and S03 operations (parallel, after shared types freeze).
3. Characterize the retained resource runner; add the external-input/completion/trace adapter (exclusive kernel ownership).
4. S02 business mapping, then the S04 fault scheduler (serialized); review failure accounting.
5. S05 bridge and all five journeys before RV-14 is complete.

Acceptance: success, failure and boundary cases for S01–S05; schema-mutation and exhaustive hash vectors; malformed references; inactive incomplete elements; all-scenario eligibility including zero-check runs; chunk-independent scheduling; retained retry RNG/FIFO/cache/broker invariants; cancellation at compiler and runner batch boundaries.
