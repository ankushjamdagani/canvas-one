# @canvas-one/whiteboard

Headless authoring, versioned board documents, trusted extension registration and
replaceable editor contracts. No React, DOM, storage or application dependencies.
Each runtime is one authoritative document instance. Host planners can supply an
existing domain document; an independent board does not open a second authority
over that domain's editing session.

`invertRecordChanges(changes, lookup)` reads an immutable pre-transaction record
set, returns inverses in reverse order, and clones prior records with the standard
`structuredClone` runtime API. A missing prior returns index/kind/id descriptors;
the consumer supplies domain-specific error messages. Lookup must return the
requested kind/id and structured-cloneable data. Validation and atomic application
remain consumer responsibilities. Input and lookup records are never mutated.

`BoardDocument` version 1 separates entities from page placements, so one semantic
entity can appear on multiple pages. It contains connectors, asset references and
namespaced extension records. Unknown extension JSON survives edits and serialization.
Asset bytes, preferences, presence, historical records and execution artifacts live
outside the authored document. Use `boardDocumentSchema` or `schema/board-v1.json`
and `examples/architecture.json` for AI generation. `validateBoardDocument` checks
uniqueness, references, finite geometry, same-page connectors and JSON item/depth
budgets. Rotations are degrees; domain semantics validate opaque anchor identifiers.

Create a runtime with `createBoardRuntime({document,scope,validate,apply,lookup})`.
For BoardDocument use `validateBoardDocument`, `applyBoardRecordChanges` and
`lookupBoardRecord`. Alternate domain documents supply their own validators and
planners. Snapshots are stable between updates, detached and recursively frozen.
Registered schemas validate only their exact authored version. An incompatible
known version returns an actionable issue; unknown records remain untouched.
Registration changes require an open, idle runtime. Initialization failures clean
contributed resources, and disposed hosts cannot register new contributions.
Authored state must use structured-cloneable plain JSON objects/arrays. Subscribe
for updates and dispose instances/subscriptions when the host unmounts.

Dispatch requires operation identity, attributed actor, project/branch scope,
expected revision and typed record changes. Optional undo/redo intent is available
for injected history coordination. Concurrent dispatch returns `busy`. Preview
planning stays local. In-memory operation requires no storage or simulator.

An optional `commit` port atomically persists the prepared document and required
history/receipt metadata. It must return the exact candidate at the next revision,
or explicit stale/invalid/failed results. Explicit failure guarantees nothing was
written. Thrown writes and invalid/divergent responses require an authoritative
reload. `onCommitted` is local observation only, never a required durable write.
Observer errors do not invalidate commits. Bounded local receipts replay identical
requests during an instance; storage provides durable idempotency. Operation-ID
reuse with differing payloads fails. Disposed instances fence late publication.

`createExtensionRegistry` checks manifests and contributions for schemas, migrations,
components, commands, tools, panels, import/export and execution providers. It
rejects duplicate identifiers, invalid versions and missing/incompatible dependencies
before registering anything. Exact/caret dependency versions are supported; other
syntax is rejected. Dependents block removal. Cleanup runs in reverse order and
collects errors. Missing extensions are explicitly unsupported through `require`.
The registry loads trusted host code; untrusted runtime plugin installation is future work.

Presentation registration is separate: `createComponentRendererRegistry` resolves
adapter/component-specific UI, or a labeled missing-renderer placeholder without
changing semantic data. `EditorAdapter` defines lifecycle, projection, selection,
viewport, coordinate conversion, hit testing, bounds, anchors and overlays.
Capabilities return explicit supported/value or unsupported/reason results.
Gestures produce neutral intents; host planners dispatch transactions. Transient
previews stay in the editor. `createTestEditorAdapter` provides conformance geometry
including rotation without a UI engine. React Flow types never enter these contracts.
# Raster export capabilities

`export/raster` owns pure SVG dimension parsing and bounded PNG geometry.
`browser/raster` is an optional browser entry containing SVG rasterization. Hosts
may supply a `RasterizationProvider`, or use the default browser surfaces and
object-URL cleanup. This entry does not participate in the headless root imports.
