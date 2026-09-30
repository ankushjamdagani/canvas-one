# Realism audit

Phase 1 (claim audit), 2026-09-30, `master`. Plan: [plan-realism-validation.md](plan-realism-validation.md). Phases 2 (oracles) and 3 (reference architectures) haven't started; the verdicts below are **provisional** until they confirm them.

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

## Ranked issues for decisions

Each item is for the user to decide. Items that change kernel behaviour or defaults change run results; batch them into one kernel version bump (see the plan, "Consequences").

1. **H11 (gateway, balancer, firewall and client throughput collapse).** The most common architecture drawn in this app, clients → gateway or balancer → services, gives wrong failure verdicts at ordinary loads once links have realistic latency.
   - *Options:* (a) routers and client kinds don't hold a slot while waiting (event-driven proxy model); (b) raise the concurrency cap (e.g. to 1,024) and adjust defaults.
   - *Recommend:* (a) for router and client kinds, plus (b) for services and databases.
2. **H12 (message TTL 2 s).** Queues can't buffer, so "a queue absorbs the burst", a core pattern, fails. *Recommend:* default TTL of 5 minutes for queue/stream edges; keep it editable and labelled.
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
   - inert source fields hidden;
   - cdn fixed-mode note.

## Next (phases 2 and 3)

- **Phase 2 oracles:** the formulas in the plan, asserted against the **current** kernel where it is internally correct (Little's law, M/D/c waiting, routing splits, broadcast fan-out, cache origin load, fault windows). The probes above show the kernel is internally consistent. The issues are modelling choices and defaults, not arithmetic bugs.
- **Phase 3 reference architectures:** the twelve in the plan, run on today's defaults and again with realistic settings. Expected outcomes are written before running. Architectures 2 (queue absorbs a burst), 3 (retry storm), 9 (gateway scaling) and 10 (async order flow) are expected to **fail on today's defaults** because of H11, H12 and H13. That confirms the ranking above.
