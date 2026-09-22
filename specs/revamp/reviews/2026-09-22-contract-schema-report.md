**Verdict: REVISE**

Eight concrete defects, ordered by blocking severity:

---

**D1 — Boundary request matching vs. runtime-generated request IDs** *(blocking S02, S05)*
`Boundary.requestFixtureId` uses "exact canonical request matching." But S01 and S02 embed a `request-id`-effect value in outgoing payloads — a value generated at runtime from `runId + monotonic counter`. Authors cannot pre-declare this in a authored fixture. Spec must state whether canonical matching excludes correlation/request-ID fields, or whether `requestFixtureId` matches only the business payload excluding system-generated path values. Without this, boundary fixture authors have no contract.

**D2 — `emit` effect `correlation` conflates two unrelated mechanisms** *(blocking S01 bridge)*
Two distinct correlation concepts exist: (a) the system call-frame ID, which the bridge uses to route the response back to `responseBindings.eventPortId`; (b) the authored request ID embedded in payload via `{kind:'context-request',path}`, used by the machine guard for stale-response detection. The spec defines `correlation` in the emit effect without separating these. An implementer may treat `emit.correlation` as (a), breaking bridge routing, or implement it as only (b), leaving frame tracking implicit and undefined. Spec must make the delineation explicit: call-frame ID is system-generated; the emit `correlation` field is payload-only for application-level stale detection.

**D3 — `CompiledPlan` in `startRun` is described as worker-local but passed as a parameter** *(blocking runner architecture)*
`startRun` takes `plan:CompiledPlan`. The spec then says "compiled plan is an opaque, worker-local validated plan, never portable input" and "not a structured-clone promise for Maps/functions." If compiler and runner inhabit the same worker, the parameter is fine. If they're separate workers (the spec also says "compilation runs in a worker"), the plan cannot be transferred. The required topology—one worker, two workers, structured via manifest re-compilation—is unspecified. Implementer cannot choose a worker architecture without this.

**D4 — `requestId` in response payload: authored vs. runtime-injected** *(blocking S01 schema and responseBindings compatibility check)*
"Event payload includes the response request ID as an explicit schema field." Ambiguous: does the author declare a `requestId` field in both the call-port `responseSchemaId` and the event port `schemaId` (making `responseBindings` shape compatibility check include it), or does the runtime inject it after schema validation (meaning the declared shapes can ignore it)? If authored, the compatibility check forces symmetric declaration in both schemas. If injected, the runtime violates the "no hidden field" guarantee. S01's stale-detection guard reads this field from `input`—it must be in the event schema. Spec must state which.

**D5 — `decision` behavior has no entry-port specification** *(blocking dispatch implementation)*
`pipeline` has `inputPortId`, `outputPortId`, `errorPortId`. `resource` has `entryPortId`. `machine` has `responseBindings`/event ports. `decision` has only `inputSchemaId`—no `inputPortId` or equivalent. The runtime must know which inbound port triggers decision evaluation. Nothing in the Port or Connection model identifies which port is the decision entry without an explicit field. Spec must add `inputPortId` (or equivalent) to the decision behavior record.

**D6 — Pipeline error row schema for non-validate operations is undefined** *(blocking S03 error output and S02 pipeline errors)*
`validate` errors produce "original row/provenance" to error output—the format is partially described. For `map`, `filter`, `group-sum`, `deduplicate`, and `trim`, "a non-validation operation with wrong input type produces an explicit row error." The spec never defines what fields that row error contains. The author must declare `errorSchemaId`, but without knowing what the runtime emits, the schema cannot be correctly declared. This makes fixture-based testing of error paths impossible.

**D7 — `completion` kind validation gap in logical mode** *(validator correctness)*
`{kind:'quiescent'}` is tagged "logical only." `{kind:'horizon',horizonMs}` and `{kind:'drain'}` are not explicitly prohibited in logical mode. Since logical mode has no `atMs` values, a `horizonMs` in logical mode is meaningless. Spec says "logical mode has no elapsed-ms/throughput/utilization values" but doesn't reject non-quiescent completion kinds for logical scenarios. Validation must explicitly reject them; the current text leaves a silent misconfiguration path.

**D8 — `{kind:'metric',elementId:null}` assertion subject semantics undefined**
`Assertion.subject` allows `{kind:'metric',elementId:Id|null,...}`. `{kind:'count',elementId:null}` has inferrable semantics (global root/message counts). For metric subjects, null elementId is not explained. Throughput, utilization, and latency quantiles are per-element concepts; a null aggregation is undefined. "Missing/unsupported metrics are unevaluated failures, never zero"—so null elementId metric assertions would always fail as unevaluated, which is probably not intent. Spec must either prohibit null here or define global aggregation semantics.

---

None of these require runtime code. D1 and D2 must resolve before boundary fixture authoring for S02/S05 can be specified; D3 before the runner split is decided; D4 before S01 schema authoring; D5 before decision behavior is implementable; D6 before S03 pipeline error paths can be fixture-tested. D7 and D8 are validator/assertion correctness gaps.
