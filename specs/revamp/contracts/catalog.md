# Standard component catalog contract — draft for approval (D39)

Status: APPROVED by the user 2026-09-25 with the resolutions below (D42). Where §1–§6 differ from a resolution, the resolution wins. Every value not lifted verbatim from `execution.ts` / `behaviorDefaults.ts` / `model-and-runner.md` / a reference fixture is marked **PROPOSED**. Nothing here is wired to code yet.

Sources read: decisions.md (D21,D35,D37,D38,D39,D41, Lead defaults), requirements.md (R01,R05,R07), model-and-runner.md §1–§5,§10, parts-and-export.md, commands.md §4, screens 12A/12B/12C/16E/2A/16A, `execution.ts`, `behaviorDefaults.ts`, `studio/model.ts`, `studio/validate.ts`, `studio/readiness.ts`, fixtures `s01–s05.json`.

## Approved resolutions (D42, 2026-09-25)

1. **Stripes (D35 extension):** state-machine indigo `#5A5B8C`, data-pipeline umber `#7A5C3E`, host charcoal `#3A3F3C` — three new groups of their own (each ≥ 5.6:1 on white and panel).
2. **thirdparty → Edge** (teal stripe). **custom → no stripe**, library group "Other".
3. **Schemas:** every placement gets its own fresh copy of the generic request/response schemas.
4. **Placement width:** 184 px, `expanded:false`.
5. **Message connection defaults:** `ackDelayMs 0`, `messageTtlMs 10000` (S02 values; assumptions, editable). Call defaults as §4.
6. **Library captions:** 1–3 hand-written tags per entry (`tags: string[]` on `CatalogEntry`), reviewed so they name only modeled behavior (e.g. no "autoscale").
7. **email, monitoring, analytics, secrets:** placeable as `unmodeled`, labelled "Not simulated" on the node and in the library.
8. **Connecting into a resource element:** drawing the edge opens a compact form for request class, read/write and deadline; the edge is stored only on confirm (one undo); Esc cancels it. No default deadline.
9. **Saved-part summary line:** the first three component kinds in saved order, then "+ n more".
10. **Node card second line:** before any run, `kind · key setting` (a configured value, never shown as a measurement); after a run of the selected scenario, measured values from that run only.
11. **Routes:** a router/broker is placed with one out port; dragging another connection from it adds a new out port for that route in the same command (one undo). The new port's channel is the one its target accepts (call or message), as in S02 — lead reading. **Messaging (D47):** a broker connected to a resource's in:call entry gets a new out:call route port (the S02/S05 consumer shape), even on its first route; a processor connected to a broker gets a new out:message port labelled `publish`. The canvas always drags from an element's first out port, so these ports are added by the gesture.
12. **traffic, client, mobile, device, scheduler:** diagram labels only — `unmodeled`, "Not simulated", no resource config. Scenario traffic enters at the next real component's entry port. The §2 rows for these five are superseded.

## 1. Catalog entry shape

```
CatalogEntry = {
  entryId: string,          // stable, catalog-local, NOT a Document/Id UUID — never placed as-is
  label: string,            // display name, becomes Element.label seed on placement
  category: CatalogCategory,// PROPOSED enum, see §2/open questions
  visualKind: VisualKind,   // one of the 32 values in studio/model.ts VISUAL_KINDS
  behaviorKind: BehaviorKind | 'none',  // 'unmodeled'|'resource'|'machine'|'pipeline'|'decision'|'host'|'none'
  ports: CatalogPort[],     // see below
  defaultConfig: object | null,   // behavior config seed; every number tagged "assumption"
  models: string,           // one line: what this entry actually simulates
  doesNotModel: string,     // one line: named gaps
  caption: { line1: string, line2template: string },  // node-card text, §5
}
CatalogPort = { label: string, direction:'in'|'out', channel:'call'|'message'|'data'|'event',
                schemaRef: 'generic-request' | 'generic-response' | 'none', responseSchemaRef: 'generic-response'|null }
```

- `entryId` is catalog-internal only. It never becomes an `Element.id`; placement always mints a fresh UUID (parts-and-export.md "fresh UUID mapping for all independently identified members").
- `ports[].schemaRef` names one of two **PROPOSED minimal generic schemas** the entry brings with it (no catalog entry defines a custom domain schema — that would misrepresent what a freshly dropped, unconnected component "knows"):
  - `generic-request` = `{type:'record', nullable:false, fields:[]}` (empty record; the emptiest legal `PayloadSchema` shape per §3).
  - `generic-response` = same shape, used only as a call port's `responseSchemaId`.
  - `none` = the port has no payload concept applicable (not used in v1; every port needs a schema per Port record, so this is reserved for future non-payload channels).
  - PROPOSED: these two schemas are inserted once per placed entry (never shared/reused across placements — parts-and-export.md: "Schema/fixture copies are detached even if content equal"), each getting its own fresh `PayloadSchema` id.
- `models` / `doesNotModel` satisfy R01 "components claim only the behavior they model" — every table row in §2 fills both.

## 2. Full entry list

Categories used below (see §6 open questions for the exact 6-layer mapping): **Clients, Edge, Compute, Messaging, Data, Operations**, plus three DECISION-NEEDED buckets for kinds D35 doesn't cover.

Legend: BK = behaviorKind. Ports shown as `dir:channel` pairs, generic schema on all call/message/data ports unless noted. "—" default config = no behavior config (host/unmodeled).

| Kind (visualKind) | Category | BK | Ports (in/out:channel) | Default config (source) | models | doesNotModel |
|---|---|---|---|---|---|---|
| traffic | Clients | resource(source) | in:call (entryPortId), out:call | capacity 2000/s, concurrency 1, queueLimit 500, failureRate 0, maxRetries 0, retryDelayMs 100 (`behaviorDefaults.ts` base+source) — **assumption** | An external arrival source issuing calls at a configured rate via a scenario workload | Real client devices, geography, think time |
| client | Clients | resource(processor) | in:call (entryPortId), out:call | base defaults, type processor — **assumption** | A generic upstream caller placeholder | Any UI, rendering, user behavior |
| mobile | Clients | resource(processor) | in:call (entryPortId), out:call | base defaults, type processor — **assumption** | Same as client, labelled for a mobile origin | Device constraints, offline behavior, native APIs |
| device | Clients | resource(processor) | in:call (entryPortId), out:call | base defaults, type processor — **assumption** | Same as client, labelled for an IoT/device origin | Hardware, firmware, connectivity loss |
| dns | Edge | resource(cache) | in:call, out:call | capacity 5000, mode fixed, hitRate 80, entries 100, ttlMs 10000 (`behaviorDefaults.ts` cache group) — **assumption** | A name-resolution hop modeled as a cache (hit/miss, ttl) in front of one origin | Real DNS propagation, anycast, record types |
| cdn | Edge | resource(cache) | in:call, out:call | same cache defaults — **assumption** | An edge cache in front of one origin | Geographic PoPs, real cache invalidation protocols |
| firewall | Edge | resource(router) | in:call (entryPortId), out:call ×1 at placement (see open question 11) | base defaults, strategy round-robin — **assumption** | A pass-through hop that can be given routing/failure config | Real rule evaluation, packet inspection |
| gateway | Edge | resource(router) | in:call (entryPortId), out:call ×1 at placement (see open question 11) | base defaults, round-robin (`behaviorDefaults.ts`) | An API gateway routing to one or more backends | Auth, rate limiting, protocol translation |
| balancer | Edge | resource(router) | in:call (entryPortId), out:call ×1 at placement (see open question 11) | base defaults, round-robin | A load balancer distributing across backends (round-robin/weighted/conditional) | Health-check protocols, L4 vs L7 specifics |
| service | Compute | resource(processor) | in:call (entryPortId), out:call (optional) | base defaults, type processor | A synchronous request handler with capacity/concurrency/failure/retry | Business logic, language runtime, real code paths |
| function | Compute | resource(processor) | in:call (entryPortId), out:call (optional) | base defaults, type processor | An invoked unit of compute, same accounting as service | Cold starts, packaging, real FaaS billing |
| container | Compute | resource(processor) | in:call (entryPortId), out:call (optional) | base defaults, type processor | Same as service, labelled for a containerized unit | Orchestration, scheduling, resource limits |
| worker | Compute | resource(processor) | in:call (entryPortId); terminal, no out port by default | capacity 100, concurrency 2, queueLimit 0, maxRetries 2 (`behaviorDefaults.ts` worker override) | A background/queue-consuming processor that returns its response via bridge settlement rather than an outbound edge | Job frameworks, real concurrency primitives |
| scheduler | Compute | resource(source) | in:call (entryPortId), out:call | base defaults, type source (`behaviorDefaults.ts`) | A timed/periodic arrival source, same accounting as traffic | Cron semantics, timezones, drift |
| state-machine | Compute (DECISION NEEDED) | machine | in:event ×N, out:call (optional) | states/transitions empty until authored — no behaviorDefaults entry; entirely author-supplied | Explicit state + event + guard + effect logic (S01 pattern) | Nothing hidden — behavior is 100% authored, no default states shipped |
| data-pipeline | Data (DECISION NEEDED) | pipeline | in:data, out:data, out:data(error) | operations empty until authored | An ordered validate/transform/aggregate row pipeline (S03 pattern) | Joins, loops, arbitrary code, streaming windows |
| database | Data | resource(storage) | in:call | capacity 500, writeCapacity 500 (`behaviorDefaults.ts`: database capacity override) — **assumption** | A relational-style store with read capacity and write capacity | Schemas, transactions, query planning, indexes |
| nosql | Data | resource(storage) | in:call | capacity 2000, writeCapacity 2000 — **assumption** | Same accounting as database, different label | Consistency models, partitioning, real query APIs |
| objectstore | Data | resource(storage) | in:call | capacity 2000, writeCapacity 2000 — **assumption** | Same storage accounting | Real object APIs, multipart upload, storage classes |
| search | Data | resource(storage) | in:call | capacity 2000, writeCapacity 2000 — **assumption** | Same storage accounting | Indexing, relevance ranking, query DSL |
| warehouse | Data | resource(storage) | in:call | capacity 2000, writeCapacity 2000 — **assumption** | Same storage accounting | Query engines, partitioned storage, ETL |
| queue | Messaging | resource(broker) | in:message (entryPortId), out:message ×1 at placement (see open question 11) | base defaults, delivery competing | A point-to-point broker: each message goes to one consumer route | Real broker protocols (SQS/RabbitMQ specifics), exactly-once semantics |
| stream | Messaging | resource(broker) | in:message (entryPortId), out:message ×1 at placement (see open question 11) | base defaults, delivery competing | Same broker accounting, labelled for a stream/log | Partitioning, offsets, replay, ordering guarantees beyond FIFO |
| pubsub | Messaging | resource(broker) | in:message (entryPortId), out:message ×1 at placement (see open question 11) | base defaults, delivery broadcast (`behaviorDefaults.ts`) | A fan-out broker: every consumer route gets its own message root (D36) | Real pub/sub protocol guarantees, subscription filters |
| email | Messaging | unmodeled | in:message | reason: "External email delivery is not simulated" | A named external notification sink | Any delivery, deliverability, templating |
| monitoring | Operations | unmodeled | in:data | reason: "Telemetry ingestion is not simulated" | A labelled observability sink for diagramming | Metrics collection, alerting, dashboards (D16: no engine change for a visual) |
| analytics | Operations | unmodeled | in:data | reason: "Analytics ingestion is not simulated" | A labelled analytics sink for diagramming | Any aggregation, reporting |
| secrets | Operations | unmodeled | in:call | reason: "Secret storage/retrieval is not simulated" | A labelled secrets-manager placeholder | Any security behavior, rotation, access control |
| thirdparty | Edge (DECISION NEEDED) | unmodeled | in:call | reason: "External third-party behavior is not simulated" (matches S02/S05 fixtures, which place `thirdparty` as `unmodeled`) | A named external dependency boundary — pairs with a `Boundary` fixture to script canned responses | Any real external behavior; nothing runs without an authored boundary |
| custom | — (no default; DECISION NEEDED) | unmodeled | none by default | reason: "Custom node has no modeled behavior until configured" | A free-form placeholder the author must fully configure or leave diagram-only | Everything, until the author adds ports/behavior via the inspector |
| host | Operations (DECISION NEEDED) | host | none | — (host has no fields; availability comes from scenario `Fault` schedule) | A deployment target that `deployed-on` relations attach resources to, and that scenario faults can take down | Real infrastructure provisioning, networking, capacity of the host itself |

**Every `resource`-behavior row above carries an inbound `entryPortId` port**, including the four Clients rows and `scheduler`. `ResourceBehavior = {kind:'resource',version:1,config,entryPortId}` (`studio/model.ts` ~837–843) makes `entryPortId` a required field on every resource, and model-and-runner.md §4 "Wiring" defines it as "an inbound call/message port" unconditionally — the `type` variant (`source` vs `processor` vs …) never exempts an element from having one. §6 "Workloads … can target only resource entry ports" is the other half: a `traffic`/`scheduler` row is only reachable by a scenario workload at all if it exposes that inbound port. No reference fixture (S01–S05) actually places a standalone `traffic`/`client`/`scheduler` node — every scenario's `Input.entry`/workload `entry` instead targets the *first real* element's own inbound port directly (e.g. S02/S05 target the checkout machine's inbound `call`/`event` port; S04 targets the balancer's inbound `call` port). That absence is carried into open question 12 below rather than silently assumed away, since it calls into question whether these four Clients rows should exist as connectable resource elements at all.

`worker`'s single `in:call` port (no default out port) is taken from the one concrete precedent in the fixtures: `s02.json` and `s05.json` both model a queue-consuming worker as a `service`-kind element with exactly one port, `{direction:'in', channel:'call'}`, used as its `entryPortId` — the broker's own outbound port dispatches to it via a `call` edge (§8 "Bridge call frames"), not a `message` edge into the worker. There is no fixture evidence for `channel:'message'` on a worker's inbound port, so that option is dropped rather than offered as an "or".

Excluded from placement (diagram-only, never gets a behavior default): none beyond the `unmodeled` rows above — every VALID_KINDS member plus the three extra kinds has at least a diagram/`unmodeled` placement per this proposal. **PROPOSED**: `email`, `monitoring`, `analytics`, `secrets`, `thirdparty` ship as `unmodeled` (storable but not runnable) rather than "not placeable," since `unmodeled` is an explicit, honest, already-contracted behavior kind (§4: "reachable in a runnable scenario only behind a boundary fixture"). `custom` is the one true "you get nothing until you configure it" entry.

## 3. Placement rule

Placing a catalog entry (drag-drop, Component dock button, or Library "Place on canvas") compiles to exactly one `model.apply-records` command:

1. **Fresh IDs for everything nested**, generated client-side before the command is built (parts-and-export.md "fresh UUID mapping for all independently identified members," extended to catalog placement, per this task's instruction to reuse the same fresh-ID rule): the new `Element.id`, every `Port.id` on it, and — if the entry's `defaultConfig` needs one — the two generic `PayloadSchema.id`s (§1). Behavior-kind fields that self-reference a port (e.g. `resource.entryPortId`, `pipeline.inputPortId/outputPortId/errorPortId`, `decision.inputPortId`, `machine` ports) are filled in with the entry's own freshly minted port IDs — never left dangling.
2. **RecordChange batch**, one `model.apply-records` call:
   - `insert` for the new `Element` (includes its `ports` array and `behavior`).
   - `insert` for each new `PayloadSchema` the entry's ports reference (0–2 per entry: `generic-request`, and `generic-response` only for entries with a call port).
   - `insert`/`replace` for the current `View`: append one `Placement{id: fresh, elementId: newElementId, x, y, width, expanded:false}` to `placements`. (No `Connection`, `Relation`, `Fixture`, `Scenario`, or `Group` records are touched — a bare placement adds no wiring and no scope membership beyond "exists in this view.")
3. **One undo entry** — the whole batch is a single compound command per commands.md §4 ("One gesture or Apply = one compound command = one undo entry").
4. **Default placement width**: **PROPOSED** 240px (matches the 2A screen's node-card width band; no contract number exists yet — DECISION NEEDED, see §6). `expanded` starts `false`.
5. **Anchor**: drag-drop uses the drop point; dock/Library "Place on canvas" uses the current viewport center in canvas coordinates (mirrors `part.place`'s documented anchor default, commands.md §5).
6. **Readiness of a freshly placed, unconnected entry** (per readiness.ts's `READINESS_ISSUE_CODES` and model-and-runner.md §5):
   - It is always **storable** immediately (a lone element with self-consistent ports is structurally valid).
   - It is **not runnable** yet if the scenario's scope includes it and:
     - a `resource` entry has no inbound wiring to receive traffic from another element (no readiness *error* by itself — an element with zero incoming connections just never gets exercised; the scenario shows it as never-reached, not a validation failure);
     - a `machine`/`pipeline`/`decision` with an outbound `call` port whose response is never bound produces `unbound-call-response` only once the author starts wiring it into a scenario's compiled scope, not at bare placement;
     - `unmodeled` and `host` entries placed into a runnable scenario's scope trigger `unmodeled-element` unless reached only behind a `Boundary` fixture.
   - In short: **placement alone never fails readiness** (readiness only evaluates a scenario's compiled scope, §"checkReadiness(doc, scenarioId)"); the UI should instead show a neutral "Unconnected · not yet in any scenario flow" state on the node, not an error badge, until the author wires it and/or a scenario is compiled. This is a **PROPOSED** UX rule — no contract text currently defines a "just placed" visual state.

## 4. Connection defaults per connection kind

Connect (dock/gesture) infers the connection `kind` from the **channel of the port the author starts dragging from**, per model-and-runner.md §2/§4: `call`→`call` connections, `message`→`message`, `data`→`data`. There is no manual kind picker.

| Connection kind | May connect | Default config (source) | Rejected when |
|---|---|---|---|
| `data` | out:data port → in:data port, identical normalized schema shape | `{}` (model-and-runner.md §4: "`data`: `{}`") — no assumption, contract-fixed | channel mismatch; direction mismatch (out→out/in→in); incompatible shapes; duplicate `(kind, source port, target port)`; target already has a duplicate pair |
| `call` | out:call port → in:call port, identical shapes, target's `responseSchemaId` non-null and matching source's | `{latencyMs:0, returnLatencyMs:0, weight:1, condition:null, fallback:false, resource:null}` — **PROPOSED**, taken from fixture `s04.json` route config and `defaultExecutionEdge`'s pre-rewrite `latencyMs:0/returnLatencyMs:0` (the old `ackDelayMs`/`messageTtlMs` fields don't exist on `CallConnectionConfig` and are dropped) | channel/direction mismatch; incompatible shapes; missing/mismatched response schema; duplicate pair; would close a synchronous call cycle (§2: "Synchronous call cycles are rejected") |
| `message` | out:message port → in:message port, identical shapes | `{latencyMs:0, ackDelayMs:8, messageTtlMs:2000, weight:1, condition:null, fallback:false, resource:null}` — **PROPOSED**: `latencyMs`/`weight`/`condition`/`fallback` mirror the call defaults above; `ackDelayMs:8` and `messageTtlMs:2000` come from `behaviorDefaults.ts:defaultExecutionEdge` (legacy code, carried forward as the only numeric precedent — fixture `s02.json` instead shows `ackDelayMs:0, messageTtlMs:10000` for one specific scenario edge, which is scenario-authored, not a shipped default; **flagged conflict, needs a decision**, §6). `resource` stays `null` by default and is only required (non-null `ResourceCallMetadata`) when the target is a `resource`-behavior element — **the UI must prompt for `requestClassId`/`operation`/`deadlineDurationMs` at connect time in that case**, since there is no honest default deadline to invent | same as `call`, minus the cycle rule (message cycles are allowed under finite runtime budgets, §2) |

Never connectable via Connect, in any kind: `event`-channel ports. Outbound event ports "can't be wired" (§4); inbound event ports receive input only from a `machine`'s own `responseBindings`/`schedule-event` effect (same element) or from a scenario's `Input`/boundary response — never from a drawn edge. The Connect gesture must not offer an event port as a valid drop target.

## 5. Library display mapping (12A/12C)

**List/grid row caption** (12A/12B): `{label}` (bold) + one line of up to 2–3 lowercase field tags joined by `·`, e.g. `http · autoscale` for Service, `fifo · retries` for Queue. **PROPOSED mapping**: for `resource` kinds, tag 1 = a short behavior-type label (`processor`→ nothing shown/omitted, `storage`→"relational"/"append only" style hint per kind — cosmetic, not modeled), tag 2 = a defining default (e.g. `mode`, `delivery`, `strategy`). For `machine`/`pipeline`, tags are fixed placeholder text ("state machine" / "data pipeline") since there is no default config to summarize. This tag text is decorative UI copy, not a modeled field — **DECISION NEEDED** on whether it's hand-authored per entry or generated from `defaultConfig` keys (§6).

**Hover/focus detail (12C)** — fields that exist, in order, excluding Owner/Used-in/team per design-revalidation.md §2 (D35 area) and R07:
- Category badge (`MESSAGING`, `COMPUTE`, …) + `STANDARD` badge (vs a saved-part "Ours" badge with its `v{revision}`).
- `label` (title).
- `models` (one line, from §1) — replaces the screen's free-text description; this is the honest one-liner, not marketing copy.
- `DEFAULTS` row: a flattened `key value` list from `defaultConfig` (e.g. `capacity 2000/s`, `queueLimit 500`) — every value here must already be tagged assumption in §2/§6, so the label is literally `DEFAULTS · …` per the footer convention below, not `CONFIGURATION` (that word is reserved for the inspector's applied config, per 2A).
- `doesNotModel` row (**PROPOSED addition**, not in the 12C mock) — one line under a `DOES NOT MODEL` label, since R01 requires the claim to be visible where the entry is chosen, not just in this document.
- Removed from the mock entirely: `OWNER`, `USED IN`, `FAILURES GO TO` (that field described dead-letter routing, which is not a modeled field on any current behavior/config — including it would be inventing a capability; a real dead-letter path only exists if the author wires a second outbound message edge and labels it themselves).
- Footer: `DEFAULTS · {same flattened defaults as above}` then the `Place on canvas` action — matches 12A/12C's bottom bar exactly, reusing the same string as the detail's `DEFAULTS` row so there is only one source of truth for that text.

Saved parts ("Ours") reuse the identical row/detail shape (`STANDARD`→`v{revision}` badge, `DEFAULTS`→a summary of the part's dominant element or count, per the 12C "Retry envelope v2 / queue + worker + dlq" example), since R07 requires the dock/panel/Library to share one content model.

## 6. Open questions

1. **Six-layer mapping for `state-machine`/`data-pipeline`/`host`.** D35 names six layers (clients, edge, compute, messaging, data, operations) but never assigns these three. Recommendation: `state-machine`→Compute, `data-pipeline`→Data, `host`→Operations (a new seventh row, since none of the six semantically fit a physical/virtual host — Operations is the closest existing bucket for "infrastructure control plane" reasoning). Needs explicit sign-off since it also decides stripe color.
2. **`thirdparty` and `custom` category.** Neither maps cleanly onto D35's six layers (they're cross-cutting, not domain-specific). Recommendation: `thirdparty`→Edge (it's always a boundary-crossing dependency in the fixtures); `custom` gets no fixed category — it's placed under whatever category the author picks at creation time, or a seventh "Other" bucket.
3. **Generic schema reuse vs. per-placement copy.** §1 proposes minting a fresh, unshared `PayloadSchema` pair per placement (safest, matches "detached copies" language in parts-and-export.md written for parts). Alternative: a single project-wide "generic" schema reused by reference across every placed entry, which is cheaper but means editing one shared schema's shape later would (correctly, but perhaps surprisingly) affect every entry that used it. Recommendation: per-placement copies, as drafted.
4. **Default placement width (240px) and `expanded:false`.** No contract number exists for a freshly placed single element's `Placement.width`. Recommendation: 240px, aligned to the 2A screen's node-card band; needs a measured value from the actual (not mock) rendered node component once built.
5. **Message connection default conflict.** `behaviorDefaults.ts`'s legacy `defaultExecutionEdge` (`ackDelayMs:8, messageTtlMs:2000`) disagrees with fixture `s02.json`'s scenario-authored edge (`ackDelayMs:0, messageTtlMs:10000`). Recommendation: keep the legacy numbers as the *shipped default* (fixtures are scenario content, not catalog defaults, per architecture.md §2's "assumptions, not facts" framing applying to defaults specifically) — but this should be an explicit confirmation, not an assumption baked in silently.
6. **Library row tag text (12A "http · autoscale" etc.).** Is this generated mechanically from `defaultConfig` keys, or hand-authored per entry for readability? Recommendation: hand-authored short strings stored on the catalog entry itself (a `tags: string[]` field added to `CatalogEntry`, not shown in §1's shape above pending this decision), since mechanical generation of `defaultConfig` produces unreadable strings like `capacity 2000` for every processor-type entry and loses the "autoscale"/"fifo" flavor text the mocks show.
7. **`unmodeled` vs "not placeable" for `email`/`monitoring`/`analytics`/`secrets`.** §2 proposes shipping these as placeable `unmodeled` entries (diagrammable, runnable only behind a boundary). Alternative: exclude them from the catalog entirely as "not yet supported," forcing `custom` instead. Recommendation: keep them placeable-as-`unmodeled` — R01 already contracts `unmodeled` as an honest, storable behavior kind, and hiding common infra-diagram vocabulary (monitoring, secrets) would make ordinary system diagrams impossible to draw.
8. **Connect-time resource metadata prompt.** §4 flags that connecting anything into a `resource` element needs an interactive prompt for `ResourceCallMetadata` (no honest default `deadlineDurationMs` exists) rather than a silent default. This is a UX flow, not just a data default, and needs explicit design (a small inline form on the just-drawn edge?).
9. **Saved-part "DEFAULTS" footer text for multi-element parts.** §5 proposes summarizing a saved part's "dominant element" per the 12C mock (`queue + worker + dlq`), but there's no rule for what counts as dominant when a part has many peer elements. Recommendation: list every top-level (non-nested) element's kind, comma-joined, truncated with "+N more" past 3.
10. **Node-card caption on the canvas (2A, distinct from Library captions).** 2A shows measured-looking text (`p99 180ms`, `8 replicas`) that reads like live metrics, not defaults — but per R05 "Node metrics show observed values, never configured capacity as throughput," a freshly placed unrun element must not show any such line. Recommendation: the canvas card's second line shows `{VISUALKIND-LABEL} · {one default}` (e.g. `SERVICE · concurrency 1`) before any run, and switches to a measured line only after a run has produced metrics for that element — needs explicit confirmation since it changes the always-on caption the mocks imply.
11. **Route count per placed router/broker entry (gateway/balancer/firewall/queue/stream/pubsub).** §4's wiring text says only "Multiple ports are legal, but selected routes are always explicit edges, never inferred from drawing order" — it does not say whether N routes need N distinct out ports or one out port carrying N connections. The one concrete precedent, `s04.json`'s balancer, has two separate `out:call` ports for its two routes (each with exactly one connection), which is what §2 now cites — but that fixture doesn't establish a rule, just one author's choice. Recommendation, pending confirmation: ship every router/broker entry with exactly **one** out port at placement time; adding a second route requires the author to add a second out port explicitly via the inspector (mirroring the S04 precedent), rather than the Connect gesture silently multiplying ports when a second edge is dragged from the same handle. Separately, `s02.json`'s only modeled broker consumer route uses an `out:call` port (a resource→non-resource bridge, §8), not `out:message` as this draft's queue/stream/pubsub rows assume — that channel choice is unconfirmed by any fixture showing a plain resource→resource message-typed broker route, so treat the `out:message` default itself as unverified alongside the port-count question.
12. **Do `traffic`/`client`/`mobile`/`device`/`scheduler` need to exist as placeable resource elements at all?** No reference fixture (S01–S05) places a standalone source/traffic/client node — every scenario enters directly at the first real behavior element's own inbound port (§2 note above). This draft still gives these five rows a valid `entryPortId` port so the record the validator sees is never invalid, but whether they should ship as connectable resource nodes (representing an abstract "front door" with its own capacity/failure config) or as non-modeled diagram labels with no behavior at all is a product decision this document can't settle from the contract alone.

Open-question count: **12**.

**D49 defaults (realism audit, supersede the table's numbers where they differ).** Every value is an **assumption**, shown in the Library's DEFAULTS line and the inspector.
- Resources: `serviceTime:'exponential'`; concurrency 64 for processors, routers and caches (a request thread/worker pool); worker keeps capacity 100, concurrency 2, queue 0, 2 retries.
- Storage: database read 500/s, write 200/s, concurrency 10; nosql/objectstore read 2000/s, write 1000/s, concurrency 16; search read 1000/s, write 100/s (indexing), concurrency 8; warehouse read 2/s (500 ms queries), write 1/s, concurrency 4, queue 100.
- Cache/cdn: LRU mode, 1000 entries, TTL 60 s (fixed mode stays available and ignores keys).
- Brokers: queue limit 10,000 retained messages; stream delivery is `broadcast` (every consumer route gets every event); queue stays `competing`.
- DNS: unmodeled (diagram only). Clients cache lookups, so DNS isn't on the per-request path.
- Connections: `call` latency 2 ms each way and `retry:null`; `message` latency 2 ms and TTL 300,000 ms (5 minutes).
- Labels: state machines and pipelines take no processing time in timed runs; nosql/objectstore/search/warehouse state their own model.

**Note on `behaviorDefaults.ts` as a source.** Every number cited above from `behaviorDefaults.ts` (capacity, concurrency, queueLimit, cache hitRate/entries/ttlMs, worker overrides, `defaultExecutionEdge`'s latency/ack/ttl fields) comes from the old, pre-rewrite app that D37 marks wholly disposable ("The whole old UI and its functionality are disposable … no adapters from the legacy `Graph`/editor/canvas"). It is kept here only because it is the sole numeric precedent in the repository for these defaults — it carries no authority beyond that, and every value drawn from it is still marked **assumption**, not fact, per architecture.md §2.

RESULT: DONE
