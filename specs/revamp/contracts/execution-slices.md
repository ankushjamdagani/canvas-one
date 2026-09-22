# RV-02c — Capability partition and scenario fixtures

Status: lead draft for Claude review. This is required scope, not a claim that runtime code exists. Each slice receives exclusive files and executable fixtures before Gemini starts it.

## Reuse versus new work

| Area | Retained implementation | Explicit new work |
|---|---|---|
| Resource service flow | `simulation/open/kernel.ts`, heap/RNG, FIFO/concurrency, retries, cache, broker and accounting tests | Current-schema adapter; per-root correlated trace hooks; finite external input scheduling and explicit completion policy |
| Frontend state | No existing UI-state interpreter | Pure state/transition evaluator, typed events, guards, command effects, deterministic response fixtures |
| Data flow | No payload transform interpreter | Small built-in operation vocabulary, per-row provenance/error outcomes and deterministic aggregation |
| Infrastructure | Probabilistic failure exists; no host outage interpreter | Explicit placement constraints, scheduled outage/detection/recovery and unavailable-resource admission policy |
| Fullstack | Call/message accounting primitives exist | One scheduler/causal bridge across modeled UI, service and deployment behavior; explicit refinement selection and correlation |

`OpenSimulation.advance()` currently stops at configured duration and may retain in-flight work. Preserve finite-horizon performance semantics explicitly; never reinterpret `finished` as every request drained. Existing `OpenSimulationAdapter` exposes aggregate metrics only: it cannot by itself deliver a fullstack causal trace. Kernel extensions must be separately reviewed with all retained invariant tests.

Defer arbitrary source execution, arbitrary expressions/eval, general SQL/ETL, DOM/browser rendering, provider-specific infrastructure emulation and live collaboration. No use-case family is deferred; each receives a bounded modeled example. Advanced vocabulary beyond the listed fixtures is a later explicit expansion, not silent capability inferred from node names.

## Common typed semantics

Payloads are validated JSON with declared scalar/record/list shapes, explicit nullability and bounded nesting. Ports name input/output direction and payload schema ID. Edge kinds: synchronous `call` (paired response/error), asynchronous `message`, and `data`; state transitions stay within a state-machine behavior. Structural `contains` and `deployed-on` are separate records. Descriptive dependency arrows do not send tokens.

Start with guards `equals`, `notEquals`, `exists`, `all`, `any` over typed field paths/literals. No coercion: missing differs from null, and string "1" differs from number 1. No user code or recursive expression references. Type errors stop validation; runtime malformed external fixture input creates an explicit modeled rejection outcome.

Each event has deterministic event ID, root/correlation ID, parent event ID, destination port, payload ref and sequence. Logical mode orders external events by declared position and internally generated events FIFO. Timed mode orders by modeled time, explicit phase priority then insertion sequence; outage/recovery phase precedes admissions at equal time, completions precede newly scheduled dispatches. The kernel's existing retry draws/attempt accounting are preserved; any change in ordering affecting them requires versioning and characterization tests.

No optional millisecond field is populated in logical mode. Event order is not elapsed time. Mixed composition uses the timed scheduler only when all time-dependent effects have declared durations; otherwise it runs logical fixtures with no latency metrics. A view's expansion/collapse never chooses a runner or refinement.

## S01: checkout machine (new)

State union: `editing`, `submitting`, `succeeded`, `failed`; initial `editing`. Context: cart `{items: [{sku, quantity}]}`, active request ID or null, error code or null. Guard validCart requires at least one item and each quantity a positive integer.

| State / event | Result |
|---|---|
| editing or failed + submit with invalidCart | Remain; record validation issue; emit no order command |
| editing or failed + submit with validCart | submitting; generate deterministic request ID; emit one createOrder command |
| submitting + submit | Remain; record ignored duplicate; emit zero commands |
| submitting + matching orderAccepted | succeeded; clear active request |
| submitting + matching orderRejected or timeout | failed; set error; clear active request |
| Any + response to an inactive request | Ignore with stale-response trace; no state change |

Fixtures: invalid empty cart → zero commands/editing; valid cart + two submits + accepted response → one command/succeeded; valid submit + timeout + deliberate resubmit + accepted response → two request IDs/succeeded; old response after retry → ignored. Timeout is a declared input in logical mode, explicit scheduled deadline in timed mode. Backend idempotence is not inferred from UI duplicate prevention.

## S02: order processing (retained accounting plus new semantics)

Modeled pipeline: validate → payment decision → accepted order → publish fulfillment message → fulfill. Payment fixture is explicitly allow/deny/timeout per request correlation. Deny yields rejected order and zero fulfillment messages. Allow yields one accepted order and one message; accepted response precedes fulfillment completion. Message completion has its own accounting and does not increase root user-success count twice.

Golden functional fixtures: one denied order → rejected=1, accepted=0, messages=0; one allowed order → accepted=1, fulfilled=1, messagesGenerated=1; fulfillment modeled failure → accepted=1, fulfilled=0, messageFailed=1. Transport retry fixture with declared maximum 2 retries must create at most 3 attempts; business retry/idempotence rules are separate explicit configuration. Preserve existing timed FIFO/queue/cache/broker invariant tests rather than inventing replacement math.

Existing default resource values may be offered as template assumptions, visibly tagged. A pure payment predicate has no CPU capacity/latency until the author enables a resource profile.

## S03: records pipeline (new)

Vocabulary initially: validate record, trim string, map explicit fields, filter by typed guard, stable deduplicate by field, group and sum numeric field. Operations are an ordered array with stable IDs. Invalid records enter an error output with original row ID and issue; no silent drop. Dedup keeps the first valid record in declared input order. Group outputs sort by key using the same specified code-unit comparison as identity encoding. Sum uses safe integer minor currency units for this fixture; overflow is explicit failure, not rounded success.

Fixture rows:

| Row | orderId | region | amountMinor |
|---|---|---|---|
| r1 | a | ` EU ` | 1000 |
| r2 | a | `EU` | 1000 |
| r3 | b | `US` | 2500 |
| r4 | c | `EU` | string `bad` |
| r5 | d | `EU` | 500 |

Expected: errors=[r4]; duplicate=[r2]; retained=[r1,r3,r5]; aggregate EU=1500, US=2500. Accounting 5 input = 1 invalid + 1 duplicate + 3 retained. Every aggregate lists contributing row IDs. No generic joins/loops until a separate bounded specification exists; the required example does not need them.

## S04: host failover (new constraints, retained capacity)

Service instances A/B each reside on hosts H1/H2; round-robin starts A. Explicit arrival sequence at modeled times 0, 1, 2, 3, 4, 5 seconds. Service time 0.1 seconds, one slot per instance, no queue/retry in this fixture. H1 unavailable at t=2 and recovers at t=4; routing detection delay 1 second, recovery detection delay 1 second. No new admission to failed resources even before router detection; stale routing can attempt and receive unavailable rejection.

Expected routing/admission: t0→A succeeds; t1→B succeeds; t2→A unavailable/rejected; t3→B succeeds; t4→B succeeds; t5→A succeeds after recovery detection. Route cursor advances on selection, including rejected selection; excluded unhealthy members do not advance the full-list cursor ambiguously—fixture defines recovery restart at A. General route reset policy is explicit configuration, not inferred from this example. No in-flight requests cross outage boundaries here.

Separate boundary fixtures MUST cover an active/queued operation at outage. Initial policy is explicit fail-at-outage: settle active work failed once, reject queued work once, free capacity, cancel completion callbacks; automatic retry uses declared retry budget, never duplicates settled results. Recovery only admits new/retried work. Host hierarchy is acyclic; conflicting placements fail readiness. This models declared policy, not real cloud control-plane behavior.

Boundary fixture (one instance A on H1, concurrency 1, queueLimit 1, service duration 1s, no retry): request x arrives t=0 (active), y arrives t=0.25 (queued), H1 fails t=0.5 and recovers at t=1.5, z arrives t=1.6. Expected at t=0.5: x settles failed once, y settles rejected once, active=0, queued=0, inFlight=0. Cancelled x completion at t=1 produces no second outcome; y never starts. z succeeds at t=2.6. Final generated=3, succeeded=1, failed=1, rejected=1, inFlight=0; root conservation holds. A second boundary fixture schedules outage exactly at x's t=1 completion: declared outage-before-completion order makes x fail exactly once. Times were scaled from the earlier 2-second sketch because the retained validator requires capacity >=1 work unit/second; no numerical range expansion is needed. This explicit new fault-phase policy must not alter ordinary no-fault kernel event ordering.

## S05: causal composition (new bridge)

One valid S01 interaction invokes the S02 boundary; use declared explicit placement from S04. Primary success fixture occurs while both hosts healthy, returns accepted to UI, then fulfills asynchronously. Exactly one UI success, one accepted root, one completed fulfillment message; all share one root correlation. Outage variant targets unavailable A before detection, returns modeled rejection to UI, creates no fulfillment; later explicit retry uses a new request ID under the same user journey correlation.

Optional S03 transform may be chosen inside fulfillment with explicit schema-matched ports. Aggregate/refined service configuration is exclusive: select one in scenario compilation, never execute both. Candidate graph with mismatched ports, recursive refinement or both paths enabled is invalid. Expansion of the canvas view has no effect on expected trace/fingerprint.

## Delivery ordering and gates

1. Current document/port/scenario validators and trace envelope, with fixture files and budget validation.
2. S01 pure interpreter and S03 pure operations can run in separate file ownership after shared types freeze.
3. Characterize existing resource runner; introduce explicit external inputs/completion/trace adapter under exclusive kernel ownership.
4. S02 business outcome mapping and S04 constraint scheduler; review failure accounting before composition.
5. S05 scheduler bridge and all five fixture journeys before declaring RV-14 complete.

All budgets, exact public TypeScript interfaces and storage versions remain RV-02 deliverables. These fixtures narrow semantic scope; they do not authorize Gemini to invent those remaining interfaces. Run identity requires the whole declared manifest and actual runner version, not the old `executionSignature` worker invalidation string.
