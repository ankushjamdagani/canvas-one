# Architecture templates implementation plan

## Outcome

Offer three thoughtfully laid-out diagram starters: real-time chat, ecommerce checkout and event processing. Each creates real editable components and labeled directed connections using the existing architecture diagram model. These are educational diagrams, not executable simulations or production recommendations. Keep the approved light docked workspace.

## Baseline and scope

Start after cd5fc3f (custom components and duplication). Baseline verification: 93 unit tests, production build, 31 production Chromium journeys. Implement templates only; no cloud sync, cross-project custom-type registry, multi-select, new simulation behavior or export formats. No commit, push or deploy during delegation.

## Domain

Create src/domain/architectureTemplates.ts with typed template descriptors (stable ID, title, short purpose, factory) and tests. Factories must return independent Graph objects with scenario diagram and fresh node/edge UUIDs on every call. Use makeNode and existing catalog kinds, notes and connection label/protocol/communication metadata. Preserve all current field limits and diagram bounds. Factories must validate through validateGraph(graph, false). Avoid shared mutable arrays or objects.

Chat: client, API gateway, chat service, message database, pub/sub, notification worker and notification service. Show message submission/persistence and asynchronous delivery explicitly with short labels.

Ecommerce: client, gateway, checkout service, product database, cache, external payment provider, order queue and fulfillment worker. Clearly label payment and asynchronous fulfillment relationships. Notes explain that the template omits real transaction/consistency machinery.

Event processing: device/producer, event stream, processing worker, object storage, warehouse and analytics. Show ingest, processing, archival and query paths. Notes identify illustrative flow choices.

Use compact left-to-right layouts with intentional branch spacing. Aim for 6–9 nodes per template. Every component should participate in at least one relationship. Labels must be readable and not sit inside node cards. Show the whole layout on desktop while preserving existing readable mobile panning behavior.

## State and preservation

Add loadArchitectureTemplate(id) to the editor store. Validate the ID before editing. Replace graph in one existing history action, set scenario diagram, clear stale guide metadata and selected node, and use existing model-reset conventions. Undo restores the prior graph exactly; Redo restores the loaded graph with its original generated IDs. Repeated loading generates fresh IDs.

Keep project identity, name, saved results, checkpoints and local records intact. Preserve dormant subsystem metadata under the existing model-switch policy; no template groups are needed in this milestone. Existing expansion IDs should remain harmless/dormant consistent with scenario switching. Unknown IDs must not change history or revision.

## UI

Add a compact Architecture templates disclosure or picker in the diagram library only. Each option needs a name and one-line purpose plus an explicit Load template action. Before loading, visible helper text must state that this replaces the current diagram and can be undone. Use an empty initial selection and avoid accidental loads on merely navigating options. Match existing controls rather than introducing another large panel or modal. Keep custom palette search and creation accessible.

Loading from diagram mode should recenter/frame the new graph through the existing layout identity mechanism. The resulting nodes, notes and edges must be immediately editable; duplication, checkpoints and exports should work unchanged. Run remains disabled. Mobile controls need appropriate touch targets and no page overflow.

## Tests and verification

Unit tests: all templates are structurally valid diagram graphs; meaningful node/edge metadata; unique IDs within/across factory calls; mutation isolation; limits. Store tests: one-step load/Undo/Redo, no-op unknown ID, preserved project data and saved results, guide removal and diagram scenario.

Browser journeys: select/load each template; verify title/summary and expected nodes/connections; edit a node and connection; duplicate; Undo loading restores a previously customized diagram; save checkpoint, reload locally and restore; export/import preserves template graph content. Include a focused mobile template load and control accessibility/overflow check. Prefer extending existing test patterns.

Run npm test and npm run build, then the complete TEST_PRODUCTION=1 npm run test:e2e suite. Inspect new desktop/mobile screenshots and correct layout issues. State exact results and known limitations; do not claim unrun checks. Avoid unrelated screenshot churn: record tracked artifact state before tests, and restore only unrelated files proven clean before your run; retain new template evidence and any deliberately reviewed changed feature screenshots.

## Documentation and report

Update README, PRODUCT, DESIGN, HANDOFF and artifacts/VERIFICATION with the actual delivered behavior and checks. Write plans/architecture-templates-result.md with decisions, changed files, test results and blockers. Follow relevant frontend skills. Leave local changes ready for parent review. Do not add unrequested milestones or silently change model semantics.
