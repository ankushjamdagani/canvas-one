# Service fan-out ports (D53)

Accepted 2026-10-03. Builds on the identical-shape rule (model-and-runner §3) and the per-route out ports of
routers and brokers ("Resolution 11" in `features/catalog/connect.ts`, D47).

## Problem

A port carries one schema, and a connection needs identical normalized shapes on both ends. A service has one
out call port, so every dependency it calls would have to share one request and one response shape. A real
service sends a different request to each dependency.

## Rule

When a `processor` resource connects an out call port `P` to a call target port `T` and the request or
response shapes of `P` and `T` differ:

1. If another out call port of the source already matches `T`, use it. Dependencies with the same contract
   share a port.
2. Otherwise add a new out call port `call out N` that carries `T`'s request and response schema ids (shared,
   like router route ports) and connect that port.

Shape never rejects a service connection. The original out port stays, possibly unused (an unconnected
output port is legal). Other source kinds (client, router, broker, and so on) keep the shape rejection.

Linked-project targets are handled on the target side first ([linked-projects.md](linked-projects.md)): the
linked node gets an in-port matching the caller, so the service's own port usually already matches.

## Consequences

- A service shows more out ports after it calls differently shaped dependencies.
- The schema record is shared between the new source port and the target port, so editing the target's shape
  keeps the pair compatible.
- Runner routing is by connection, not port (verified by `fan-out-run.test.ts`: a service calling two
  differently shaped dependencies runs with every check passing).

## Not covered

- Ports and handles: edges still attach to one element handle; extra ports have no handle of their own.
- Saved parts (`domain/parts/capture.ts`) and three-way merge with extra ports have no dedicated test.
- The inspector lists ports as before; a long list is not specially designed.

## Verification

`connect.test.ts` (adds a port on mismatch, reuses a matching port, still rejects for a client source) and
`fan-out-run.test.ts` (validate, readiness, scenario run).
