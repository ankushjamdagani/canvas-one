# Connection protocols (D53)

Accepted 2026-10-03. Replaces the earlier payload-shape workarounds for linked projects and service fan-out
(reverted the same day): one rule decides how a node gets a new way to be connected.

## Model

- A closed set of protocols per channel (`domain/studio/protocols.ts`). A protocol is a label: the runner and
  readiness ignore it. `event` ports have none and can't be connected.

  | Channel | Protocols |
  | :--- | :--- |
  | `call` | `http`, `grpc`, `graphql`, `soap`, `json-rpc`, `thrift`, `sql`, `redis`, `memcached` |
  | `message` | `amqp`, `kafka`, `mqtt`, `nats`, `stomp`, `sqs`, `sns`, `google-pubsub`, `azure-service-bus` |
  | `data` | `jdbc`, `s3`, `sftp`, `cdc`, `http-bulk` |

- `Port.protocol` is required on call, message and data ports and null on event ports (D54: no backward compatibility
  is kept; old files are not read). New ports start with the node's default for the channel (`defaultProtocol(visualKind,
  channel)`: service and gateway `http`, database and warehouse `sql`, cache `redis`, queue `amqp`, stream `kafka`, pub/sub
  `google-pubsub`, data pipeline `jdbc`, other call nodes `http`).
- `Port.path?` is the endpoint path or name within the protocol (`/orders`, a topic, a procedure): free text, trimmed,
  1–120 characters, absent when blank. A node's ports are identified by (direction, channel, protocol, path); two
  in-ports of one node never share all four.

## Connecting

The connect form gets a **Connection type** field (the channel's protocols; default is the target's entry
protocol, else the source's) and a **Path / name** field (suggests the paths the target already has for that type;
default is the target's own path for it). Changing the type re-plans; confirming plans again with the typed path.
On confirm, with channel `c`, protocol `P` and path `x`:

1. Source out-port `(out, c, P, x)` and target in-port `(in, c, P, x)` are each reused if the node has one, else
   added (so a source gets one out-port per downstream endpoint).
2. A newly added port shares the schema records of the port on the other side. If both are new they share one
   fresh request/response pair (like router route ports).
3. If both already existed, their shapes must be identical, as today; otherwise the connection is rejected.
4. Router and broker route ports keep their own rule (a new out-port per route) and take the target's protocol.

Once a node has a `(c, P)` port, every later connection of that type reuses it.

## Linked projects

A linked node is read-only, so it never gains a connection type on its own. The external project decides which
endpoints other projects may use: its **exposed endpoints** (project menu → Exposed endpoints…) are a project-level
list of `{channel, protocol, path}`, stored on the project record like description and team (`ProjectRecord.exposures`,
set through `project.update-details`, not part of any document, branch or the portable file). The dialog lists
the endpoints that nodes of that project accept (in-ports, plus any exposed endpoint no node accepts any more).

- A project that exposes no call type can't be linked (the Library row says why and disables Link).
- Placing the link creates one in-port per exposed endpoint, call endpoints first; the first is the entry port.
- Connecting offers only the exposed types, and the typed path must be one the project exposes for that type. An
  endpoint the node lacks but the project now exposes adds that in-port (it shares the caller's schemas, like any
  new port). Anything else is rejected: "'<node>' doesn't expose <protocol> <path>. Edit that project to expose
  it, then connect."
- The exposures are read when you link and when you connect; changing them later does not rewrite existing
  linked nodes or connections.

## Display

- A connection has no label field. Its text is derived from the port it enters, `<channel> · <protocol> <path>`
  (for example `call · HTTP / REST /orders`), on the canvas, in exports and in history, so it can never go stale.
- A card expanded with the port toggle lists its ports as protocol and path (`in: HTTP / REST /orders, gRPC`),
  which for a linked node is the set of endpoints it can be connected with.

## Not covered

- Two dependencies at the same protocol *and path* with different payload shapes still conflict (rule 3).
- Exposures are a declared list, not checked against the external project's nodes after the fact.
- Future work: a `stream` channel (WebSocket, SSE, gRPC streams) needs runner support for sustained connections.
  Code-level data flow (functions and modules) is diagram-only: see the note in `decisions.md` D53.

## Verification

Unit: protocol defaults and validation, exposure list validation, placement omits default protocols, connect (reuse,
add both, add one side, shape conflict, linked exposed/not exposed/exposed later), the manifest ignores the field,
`project.update-details` stores exposures. E2E: pick gRPC in the connect form; expose a type, link, connect; a
project that exposes nothing can't be linked.
