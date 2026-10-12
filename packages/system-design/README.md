# @canvas-one/system-design

Headless authored system model, validation, protocol/port semantics, scenario
readiness, deterministic manifests and fingerprints, reusable parts, and semantic
diff/merge planners extracted from the existing app. Public subpaths expose each
cohort explicitly; the root exposes the model and common validation APIs.

Depends only on `@canvas-one/whiteboard` authoring contracts. No React, editor,
storage or simulator imports. Standard runtime APIs TextEncoder, TextDecoder,
structuredClone and Web Crypto must be supplied by the host. Hashing throws an
explicit error when Web Crypto is unavailable.

Existing studio-model/1 payload shapes, IDs and canonical hashing remain intact.
No database migration, new document authority, execution runner or mandatory UI
is introduced. Source facades preserve existing app import paths during cutover.

Semantic editing APIs in `catalog/*` and `authoring/*` now provide actual component
placement, protocol-aware connection creation, record application, dependency-aware
delete/replace/wrap, view selection/alignment/note editing and expansion planning.
Their existing app modules forward to these implementations. Renderers, React styles,
menus, forms and panel UI remain in the app; measured placement geometry is injected.

`planSystemDesignDiagram` accepts readable aliases, namespaced component identifiers
such as `system-design/service`, optional labels/positions and alias-based connections.
The host supplies internal UUID generation. Missing positions receive an explicit
example grid layout. The result is one validated batch with one change per record,
alias-to-ID maps and declared assumptions; it does not persist or bypass proposal
review. `discoverSystemDesignComponents` and `diagramRequestSchema` allow agents to
discover supported component semantics without manufacturing internal snapshots.
Linked projects require the existing richer host resolver/placement API.

`projectSystemDesignDocument` supplies a read-only BoardDocument projection, with
shared entities, separate page placements and preserved complete authored semantics
in `system-design/source`. Unknown host-supplied extension records survive unchanged.
`readSystemDesignSource` reads that preserved semantic payload only. Neutral placement
edits are never silently applied back to the system document. Display-height callbacks
can use a host's measured renderers; default 80px heights are illustrative only.
This projection neither rewrites historical payloads nor creates another writable
authority alongside the current system session.

`authoring/inspector/*` owns raw draft values, field parsing/planning, validation,
Apply/Cancel, navigation gating and explicit stale/deleted handling. `DraftSession`
depends only on current document/revision and minimal outcome statuses; it imports
no app controller or storage receipts. Applying submits one compound record batch.
Field schemas have default labels, but require no controls, panel or history UI.
`createInspectorFieldFactory` can override display labels, groups, units, notes and
option labels without replacing semantic parsers or allowed values. Bind it with
`createInspectorDraftApi` to retain custom metadata after successful field refresh.
The current app adds catalog stripe colors in its own small presentation binding;
those colors are absent from headless draft contracts.
# Scenario authoring

`authoring/scenarios/draft` owns scenario creation, duplication, validation, acceptance,
and deletion. Its `ScenarioDraftSession` port consumes authored record changes and
lifecycle outcomes; it does not require a storage implementation or a React editor.
`authoring/scenarios/draftScenario` retains incomplete workload and assertion choices
outside the persisted model until they are explicitly supplied. IDs and randomness
remain host-injected. `authoring/addProbePlan` plans checks without rendering controls.
The app supplies navigation, pending-submit controls, and undo through its session.

# Optional node presentation

Import `SystemDesignNodeCard` from `@canvas-one/system-design/react` for the default
studio appearance. It receives domain records, presentation metadata, neutral
callbacks, and host-supplied handle/activity slots; it imports no editor or simulator.
`SystemDesignPresentationProvider` accepts an instance-scoped `nodeRenderer` override.
Hosts use `useSystemDesignNodeRenderer()` to resolve that override or the default.
React, Lucide and the shared UI utility package are optional peers used by this entry.
The headless root entry does not import presentation code.

# Semantic SVG export

`export/svg` renders authored system-design views with deterministic ordering and
XML escaping. Supply `SvgPresentation` for captions, stripes, note fills, and plain
note lines. The app binding supplies the existing studio appearance; other hosts
can choose their own presentation without importing an editor or React.

# Editing session composition

`session/controller` owns system-design project and branch navigation, auto-drafting,
authored transactions, paired reloads, local undo/redo, and reviewed proposal acceptance.
Supply its five-method `SessionRepository` read/command port and backend error mapper.
The session uses whiteboard's immutable authored authority and history's local undo
mechanics. Storage schemas, browser database startup, and presentation remain host-owned.
Optional trusted extensions validate the same authored document projection; they do
not introduce another writable board.

# Canvas projection

`canvas/projection` owns active-view projection, collapsed-group/refinement geometry,
connection rerouting, catalog layer defaults, and rounded authored move changes.
Its renderer labels and presentation values are framework-neutral contracts; the
editor adapter maps those labels to host renderers. It imports neither React nor
React Flow. This canvas projection serves the complete app; the separate root
`projectSystemDesignDocument` projects semantic data into a read-only generic board.
