# Plan: validate that components and connections behave like the real thing

2026-09-30. Status: phases 1–2 done (see [realism-audit.md](realism-audit.md)); phase 3 next. Requested by the user after the RV-18 discussion showed that one catalog pairing (router → state machine) would have produced plausible but wrong results. Nothing here is implemented.

## Goal

For every catalog entry (catalog.md §2, 31 entries) and every connection kind (`call`, `message`, `data`), answer one question: **when someone builds a familiar architecture with it, does the run tell them what would really happen?** R13 ("truthful results") is the bar: a simplification is fine when it's honest and labelled; a result that looks right and is wrong is a defect.

Each entry and connection kind ends with a verdict:

| Verdict | Meaning | Action |
|---|---|---|
| **Faithful** | The mechanics match the real behaviour at the level the entry claims | None |
| **Simplified, honest** | Coarser than reality, and the difference can't change a pass into a fail for its intended use | Say so in the entry's "models" text and the Library detail |
| **Misleading** | A plausible design gets a wrong verdict, or a number that looks real is an artefact | Fix the model, change the default, reject the pairing in readiness, or remove the claim; each needs a user decision |

## What the simulator does today (from the code)

- **Arrivals:** Poisson (exponential gaps), with steady, burst or ramp rate profiles, or fixed intervals (`kernel.ts` ~770).
- **Service time:** deterministic, `1 / capacity` per slot. Storage uses `writeCapacity` for writes (`kernel.ts` ~1205). A resource is an M/D/c queue with a finite queue (`queueLimit`), retries (`maxRetries`, fixed `retryDelayMs`), a random `failureRate` and deadlines.
- **Routers:** round-robin, seeded weighted, or conditional by class or operation, with health-aware pools under faults.
- **Caches:** a fixed `hitRate`, or LRU over the request class's key distribution with `entries` and `ttlMs`.
- **Brokers:** competing (one consumer) or broadcast (one root per consumer).
- **Connections:**
  - `call`: `latencyMs` and `returnLatencyMs`, both 0 by default.
  - `message`: `latencyMs`, `ackDelayMs` (8) and `messageTtlMs` (2000).
  - `data`: pipelines only.

## Hypotheses to test first (suspected gaps)

Each is a claim to confirm or refute with evidence, not a conclusion:

| # | Suspect | Why it might mislead |
|---|---|---|
| H1 | Deterministic service time | Real services have variable service times with long tails; M/D/c under-predicts queueing delay and p95/p99 at the same utilisation, so latency checks pass too easily |
| H2 | `call` latency defaults to 0 ms | A five-hop synchronous chain costs nothing on the network; timeouts and latency budgets look generous |
| H3 | Base capacity 2000/s per slot (0.5 ms of work) for service, function, container and gateway | Orders of magnitude faster than typical request handlers, so designs look under-loaded |
| H4 | database, nosql, objectstore, search and warehouse share one storage model; reads and writes differ only by rate | Warehouse queries at 2000/s, and search indexing that costs the same as a key lookup, can't be right |
| H5 | dns and cdn are per-request caches "in front of one origin" | DNS isn't on every request path (it's cached by clients), and a CDN has many origins and objects. A fixed 80% hit rate ignores the key distribution unless LRU is chosen |
| H6 | firewall is a round-robin router | A firewall filters and forwards; it doesn't balance load |
| H7 | client, mobile and device are processors with capacity | A client doesn't queue on the server's behalf; a processor there can hide or add load |
| H8 | Retries use a fixed delay with no backoff or jitter | Real clients use backoff and jitter, and retry storms are a major failure mode; a fixed delay synchronises retries |
| H9 | Worker `queueLimit` 0 | A worker behind a queue normally pulls when free; a zero local queue plus broker semantics must not double-count or drop messages |
| H10 | Cache miss path and staleness | Check that misses reach the origin at `(1 − h)·λ` and that the TTL behaves like expiry, not eviction |

## Method

### 1. Claim audit (desk review, lead)

For each of the 31 entries, write down three things:
- what the entry claims (catalog "models" text, Library detail);
- which config fields and kernel mechanics back that claim;
- what the real component does in the situations people design for.

Tabulate the result in `specs/revamp/realism-audit.md`. Sources: the kernel code, contracts, and standard references:
- queueing theory (Little's law; M/M/c, M/D/c and Allen–Cunneen approximations);
- published engineering guidance on retries and backoff, load shedding, caching and queues.

Cite each source in the table.

### 2. Analytical oracles (automated, statistical)

Property tests that compare simulated metrics with closed-form results. Each runs many seeds and checks a confidence interval, not one run.

| Oracle | Setup | Expected |
|---|---|---|
| Little's law | Any stable resource | L = λ·W within tolerance |
| Throughput and saturation | One service, λ below and above c·μ | Throughput = min(λ, c·μ); beyond saturation the queue fills to `queueLimit`, then rejections ≈ λ − c·μ |
| Waiting time | M/D/c at ρ = 0.5, 0.8, 0.95 | Mean wait matches the M/D/c value (half the M/M/c wait for c = 1) |
| Retry amplification | failureRate p, maxRetries r | Attempts per request = Σₖ₌₀ʳ pᵏ; final failure share = pʳ⁺¹ |
| Deadlines | Timeout below service time plus queueing | The share of requests exceeding the deadline matches the waiting-time distribution |
| Cache | Fixed hit rate h; LRU with a Zipf-like hot set | Origin load = (1 − h)·λ; LRU hit rate within the expected range for its entries and key distribution |
| Routing | Round-robin, weighted w₁:w₂, conditional | Equal split; split in proportion to weights; class-exact split |
| Brokers | Competing with N consumers; broadcast to N | Load split across consumers; N× downstream load |
| Faults | Host down for D seconds with detection delay d | Failures ≈ λ_host·d at failure detection (λ_host = the load that host receives; recovery detection only reduces capacity); round-robin resumes on the healthy pool |
| Connection latency | A chain of k calls with latency ℓ each way | End-to-end latency grows by 2·k·ℓ |

These live next to the kernel's characterization tests in `src/simulation/open/`. They don't change the golden files.

### 3. Reference architectures (scenario library)

Twelve familiar designs, each with its expected outcome **written down before running**, then built from catalog entries with default settings and with realistic settings:

1. A cache in front of a database protects it under read load, and stops protecting it when the hit rate drops.
2. A queue absorbs a 5× burst: latency rises and workers drain afterwards, with no failures up to the queue limit.
3. Retry storm: an overloaded service with aggressive retries fails worse than without them.
4. Load balancer failover: errors during the detection delay, then recovery on the healthy instance.
5. Pub/sub fan-out multiplies downstream load by the number of subscribers.
6. A write-heavy mix saturates the database's write capacity before its read capacity.
7. Latency in a synchronous chain adds up across hops. A timeout shorter than the tail latency causes failures under load.
8. Hot keys: an LRU cache with a skewed key distribution hits more often than a uniform one.
9. A gateway in front of replicated services scales throughput with the replica count.
10. Async order flow (S05 pattern): API, then a state machine, then a queue, then a worker. Checkout latency is independent of the worker's speed.
11. Scheduled batch into a data pipeline: validation failures go to the error output.
12. A third-party boundary behind a service: a slow boundary response shows up as caller latency, and a failed one as caller failure.

Each becomes a fixture plus e2e-free runner tests. If a run contradicts the written expectation, one of these holds:
- the model is wrong;
- the default is wrong;
- the expectation was naive.

The audit records which, with reasons.

### 4. Defaults review

For each default (capacities, latencies, TTLs, retry settings, queue limits), check it against typical published orders of magnitude. Propose new values with their sources, keep the "assumption" marking, and make sure the UI shows these values as assumptions (R13).

## Outputs

- `specs/revamp/realism-audit.md`: a verdict per entry and per connection kind, with evidence (oracle results, reference-architecture runs, sources).
- A proposed change list. Each item is one of:
  - a model change (for example a service-time distribution, backoff with jitter, or a separate warehouse query cost);
  - a default change;
  - a readiness rule (like D45);
  - a Library text change;
  - removing a claim.

Each item goes to the user as a decision.

## Consequences to decide up front

- **Run identity.** Changing kernel behaviour or defaults changes results. If the kernel version is part of the run fingerprint, stored passing evidence becomes stale, and commits and publishes need reruns (D20/D27/D28). Batch model changes into one kernel version bump.
- **Golden files.** Model changes will intentionally change the 19 golden metric files. Each change needs a written reason in the ledger.

## Execution

| Phase | Work | Who |
|---|---|---|
| 1 | Claim audit and the hypothesis table filled in with evidence | Lead |
| 2 | Oracle property tests (statistical, many seeds) | Codex lane: precise maths and tests |
| 3 | Twelve reference architectures as fixtures, plus runner tests with written expectations | Gemini lane(s) |
| 4 | Audit report and change list for decisions | Lead, then an independent review |
| 5 | Approved changes, one kernel version bump, golden updates with reasons | Separate RV items after the decisions |

Phases 2 and 3 run in parallel after phase 1 fixes the expectations. Phases 1–4 change no product behaviour.

## Out of scope

Calibration against real production traces; multi-region, network partitions and autoscaling, unless the audit shows that a catalog claim implies them.
