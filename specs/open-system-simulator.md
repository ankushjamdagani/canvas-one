# Open system simulator and canvas grouping

Status: implemented and verified before the UI decluttering milestone. Baseline: 233 unit tests across 36 files, 44 production Chromium tests, production build and whitespace checks passed. Implementation used agy/Gemini gemini-3.8-flash-low with lead integration review. Shared-team infrastructure remains future scope.

## Outcome

Replace the fixed experiment paths and visual-only diagram mode with one editable, executable system canvas. Users model frontend-to-backend requests, events, latency, queues, capacity and failures; the app does not execute application code or reproduce an actual infrastructure provider.

All 29 component identities remain available in one searchable catalog. Their execution comes from explicit configurable behaviors. Templates and tutorials are optional starting points, not modes or component filters. Create subsystems directly from a canvas selection through its right-click menu.

This milestone precedes the shared-team workspace plan. It does not add authentication, a backend or collaboration infrastructure.

## Confirmed product decisions

- New projects start with an empty canvas named “Untitled system.” Returning users reopen their existing project.
- Remove Experiment path, Guided experiment and Architecture diagram from the main flow. There is no separate non-executable editing mode.
- Keep a secondary “Examples” action containing “Starter templates” and “Tutorials.” Selecting an item previews its purpose before explicitly loading it. Loading replaces the current canvas through one undoable action and preserves project identity and saved history.
- Tutorials provide optional instructions alongside the same editor. Closing a tutorial only hides its instructions. Neither examples nor tutorial selection changes component availability.
- Keep names, notes, connection labels, subsystems, layout, image exports, local projects, authored revisions and saved comparisons.
- Use box selection followed by right-click to group. Shift-click is not required. Provide equivalent keyboard and touch actions.
- Delegate implementation to `agy --model gemini-3.8-flash-low`. The lead owns simulation semantics, frozen contracts, integration decisions and final review.

## 1. One component catalog, explicit behavior

Separate `kind` (architectural identity and icon) from a discriminated `behavior` configuration. A component remains selectable and configurable regardless of the rest of the graph. The inspector shows what its behavior models and the parameters that affect execution; do not imply that an icon implements a real protocol or managed service.

| Default behavior | Component identities | Initial modeled capability |
| --- | --- | --- |
| Source | Traffic source, scheduler | Seeded arrivals or fixed-interval scheduled arrivals |
| Processor | Web client, mobile app, IoT device, service, function, container cluster, worker, notification service, monitoring, analytics, secrets manager, external system, custom component | Finite concurrency, service time, FIFO waiting, local failure and retry |
| Router | API gateway, load balancer, firewall/WAF | Round robin, weighted choice or request-class conditions after local processing |
| Storage | SQL database, NoSQL database, object storage, search index, warehouse | Processing capacity and latency for read/write request classes |
| Cache | Cache, CDN, DNS | Fixed hit probability or finite keyed LRU with TTL and a configured origin |
| Broker | Message queue, event stream, pub/sub | Buffered asynchronous work and delivery to configured consumers |

The inspector can change the behavior independently of the identity, including for a custom component. This is how users model a component differently without adding a new icon type. DNS caching does not imply DNS protocol simulation; a stream defaults to FIFO delivery without partitions/replay; a container cluster defaults to a processor pool without orchestration. State these assumptions beside the relevant configuration rather than offering inert components.

### Configuration and defaults

- Use milliseconds for delays and seconds for simulation duration. Processing time per attempt is `1000 / capacity` milliseconds per slot; show the equivalent rate and delay without storing two independent contradictory inputs.
- Processor/router/cache/storage pools support 1–16 slots and FIFO limits of 0–10,000 waiting operations. Defaults retain current catalog capacities where applicable; failures default to 0%, retries to 0, and retry delay to 100 ms. Worker presets can explicitly use two slots and two retries.
- Storage has independently configurable read and write service rates, initially equal. It models service performance, not records, transactions, replication or consistency guarantees.
- Routers default to round robin. Weighted routes normalize positive weights. Conditional routes match the request-class name, read/write operation or an exact tag; use edge-ID order for multiple matches and require exactly one fallback route. No arbitrary user code or expression evaluation.
- Caches support the current fixed-probability and finite LRU models, defaulting to 80% fixed hits, 100 entries and 10,000 ms TTL. A cache has exactly one synchronous origin edge; hits complete locally, misses call the origin. A successful, live origin read fills the finite cache, and TTL starts at fill. Hits refresh recency. Writes bypass lookup and invalidate the local key on successful origin completion. No miss coalescing or external invalidation.
- Queue/stream brokers select one available consumer in round-robin order. Pub/sub creates one independently accounted message per subscription. Consumer delivery is broker-owned, not a second message creation at its outgoing edge.
- Keep existing size limits where already appropriate: 100 components, 200 connections, 100 notes, 10 non-overlapping subsystems, and 2–20 members per subsystem. Preserve existing bounded text fields and numeric validation.

## 2. Workloads and graph execution

### Public model changes

- Add versioned execution contracts in `src/domain/execution.ts`: `BehaviorConfig`, `WorkloadDefinition`, executable connection configuration, compiled-plan types and structured validation issues.
- `Graph.workloads` replaces the single implicit source. Each workload has a stable ID, entry component, enabled state, arrival profile, timeout, and request classes. Request classes carry a name, weight, read/write operation, tags and key distribution. Root arrivals enter the selected component and use its behavior normally.
- Retain one global seed and run duration. Default source settings remain 100 requests/s, seed 42, duration 30 seconds and a 2,000 ms deadline. Adding a Traffic source creates one enabled workload; other components expose an explicit “Generate traffic here” action rather than silently generating traffic.
- Connections gain an executable transport: synchronous call or asynchronous message. New connections default to synchronous calls; incoming broker connections default to asynchronous messages. Keep labels and protocol names as descriptive metadata. Remove the ambiguous non-executable “data flow” transport from the new connection editor.
- Add a compiler that returns a runnable plan or actionable issues with component/connection IDs. The worker consumes the compiled plan through the existing reset/run/pause boundary. It must not choose an engine by scenario or infer stages by component kind/order.

### Synchronous execution

1. A root arrival receives its request class, key and absolute deadline. It enters its configured starting component.
2. A resource admits an operation into a free slot or its bounded FIFO. If neither is available, that operation is rejected immediately.
3. Local processing consumes the configured service time. An injected local failure either schedules an allowed retry or returns failure. Do not dispatch downstream operations from a failed attempt.
4. After successful local processing, an ordinary component dispatches all outgoing edges in parallel. A router selects one route; a cache chooses hit versus origin. A terminal component returns success.
5. Synchronous children return automatically through their call context; users do not draw response edges. The caller completes only after all required children succeed and its asynchronous publications are admitted. Multiple calls reaching the same downstream component are distinct invocations, not an implicit join.
6. A caller holds its concurrency slot while waiting for synchronous responses/admission acknowledgements. Report local processing utilization and occupied concurrency separately so a waiting caller is not described as consuming CPU.

Connections have configurable forward and return latency, both defaulting to zero. Resource processing retains positive service time. Sources generate and forward work without a processing slot or local attempt; their resource capacity and retry fields do not throttle ingress. Edge request counts measure actual sends, including sends whose destination rejects them; responses are separate counters.

### Asynchronous execution and brokers

- An asynchronous send creates an independent message work unit with a correlation ID. At the destination, admission either rejects it or accepts it. The producer waits for admission acknowledgement, not downstream completion. Acknowledgement delay defaults to 8 ms plus the configured return latency.
- An admitted message survives its producer's later timeout/failure. Its own deadline starts at publication; use the edge's message TTL, defaulting to 2,000 ms. Retries and broker waiting consume this lifetime. Descendant asynchronous sends inherit the earlier lineage deadline so cycles cannot extend lifetime indefinitely.
- A broker maintains a bounded FIFO per consumer subscription; a queue/stream has one shared competing-consumer FIFO. The configured queue limit applies to each FIFO. A ready consumer slot is reserved before dispatch so competing messages cannot overbook it; otherwise the message remains buffered until capacity is available or its deadline expires.
- Broker-to-consumer delivery continues the accepted message rather than creating a new one. Include connection latency in delivery and count the reservation as occupied concurrency. Broker occupancy counts buffered messages, not consumer work already dispatched.
- Pub/sub admission is accounted per subscription. If one subscription is full, other accepted deliveries remain valid; the producer receives a failed publication outcome. Never roll back already accepted independent messages or pretend publication was atomic.
- Asynchronous sends to ordinary processors are also supported; their own bounded admission queue is the mailbox. Protocol names do not silently change these semantics.

### Failure, retry and deterministic boundaries

- Local retry means rerunning only the failed node's local processing, before any downstream sends. Downstream rejection/failure propagates; v1 does not retry a whole subtree and risk duplicating its side effects.
- Retry backoff occupies no slot. Retried work re-enters the same bounded queue; a full retry queue or exhausted retries produces permanent failure. The deadline never restarts.
- A synchronous child failure terminates its parent operation and cancels its remaining synchronous descendants. Queued canceled work is removed; local processing already started holds its resource until that attempt ends and cannot dispatch or fill caches. Previously admitted async work remains independent.
- At an exact deadline, expiry wins over completion/admission. Process completion events before new arrivals at the same time, then stable sequence order within an event class. Include events at the requested observation time.
- Stable per-workload random streams determine arrivals independently of architecture edits. Key selection, routing and failure draws derive from the seed plus workload/request/operation/attempt identity; unrelated components must not perturb arrivals. Chunked `advance()` and one-shot advancement must produce identical results.
- Reject synchronous call cycles with a highlighted cycle path. Async feedback is allowed with lineage deadlines and a 64-hop lineage limit; exceeding the limit is an explicit failed message outcome.
- Bound execution to 1,000,000 processed events or 100,000 simultaneously live operations per run. Crossing a bound stops with an “incomplete: resource limit” result, retains diagnostics and disables saving it as a completed comparison. Do not silently trim work.

### Graph validation

Allow incomplete systems to be drawn, saved and exported. Run requires at least one enabled workload, valid behavior configuration and executable edges. Highlight missing endpoints/origins, invalid routing choices, unconfigured migrated transports and synchronous cycles with corrective messages.

Do not reject a graph for having multiple databases, caches, services, workloads or mixed synchronous/asynchronous branches. Disconnected components remain on the canvas; report them as inactive and show zero observed traffic, rather than forcing an artificial connection. Subsystems and notes never become runtime stages.

## 3. Measurements and saved results

Introduce simulation model version `open-system/1`. Replace lookup-specific global assumptions such as “database arrivals cannot exceed generated requests.” One request can issue several calls and publish several messages.

- Root requests: `generated = succeeded + rejected + failed + expired + inFlight`.
- Async messages, including each pub/sub delivery: `created = completed + rejected + failed + expired + inFlight`.
- Count each root/message exactly once in its terminal partition. Node invocations, attempts and retries are separate accounting layers, never added to root completion totals.
- Per-node observations include arrivals, admissions, queued work, processing slots, slots waiting on responses, completions, rejections, failures, expiries, attempts and retries. Maintain a partition for logical operations; physical cleanup after expiry is tracked separately and still contributes occupied time.
- Per-edge observations include sends, delivered/rejected admissions, returned responses and latency. Cache metrics are per cache, with explicitly labeled aggregate totals. Broker metrics expose admission, backlog and delivered/completed messages separately.
- Show root throughput/latency separately from background-message throughput/latency. Do not sum their p95 values or combine independent traffic populations into an unlabeled metric.
- A run ends at its configured observation horizon with unfinished work still in flight; it does not silently drain the system. Save only successfully completed observation windows with reconciled counters.
- Compare runs only when model version and normalized workloads match, including source identities/entry points, rates, profiles, classes, key distributions, seed, duration and deadlines. Architecture changes remain comparable. Renaming/moving a node or grouping it is not a workload change.
- Preserve the existing local reset-on-configuration-change behavior in this milestone. Names, positions, notes, grouping, collapse and tutorial visibility do not reset a running simulation. The separate team spec's captured-run behavior remains future collaboration work.

## 4. Canvas selection and subsystem UX

- On desktop, dragging empty canvas space draws a selection rectangle without a modifier. Space-drag or middle-button drag pans; provide a visible pan/select control. Node dragging moves the existing selected set.
- Right-clicking any selected node preserves the complete selection and opens its context menu. Right-clicking an unselected node selects that node first. Never replace a multi-selection just because its member opened the menu.
- “Create subsystem” is enabled for 2–20 selected, visible, ungrouped component nodes while below the group limit. If any selected component already belongs to a subsystem, disable the action with a reason; do not silently omit it. Notes, edges and group shells are not eligible members.
- Activating Create subsystem shows an inline name field anchored to the selection. Use “Subsystem” as an editable default, require 1–80 trimmed characters, Enter to confirm and Escape to cancel. Cancel makes no history entry.
- Create an expanded boundary around those exact nodes without moving them, changing IDs or rewiring edges. Select its shell after creation.
- Right-click a shell for Rename, Collapse/Expand and Ungroup. Ungroup retains nodes, positions and connections. Keep one-level, non-overlapping groups for this release; membership editing/nested groups are not added implicitly.
- Make create, rename, collapse/expand, ungroup and group movement each one undoable action, including relevant selection/view state. Preserve dormant membership through ordinary node undo.
- Provide a visible selection-actions button opening the same menu for touch, plus keyboard Context Menu/Shift+F10 and Cmd/Ctrl+G when the canvas has focus. Do not intercept shortcuts in text fields. Menus support arrow keys, Escape, focus restoration and viewport-safe placement.
- Retain the sidebar group list for navigation, but remove its checkbox-based creation wizard. Generalize the existing alignment/distribution/selection tools beyond diagram mode.
- Collapsed groups still aggregate actual child activity and project boundary connections. Connecting directly to group shells remains disabled; users expand to wire real endpoints.

## 5. Optional examples, editing and persistence

### Examples and editor changes

- Put Examples beside project-level actions, outside the core build/run flow. New-project guidance offers “Add a component” and a secondary “Browse examples.” No starter loads automatically.
- Migrate the three current starter templates and six tutorials to the new executable schema. Include workload definitions, explicit transports and all required behavior parameters. Chat examples model message delivery rather than actual WebSocket execution; split producer/receiver roles where necessary instead of drawing a synchronous cycle.
- Tutorials retain their learning questions but derive observations from the new metrics. Rewrite any old quantitative promise that assumed the former engines. Tutorial steps never gate editing or palette availability.
- Show selected-node behavior configuration in the existing inspector and connection transport/latency in the connection editor. Removing diagram mode must not remove note editing, relationship labels, duplicate, alignment or image exports.

### Existing data and format policy

- Use portable format version 8 for new-schema projects. Keep version-7 files as archives; do not add a general backward-compatibility import framework.
- Never mutate/delete old browser records automatically. Display existing legacy projects read-only with “Export original” and “Create runnable copy.” Export original preserves their original format and saved results.
- Create runnable copy gets a new project ID and converts the current graph, notes, subsystem layout and view metadata. Preserve the old record's revisions, checkpoints and observed results in that original archive; do not relabel them as new-engine history or measured results.
- Convert known lookup/job edges using explicit migration rules. For old diagrams, preserve structure and labels, suggest behavior defaults, and flag every ambiguous data-flow edge and absent workload for review before Run. Copying does not claim the model already represents real infrastructure.
- New revisions/checkpoints/exports retain the new behavior and workload schema. Their validation allows incomplete editing graphs but rejects structurally malformed data. New completed saved results require `open-system/1` metrics and accounting validation.
- Keep existing file-size and saved-history limits; report the limit explicitly rather than silently dropping snapshots/results.

## 6. Implementation delegation and integration gates

Use `agy` with the verified exact model ID `gemini-3.8-flash-low`. Do not silently substitute another model or invoke an internal agent instead. Each invocation receives this spec plus a short file-ownership brief, frozen contracts, acceptance cases and required checks. Run in an isolated checkout, inspect the returned diff, and integrate only the scoped patch. Avoid a blanket permission-bypass flag. If the CLI cannot edit or test under its permissions, record the actual block rather than claiming delegated completion.

Run these packets sequentially; split runtime work further into the listed independent behaviors rather than handing the entire engine to one low-effort prompt. The lead resolves ambiguous semantics and approves each integration gate before the next dependent packet.

| Packet | Exclusive implementation boundary | Required gate |
| --- | --- | --- |
| 1. Contracts/compiler | New `src/domain/execution.ts`, its tests and new behavior-default module | Lead reviews discriminated types, topology compilation and default mappings; compiler tests pass without changing the current app |
| 2a. Execution kernel | New `src/simulation/open/` scheduler, operation/resource and synchronous-execution modules, with their focused tests | Exact event ordering, queue/deadline accounting, fan-out and deterministic replay tests pass |
| 2b. Routing/cache | Only assigned router/cache modules and tests under the new runtime directory | Weighted/conditional routing, finite-cache fill/expiry and failure tests pass |
| 2c. Messaging | Only assigned broker/message modules and tests under the new runtime directory | Admission vs completion, competing consumers, pub/sub partial rejection, retries and expiry reconcile |
| 3. Model/persistence/results integration | `src/domain/model.ts`, `src/domain/results.ts`, `src/domain/metrics.ts`, `src/domain/workload.ts`, `src/persistence/projects.ts`, worker/run hook and related tests | New model runs through the worker; copies leave old records intact; new round trips and saved-result validation pass |
| 4. Canvas grouping | Canvas/organization/subsystem components, new context-menu component, editor state actions and focused browser/unit tests | Rectangle selection → right-click → group, rename/collapse/ungroup and undo pass on desktop and touch |
| 5. Unified editor/examples | App, inspector, component rendering, optional examples/tutorial components and factories, exports and their tests | Empty-to-runnable flow works; no palette/mode gating; every shipped example runs and preserves editing features |
| 6. Verification/docs | Assigned regression tests and product/design/verification documentation | Full release checks below pass; lead completes final integration review |

Shared files such as editor state and styles belong to only the currently active packet. Later packets receive the integrated earlier version. The lead owns the spec and ACTION_LOG updates; implementation agents do not broaden scope into team collaboration, deployment or unrelated tooling.

## 7. Acceptance and verification

### Runtime and persistence

1. Build and run a mixed graph: web-client workload → gateway → two services → cache/storage, with an asynchronous queue/worker branch. No scenario selector or palette change is required.
2. Run two independently configured workloads through shared downstream capacity; seeded arrivals remain stable across architecture changes.
3. Parallel synchronous calls join correctly; shared downstream visits count as separate operations. Queue full, local failure, response failure and deadlines terminate each root once.
4. Async admission can succeed while eventual work fails. Pub/sub partial admission preserves accepted deliveries and reports rejection accurately.
5. A cache hit avoids its origin; misses fill only after live success; writes invalidate on success; expired operations never fill. Multiple caches reconcile independently.
6. Backoff occupies no slot; expired active work retains its resource until processing ends. An exact deadline/completion tie expires deterministically.
7. One-shot and chunked advancement match exactly, including pause/resume. Changing labels, layout, groups or tutorials does not change replay.
8. Root/message/operation conservation holds throughout execution, not just at the final sample. No per-edge or cache validator assumes visits are bounded by root count.
9. Invalid cycles/routes and unconfigured migrated edges identify the affected elements. Async feedback hits its TTL/hop limit explicitly; execution resource bounds return incomplete diagnostics.
10. Format-8 project/revision/result round trips retain executable semantics. Original browser records and format-7 exports remain unchanged; old results never masquerade as new-engine output.

### Browser and UX

11. Open a blank system, add from every catalog category, configure behaviors and run without selecting a starter. Optional templates/tutorials never restrict the palette.
12. Box-select nodes, right-click a selected member, name a subsystem and verify exact membership. Right-click an unselected node does not accidentally group the prior selection.
13. Group/rename/collapse/ungroup/move undo and redo atomically. Invalid or overlapping selections are explained; cancel leaves no history entry.
14. Context menus remain inside the viewport and work via touch action and keyboard. Form typing does not trigger grouping shortcuts or canvas panning.
15. Notes, relationships, exports, checkpoints and authored revisions remain functional; simulation metrics are attached to real components even when a group is collapsed.

Run focused Vitest and Playwright checks at each integration gate. Before completion, run `npm test`, `npm run build`, `TEST_PRODUCTION=1 npm run test:e2e` and `git diff --check`. Use the Impeccable UI detector once after UI implementation and visually inspect desktop/mobile selection, context menus, examples and inspector states. Update `PRODUCT.md`, `DESIGN.md`, `HANDOFF.md` and verification evidence only to reflect completed behavior and actual test results.

Specialized replication, database consistency, browser rendering/network stacks, autoscaling, stream partitions/replay, real application execution and shared team infrastructure remain separately scoped. The release delivers an open topology using explicit performance behaviors; it makes no claim of faithfully simulating every infrastructure technology.
