# Port settings and connection links (D54)

Accepted 2026-10-03, on top of [connection-protocols.md](connection-protocols.md) (D53). A connection used to carry
everything about a call: wire delay, routing, the caller's retries and request, the receiver's acknowledgement.
Those belong to different parties, so they now live where they are decided.

## Who owns what

| Owner | Holds | Why |
| :--- | :--- | :--- |
| Connection (link and route) | `latencyMs`, `returnLatencyMs` (calls), `linkClass`, `weight`, `condition`, `fallback` | The wire between two ends, and one route among several from a node. |
| Out-port (the caller's contract for one downstream endpoint) | `retry`, and for traffic that originates here `request` and `deadlineDurationMs` | Governed by the downstream protocol and path, like the port itself. |
| In-port (the callee's contract and behavior for one endpoint) | declared expectations and simulated overrides (below) | What a callee promises or enforces on that endpoint. |
| Node | capacity, concurrency, failure rate, service time, ... | Unchanged. |

A connection has no label field and no caller or receiver terms. Its text is derived (D53).

## Link class

`linkClass` is `same-host | same-az | cross-az | cross-region | internet | null` (null is custom). Choosing a class sets
the latencies to its one-way value (1, 2, 5, 80, 120 ms; assumptions, shown in the inspector); typing a latency makes the
link custom. A new connection starts as `same-az`. The class is presentation (dropped from the run manifest); the
numbers are what the runner uses. Data connections have no link settings.

## Settings by port

`Port.settings` is omitted when empty and is valid only for the port's direction and channel. "Simulated" settings change
what a run does and enter the manifest; "declared" settings are expectations shown to callers and never simulated.

| Port | Declared | Simulated |
| :--- | :--- | :--- |
| in, call | `expectedP95Ms`, `availabilityPct`, `idempotent`, `maxConcurrency` | `rateLimit {rps, burst}`, `failureRate`, `serviceTimeMs` (resource nodes only) |
| in, message | `delivery` (at-most/at-least/exactly-once), `ordering` (none/per-key/global) | `ackDelayMs` (default 0), `messageTtlMs` (default 5 min) |
| in, data | `throughputPerSec`, `maxStalenessMs` | none |
| out, call | none | `retry`; `request`, `deadlineDurationMs` |
| out, message | none | `request`, `deadlineDurationMs` |

- **Simulated in-port overrides apply per endpoint.** A call that enters through the port is rejected once the token
  bucket (`rps`, refilled continuously, full at the start, `burst` deep) is empty; `failureRate` replaces the node's failure
  rate for it; `serviceTimeMs` replaces `1 / capacity` as the mean (the node's service-time distribution still applies).
  Retries of an admitted call do not take another token. Overrides cover calls from workloads and from other nodes'
  routes; calls that leave a state machine or enter from a scenario input use the node's behavior.
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

Circuit breaker, in-flight limit (bulkhead), hedging, publish confirm and batch size on out-ports; jitter, loss and
bandwidth on links; per-endpoint concurrency enforcement (`maxConcurrency` is declared only). Each needs kernel
semantics. A `stream` channel and code-level data flow remain future work (D53).

## Verification

Unit: settings validation per port kind, manifest classification (declared fields do not change a fingerprint, simulated
ones do), endpoint overrides through the runner (`endpoint-behavior.test.ts`), the fields and advisories, exposure
contracts, connect (settings stay off connections, adopted out-ports, request only for unsimulated callers), and the
existing reference-architecture tests with retries and TTL moved to ports. E2E: connect form, link inspector, port retry
editing, linked-project flows.
