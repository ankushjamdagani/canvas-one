# Canvas One composable architecture plan

Status: implementation authorized by the user, proceeding through the gated phases below. The first tranche establishes ownership ADRs, moves the existing Next entry to `apps/web`, and extracts UI leaves, playback timeframe primitives and command execution. The remaining packages and AI integration are not yet delivered.
Baseline: restored commit `8f41338`. Updated 2026-10-11.

## Product requirements

- Keep the current Next.js app, appearance, routes and complete workflows. Add AI collaboration to that workspace. Do not introduce a reduced replacement board or separate old/new product routes.
- `packages/*` owns reusable behavior; `apps/*` composes packages and supplies product presentation, navigation and deployment policy.
- Each package owns and exports its contracts. No central contracts, core or miscellaneous runtime package.
- Separate behavior from presentation. History has no history panel; system design has no mandatory node or inspector UI; simulation has no mandatory results UI.
- React Flow remains the initial renderer behind a replaceable editor adapter.
- No backward compatibility promises for previously released APIs or file formats. This does not authorize deleting local databases or discarding current authoring/history workflows. Format changes require an explicit export/recovery or migration decision before switching storage.
- Trusted first-party extensions use the same contribution APIs available to hosts. Downloading and running untrusted plugins, human hosted collaboration and Git synchronization are future work.

## Current architecture and extraction risks

The restored app is Next.js with a browser editing session. `src/App.tsx` creates a SessionController. `src/features/workspace/Workspace.tsx` constructs RunController, HistoryController and PublishController and coordinates drafts, panels, transfers and selection. `src/features/session/controller.ts` mixes working-document edits, repository commands and local undo stacks. The current command registry under `src/features/workspace/commands/registry.ts` already centralizes many menu, keyboard and button actions, but is a closed product-specific registry whose types depend on panels, storage, history and simulation.

The domain model separates semantic elements and their view placements. Preserve this distinction. The repository contains atomic operations, revision checks, immutable history, publication evidence and linked-project references; it cannot be replaced by simple JSON autosave plus a checkpoint array. The simulator and recording inspection have substantial existing behavior that should move rather than be rewritten.

Graphify identifies the original architecture but its graph is stale after prior moves. Direct source reads establish the baseline. Do not rebuild the graph during this task.

## Package inventory

All names use the `@canvas-one/` prefix. Start with these behavior boundaries; do not add packages merely for folders or small helper files.

| Package | Owned contracts and behavior | Dependencies allowed |
| --- | --- | --- |
| `commands` | Registry, definitions, typed/JSON inputs, discovery, execution results, availability, cancellation, contribution lifecycle | No feature package, React or DOM |
| `whiteboard` | Authored document, reusable entities and placements, connectors, atomic operations, editing session, drafts/navigation guards, selection/viewport, tools/components/extensions, editor host contract | `commands` |
| `editor-reactflow` | Implements editor contract; geometry, gestures, previews, renderer integration and overlays | `whiteboard`, React, React Flow |
| `components-basic` | Notes/text/shapes/images/frames/drawing schemas and board editing tools | `whiteboard`, `commands` |
| `system-design` | Semantic elements/ports/protocols, catalog, scenarios, refinements, exposures, reusable parts, linked-project resolvers, semantic planners, domain eligibility rules | `whiteboard`, `commands`; injected project/version resolver ports |
| `playback` | General clock, timeline, tracks, seek/range/loop/speed and subscriptions | No feature package, React or DOM |
| `simulation-system-design` | Existing compiler/kernel, runner state, worker protocol, run/recording/results contracts, inspection queries, scenario execution, execution evidence | `system-design`, `whiteboard`, `commands`, `playback` |
| `history` | Local UndoController and separate VersionController; branches, checkpoints, diff/merge orchestration, immutable records and version-store contract | `whiteboard`, `commands`; injected domain diff/merge/publication policy |
| `storage` | Local project/workspace repository, project catalog/metadata, atomic persistence coordinator, receipts/CAS, asset/preferences/archive capabilities, backend transaction contract, memory backend | `whiteboard`, `history`, `commands`; injected domain/extension serialization |
| `storage-indexeddb` | Dexie backend, database boot and transaction implementation | `storage`, `whiteboard`, `history`, Dexie |
| `collaboration` | Transport/provider contract, participants, presence, connection state, capability negotiation; future synchronization ingress | `whiteboard`; injected authorization and concurrency policy |
| `agents` | Context/schema discovery, provider interface, tools, proposal validation/preview/accept/reject/status, attribution, permissions | `whiteboard`, `commands`; optional injected collaboration identity |
| `agent-bridge` | Loopback server protocol, pairing, sessions/origins, bounded queues, browser reconnect transport | `agents`; optional browser entry; Node server entry |
| `cli` | CLI and MCP tool interfaces over bridge/agent contracts | `agents`, `agent-bridge` |
| `react` | Thin hooks, providers and board host; explicit renderer/panel binding contracts | `whiteboard`, React; no feature service imports |
| `ui` | Existing foundation components, styles/tokens/themes and visual assets | React and existing foundation libraries; no domain controllers |

Storage owns project-level lifecycle so creating/opening/listing/renaming projects does not become application behavior. History owns version mechanics, while system design supplies publication policy and semantic merge/diff functions. Simulation supplies evidence through injected policy inputs. These directions avoid history depending on simulation or storage depending on system design.

### Presentation arrangement

Headless roots never import React. Optional default UI may use isolated `/react` export paths in components-basic and system-design, with independent browser tsconfig/build entries. Import checks must enforce the separation even within a package. Extract dedicated presentation packages if independent release cadence or additional frameworks justify it.

Feature React bindings belong to their owner package's isolated presentation entry, not `@canvas-one/react/system-design` or another hidden cross-feature dependency. Package dependency declarations include React as a presentation peer dependency; headless consumers must be supported without pulling presentation into the bundle or requiring browser globals. Installation/peer behavior must be verified in the minimal headless consumer.

`react` supplies the generic host and bindings, not the complete routed app. Feature panels, command palette, routing, responsive panel placement and product shell belong in `apps/web`. Existing reusable node/edge/traffic renderers can be default presentation exports; product layout does not move into ui. Existing public branding, scoped portals, PWA, Next metadata and theme behavior remain intact.

## Dependency and ownership rules

1. The contract consumer imports the owner's public export, including type-only dependencies. Adapters implement contracts exported by the consuming service, e.g. EditorAdapter from whiteboard and VersionStore from history.
2. commands is feature-agnostic. Each feature registers its own command handlers bound to explicit service instances. No global service locator or giant CommandContext.
3. whiteboard owns authored state, revisions and the single committed transaction stream. Storage persists it; history observes it; agents propose transactions; editor adapters emit editing intents. None maintains a second authoritative document.
4. UndoController is supplied to the editing session as a narrow port owned by whiteboard. History implements that port and must apply undo through the normal transaction path. This permits whiteboard-without-history and avoids a cycle.
5. DocumentTransactionStore is a port owned by whiteboard; VersionStore is owned by history. storage's coordinator implements both over one backend transaction mechanism. IndexedDB implements storage's backend contract. Keep this two-level split only because it centralizes real atomic invariants and gives alternative backends a conformance suite.
6. Cross-feature registration/composition is explicit in apps/web. No package imports apps/web, Next routing, a particular backend or CLI to invoke another feature.
7. Enforce acyclic dependencies with npm workspace dependency declarations, TypeScript references and import-boundary checks. No wildcard internal source exports.

## Document and component model

BoardDocument owns a versioned JSON envelope containing stable readable IDs, title, pages, semantic entities, page placements, connectors, asset references and namespaced extension records. Preserve independent semantic identity across multiple views and nested/refinement relationships. System-specific ports, scenarios and executable behavior live in system-design records, not core connector enums.

Separate authored document from project metadata, local selection/viewport/preferences, transient gesture previews, ephemeral presence, asset bytes and run artifacts. Whether layout/expansion is authored or session-local must match current behavior and be explicit per field. Simulation fingerprints exclude purely visual content.

Component definitions declare namespaced type, schema version, JSON Schema, default data, validation, supported tool actions and semantic capabilities. Rendering is separately registered by type and editor/framework. Hosts override defaults through explicit priority/replace APIs; duplicate accidental registration fails. Missing renderers show labeled placeholders and preserve data. Missing semantic providers disable their operations rather than treating unknown types as executable.

Whiteboard owns an injected DomainContribution contract with deterministic synchronous validation of the proposed complete document, operation planning and endpoint-resolution hooks. system-design implements it; whiteboard never imports system-design. Endpoint references distinguish a page placement anchor from semantic entity identity and an optional opaque endpoint ID. System design resolves that endpoint ID to a stable port ID and checks protocol compatibility. Port deletion/rename, entity deletion and refinement updates must plan all dependent connection mutations together; core reference validation and domain validation both run before commit. IDs never depend on display labels or array indices. Visual-only connectors can attach to placements or board coordinates without executable meaning.

A ToolDefinition describes activation/deactivation, neutral input events, gesture previews, commit/cancel and required editor capabilities. Freehand drawing requires pointer capture/samples and an overlay or renderable stroke; registration alone cannot provide drawing. React Flow adapter capabilities determine which tools can activate. Basic components include working text, shapes and drawing in the final scope; sophisticated rich text/image editing is staged after parity and AI integration.

Extension manifests are owned by whiteboard and identify contribution namespace/version, required dependencies/capabilities, registration cleanup and schema migrations. commands owns CommandDefinition; playback owns TrackSource; simulation owns ExecutionProvider. Whiteboard extension registration must not duplicate these contracts: feature contributions are registered through their owner services by the host.

Unknown extension JSON survives load/save/export exactly at the data-value level. Strict core structure, unique identifiers, finite geometry and valid core references remain required. Validation issues include code, JSON pointer, explanation and corrective guidance. Supply authored JSON Schema, examples, canonical serialization and optional layout planners. AI sends authored data/commands, never internal hashes, receipts or history snapshots.

## Commands and command center

CommandDefinition includes namespaced ID/version, description, input schema, optional discovery metadata (label/category/search terms/suggested shortcut), effect category, availability, execution handler and disposal. Results discriminate applied/no-op/invalid/unavailable/conflict/cancelled/failed. Feature packages own their input/result types; registry discovery exposes JSON-safe descriptors.

Separate UI discovery from callable capability. An agent allowlist and session policy determine agent access; a visible command is not authorization. Availability is advisory for display and is rechecked at execution. Host-only UI actions such as open-history-panel are registered by apps/web, with no history UI dependency.

Document-mutating commands plan changes against a captured revision and enter one transaction pipeline. Non-mutating queries, session actions, UI actions, file exports and long-running executions have explicit distinct effects. Execution metadata does not itself decide undoability. Undo records committed authored transactions only.

Cmd+K is application palette UI over discovery. Keep existing Quick options behavior and F2; add Cmd/Ctrl+K with editable-field/IME/dialog guards and configurable scopes. Scope/context bindings select the focused board. Keyboard matching is a browser binding over headless shortcut metadata. Input-requiring commands open app forms; agents supply structured inputs. Every supported action is discoverable, but context-dependent actions can request a target rather than manufacturing one. Search follows the existing word-prefix rule.

Do not route every pointer sample through the command registry. Gestures keep previews local and commit one command/transaction at completion; canceled drags/drawing create no undo entry.

## Editing, storage and history lifecycle

Pipeline: intent -> resolve explicit targets -> plan -> validate core and registered domain invariants -> authorize -> prepare participating version/project changes -> check revision/idempotency -> persist the complete atomic envelope and receipt -> publish committed session snapshot -> notify undo/subscribers. Without persistence, the memory transaction store provides the same semantics.

Whiteboard owns a TransactionParticipant port for pre-commit preparation. History registers a participant only for operations that require version metadata/head updates; ordinary local undo is a post-commit observer. Participants return immutable namespaced prepared changes with preconditions, never perform writes or mutate the document. The storage coordinator's registered handlers validate those contributions and persist document, receipt, project/version records and any required evidence references in one backend transaction. Storage failure publishes neither new document nor version head. Post-commit notifications never perform mandatory durable history writes. Version-only transactions use the same storage coordinator and conflict checks. Unsupported participant/backend combinations fail before committing.

Use the current typed record-change approach as the starting mutation algebra: add/remove/replace records and controlled field updates against identified entities/placements/connectors/extension records, with explicit before-value preconditions. The whiteboard kernel computes forward and inverse operations from the validated before-state; trusted planners return operations rather than arbitrary mutating callbacks. Extension data updates replace an identified JSON value or use schema-validated bounded field operations, preserving opaque unknown records. Do not expose arbitrary JSON Patch as an agent editing API. Transactions reject non-serializable or non-invertible mutations. External side effects such as exports, model calls and simulation starts are excluded from the authored undo algebra.

On persistence failure, retain recoverable draft/intention and report failure; do not announce committed success or add an undo entry. Same operation ID and same request returns original result; reused ID with different payload fails. Async queues and results must be scoped to board/project/branch and disposed on close. Persisted revisions and receipts, not command-palette invocation IDs, govern edit retries.

UndoController records inverse/forward changes with transaction grouping, bounded memory, actor/source attribution and expected applicability. Undo/redo produces a new transaction. Accepted agent proposals count as one local undo step under the accepting human, preserving proposedBy metadata. Branch/document switching, restore and merge define stack behavior explicitly; preserve current behavior first. External revisions invalidate local history when safe inverse application is unavailable. Actor-scoped concurrent undo is future work, not whole-document snapshot overwrite.

Commit metadata includes history intent (`normal`, `undo`, `redo`) and the target undo-entry identity. Undo/redo observations update the existing stack entry rather than recording another normal undo entry; only a successfully committed receipt moves the entry between stacks. Failed/stale/canceled inverse submissions leave stacks intact. New ordinary edits clear redo; serialization prevents nested undo execution. Import/restore/branch changes follow explicitly tested current stack reset/grouping rules rather than inheriting incidental subscriptions.

VersionController owns branches, immutable commits/checkpoints, restore and merge orchestration. Domain policy supplies semantic comparison/conflict resolution and publication requirements; simulation evidence is an input to that policy. Git later implements version import/export/synchronization with explicit mapping to branch identities and merge semantics. Git is not the live editing protocol or assumed byte-for-byte storage backend.

PublicationPolicy is a pure decision over a supplied immutable candidate and evidence bundle, not a reference to a live RunController. A narrow persisted-evidence reader provides that bundle; storage initialization precedes history and simulation construction. This avoids composition cycles and permits publishing from stored runs when the simulator is not mounted. Missing evidence or incompatible fingerprints fail eligibility explicitly. Commit coordinator rechecks the candidate/head/evidence preconditions before publication.

System design owns the minimal evidence summary required by its publication policy; simulation maps its richer run artifact into that summary. Storage stores versioned artifact envelopes and does not import the simulator merely to deserialize records. History sees a policy result and preconditions, not simulator-specific metrics types.

Storage capabilities cover project/document transactions, version records, assets, preferences, execution artifacts and archive portability. A capability collection does not imply atomicity across independent adapters. Current linked operations and publication must share a transaction domain; unsupported compositions fail explicitly. History metadata/head and document/receipt writes requiring atomicity are committed together, with fault-injection tests.

Archives include immutable records, assets and evidence; authored JSON is separately readable and minimal. No destructive database reset is part of extraction. Preserve database names/actor identities during move-only phases. New format adoption is a later gated change with schema version, rejection behavior and recoverable originals; no historical hash rewriting.

## Playback and simulation

playback accepts TrackSource events/samples with explicit time units, duration/frontier, seekability, range and provenance. It provides deterministic clock injection, pause/resume, seek, loop/range, speed and subscriptions. No React Flow geometry or system model in general tracks. Renderers interpret playback state into overlays.

simulation-system-design retains the characterized compiler/kernel, run control, seeded behavior, cancellation, live recording frontier and detailed inspection queries. It consumes an immutable validated system snapshot and owns ExecutionProvider/RunArtifact contracts. It adapts recordings to playback's generic TrackSource contract. Track metadata retains scenario/configuration/fingerprint/provenance; result queries retain current cohort and interval semantics.

Missing or incompatible required execution providers fail compilation with actionable issues; never skip unknown executable nodes and publish partial results as valid. Existing fingerprint/hash algorithms remain unchanged in extraction, with fixtures covering saved evidence. Any later algorithm revision is versioned and explicitly invalidates incompatible evidence rather than silently recomputing historical identities.

Example/authored communication animations never invent measured throughput/latency/capacity. Actual simulation results distinguish assumptions from observations. Preserve existing publication eligibility and evidence checks through system-design policy. Board embedding and basic tools must work without importing simulator or worker code.

## AI assistance and collaboration

First release: humans review agent proposals in the existing workspace. AI collaboration does not require a multiplayer server. Agents inspect board/selection, discover schemas/allowed commands, validate authored data, create diagrams/annotations and submit/status proposals. Both CLI/MCP and host-supplied model clients call the same agents service.

Proposal states: pending -> accepted/rejected; stale/conflicted/expired/disposed are explicit. Proposal carries identity, actor, project/branch/document scope, expected revision, bounded intents/operations, explanation and optional source references. Preview is derived separately from authored state. Accept revalidates schema/domain/permissions/revision and commits one atomic transaction. Reject changes no document/history. A stale proposal requires regeneration or a new explicitly reviewed preview, never silent rebase. Duplicate acceptance returns its receipt; proposals cannot target a closed/different branch accidentally.

ModelProvider supplies generation/cancellation/streaming with host credentials and redaction; no credentials in documents, archives or tool outputs. Context limits are explicit byte/token-estimate budgets with truncation markers and asset references. Agent session capabilities allow inspect/propose by default; direct editing is an explicit opt-in, not implied by pairing or command discovery.

Direct-edit authorization is scoped to the current paired session and board/branch, expires with it and clears on disconnect/revocation/teardown. It is never persisted in project data or restored by agent identity alone.

agent-bridge uses loopback only, explicit short-lived one-use pairing code, origin/host checks, authenticated scoped session tokens, bounded requests/queues, expiry/revocation, reconnect/replay and idempotency. Browser runtime is the editing authority; CLI cannot write browser storage independently. Node server and browser client exports must not import each other's environment code. Test session hijacking/wrong origin/scope, reconnect, duplicate requests and browser closure.

Use explicit `/server` and `/browser` exports with separate build entries and browser dependency-graph checks. A shared protocol module is environment-neutral. Do not rely solely on a bundler's interpretation of conditional exports to hide Node imports.

The CLI companion owns the loopback server; Next.js does not host it. It prints its bound endpoint plus pairing code for explicit entry in the app, avoiding network port scans. Initial transport uses authenticated HTTP requests/long polling with request identities and bounded reconnect, not a required WebSocket implementation. Pairing endpoint uses exact allowed Origin and Host values; bearer credentials stay in memory, not query strings. Hosted HTTPS-to-loopback connectivity must be prototyped in supported browsers before phase 7 is considered complete, including local-network permission denial, CORS, address-space checks and mixed-content behavior. Permission denial produces actionable connection state. Do not assume localhost HTTP development proves hosted compatibility or ask users to disable browser security. Chrome's evolving restrictions are documented in [Chrome's local-network guidance](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/security/local-network-access.md); browser-specific support remains a verification gate rather than an architectural guarantee.

collaboration owns future CollaborationProvider and presence/identity contracts. Its provider ingress submits validated updates through the document authority. CAS-only local mode advertises single-writer/conflict-detection capabilities. Hosted mode requires a deliberate concurrency design (server-ordered operations, OT or CRDT), authorization/invitations, offline reconciliation, persistence consistency and actor undo. Do not promise all providers can share the current revision algorithm. No production hosted provider or invitation UI in this implementation.

## App composition and lifecycle

apps/web builds services through a composition factory with typed returned facades, explicit injected adapters, clock/ID/actor factories and deterministic dispose. Avoid an unrestricted container. Features contribute commands/tools/definitions; presentation registries select defaults or host overrides. React hooks subscribe to stable snapshots and invoke facades.

Feature packages export contribution factories; the host invokes them against selected service instances and disposes their registrations. Importing a package never self-registers globally or bootstraps a second board. If storage initialization fails, expose a typed unavailable state with retry/recovery; the app may offer explicitly labeled temporary in-memory editing and export. Never silently switch a persistent project into volatile storage.

App behavior retained: routes, product shell, theme/responsive layout, palette/forms, panels, notifications, downloads, PWA/metadata and presentation-specific gestures. Packages own edits, navigation/draft decisions, history, simulation, transfer planning, project lifecycle and proposal decisions. A UI can ask for confirmation using a headless decision result; it must not reproduce the decision logic.

All service state is instance-local. Registrations return cleanup; boards dispose subscriptions, roots, workers, transports, timers and queued operations. Next server rendering of public pages must not initialize browser services. Browser editor mount and host portals remain scoped per board. Real embedding host exercises two boards with no mandatory backend/simulation.

### Public API design checklist

Before implementing each package, agree its state owner, factory inputs, subscriptions, commands, failures, cleanup and adapter conformance tests. Factories expose narrow facades rather than mutable implementation fields. Snapshots are immutable with stable identity until state changes; async methods accept AbortSignal where cancellation is meaningful. Cancellation after a successful commit reports the committed result, never a fictitious rollback.

Illustrative API shapes, to be finalized in phase 1:

```ts
// commands owns these definitions; it has no knowledge of BoardDocument.
registry.register(definition); // returns an unregister function
registry.discover({ scope, principal }); // JSON-safe descriptions
registry.execute(id, input, { scope, principal, signal });

// whiteboard owns document/session/transaction/editor contracts.
board.getSnapshot();
board.subscribe(listener);
board.plan(intent, { expectedRevision });
board.commit(transaction, { operationId, actor, expectedRevision });
board.components.register(componentDefinition);
board.tools.register(toolDefinition);

// history owns controllers; whiteboard owns the commit observer/undo port.
undo.getSnapshot(); // canUndo/canRedo and disabled reasons
undo.undo();
versions.createCommit({ message, expectedHead });
versions.restore({ targetId, expectedRevision });

// agents owns Proposal and ModelProvider. Pairing is transport, not approval.
proposals.submit({ scope, actor, expectedRevision, intents });
proposals.preview(proposalId);
proposals.accept(proposalId, { acceptedBy, expectedRevision });
```

These are sketches, not an excuse to expose unvalidated object patches. Define actual typed intents and JSON schemas, safe scope/principal identity and narrow ports before implementation. Identity envelopes used by feature APIs import whiteboard's authored actor/scope types where appropriate; commands may carry a generic principal token/context owned by commands. Do not duplicate actor identity in unrelated packages or turn commands into a domain identity authority.

### Baseline source-to-owner ledger

| Existing source area | Final behavior owner | Presentation owner |
| --- | --- | --- |
| `src/features/workspace/commands` | commands plus feature-owned registrations | apps/web palette/forms and shortcut binding |
| `src/features/session` | whiteboard session/editing, history undo, storage project orchestration | apps/web loading/error decisions |
| `src/features/history`, `src/domain/versioning` | history mechanics, system-design semantic/publication policy | apps/web history/commit/publish panels |
| `src/persistence/studio` | storage coordination and IndexedDB backend, contracts redistributed to consuming owners | no UI |
| `src/domain/studio`, `src/domain/parts` | system-design; general geometry/document types in whiteboard | optional system-design/react |
| `src/features/workspace/CanvasView` and engine projection | editor-reactflow plus whiteboard-neutral projection | adapter host and overridable renderers |
| `src/features/inspector`, `src/features/scenarios` | system-design draft/validation behavior, whiteboard navigation decisions | apps/web inspectors/dialogs |
| `src/features/library`, linked projects and parts | system-design catalog/parts/link resolution; storage catalog retrieval | apps/web library and linked-project panels |
| `src/features/runs` and kernel/compiler | simulation-system-design run/query behavior, playback clock/timeline | apps/web controls/results plus optional renderers |
| `src/features/transfer` | storage archives; system-design semantic exporters; editor visual export capability | apps/web file picking/download/presentation |
| `src/features/workspace/panels`, entry/shell/App | app-local layout/navigation composition; extract pure preference serialization into storage capabilities | apps/web |
| `src/components/ui`, foundation styles/theme | ui | ui |

Some files contain several owners and must be split, not moved intact. In particular Workspace, SessionController, the command registry and StudioRepository deserve explicit extraction maps before parallel implementation assignments.

## Implementation sequence and gates

Each phase integrates into the existing app and ends with a runnable parity check. No parallel new app becomes the product.

The inventory is the target boundary, not sixteen simultaneous migrations. Establish build tooling once, use ESM and explicit browser/Node entries, and extract only packages needed by each phase. The second editor is a small contract test double, not a second production renderer. It checks that engine types/state have not leaked; it does not recreate the app or all React Flow gestures.

1. **Baseline and parity ledger.** Record current routes, commands, authoring gestures, inspector drafts/guards, multi-view/refinements, scenarios, run inspection, history/merge/publication, reusable parts, linked projects, import/export, embedding, themes and PWA. Run baseline checks and identify inherited failures before editing. Agree package contracts and dependency graph in small ADRs. Complete the field-by-field ownership ledger (authored board, domain extension, project metadata, session, presence, asset or execution artifact), transaction/inverse algebra and storage cutover decision before phase 4.
2. **Workspace scaffolding and leaf extraction.** Introduce npm workspaces and apps/web. Extract foundation ui and feature-agnostic playback primitives that have no unresolved application imports. Keep system model and simulation code in the app until their real dependency owners exist; do not create packages that import apps/web internals or publish placeholder re-exports. Existing app remains fully functional; preserve storage schema and behavior.
3. **Commands.** Phase 3a extracts the generic registry and feature registrations from the current closed registry with no UI behavior change. Product UI commands remain app registrations. Wire current menus/buttons/F2/shortcuts to it and verify parity. Phase 3b separately adds Cmd+K. Preserve payload validation and execution-time availability. No new editing model yet.
4. **Whiteboard and editor.** Entry gate: approve an authority-cutover ADR and complete field ownership ledger. Extract/rework the existing SessionController rather than wrapping it with a second writable controller. Its editing kernel becomes whiteboard; temporary app facades delegate one way to that kernel. Stop accepting old-controller writes at an app-reload boundary; no live hot migration of in-flight gestures/drafts/undo. Flush or recover pending work before reload. Undo state remains session-local and can restart on normal app reload, matching current lifecycle. Preserve existing domain identity and current persisted format through an explicit codec until a separately gated format cutover; codec is a persistence projection, not another editable document. Extract system-design and whiteboard together where their new ownership contracts require it. Replace engine-dependent public types. Migrate current CanvasView and renderers to adapter. Retain current guards/selection/refinement behavior. Test against a second minimal adapter.
5. **Storage and history.** Move pure repository coordination and record contracts to owners, Dexie implementation to adapter. Split SessionController undo from editing and versioning controllers from UI. Extract project lifecycle and transfer capability. Establish atomic receipt/history/document writes and storage conformance tests. No wholesale snapshot-based simplification.
6. **Complete composition.** Remove direct service construction from Workspace; inject feature facades. Integrate system semantics, simulation/playback, parts/links/publication policies and optional UI. Move app shell/panels into apps/web. Finish full parity ledger before introducing AI.
7. **Agents.** Implement proposal service, model adapter, pairing/bridge, CLI/MCP and existing-workspace proposal UI. Verify attribution, stale cases, accept/reject/idempotency/undo and session teardown. Collaboration interfaces declare actual supported concurrency capabilities.
8. **Basic tools and extensibility proof.** Implement working initial shapes/text/freehand through public APIs, optional default renderers and custom host override. Use a small trusted extension without changing whiteboard internals. Ensure custom semantic data survives round trips and disabled capability behavior is visible.
9. **Packaging and release verification.** Public exports/declarations, minimal host examples, package README/schema/examples, build boundaries, app/Storybook/browser checks, updated handoff/action history. Remove temporary internal facades only after all consumers switch. Implementation completion requires full existing app plus AI, not just packages compiling.

The BoardDocument ownership model and full conversion are phase-4 entry requirements, not discoveries after package extraction. Current storage encoding may remain temporarily behind the explicit codec; there is still only one editable in-memory representation. Any general BoardDocument transition must cover elements, views, groups, notes, scenario/refinement/link data. Do not leave a system snapshot embedded beside an independently editable generic document. Reuse and adapt current algorithms instead of rewriting everything at once.

## Verification and acceptance

- Existing unit and production journeys cover authoring, draft guards, history, transfer, publication, linked projects and simulation without reduced functionality. Feature parity ledger has no absent rows at completion.
- Commands conformance: registration/disposal/duplicate checks, typed schema errors, availability changes, execution recheck, scoped keyboard handling, cancellation, agent allowlists and app-only actions.
- Headless packages import in Node with DOM globals unavailable and dependency inspection proves no React/Next/Dexie/React Flow leakage. Package exports work from built artifacts in a real consumer.
- Editor conformance: React Flow and test adapter execute same operations, selection/viewport/coordinate/geometry/capability contracts. Custom renderer override, missing renderer fallback and unsupported tools are tested.
- Transaction tests: atomic failure injection, concurrent revision conflict, receipt retries and payload mismatch, inverse grouping, branch changes, restore/merge and exact acceptance undo behavior.
- Storage conformance: memory and IndexedDB pass the same behavioral suite; archives/assets/history/evidence preserve integrity and current original data remains recoverable.
- Simulation characterization remains unchanged; authored playback has explicit provenance and no measured claims; basic board does not import simulation.
- Agents: paired scope/origin validation, expiry/revocation, bounded context, invalid/stale/duplicate proposals, reconnect, accept/reject attribution/undo, browser close and credential separation.
- Two boards in real Next host operate independently, with scoped portals/styles and no mandatory simulation/storage. Next public SSR, routing/basePath/PWA and existing responsive/theme presentation remain valid.
- Run `npm test`, package/type/import checks, `npm run build`, `npm run build-storybook`, isolated `TEST_PRODUCTION=1 npm run test:e2e` and embedding consumer tests. Run heavy suites separately; report inherited flakes rather than masking them.

## Scalability constraints

Package count does not make the app scalable by itself. Measure baseline large-board editing, command search, run recording and archive workloads before changing representations. Preserve structural sharing, subscribe to relevant state slices, index entities/placements/endpoints and avoid serializing the full document on every pointer move. Domain validators declare affected namespaces/references for incremental validation, with full validation on import and checkpoints as a correctness backstop.

Use record-based inverse operations with bounded undo retention rather than cloning whole projects on every edit. Asset bytes and large run recordings stay outside authored JSON; recordings use bounded/chunked queries and playback does not materialize every event for every frame. Long-running simulation/source analysis stays off the UI thread. Set configurable document/proposal/request/asset limits and expose explicit limit errors rather than partially accepting malformed input. Add measured regression budgets after the baseline; avoid arbitrary CI timing assertions before representative workloads exist.

## Future work

Hosted human collaboration/invitations/roles, offline synchronization and concurrent actor undo; Git version import/export/sync; plugin distribution/permissions/sandboxing; richer freeform editing; source-analysis adapters for code/API/infrastructure/traces with provenance/confidence and reviewable incremental proposals; simulation calibration against measured workloads with explicit questions, repeated seeds and sensitivity analysis.

## Review record

Independent read-only reviews completed through the [delegate skill](../.agents/skills/delegate/SKILL.md): Gemini `gemini-3.1-pro-high` and Claude `claude-sonnet-4-6`. Both requested revisions to the initial draft. The lead incorporated their concrete findings; this revised document has not received a second independent approval pass.

| Review finding | Resolution |
| --- | --- |
| Gemini: document persistence followed by history writes cannot be atomic | Added pre-commit participants and one complete storage transaction; post-commit undo observer never writes required durable history |
| Gemini: domain validation, port references and inverse operation algebra unspecified | Added injected validators/resolvers, stable semantic endpoint IDs, dependency-aware planners and kernel-generated record inverses |
| Gemini: sixteen simultaneous extractions are risky | Explicit incremental extraction; each phase retains full app parity |
| Gemini: loopback transport/browser restrictions unresolved | CLI-owned endpoint, explicit pairing, separate environment exports and hosted browser connectivity gate; checked official Chrome guidance |
| Claude: package moves precede their dependencies | Deferred model/simulation extraction until real owners exist; no package imports app internals |
| Claude: document authority/format cutover vague | Phase-1 field ledger and phase-4 authority ADR; extract existing kernel, one-way transitional facades and app-reload cutover |
| Claude: React feature subpaths hide dependencies | Generic react package has no feature imports; feature bindings stay in feature presentation entries |
| Claude: publication service cycle and undo re-entrancy | Pure policy over persisted evidence; explicit undo/redo history intent and receipt-driven stack transitions |
| Claude: direct-edit lifetime, provider absence and environment exports vague | Session-only authorization, fail-fast execution providers, explicit browser/server builds and bundle checks |

Recommendations deliberately not adopted: collapsing editor/history/simulator/backend into a few mixed packages would weaken the requested replaceability; a test adapter remains a small conformance fixture rather than another product renderer; storage failure never silently falls back to volatile memory. No guarantee that simply choosing WebSocket or localhost development bypasses browser security.

Review state and full outputs: `.delegate/runs/20261011-121033/state.json` (local, ignored). Implementation still requires the phase-specific contract/cutover decisions and acceptance gates above.
