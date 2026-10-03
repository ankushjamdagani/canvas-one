# Port settings and connection links (D54)

Accepted 2026-10-03, on top of [connection-protocols.md](connection-protocols.md) (D53). A connection used to carry
everything about a call: wire delay, routing, the caller's retries and request, the receiver's acknowledgement.
Those belong to different parties, so they now live where they are decided.

## Who owns what

| Owner | Holds | Why |
| :--- | :--- | :--- |
| Connection (link and route) | `latencyMs`, `returnLatencyMs` (calls), `linkClass`, `jitterMs`, `lossRate`, `bandwidthKbps`, `weight`, `condition`, `fallback` | The wire between two ends, and one route among several from a node. |
| Out-port (the caller's contract for one downstream endpoint) | `retry`, and for traffic that originates here `request` and `deadlineDurationMs` | Governed by the downstream protocol and path, like the port itself. |
| In-port (the callee's contract and behavior for one endpoint) | declared expectations and simulated overrides (below) | What a callee promises or enforces on that endpoint. |
| Node | capacity, concurrency, failure rate, service time, ... | Unchanged. |

A connection has no label field and no caller or receiver terms. Its text is derived (D53).

## Link

`linkClass` is `same-host | same-az | cross-az | cross-region | internet | null` (null is custom). Choosing a class sets
the latencies to its one-way value (1, 2, 5, 80, 120 ms; assumptions, shown in the inspector); typing a latency makes the
link custom. A new connection starts as `same-az`. The class is presentation (dropped from the run manifest); the numbers
are what the runner uses. Data connections have no link settings.

A call or message link also carries three impairments (D54), all off by default:

- `jitterMs`: each leg takes up to this much longer, uniformly at random, seeded per leg.
- `lossRate` (percent): a leg never arrives. A lost request is never admitted, so the caller waits for its attempt
  timeout or deadline (and a bulkhead slot stays taken meanwhile); a lost response means the callee did the work but the
  caller never hears; a lost publish is never delivered and expires at its TTL; a lost acknowledgement leaves the
  publisher waiting. The hop from a broker to its consumer gets jitter and transfer time but is never lost, because the
  broker would wait forever.
- `bandwidthKbps` (null = unlimited): each leg adds `bytes * 8 / kbps` ms of transfer time, where the bytes come from the
  out-port's `requestBytes` and the in-port's `responseBytes`. With no sizes there is no transfer time.

## Settings by port

`Port.settings` is omitted when empty and is valid only for the port's direction and channel. "Simulated" settings change
what a run does and enter the manifest; "declared" settings are expectations shown to callers and never simulated.

| Port | Declared | Simulated |
| :--- | :--- | :--- |
| in, call | `expectedP95Ms`, `availabilityPct`, `idempotent` | `rateLimit {rps, burst}`, `failureRate`, `serviceTimeMs`, `maxConcurrency`, `responseBytes` (resource nodes only) |
| in, message | `delivery` (at-most/at-least/exactly-once), `ordering` (none/per-key/global) | `ackDelayMs` (default 0), `messageTtlMs` (default 5 min) |
| in, data | `throughputPerSec`, `maxStalenessMs` | none |
| out, call | none | `retry`, `circuitBreaker`, `maxInFlight`, `hedge`, `requestBytes`; and `request`, `deadlineDurationMs` where traffic originates |
| out, message | none | `confirm`, `batch`, `requestBytes`; and `request`, `deadlineDurationMs` where traffic originates |

Why the declared ones are not simulated: `expectedP95Ms` and `availabilityPct` are outcomes of a run (measured from the
latencies and failures the inputs produce), so feeding them in would count the same thing twice; they are what a run is
compared against. `idempotent` is a promise about repeated requests, and the model does not carry request effects, so it
only drives advisories. `delivery` and `ordering` describe broker guarantees the runner does not model; `throughputPerSec`
and `maxStalenessMs` belong to the data channel, which has no run-time behavior.

- **Per-endpoint overrides.** A call that enters through the in-port is rejected once the token bucket (`rps`, refilled
  continuously, full at the start, `burst` deep) is empty or `maxConcurrency` calls are already in service or queued
  through that endpoint; `failureRate` replaces the node's failure rate for it; `serviceTimeMs` replaces `1 / capacity` as
  the mean (the node's service-time distribution still applies). Retries of an admitted call take neither a token nor a
  slot again. Overrides cover calls from workloads and from other nodes' routes; calls that leave a state machine or enter
  from a scenario input use the node's behavior.
- **Circuit breaker** (call out-port, shared by every connection of the port). Closed: calls go through, and
  `failureThreshold` consecutive failed attempts (rejected, failed or timed out) open it. Open: calls fail fast as
  rejected, never reaching the callee, for `openMs`. Then half-open: up to `halfOpenProbes` calls go through; a success
  closes it, a failure opens it again. A fast-failed attempt can still be retried by the caller's retry policy.
- **In-flight limit** (call out-port): a call beyond `maxInFlight` outstanding through the port (a lost request still
  counts until it is given up on) fails fast as rejected.
- **Hedging** (call out-port): an attempt unanswered after `afterMs` is sent again to the same route; the first success
  wins, the other copy is abandoned, and the attempt fails only when every copy has failed. Hedges add load to the callee.
- **Confirm** (message out-port, default yes): with `confirm: false` the publisher moves on at once and never hears of the
  delivery's fate (a full or failing queue is invisible to it).
- **Batch** (message out-port): a publish waits until `size` publishes (per port and route) have gathered or `windowMs`
  has passed since the first, then the batch travels as one hop (one latency draw, one loss draw, the transfer time of all
  its bytes, one acknowledgement time). Broker work is still per message, so batching trades latency for fewer hops, not
  for lighter broker load.
- **Request and deadline** are needed only where traffic originates in a node the runner does not simulate (a client, a
  state machine). A simulated caller's requests inherit them, so the connect form asks for class, operation and deadline
  only for such a source. Ports that send the same class id must use the same label.
- **Node kinds.** Declared settings are valid on every connectable port; the simulated in-port settings only on
  `resource` behaviors. Out-port `retry` is valid on any call out-port (a broker's route retry is its redelivery policy,
  without an attempt timeout). Unmodeled nodes (clients, DNS, third parties, email, monitoring, analytics, secrets) can
  declare a contract but nothing changes in a run; the scenario's boundaries still decide their behavior.

## Advisories

The connection inspector shows the caller's and callee's terms read-only and lists disagreements between them: a caller
deadline or attempt timeout below the callee's expected p95, and retries against an endpoint declared not idempotent.
Advisories never block a run. Settings are edited on the node, per port (group `In · <protocol> <path>`).

## Linked projects

An exposure is `{channel, protocol, path, contract?}`; `contract` is the declared part of the endpoint's in-port settings
at the moment it was exposed. A linked node's in-ports are created with that contract, and a connection that adds a newly
exposed endpoint copies it too, so a caller sees the project's real expectations. Switch an endpoint off and on to
publish a change; existing linked nodes are not rewritten.

## Out-ports are adopted, not left behind

A node ships with a default out-port. While nothing is connected through it, the first endpoint the node calls retypes it
(protocol, path, schemas) instead of adding a second port, so a service that only calls a database shows one `Out · SQL`
group, not an unused HTTP one. Later endpoints add ports as in D53.

## Not built

`delivery` and `ordering` are declared only (the broker model has no loss or reordering to guarantee against). A `stream`
channel and code-level data flow remain future work (D53).

## Verification

Unit: settings validation per port kind, manifest classification (declared fields do not change a fingerprint, simulated
ones do), endpoint overrides and every caller, link and publishing policy through the runner (`endpoint-behavior.test.ts`,
`call-policies.test.ts`), the fields and advisories, exposure
contracts, connect (settings stay off connections, adopted out-ports, request only for unsimulated callers), and the
existing reference-architecture tests with retries and TTL moved to ports. E2E: connect form, link inspector, port retry
editing, linked-project flows.
