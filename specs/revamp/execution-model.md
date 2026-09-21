# Execution model — architecture discussion

Status: architecture proposed; user confirmed model-based runs first, actual source execution later, and all use-case families important on 2026-09-21. This document takes precedence over assuming diagrams are a permanent non-executable product mode. It does not authorize runtime changes.

## Product direction

One modeling workspace, multiple views of the same system, one scenario-oriented Run experience. Frontend, backend, fullstack, infrastructure, code/data flow and service flow should all have a path to meaningful execution. A sketch with missing behavior is an incomplete model, not a separate product mode.

Consistency means a common input → validate → run → trace/results → compare loop. It does not mean assigning throughput and queues to every screen, function or deployment relationship. A successful animation is not evidence that application code or infrastructure works.

## What already exists

`specs/open-system-simulator.md` already replaced fixed experiment/diagram modes for new projects. `newOpenProject()` is the default. New component identity (`kind`) is separate from explicit behavior. Current behavior families in `src/domain/execution.ts` are source, processor, router, storage, cache and broker. Edges are calls/messages; workloads carry rate/profile, request classes, tags and key distribution. This is a useful resource/traffic simulator.

Current limits matter: no general payload transformation or UI state-machine schema, conditions limited to class/operation/tag, synchronous call cycles rejected, and every behavior shares a resource configuration shape. `defaultBehavior()` supplies numerical defaults, including a processor fallback for otherwise unmatched identities. These defaults are modeling assumptions, not facts inferred about the named technology.

The non-open path is mainly legacy archive compatibility. `App.tsx` loads such projects read-only and only enables Run for open graphs. `useSimulation.ts` and the worker/Simulation dispatcher still contain old paths. Thus the revamp must not reintroduce a prominent “diagram-only versus runnable” choice that earlier work already removed. User decision D19 now permits removing old-data readers and runtimes entirely; these are current-state observations, not preservation requirements.

## Four concepts to separate

| Concept | What it represents | Example |
|---|---|---|
| System element | Stable identity and responsibility | Checkout page, order service, payment provider |
| View | A projection and layout of chosen elements/relationships | Fullstack overview; service internals; deployment view |
| Behavior | What happens when an input arrives, under a declared model | Validate order; transition UI state; queue message |
| Scenario | Chosen scope, initial state, inputs, assumptions and checks | Payment timeout with a repeated user click |

Author a system once; views reference stable IDs rather than becoming independent copies. A cross-project reference, when added, pins a version and declares a boundary contract; do not recursively fetch whatever is current during a run.

## Proposed execution capabilities

| Capability | Useful result | Preconditions | Current support |
|---|---|---|---|
| Behavioral scenario | Ordered causal trace, outputs/state changes, assertion outcomes | Explicit inputs, behavior and expected outcomes | New work; current kernel has request/message causality but no general functional runner |
| Performance scenario | Latency, throughput, waiting, occupancy, failures | Workload and resource/timing assumptions | Existing open engine, with bounded semantics |
| Failure scenario | Recovery path, timeout/cancellation/retry effects, violated checks | Failure event schedule plus defined failure/recovery behavior | Probabilistic failures/retries exist; broader fault schedules need specification |
| Actual source execution | Observed outputs from a real program | Runtime, source/dependencies, isolation and reproducible environment | Deferred by user; not in the initial model-run scope |

Do not add separate disconnected products for these capabilities. One scenario selects supported behaviors and optional resource modeling; results declare their evidence type. A logical trace with no timing model shows causal order, not made-up milliseconds. A resource simulation is an estimate conditional on assumptions, not a benchmark of deployed software.

## Domain examples to validate with the user

| Use case | Inputs | Run behavior | Useful outputs |
|---|---|---|---|
| Frontend checkout | User events, cart fixture, mocked API responses | State transitions, validation, network effects, retries/cancellation | State timeline; double-submit prevention; error/recovery outcome |
| Backend service flow | Order command, request class, workload | Calls/messages, resource contention, persistence, failure/retry | Trace; accepted/completed distinction; latency/queue/failure metrics |
| Fullstack journey | UI event through API to background worker | Compose frontend and service behaviors through explicit ports | Correlated end-to-end outcome without counting async completion as an immediate response |
| Code/data flow | Typed records and expected output | Built-in transformations, branching, join/aggregation, bounded iteration | Values per step; shape validation; assertions and provenance |
| Infrastructure | Request scenario plus instance/zone outage schedule | Placement/capacity constraints and declared failover rules | Affected routes, unmet demand, recovery/availability under assumptions |

All families are important per the user. The concrete fixtures below are lead proposals for requirements review, not implemented capabilities. A Kubernetes-shaped node does not emulate Kubernetes; a function-shaped node does not execute source code.

## Representative scenario acceptance proposals

These scenarios are required design coverage, not a promise to implement every advanced behavior at once. The contract review must prove the core can express each before choosing incremental delivery slices.

### S01 — Frontend checkout

Input: a valid/invalid cart fixture, submit events (including a second click while pending), initial UI state, and deterministic success/timeout API response fixtures. Modeled states: editing, submitting, succeeded and failed. Output: event/state trace, commands emitted and assertions. Checks: invalid input sends no command; repeated submit while pending creates no extra order command; timeout presents a recoverable state; deliberate retry follows its stated policy. No DOM rendering, React execution or browser paint metric is claimed.

### S02 — Backend order processing

Input: order workload with named request classes, inventory/payment response fixtures and a fulfillment queue. Output: correlated call/message trace, final order outcomes and existing timed resource metrics where configured. Checks: rejected payment cannot report a confirmed order; accepted async work is distinguishable from completed fulfillment; retry attempts obey budget/deadline; accounting remains conserved. A business assertion may fail even when a simulation completed normally.

### S03 — Code/data transformation

Input: a small typed record set containing valid, invalid and duplicate records. Pipeline: parse/validate → branch invalid rows → normalize → explicitly specified deduplication → aggregate → output. Output: values and provenance per step, rejected records with reasons, deterministic aggregate. Checks: known fixture matches its expected output; invalid rows do not silently disappear; dedup key/order is explicit; input-count accounting reconciles. This exercises declarative operations, not an arbitrary language runtime or complete ETL engine.

### S04 — Infrastructure failover

Input: a service placed across two modeled instances/hosts, a workload, a scheduled host outage and recovery, and explicit routing/health-detection/failover delays. Output: availability/routing trace, demand served/rejected and recovery interval under those assumptions. Checks: a failed instance serves no new work after the specified detection/dispatch policy takes effect; routing respects remaining capacity; queued/in-flight work follows an explicit failure policy; recovery does not duplicate completed requests. A deployed-on relationship constrains a resource; it is not an extra service invocation.

### S05 — Fullstack composition

Connect S01's order command to S02's API boundary, with S04 as a deployment/failure scenario. Correlate one user interaction across UI, request and background events. One event may produce several messages without becoming several user successes. Use explicit boundary ports and model refinement so the API is not counted once as a black box and again as its internals. S03 can be a declared data-processing subflow rather than an unrelated duplicate diagram.

## Proposed semantic core

Use typed input/output ports and distinguish behavioral connections (call, event/message, data, control transition) from structural relationships (contains, deployed-on, depends-on, reads/writes as descriptive relationships). Structural arrows do not automatically carry runtime tokens. Their effects enter compilation through a declared rule, such as a failed host making its resident modeled resources unavailable.

A behavior contract declares inputs/outputs, state, completion/failure semantics and optional resource/timing requirements. Candidate bounded building blocks: trigger, operation, decision, transformation, store, queue/event, fork/join, delay, state transition and assertion. Existing service behaviors are reused where semantics match; do not replace exact kernel accounting with a generic animation engine.

Avoid arbitrary `eval` as a shortcut for expressions. If model-based transformations are approved, first define a small versioned typed expression/operation vocabulary, deterministic evaluation and budgets. Bounded iteration has explicit exit/step limits; ordinary dataflow joins require a defined correlation/window policy. Cycle support is not achieved by removing current cycle validation.

### Abstraction and refinement

An element may have an internal submodel linked to the same identity. Per scenario, choose either an aggregate behavior or its refined submodel; never run both and double-count latency/capacity. Ports map boundary inputs/outputs. View collapse/expand never changes execution granularity. A refinement selection and pinned submodel versions belong in the executable fingerprint.

### Scenario readiness and transparent assumptions

Use readiness states: sketch → behavior specified → scenario configured → runnable → evidence available. Missing inputs/behavior produce actionable issues on the relevant elements. Templates can propose defaults, but show their origin and allow review; do not silently treat defaults as measured facts. Mark elements outside the selected scenario as outside coverage, not verified.

Persist assumptions with the scenario: specified, template default, measured/calibrated or unknown. Include active assumptions in the run snapshot and comparison identity. A user can run a deliberately coarse model, but the output must state the limits of what was exercised.

### Run record

Immutable run record: scenario ID/version; model/behavior/runner versions; selected scope/refinement; executable fingerprint; initial state and input fixture hashes; seed; resource/time budgets; start/completion status; trace reference; assertions; metrics with definitions; assumption provenance. Wall-clock playback speed is separate from modeled time.

Trace events carry run ID, parent/correlation IDs, logical sequence/time, element/port, event kind and bounded payload reference. Truncation/resource exhaustion is explicit and cannot count as completed verification. Old saved/imported metrics need not be supported and must never be relabeled functional traces.

## Consequence for commit/publish policy

User decision D20 keeps commits and publication run-required, without a diagram exemption. Proposed contract: every current project has at least one designated baseline scenario, and commits/publications identify a non-empty required scenario set with completed exact-state evidence for each. A runnable trivial path must not silently claim coverage of the whole system: record tested scope, inactive elements and uncovered behavior explicitly.

Autosave/checkpoints preserve incomplete sketches and do not carry commit/publication status. A project may have a working branch with no initial commit yet; creating a project does not manufacture a qualifying run. Imported current-format snapshots likewise do not gain verification by parsing successfully.

Completion and passing assertions remain distinct. Lead default: a completed modeled failure scenario can support a commit/publication with its failures prominent; do not display a passing-verification badge when assertions failed. No additional mandatory pass/fail publication gate is introduced without a separate decision, because the confirmed requirement specifies completed runs.

## Before implementation

1. Preserve confirmed model-based-first scope, all-family coverage, run-required commits and removal of old-data compatibility.
2. Codex/Claude refine S01–S05 into typed fixtures and exact expected outputs, assumptions, failure cases and useful comparisons.
3. Claude reviews whether one bounded behavior model covers them without pretending to model unsupported systems.
4. Freeze semantic contracts and revise storage/commit identity within RV-02 before any dependent feature code.
5. Prototype one thin scenario slice under Gemini guidance, with deterministic fixtures, before committing to all use-case families.
