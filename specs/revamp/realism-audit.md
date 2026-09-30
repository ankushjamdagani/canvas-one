# Realism audit

Phases 1–3, 2026-09-30. Plan: [plan-realism-validation.md](plan-realism-validation.md).
- Phase 2 (oracles): the kernel matches queueing theory everywhere it was tested.
- Phase 3 (reference architectures) found that phase 1 probed the wrong defaults (see "Correction to phase 1"). It also found eight runner, metric and connect defects, B1–B8, and they come ahead of the modelling issues in "Ranked issues".

The per-entry verdicts below are phase 1's, with the phase 3 corrections noted where they differ.

Evidence comes from three places:
- **Kernel code** (`src/simulation/open/kernel.ts`, `src/domain/execution.ts`, `src/domain/behaviorDefaults.ts`).
- **Contracts** (catalog.md, model-and-runner.md).
- **Probes** in `src/simulation/open/realism-probes.test.ts`. They are skipped in the normal suite; run them with `REALISM_PROBES=1 npx vitest run src/simulation/open/realism-probes.test.ts --reporter=verbose --silent=false`. Probe numbers vary slightly between runs because `defaultWorkload` mints a random workload ID that feeds the seed; the app's stored IDs are stable.

## How a resource behaves (established)

| Mechanic | What the kernel does | Source |
|---|---|---|
| Arrivals | Poisson (exponential gaps) per workload; steady, burst or ramp; or fixed intervals | `kernel.ts` ~770 |
| Service time | Deterministic `1 / capacity` per slot; storage uses `writeCapacity` for writes | ~1205 |
| Slots | Up to `concurrency` ops in service, **1–16** (validation). Excess waits in a FIFO queue of `queueLimit` (0–10,000), then is rejected | `execution.ts` 137–138; `admitOp` |
| **Slot held while waiting** | After its own work, a resource keeps its slot until every downstream call or message acknowledgement returns (thread-per-request blocking) | `dispatchDownstream`, `handleChildResponse`, `completeLocalOp` |
| Failure and retry | `failureRate`% of the node's **own** attempts fail at random; the node retries itself after a fixed `retryDelayMs`, up to `maxRetries` (0–5). Rejections, timeouts and downstream failures are never retried | `handleProcessingCompletion` |
| Child failure | Any failed child fails the parent and cancels its siblings | `handleChildResponse` |
| Deadlines | A request expires at its workload `timeoutMs`. Queued work is dropped; work in service keeps running (wasted work); waiting parents release their slots | `expireUnit` |
| Messages | The publisher waits `latencyMs + ackDelayMs` for the ack. A message expires `messageTtlMs` after publish, including time spent queued. Its lineage deadline is the minimum of the TTLs along its path, not the originating request's timeout | `publishDelivery` |
| Brokers | Competing: one consumer per message. Broadcast: one copy per consumer route. Consumers pull when they have a free slot | `admitOp` broker branch, `reserveBrokerConsumer` |
| Cache | Inline read-through. `fixed` mode: each read hits with probability `hitRate`, **ignoring keys**. `lru` mode: real key-based LRU with `entries` and `ttlMs`. Writes invalidate. Misses go downstream and fill the entry on success | `handleProcessingCompletion` cache branch |
| Metrics | Mean and p95 latency (no p99), throughput, counts, utilisation | `LatencyCollector` |
| Limits | Run ≤ 300 s, ≤ 100 nodes, ≤ 200 edges | `compileExecution` |

## Probe results

| Probe | Setup | Result | Reading |
|---|---|---|---|
| E1 | One service, S = 100 ms, one slot, Poisson λ = 8/s (ρ = 0.8), 8 seeds | Mean wait 267–331 ms, p95 610–944 ms | Matches **M/D/1** (0.300 s). An M/M/1 service would give 0.500 s mean and about 1.5 s p95. The kernel is internally correct, but the service-time model has no variance (H1). |
| E2 | Default gateway → service; 50 ms links each way; service 160/s; load 50/s | **10 of about 2,900 requests succeed** (0.17/s); the rest expire | The gateway's one slot is held for the full round trip (~0.2 s), so it can pass at most ~5/s. Its FIFO queue then fills with requests already near their 2 s deadline, and goodput collapses. The collapse itself is realistic; a gateway that can hold one request at a time is not. |
| E2b | Same with gateway concurrency 16 (the maximum), 150/s | 4.6–4.9/s succeed; the rest expire | Even at the cap, a gateway passes at most 16 / round-trip, here ~80/s. Real proxies hold thousands of connections. |
| E3 | A default `client` element in the path, then a service over 50 ms links | Same collapse as E2 | Every user request funnels through one client element with ≤ 16 slots. |
| E4 | Overloaded service, queue 5, `maxRetries` 3 | About 640 failures, **0 retries** | Overload rejections are never retried, so retry storms and backoff can't be modelled. |
| E5 | API → queue → worker (20/s) at 60/s for 20 s, defaults | About 1,020 of 1,200 messages **expire in the queue**; the worker wastes slots on messages that expire mid-work | A 2 s default message TTL: a queue can't absorb anything longer than a 2 s backlog. Real queues retain for minutes to days. |
| E6 | Service → default database, 450/s | Throughput 450/s, utilisation 0.91 | The default database is one serialized slot at 500/s. That's plausible for simple queries, but with ≤ 16 slots a database whose queries take real time can't reach realistic concurrency. |

## Hypotheses (from the plan)

| # | Verdict | Evidence |
|---|---|---|
| H1 deterministic service time | **Confirmed** | E1 matches M/D/1. The tails are shorter than real systems', so p95 checks pass too easily. |
| H2 zero call latency by default | **Confirmed** | `defaultExecutionEdge`: `latencyMs` 0 and `returnLatencyMs` 0 |
| H3 service capacity 2000/s per slot | **Confirmed** | 0.5 ms of work per request. Harmless by itself, but see H11. |
| H4 one storage model for five kinds | **Confirmed** | database 500/s, the others 2000/s, all with read = write cost |
| H5 dns and cdn as inline caches | **Confirmed**, and fixed mode ignores keys | Code |
| H6 firewall as round-robin router | **Confirmed** | `defaultBehavior('firewall')` |
| H7 client, mobile and device as processors | **Confirmed, severe** | E3 |
| H8 fixed retry delay, no backoff or jitter | **Confirmed, and wider than expected** | E4: see H13 |
| H9 worker with no local queue double-counts or drops | **Refuted** | E5: the worker pulls at its capacity; losses come from the TTL, not the worker |
| H10 cache miss path | **Confirmed correct** by code: misses go downstream, fill on success, writes invalidate | Phase 2 oracle to prove it numerically |

New findings:

| # | Finding | Evidence |
|---|---|---|
| H11 | **Slot held during downstream waits + concurrency cap of 16.** Throughput of any element that calls downstream is capped at 16 / round-trip latency. Correct for a small thread pool; wrong for gateways, balancers and firewalls (event-driven, thousands of connections); tight for services (real pools run 50–500). | E2, E2b, E3 |
| H12 | **Message TTL default 2 s includes queue time.** Queues and streams lose work instead of buffering it. | E5 |
| H13 | **Retries are server-side and only for the node's own random failures.** Callers never retry rejections, timeouts or failures, so the most common overload failure mode (retry amplification) can't appear. | E4, code |
| H14 | **stream uses competing delivery.** A stream with two consumer services (billing, analytics) splits events between them. A real log gives every consumer group every event, and competes only within a group. | `defaultBehavior('stream')`; the D36 broadcast rule exists only for pubsub |
| H15 | **State machines and pipelines take zero time in timed runs**, and bridge frames add only link latency. Honest only if stated. | Contract §8; no machine capacity fields |
| H16 | **Source config fields are ignored.** traffic and scheduler carry capacity, concurrency and queue fields that do nothing. | `admitOp` source branch |
| H17 | **Expired in-service work keeps running (wasted work) while queued expired work is dropped.** Realistic for most servers; keep it. | `expireUnit` |

## Verdict per catalog entry (provisional)

Legend: **F** faithful · **S** simplified, honest · **M** misleading.

| Entry | Claim (catalog) | Verdict | Why | Direction |
|---|---|---|---|---|
| traffic | Arrival source at a rate | S | Poisson arrivals are a good default. Capacity/queue fields are inert (H16). | Hide the inert fields |
| scheduler | Timed or periodic source | S | Same as traffic; "periodic" relies on the workload interval | Hide the inert fields; state that it's the workload that sets timing |
| client, mobile, device | Upstream caller placeholder | **M** | A processor in the path throttles all users through ≤ 16 slots (E3) | Make them pass-through (no slot), or unmodeled/diagram-only |
| dns | Name resolution as a cache in front of one origin | **M** | DNS isn't a proxy; putting it inline makes every request "go through" DNS to the backend | Diagram-only (unmodeled), or a latency-only hop with no capacity |
| cdn | Edge cache in front of one origin | S | Read-through cache is right. Fixed mode ignores keys; one origin. | Default to LRU or explain fixed mode; state "one origin" |
| firewall | Pass-through hop | **M** | Round-robin router with a slot held for the round trip (H11); a firewall doesn't balance | Pass-through filter with a latency and failure rate, no slot hold |
| gateway | Routes to backends | **M** | H11: at most 16 in flight, collapses under ordinary load with real latencies (E2) | Event-driven proxy: don't hold a slot while waiting, or a large separate in-flight limit |
| balancer | Distributes across backends | **M** | Same as gateway. The routing strategies themselves are right. | Same |
| service, function, container | Synchronous handler with capacity, concurrency, failure and retry | S → M | Thread-per-request is a real model, but the 16 cap and deterministic time understate queueing and cap throughput (H1, H11). Functions also have no cold start or per-instance scaling. | Raise the concurrency cap; add a service-time distribution; state that functions have no cold starts |
| worker | Queue consumer | S | Pulls at capacity (H9 refuted). Retries only its own random failures (H13). | Keep; fix via H13 and H12 |
| state-machine | Authored state logic | F (logic) / S (time) | Executes exactly what's authored; takes zero time (H15) | State "no processing time"; put a service in front for capacity (D45 pattern) |
| data-pipeline | Ordered row operations | F (logic) / S (time) | Same | Same |
| database | Read and write capacity | S | Plausible default, and read/write rates are separate. The 16-slot cap limits realistic concurrency. | Raise the cap; state the model (one rate per operation) |
| nosql, objectstore | Same accounting | S | Label only; defaults plausible for simple gets and puts | State "same model as database" |
| search | Same accounting | **M** | Indexing (writes) costs the same as a lookup; at 2000/s both ways | Lower default write capacity; state it |
| warehouse | Same accounting | **M** | 2000 queries/s with deterministic sub-ms time is off by orders of magnitude for analytical queries | Low default capacity (a few per second), or diagram-only |
| queue | Point-to-point broker | **M** | A 2 s TTL including queue time means it can't buffer (E5, H12) | Default TTL of minutes, and a clear "retention" label |
| stream | Stream or log | **M** | Competing delivery splits events between different consumers (H14) | Broadcast between consumer routes (per-consumer-group semantics), plus the TTL fix |
| pubsub | Fan-out broker | F | Broadcast gives one root per subscriber (D36). TTL issue as for queue. | TTL default |
| email, monitoring, analytics, secrets, thirdparty, custom | Not simulated | F (honest) | Unmodeled; reachable only behind a boundary fixture | None |
| host | Deployment target for faults | F | Outage windows, detection delays and a health-aware routing pool, per contract | None |

## Connections

| Kind | Verdict | Why | Direction |
|---|---|---|---|
| call | S → M by default | Latency and return latency are modelled correctly, but default to 0 ms (H2). The caller holds its slot for the round trip, which is right for synchronous calls; H11 is about the cap, not the link. | Non-zero defaults (a few ms in-region), labelled as an assumption |
| message | **M** by default | Publish-with-ack is modelled correctly. The 2 s TTL default makes queues lossy (H12). | TTL of minutes by default; "retention" label |
| data | F | Logical pipeline wiring; identical shapes; no timing claims | None |

## Phase 2: analytical oracles (2026-09-30)

`src/simulation/open/oracles.test.ts` (part of the normal suite, about 6 s). Every oracle runs over 6 seeds. Each tolerance is a 99% batch-means confidence interval plus an analytic sampling term, derived in comments and not tuned to pass. An M/M/1-style kernel would fail the M/D/1 checks by a wide margin.

| Oracle | Expected | Observed (mean over seeds) | Result |
|---|---:|---:|---|
| Little's law | λW = 2.535 | L = 2.556 | Pass |
| Throughput, stable / saturated | 6.00 / 10.00 per s | 6.07 / 9.99 | Pass |
| Rejections beyond saturation | 5.00/s | 4.99/s | Pass |
| M/D/1 mean wait, ρ = 0.5 / 0.8 / 0.95 | 0.025 / 0.100 / 0.475 s | 0.025 / 0.107 / 0.465 s | Pass |
| M/D/2 mean wait (Cosmetatos, ±5% approximation allowance) | 0.0088 / 0.0451 / 0.2321 s | 0.0090 / 0.0484 / 0.2460 s | Pass |
| Retry attempts per request (p = 0.3, r = 2) | 1.390 | 1.381 | Pass |
| Final failure share | 0.027 | 0.029 | Pass |
| Deadlines | all expire / all succeed as designed | same | Pass |
| Fixed-cache origin share (h = 70%) | 0.300 | 0.299 | Pass |
| LRU hot keys vs uniform | hot > uniform | 0.905 vs 0.099 | Pass |
| Weighted routing 1:3 | 0.250 | 0.249 | Pass |
| Conditional routing | class-exact | class-exact | Pass |
| Broadcast multiplier (3 consumers) | 3× | 3× | Pass |
| Fault detection-window failures | 40.0 | 39.8 | Pass |
| Four-hop call latency | 56.0 ms | 56.0 ms | Pass |

**Reading.** The arithmetic is right. What the audit ranks below are modelling choices and defaults: slot hold and cap, message TTL, caller retries, the service-time distribution, stream semantics and link latency. Fixing them won't mean fixing bugs.

**Fault accounting.** Failures from a detection delay are λ_host·d per failing host, where λ_host is the load that host receives. Behind a two-host round-robin router that's λ·d/2 for one failed host, which is what the oracle asserts. Recovery detection only reduces capacity: the host is already healthy, so it adds no failures. The plan's "λ·d at each transition" wording is corrected to this.

## Ranked issues for decisions

**All eight are adopted (D49, 2026-09-30, runner `studio-runner/4`).** See "Phase 5: modelling fixes" at the end. The text below is the original ranking.

Each item is for the user to decide. Items that change kernel behaviour or defaults change run results; batch them into one kernel version bump (see the plan, "Consequences").

**Defects B1–B5, B7, B8 and G1 are fixed (D47, 2026-09-30; runner version `studio-runner/2`, so earlier evidence is stale).** B9 is fixed too (D48, `studio-runner/3`). The modelling issues below still need decisions.

Modelling issues, updated by phase 3:

1. **H11 (gateway, balancer, firewall and client throughput collapse).** The most common architecture drawn in this app, clients → gateway or balancer → services, gives wrong failure verdicts at ordinary loads once links have realistic latency.
   - *Options:* (a) routers and client kinds don't hold a slot while waiting (event-driven proxy model); (b) raise the concurrency cap (e.g. to 1,024) and adjust defaults.
   - *Recommend:* (a) for router and client kinds, plus (b) for services and databases.
2. **H12 (message TTL: 10 s in the app, not 2 s as phase 1 said).** Queues buffer only about 10 s of backlog, and the default queue limit of 500 fills first (A2), so "a queue absorbs the burst", a core pattern, fails. *Recommend:* default TTL of 5 minutes for queue/stream edges; keep it editable and labelled.
3. **H13 (no caller retries).**
   - *Recommend:* a call-edge retry policy (max attempts, timeout, exponential backoff with jitter) applied by the caller to rejections, failures and timeouts.
   - The node-level random-failure retry would become the element's own failure behaviour only.
   - This is a model change with a contract update.
4. **H1 (deterministic service time).** *Recommend:* exponential service time as the default distribution (seeded per attempt, deterministic runs preserved), with "fixed" kept as an option.
5. **H14 (stream delivery).** *Recommend:* stream delivers to every consumer route (broadcast); queue stays competing.
6. **H2 (0 ms call latency).** *Recommend:* a small non-zero default (e.g. 2 ms each way), labelled as an assumption.
7. **Catalog relabels:**
   - dns → unmodeled or a latency-only hop;
   - warehouse and search defaults lowered;
   - state-machine and pipeline "no processing time" note;
   - inert source fields hidden (moot: traffic and scheduler are unmodeled in the app);
   - cdn fixed-mode note, and default caches to LRU, because fixed mode ignores hot keys (A8);
   - database write capacity below read capacity by default (A6).
8. **G1 (messaging can't be drawn): fixed (D47).** Services have only call ports, the catalog queue's output is `message` and the worker's input is `call`, so the canvas rejects service → queue and queue → worker ("Channel mismatch"). Only a state machine can publish (S02/S05). The catalog.md open item 11 already doubted the `out:message` broker default. *Recommend:* give processors an out:message port (or let Connect add one, as it does for router routes), and let a broker route into a processor's entry, with the kernel treating it as a message delivery.

## Phase 3: reference architectures (2026-09-30)

### Correction to phase 1: which defaults the app uses

The phase 1 probes built graphs from `src/domain/behaviorDefaults.ts`. Only tests import that file; the app never loads it. A studio document gets its defaults from `src/features/catalog/catalog.ts` (element config) and `src/features/catalog/connect.ts` (connection config). Scenario workloads come from `TrafficSection.tsx`: timeout 30 s, rate 1/s, steady only. The differences:

| Item | Phase 1 probe (`behaviorDefaults`) | App (catalog and connect) | Effect on findings |
|---|---|---|---|
| traffic, scheduler, client, mobile, device | Processors or sources with capacity | **Unmodeled**, diagram labels only (D42 resolution 12). Workloads enter a resource's entry port directly. | **H7 and H16 don't apply to the app.** E3 measured a graph the app can't build. |
| Message TTL | 2 s | **10 s**, still including queue time | H12 stands, but milder: a queue buffers about 10 s of backlog, not 2 s |
| Message ack delay | 8 ms | 0 ms | None |
| Call latency | 0 ms | 0 ms | H2 stands |
| Broker queue limit | — | 500 | New: a queue holds at most 500 waiting messages by default |
| Worker | — | 100/s per slot, 2 slots, 2 retries, no local queue | — |
| Gateway, balancer, firewall | 1 slot | 1 slot, 2000/s, queue 500 | H11 stands |
| Database | 500/s, 1 slot | 500/s read and write, 1 slot | Same |

Phase 3 builds every architecture with the app's own `placeEntry` and `planConnection`, so the defaults under test are the ones a user gets.

### Expected outcomes (written before running)

"Defaults" means catalog and connection defaults, with only the values the architecture needs (rates, and latencies where the architecture is about latency). "Realistic" means values a practitioner would pick: concurrency 16, links of a few ms, a queue TTL of minutes, and so on. Each test lists its exact values.

| # | Architecture | Real-world expectation | Prediction: defaults | Prediction: realistic |
|---|---|---|---|---|
| A1 | Cache in front of a database | At a hit rate that keeps the database below saturation, reads succeed. When the hit rate drops, the database saturates and requests fail. | Holds. The cache's one slot is held during misses, which lowers the load it can take. | Holds |
| A2 | Queue absorbs a 5× burst | During a burst the backlog grows; workers drain it afterwards; nothing is lost while the backlog is within the queue limit. | **Fails.** Broker queue limit 500 rejects publishes, and 10 s TTL expires waiting messages (H12). | Holds with TTL 300 s and queue limit 10,000 |
| A3 | Retry storm | An overloaded service with caller retries fails worse (more attempts, lower goodput) than without them. | **Can't be expressed.** Callers never retry, and `maxRetries` doesn't react to rejections (H13). Rejections identical with and without retries. | Same (model gap) |
| A4 | Balancer failover | Errors during the detection delay (≈ load on the failed host × delay), then all traffic succeeds on the healthy instance. | Holds | Holds |
| A5 | Pub/sub fan-out; stream with two consumers | Pub/sub: each subscriber receives every event. Stream: each consumer group receives every event. | Pub/sub holds. **Stream fails**: events are split between consumers (H14). | Same |
| A6 | Write-heavy mix on a database | Writes cost more than reads, so a write-heavy mix saturates sooner than a read-heavy one at the same rate. | **Fails**: read and write capacity default to the same value (500/s), so the mix doesn't matter. Default issue, not a model gap. | Holds with write capacity below read capacity |
| A7 | Synchronous chain and timeouts | Latency grows with hops (2 × hops × link latency). A timeout shorter than the tail causes expirations under load, and not under light load. | Latency part holds, but with 0 ms links there's nothing to add up (H2). With 5 ms links, a chain of 1-slot services **collapses** at modest load (H11). | Holds with concurrency 16 |
| A8 | Hot keys on an LRU cache | A skewed key distribution hits more often than a uniform one. | **Fails**: the default `fixed` mode ignores keys, so both hit 80%. | Holds in `lru` mode |
| A9 | Gateway in front of replicas | Throughput grows with the replica count until the gateway itself saturates. | **Fails**: a 1-slot gateway holds its slot for each backend call, so throughput stays flat as replicas are added (H11). | Holds up to the 16-slot cap, then flattens (H11 cap) |
| A10 | Async order flow (S05) | Checkout latency doesn't depend on the fulfilment worker's speed. | Holds: the reply is released before fulfilment | Holds |
| A11 | Batch into a pipeline | Rows that fail validation go to the error output; valid rows reach the result. | Holds (S03) | Holds |
| A12 | Third-party boundary | A slow boundary response shows as caller latency; a failed one as caller failure. | Holds, with the scripted delay as a constant | Holds |

Predicted defaults failures: A2, A3, A5 (stream), A6, A8, A9, and A7 once links have latency. That's more than the four phase 1 predicted; A6 and A8 are default issues, not model gaps.

### Results

All twelve were run on 2026-09-30. Tests: `src/domain/studio/runner/reference-architectures.test.ts` (29 tests, about 3 s, part of the normal suite; `REF_REPORT=1` prints one line per run). A run that differs from the real-world expectation is tagged in the test name and asserts today's behaviour, so the fix has to rewrite it.

| # | Defaults | Realistic | Observed | Cause |
|---|---|---|---|---|
| A1 | Holds at 80% hits. At 20% hits requests are rejected, but at the API service, not the database. | Holds | Default h20: database 70% busy, while the 1-slot API service fills its queue because it holds its slot for the whole miss path. Realistic: database utilisation goes from under 0.6 to 1.0, and latency rises about 70× (2.8 ms to 205 ms) as hits drop from 80% to 40%. | H11, B5 |
| A2 | **Fails** | Holds | Default: at 2× the worker rate, over 500 publishes are rejected and each fails its API request. With room in the queue, the 10 s TTL expires the backlog. Realistic (limit 10,000, TTL 5 min): no losses, backlog above 1,000. The "drains afterwards" half can't be run (B2, and only steady profiles exist). Not buildable in the app (G1). | Default queue limit, H12, G1 |
| A3 | **Can't be expressed** | Same | `maxRetries` 0 vs 3 under overload: identical rejections, zero retries. Node retries cover only the element's own random failures; callers never retry. | H13 |
| A4 | Holds | — | S04's topology with catalog defaults, 100/s: 47–51 failures per seed (expected 50), all inside the 1 s detection window, none after | — |
| A5 | Pub/sub holds; **stream fails** | Same | Pub/sub: 3 messages per request. Stream: 1, split between consumers. Not buildable in the app (G1). | H14, G1 |
| A6 | **Fails** | Holds | Default: 20% and 80% write mixes give identical results. Writes costing 5×: the write-heavy mix saturates and rejects. | Default |
| A7 | Trivially holds at 0 ms. **Collapses** with 5 ms links. | Holds | 0 ms: mean below 3 ms. 5 ms defaults: about 31/s pass at a 100/s load (1-slot hold for a 32 ms round trip) and the mean exceeds 1 s. Realistic: 32.0 ms mean, exactly 2 × 3 × 5 + 4 × 0.5. A 60 ms timeout expires requests at 90/s and none at 20/s. | H2, H11 |
| A8 | **Fails** | Holds | Fixed mode: hot and uniform keys hit identically. LRU: hot keys 87%, uniform 1%. | Default mode |
| A9 | **Fails** | Holds up to the cap | Default: 44/s with 1, 4 or 8 replicas. 16 gateway slots: 50 per replica, linear to 8. | H11 |
| A10 | Holds | Holds | Checkout reply at 10 ms with a 1 ms or a 1 s fulfilment worker | — |
| A11 | Holds | Holds | The schema-mismatch row goes to `errors`; totals are emitted | — |
| A12 | **Fails to run** | Same | A traffic-driven service calling a third-party boundary fails the run | B8 |

Predictions against results: ten of the twelve defaults predictions held. The two that didn't:
- **A1:** predicted to hold, but rejections land at the API service because of H11.
- **A12:** predicted to hold, but the run fails because of B8.

### Defects

Found while building the architectures. Each has a test tagged with its ID. **Status (D47):** B1–B5, B7 and B8 fixed (D47); B9 fixed (D48); B6 withdrawn.

| ID | Defect | Effect | Where |
|---|---|---|---|
| B1 | A workload whose entry is a queue passes readiness, then the run fails: "Cannot resolve journey for delivered message unit" | Traffic straight into a queue can't run. Reached with the G1 workaround; in the app a queue can't feed a worker at all. | `resource-adapter.ts` `registerMessageCreated` |
| B2 | Drain completion gives the kernel `deadlineMs` as the duration, so arrivals continue past `arrivalHorizonMs` to the deadline | Arrivals run the whole window, so burst-then-drain can't be expressed. A run with a backlog at the deadline ends `incomplete` (A2 exploration); a light one completes. The `arrivalHorizonMs` check only covers external inputs. | `scenario-runner.ts` 582 (duration), 1749 (inputs only); `resource-adapter.ts` 332 |
| B3 | `summary.rootCounts` counts only external-input roots. Workload roots appear only in the root metrics. | **The Results panel's roots and failures figures, the CSV export and every root-count assertion read 0 for traffic runs.** An assertion like "rejected = 0" passes with over 50 rejections. The drain check also reads `rootCounts.inFlight`, so drain can report completion while workload roots are unsettled, unless a pending kernel event holds it open. | `scenario-runner.ts` 165–175, 701, 1578, 2112; `ResultsRegion.tsx` 145, 240, 250, 398–407; `csv-export.ts` 229; `assertions.ts` 94 |
| B4 | A root rejected at admission is counted twice in the root metrics: once on the kernel's `rejected` fact and again on `unit_settled` | Rejections shown as double, and the counts no longer add up | `resource-adapter.ts` 555–557 and 566–579 (`admit()` at 708 counts once) |
| B5 | Element utilization counts only the element's own work, not a slot held waiting downstream | A service that rejects everything because its slots are held reads 2–20% busy | kernel utilization, adapter element metrics |
| B6 | *(withdrawn: a test error; `hotShare` is a percentage and the editor labels it so)* | — | — |
| B7 | The trace cap ends the run: default budgets (10,000 rows) stop any traffic run after about 1,300–1,400 requests with "Budget exhausted: recorder cap hit"; the maximum budget (100,000 rows, 16 MiB) stopped these tests' runs at about 42,000 rows, 16 MiB of trace | 50/s for 30 s can't complete on defaults. This follows storage.md §6 ("stop at the first cap"), so it's a contract decision. *Recommend:* past the trace cap, stop recording rows but keep running and counting, and mark the trace as truncated. | `scenario-runner.ts` recorder cap |
| B8 | A traffic-driven service calling a third-party boundary fails the run: "Bridge dispatch … referenced an unresolvable payload 'payload-workload'" | "Service calls Stripe" can't run under load | `scenario-runner.ts` 1705 (payload lookup); `resource-adapter.ts` 551, 562 set `'payload-workload'`, which has no payload |
| B9 | *(fixed, D48)* Metric assertions (`{kind:'metric'}`: throughput, latency, utilization) always return `unevaluated` ("unsupported in logical mode"), in timed mode too, so a scenario with one can never qualify | Latency and throughput checks, the natural checks for load runs, can't pass | `assertions.ts` `case 'metric'` |

**Fixes (D47):**
- **B1:** the kernel emits the root's `admitted` fact at a broker entry before publishing (`kernel.ts` `handleBrokerWorkloadEntry`).
- **B2:** the kernel takes an arrival horizon separate from the run duration; drain passes `arrivalHorizonMs`.
- **B3:** the adapter keeps workload-root counts; the runner adds them to `summary.rootCounts` and to its drain and live-root checks. So `maxLiveRoots` now counts workload roots too: a saturation run with more than the budget in flight ends `incomplete`, where before it ran on uncounted.
- **B4:** a root's `rejected` fact counts only generation; its `unit_settled` records the outcome.
- **B5:** element `utilization` is slot occupancy (the kernel's `occupancy`), so held slots count.
- **B7:** at a trace cap the recorder stops keeping rows and the run continues; `RunSummary.trace` records it and Results shows it; trace-count checks become unevaluated.
- **B8:** workload requests carry `{}`; a boundary answers a resource's outbound call and settles its bridge frame; workload traffic reuses the matching response.
- **G1:** Connect adds a `publish` out:message port (processor → broker) and an out:call route port (broker → call entry); the adapter delivers a broker's call route as a message.

Not a defect, but noted: a per-element count of generated, succeeded, rejected, failed and expired isn't among the element metrics; only queued, active and utilization are. The tests read per-root outcomes from the trace.

### Verdict changes from phase 1

- **client, mobile, device, traffic and scheduler:** H7 and H16 withdrawn. These are unmodeled in the app, so the verdict is F (honest).
- **queue and stream:** still M. The TTL is 10 s rather than 2 s; the default queue limit of 500 binds first (A2); stream delivery is H14 (A5). Neither can be drawn in the app (G1).
- **database:** S, but the write-heavy claim needs write capacity below read capacity by default (A6).
- **cache and cdn:** the LRU mode is F (A8); fixed mode is S → M as a default, because it can't show hot keys.
- **gateway, balancer and firewall:** M confirmed (A9); failover itself is F (A4).
- **service:** S → M confirmed (A7, A1).
- **state-machine and data-pipeline:** F for logic (A10, A11).
- **thirdparty:** F behind a machine; **broken behind a traffic-driven service** (B8).

## Phase 5: modelling fixes (D49, 2026-09-30)

The user adopted the recommendations. One runner version bump (`studio-runner/4`); stored documents keep their configs (absent `serviceTime` and `retry` mean fixed and none).

| Issue | Change | Evidence |
|---|---|---|
| H11 | Routers release their slot once they forward a request, and forwarded requests still fail with the router's host. The concurrency cap rises to 1,024, and defaults are pool-sized: processors, routers and caches 64; database 10; search 8; warehouse 4. | `model-d49.test.ts`: a one-slot gateway passes 150/s over 5 ms links. A9 on defaults scales linearly with replicas. A7 with 5 ms links holds 100/s. Goldens 03/04/05: only router occupancy changed. |
| H1 | `serviceTime: 'exponential'` (seeded per unit, path and attempt) is the default; `fixed` stays available. | M/M/1 oracle: mean wait ρS/(1−ρ) at ρ = 0.8 within the 99% interval; mean service time 1/capacity; chunk-independent. |
| H13 | Call connections take a retry policy: attempts, exponential backoff, full jitter, per-attempt timeout. Retries appear as `call-retry` trace rows. | Amplification 1 + p + p², final failures p³. Exact backoff timings. The timeout cancels abandoned work. Retry storm (A3): more load, no more goodput, higher latency. Caller retries recover transient failures. |
| H12 | Message TTL 5 minutes; broker queue limit 10,000 | A2 on defaults: a 2× burst queues and drains with nothing lost |
| H14 | Stream delivery is broadcast | A5: 3 messages per request for both stream and pub/sub |
| H2 | 2 ms default call and message latency | A7 on defaults: 14 ms over four hops (2 × 3 × 2 + 4 × 0.5) |
| Defaults | Database write 200/s against read 500/s; search indexing 100/s; warehouse 2 queries/s; LRU caches (1,000 entries, TTL 60 s); DNS unmodeled; label notes | A6: a write-heavy mix saturates first. A1: a cache that holds the working set protects the database, and an outgrown one lets it saturate. A8: LRU hot keys 87% against uniform 10%. |

**Verdicts after D49:**
- gateway, balancer and firewall: M → F for throughput;
- service, function and container: S (thread-per-request with 64 slots is a real model);
- queue: S (TTL, limit and retention are real knobs);
- stream: M → S (broadcast; no consumer groups within a route);
- dns: M → F (honest, unmodeled);
- search and warehouse: M → S;
- cache and cdn: S;
- `call`: S (latency and retries modelled).

**Limits that remain (labelled):**
- Retries don't apply to calls that leave the kernel to a boundary, or to broker deliveries.
- There is one service-time distribution family (exponential), with no heavy tails.
- Load balancers retry on the same route.
- Workload profiles are steady only.
