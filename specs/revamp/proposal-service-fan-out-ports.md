# Proposal: per-dependency out ports on services (not accepted)

Status: proposal for review. Not decided; no decision row, no code.

## Problem

Ports carry one schema, and a connection needs identical normalized shapes on both ends
(model-and-runner §3). A service has one out call port, so every dependency it calls must share one
request shape and one response shape. A real service sends a different request to each dependency
(database, cache, payment API, linked project). Today this works only because fresh placements all start
with the same empty record. Once an author edits one shape, connecting the service to a dependency with a
different shape is rejected ("Incompatible payload shapes").

Routers and brokers already avoid this: when an out port is already connected, the connect gesture adds a new
out port with the channel and schema the target accepts ("Resolution 11" in `features/catalog/connect.ts`,
see D47 for the broker/service messaging extension). Services do not.

## Proposal

Extend that gesture to service-like resources (`processor` and the other call-making resource types).
On connect, with source port `P` and target port `T`:

1. If `P` and `T` have identical request and response shapes, connect as today.
2. Else if `P` has no connections, keep today's rejection so the author sees the mismatch.
3. Else add a new out call port on the source with `T`'s request and response shapes (fresh schema records,
   fresh field ids) and connect that port.

Open question for review: rule 2 versus always adding a port. Always adding avoids the rejection entirely
but hides shape mismatches the author may want to see. This proposal prefers rejection until a port is in use.

## Impact to check before accepting

- Readiness checks for unconnected or unmodeled ports must accept extra out ports.
- Saved parts (`domain/parts/capture.ts`) key connected endpoints by port id; a part with extra ports needs a
  round-trip test.
- Merge descriptors: new ports are element changes, so three-way merge needs the same handling router route
  ports need.
- The inspector shows ports; a service with several out ports needs a readable list.
- Runner routing is by connection, not by port, so no runner change is expected (not verified by a run test).

## Verification if accepted

Unit tests in `connect.test.ts` for each rule; a scenario run through a service with two dependencies of
different shapes; a saved-part round trip; the existing S01–S06 scenarios unchanged.
