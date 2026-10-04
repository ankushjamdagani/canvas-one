# Configuration reference

Every configurable thing in a project, by node and by connection, with what it does, its default and its range. This
page describes the model as built (D52–D54); the contracts it summarizes are [model-and-runner.md](contracts/model-and-runner.md),
[connection-protocols.md](connection-protocols.md) and [port-settings.md](port-settings.md). The tables for node kinds
and defaults are generated from the catalog (`features/catalog/catalog.ts`); ranges come from the validator
(`domain/studio/validate.ts`).

## 1. Where configuration lives

| Level | What it describes | Edited in |
| :--- | :--- | :--- |
| Project | title, description, team, exposed endpoints | Project menu → Project settings / Exposed endpoints |
| Node | label, description, behavior (what the runner simulates) | Inspector → Configuration |
| Port (in) | what a callee declares and, on simulated nodes, how an endpoint behaves | Inspector → one group per port |
| Port (out) | how a caller calls one downstream endpoint (simulated nodes only) | Inspector → one group per port |
| Connection | the link and the route | Inspector (select the connection) |
| Scenario / workload / fault | what is run and under what conditions | Scenario editor (not covered here) |

A port is one endpoint of a node: a channel (`call`, `message`, `data`; `event` ports belong to state machines and cannot
be connected), a protocol, an optional path or name, and optional settings. Connecting two nodes picks or adds the
matching port on each side (D53).

## 2. Node behaviors

A node's `behavior` decides how much of it is simulated.

| Behavior | Nodes | Editable configuration |
| :--- | :--- | :--- |
| `resource` | services, stores, caches, brokers, gateways, balancers, workers, linked projects | The resource config in section 3, and the port settings in section 5 |
| `unmodeled` | clients, mobile, devices, DNS, third parties, scheduler, email, monitoring, analytics, secrets, custom | A reason (free text). Inbound ports can declare a contract; outbound ports are read-only (their calls are a default read with a 60 s deadline) |
| `machine` | state machine | Read-only summary (states); editing arrives later |
| `pipeline` | data pipeline | Read-only summary (steps); editing arrives later |
| `decision` | decision | Read-only summary (cases); editing arrives later |
| `host` | host | Read-only; the nodes deployed on it fail with it under a fault |

A linked project is a `resource` with fixed processor behavior that nothing in this project can edit; its in-ports come
from the endpoints the linked project exposes.

## 3. Resource configuration

Common to every resource (a `serviceTime` of `fixed` takes exactly `1 / capacity` per request):

| Field | Meaning | Range |
| :--- | :--- | :--- |
| `capacity` | requests per second one slot serves | 1–100000 |
| `concurrency` | slots in parallel | 1–1024 (whole number) |
| `queueLimit` | requests that may wait when every slot is busy; beyond it they are rejected | 0–10000 (whole number) |
| `failureRate` | percent of attempts that fail | 0–100 |
| `maxRetries` | retries after a failed attempt | 0–5 (whole number) |
| `retryDelayMs` | wait before a retry | 0–10000 |
| `serviceTime` | `fixed`, `exponential` (variable) or `lognormal` (heavy tail) | one of the three |
| `serviceTimeCv` | stdev / mean for `lognormal` only | 0.1–10 |

Per resource type:

| Type | Extra fields | Range |
| :--- | :--- | :--- |
| `processor` / `source` | none | |
| `storage` | `writeCapacity`: writes per second | 1–100000 |
| `router` | `strategy`: `round-robin`, `weighted`, `conditional` | one of the three |
| `cache` | `mode` (`fixed` or `lru`), `hitRate` (percent, fixed mode), `entries`, `ttlMs` | hitRate 0–100; entries 1–100000; ttl 1–3600000 ms |
| `broker` | `delivery`: `competing` or `broadcast` | one of the two |

## 4. Node kinds

Defaults are what a node starts with when placed from the Library. `Ports` shows direction, channel and the default protocol.

| Node | Group | Behavior | Resource type | Ports | Default configuration |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Traffic Source (`traffic`) | Clients | unmodeled | — | out call (http) | — |
| Client (`client`) | Clients | unmodeled | — | out call (http) | — |
| Mobile Client (`mobile`) | Clients | unmodeled | — | out call (http) | — |
| IoT Device (`device`) | Clients | unmodeled | — | out call (http) | — |
| DNS (`dns`) | Edge | unmodeled | — | in call (http) | — |
| CDN (`cdn`) | Edge | resource | cache | in call (http), out call (http) | capacity 5000/s; concurrency 64; queue 500; failure 0%; service exponential; lru hit 80% entries 1000 ttl 60000 ms |
| Firewall (`firewall`) | Edge | resource | router | in call (http), out call (http) | capacity 2000/s; concurrency 64; queue 500; failure 0%; service exponential; strategy round-robin |
| API Gateway (`gateway`) | Edge | resource | router | in call (http), out call (http) | capacity 2000/s; concurrency 64; queue 500; failure 0%; service exponential; strategy round-robin |
| Load Balancer (`balancer`) | Edge | resource | router | in call (http), out call (http) | capacity 2000/s; concurrency 64; queue 500; failure 0%; service exponential; strategy round-robin |
| Third-Party Service (`thirdparty`) | Edge | unmodeled | — | in call (http) | — |
| Service (`service`) | Compute | resource | processor | in call (http), out call (http) | capacity 2000/s; concurrency 64; queue 500; failure 0%; service exponential |
| Function (`function`) | Compute | resource | processor | in call (http), out call (http) | capacity 2000/s; concurrency 64; queue 500; failure 0%; service exponential |
| Container (`container`) | Compute | resource | processor | in call (http), out call (http) | capacity 2000/s; concurrency 64; queue 500; failure 0%; service exponential |
| Worker (`worker`) | Compute | resource | processor | in call (http) | capacity 100/s; concurrency 2; queue 0; failure 0%; service exponential; retries 2 |
| Scheduler (`scheduler`) | Compute | unmodeled | — | out call (http) | — |
| Relational Database (`database`) | Data | resource | storage | in call (sql) | capacity 500/s; concurrency 10; queue 500; failure 0%; service exponential; write 200/s |
| NoSQL Database (`nosql`) | Data | resource | storage | in call (http) | capacity 2000/s; concurrency 16; queue 500; failure 0%; service exponential; write 1000/s |
| Cache Store (`cache`) | Data | resource | cache | in call (redis), out call (redis) | capacity 5000/s; concurrency 64; queue 500; failure 0%; service exponential; lru hit 80% entries 1000 ttl 60000 ms |
| Object Store (`objectstore`) | Data | resource | storage | in call (http) | capacity 2000/s; concurrency 16; queue 500; failure 0%; service exponential; write 1000/s |
| Search Engine (`search`) | Data | resource | storage | in call (http) | capacity 1000/s; concurrency 8; queue 500; failure 0%; service exponential; write 100/s |
| Data Warehouse (`warehouse`) | Data | resource | storage | in call (sql) | capacity 2/s; concurrency 4; queue 100; failure 0%; service exponential; write 1/s |
| Message Queue (`queue`) | Messaging | resource | broker | in message (amqp), out message (amqp) | capacity 2000/s; concurrency 64; queue 10000; failure 0%; service exponential; delivery competing |
| Event Stream (`stream`) | Messaging | resource | broker | in message (kafka), out message (kafka) | capacity 2000/s; concurrency 64; queue 10000; failure 0%; service exponential; delivery broadcast |
| Pub/Sub Topic (`pubsub`) | Messaging | resource | broker | in message (google-pubsub), out message (google-pubsub) | capacity 2000/s; concurrency 64; queue 10000; failure 0%; service exponential; delivery broadcast |
| Email Delivery (`email`) | Messaging | unmodeled | — | in message (amqp) | — |
| Monitoring Sink (`monitoring`) | Operations | unmodeled | — | in data (jdbc) | — |
| Analytics Ingestion (`analytics`) | Operations | unmodeled | — | in data (jdbc) | — |
| Secrets Manager (`secrets`) | Operations | unmodeled | — | in call (http) | — |
| State Machine (`state-machine`) | State Machine | machine | — | in event | — |
| Data Pipeline (`data-pipeline`) | Data Pipeline | pipeline | — | in data (jdbc), out data (jdbc), out data (jdbc) | — |
| Host Infrastructure (`host`) | Host | host | — | none | — |
| Custom Node (`custom`) | Other | unmodeled | — | none | — |
| Linked project (`linked-project`) | Other | resource | processor | none | capacity 2000/s; concurrency 64; queue 500; failure 0%; service exponential |

Notes: `custom` and `host` start with no ports (a custom node's ports are authored); a state machine's event ports are
internal and not connectable; a data pipeline's ports are data ports.

## 5. Port settings

`Port.settings` is omitted when empty. **Simulated** settings change a run (they enter the run's identity); **declared**
settings are expectations shown to callers and checked by advisories. Every simulated setting needs a `resource` node.

### In-ports (the callee)

| Channel | Setting | Kind | Meaning | Range |
| :--- | :--- | :--- | :--- | :--- |
| call | `expectedP95Ms` | declared | latency a caller can expect | 0–600000 ms |
| call | `availabilityPct` | declared | availability a caller can expect | 0–100 % |
| call | `idempotent` | declared | safe to retry or hedge (advisories only) | yes / no |
| call | `rateLimit {rps, burst}` | simulated | token bucket; calls beyond it are rejected | rps > 0; burst ≥ 1 |
| call | `failureRate` | simulated | replaces the node's failure rate for this endpoint | 0–100 % |
| call | `serviceTimeMs` | simulated | replaces `1 / capacity` as the mean service time | > 0–600000 ms |
| call | `maxConcurrency` | simulated | calls beyond this many in service or queued are rejected | 1–100000 |
| call | `responseBytes` | simulated | reply size; adds transfer time on a link with a bandwidth | > 0 |
| message | `ackDelayMs` | simulated | publisher is told "received" this long after arrival (default 0) | 0–60000 ms |
| message | `messageTtlMs` | simulated | a message expires this long after publication (default 5 min) | 1–3600000 ms |
| message | `delivery` | declared | at-most / at-least / exactly-once | one of three |
| message | `ordering` | declared | none / per-key / global | one of three |
| data | `throughputPerSec` | declared | | > 0 |
| data | `maxStalenessMs` | declared | | > 0 |

### Out-ports (the caller; resource nodes only)

| Channel | Setting | Meaning | Range |
| :--- | :--- | :--- | :--- |
| call | `retry` | attempts (1 = none), backoff, multiplier, max backoff, jitter, attempt timeout | attempts 1–10; backoff 0–60000 ms; multiplier 1–10; max backoff 0–600000 ms; timeout 1–600000 ms or none |
| call | `circuitBreaker` | consecutive failures to open (1–1000), open time (1–600000 ms), probes when half-open (1–100) | |
| call | `maxInFlight` | calls beyond this many outstanding fail fast | 1–1000000 |
| call | `hedge {afterMs}` | send an unanswered attempt again after this long; first success wins | 1–600000 ms |
| call | `requestBytes` | request size; adds transfer time on a link with a bandwidth | > 0 |
| message | `confirm` | wait for the receiver's acknowledgement (default yes) or fire and forget | yes / no |
| message | `batch {size, windowMs}` | hold publishes until `size` gather or the window passes, then send together | size 2–1000; window 1–600000 ms |
| message | `requestBytes` | message size | > 0 |

An unsimulated node's out-ports have no settings: what it sends is a default read with a 60 s deadline.

### Which node kinds get which settings

| Node | Port settings that apply |
| :--- | :--- |
| Traffic Source | out/call: none (read-only) |
| Client | out/call: none (read-only) |
| Mobile Client | out/call: none (read-only) |
| IoT Device | out/call: none (read-only) |
| DNS | in/call: declared contract |
| CDN | in/call: declared contract + endpoint behavior; out/call: caller policies |
| Firewall | in/call: declared contract + endpoint behavior; out/call: caller policies |
| API Gateway | in/call: declared contract + endpoint behavior; out/call: caller policies |
| Load Balancer | in/call: declared contract + endpoint behavior; out/call: caller policies |
| Third-Party Service | in/call: declared contract |
| Service | in/call: declared contract + endpoint behavior; out/call: caller policies |
| Function | in/call: declared contract + endpoint behavior; out/call: caller policies |
| Container | in/call: declared contract + endpoint behavior; out/call: caller policies |
| Worker | in/call: declared contract + endpoint behavior |
| Scheduler | out/call: none (read-only) |
| Relational Database | in/call: declared contract + endpoint behavior |
| NoSQL Database | in/call: declared contract + endpoint behavior |
| Cache Store | in/call: declared contract + endpoint behavior; out/call: caller policies |
| Object Store | in/call: declared contract + endpoint behavior |
| Search Engine | in/call: declared contract + endpoint behavior |
| Data Warehouse | in/call: declared contract + endpoint behavior |
| Message Queue | in/message: ack delay, TTL, declared delivery/ordering; out/message: confirm, batch, size |
| Event Stream | in/message: ack delay, TTL, declared delivery/ordering; out/message: confirm, batch, size |
| Pub/Sub Topic | in/message: ack delay, TTL, declared delivery/ordering; out/message: confirm, batch, size |
| Email Delivery | in/message: ack delay, TTL, declared delivery/ordering |
| Monitoring Sink | in/data: declared throughput/staleness |
| Analytics Ingestion | in/data: declared throughput/staleness |
| Secrets Manager | in/call: declared contract |
| State Machine | — |
| Data Pipeline | in/data: declared throughput/staleness; out/data: none (read-only); out/data: none (read-only) |
| Host Infrastructure | — |
| Custom Node | — |
| Linked project | — |

## 6. Connections

A connection is the link and the route. Its caller and receiver terms live on the ports it joins. It has no label: its
text is derived from the port it enters, e.g. `call · HTTP / REST /orders`.

| Kind | Field | Meaning | Range |
| :--- | :--- | :--- | :--- |
| call, message | `linkClass` | preset the latencies came from: same-host 1 ms, same-AZ 2, cross-AZ 5, cross-region 80, internet 120; null = custom | one of five or custom |
| call, message | `latencyMs` | one-way delay of the request leg | 0–60000 ms |
| call | `returnLatencyMs` | one-way delay of the response leg | 0–60000 ms |
| call, message | `jitterMs` | each leg takes up to this much longer, at random | 0–60000 ms |
| call, message | `lossRate` | percent of legs that never arrive | 0–100 % |
| call, message | `bandwidthKbps` | link bandwidth, null = unlimited; transfer time needs port sizes | > 0 |
| call, message | `weight` | share of traffic when a node has several routes (router, balancer, gateway, broker) | > 0–1000000 |
| call, message | `condition` | route only requests whose class, operation or tag matches (read-only in the inspector) | field + value |
| call, message | `fallback` | the route used when the others fail (read-only in the inspector) | yes / no |
| data | none | a data connection has no run-time settings | |

Delays apply in timed runs only. A broker-to-consumer hop gets jitter and transfer time but is never lost.

## 7. Project

| Field | Meaning | Range |
| :--- | :--- | :--- |
| `description` | shown on linked nodes | up to 500 characters |
| `team` | shown on linked nodes and in the project menu | up to 60 characters |
| `exposures` | endpoints other projects may link to: channel, protocol, path and the declared contract (p95, availability, idempotent, delivery, ordering, throughput, staleness) | up to 32, each unique by channel, protocol and path |

A project with no exposed call endpoint cannot be linked. Protocols are a closed set per channel:

- call: http, grpc, graphql, soap, json-rpc, thrift, sql, redis, memcached
- message: amqp, kafka, mqtt, nats, stomp, sqs, sns, google-pubsub, azure-service-bus
- data: jdbc, s3, sftp, cdc, http-bulk

## 8. Traffic sources, cycles and run controls

A scenario has no completion setting (D56). Each traffic source in the scenario editor says how much it sends. A timed run is computed ahead of a
playhead that moves in real time: the worker stays about 30 s of simulated time ahead of it and waits for it (D57), so a stream can play on
within a retained history window. Timeline controls (D59) provide play/pause, seek, previous/next cycle, speeds ×0.25–×16 (default ×1),
finished-bulk loop, stream Go live, Stop/drain and Restart. Results follow the playhead. Completed recordings can replay in memory until
reset/restart; reload does not restore them. Browser tests use the visible speed control, with no hidden storage override.

| Source | Sends | Ends | Range |
| :--- | :--- | :--- | :--- |
| Bulk, "All at once" | N requests at the start delay | by itself, when all N cycles have settled | N 1–100000 |
| Bulk, "Evenly over" | N requests evenly over D ms | same | D 1 ms–1 h |
| Bulk, "Ramping up over" | N requests, the rate rising linearly from zero over D ms | same | D 1 ms–1 h |
| Stream | requests at a rate (Poisson), steady, burst or ramp (ramp holds its end rate) | never by itself; the user presses Stop | rate above 0, up to 10000/s |

Every source also has a start delay (0–1 h). A run ends when every bulk has sent its requests and everything has settled; with a stream it runs until Stop.

A **cycle** is one request and everything it causes, including side effects after the response. Results report response latency (the response reached the source) and completion latency (the last descendant settled). Work that can never settle is reported `stuck`, by where it is held; a message port's optional TTL makes a waiting message `expired` instead.

| Run control | Effect |
| :--- | :--- |
| Pause / Resume | hold and continue the clock |
| Stop | stop new requests, let work in flight finish (up to 60 s of simulated time), complete with the results kept |
| Reset | cancel and discard the run |
