# Requirements and acceptance contracts

These IDs must appear in work packages and review evidence. Confirmed feature scope does not settle the open semantics in `decisions.md`.

## R01 — Preserve the product

Preserve useful capabilities: project creation/rename/switch, templates/guides, configuration, scenario/workload editing, run controls, measured results/compare/restore, autosave/checkpoints, canvas authoring, notes/grouping/layout and JSON/SVG/PNG transfer. Replace old revision/mode UX with the agreed history/scenario model. D19 permits dropping old-data compatibility and obsolete implementations; archive viewers, legacy engine replay and old import formats are not required.

Acceptance: tests for retained behavior pass; tests specific to removed modes/formats are deliberately retired with a recorded replacement/reason. Catalog totals derive from actual entries; a component claims only its explicitly modeled behavior. Deleting obsolete tests does not excuse a current capability regression.

## R02 — Foundation fidelity

Evergreen tokens and explicit semantic variants govern the app. Components cover rest, hover, pressed, focus-visible, selected, disabled, loading and invalid states where applicable. Domain editors compose shared controls; custom appearance belongs in the foundation rather than repeated screen overrides.

Acceptance: reviewed specimen matrix plus browser computed-style checks on representative Button, Input, Switch, Tabs and overlay instances. Verify readable text, visible focus, nested menus, portal positioning, keyboard operation and long labels. No application runtime dependency on exported design HTML/JSX.

## R03 — Shell and commands

One project identity, a distinct branch switch target when versioning is ready, one main Run action, History/Library entry points, overflow/project actions and a searchable command surface. Every menu item invokes an available capability or states why it is unavailable. No fake sharing, team membership or generation controls.

Acceptance: project switch flushes or safely handles autosave failure; rename preserves identity/history; Escape restores focus; command availability respects selection, model readiness and run state. Browser-reserved shortcuts in specimens (e.g. Cmd+R/H) are not copied blindly. Define one collision-reviewed shortcut map, ignore text entry/composition and show platform-appropriate key labels.

## R04 — Panel workspace

History and Library can dock left/right, float, stack on a side and collapse to a rail. Their contents retain state across placement changes. Header placement menus provide a full alternative to dragging. Dragging exposes targets; Escape cancels; pointer cancellation restores the pre-drag state. Widths are remembered per side. Reset width and close remain available.

Acceptance: test each 23A–G state; keyboard placement/resize; touch placement; both side stacks; reopening; short viewport; window shrink and reload. Canvas geometry responds without losing the user's camera/selection. Floating rectangles are clamped so the header and close controls remain reachable. Panel operations do not create graph undo entries or reset simulation. Placement is not undoable through graph Cmd/Ctrl+Z; Escape cancels an in-progress placement/resize. Inspector occupancy follows D23 and its RV-02f numeric breakpoint/geometry contract.

## R05 — Canvas and dock

Keep XYFlow interaction behavior while restyling nodes, edges, boundaries, notes, selection and the single main floating dock. Dock commands come from one registry, with selection-aware enablement. Include customization, ordering, overflow and restore defaults. All customization works without drag.

Acceptance: create/connect/move/duplicate/delete, undo/redo, multi-select/group/align/distribute, notes, expand/collapse and viewport preservation remain correct. Drag/move changes remain atomic undo operations. No duplicate global dock. Selection-local actions must not obscure handles or intercept canvas gestures. Metrics in nodes remain observed, not configured capacity presented as throughput.

## R06 — Contextual editing

Configuration, validation and measured results remain separate. The new inspector visually follows `2A workspace` but preserves all behavior-specific settings and read-only restrictions. D10 confirms draft editing.

Draft acceptance: edit several fields without mutating the engine model; invalid Apply preserves the draft and focuses the first error; valid Apply updates atomically; Cancel restores the original values; one Undo reverses the whole Apply. Selection/project/branch changes and closing a dirty inspector use an explicit Apply/discard/cancel path. A run must use committed editor values; never silently run unapplied fields. Concurrent external changes to the same target are detected before Apply.

Run cannot start while a configuration draft is dirty. Explain that the user must Apply or Cancel first; invalid/stale/failed Apply keeps Run blocked and preserves the draft. No Run applied version bypass, implicit Apply, or silent discard. After successful Apply or Cancel the user can invoke Run normally; it uses an immutable applied snapshot. This governs toolbar, shortcuts and command entry points equally.

Workload editing acceptance: retain workload enablement, entry target, rate/interval/profile, timeout, named request classes, weights, operations, tags and key distribution where resource scenarios use them. Validate the whole draft atomically; add/remove/edit classes and workloads must survive reload and one-step undo without silently substituting defaults. Pure logical scenarios expose typed input events/fixtures rather than irrelevant traffic-rate fields. RV-05 owns this surface and R13 owns resulting run behavior.

## R07 — Library and reusable parts

Catalog and saved parts share search, categories, list/grid views and a focus/touch-accessible detail surface. Dock entry and panel entry use the same content/actions. Include save-selection-as-part and placement; do not fabricate a team catalog.

D30 confirms one live Library instance. Invoking Library from any entry focuses/expands the existing panel or opens its last valid placement; the dock icon indicates open state. Do not open a second compact picker while the panel is open. History also retains a single panel instance; focus/open and explicit close/toggle are distinct commands.

Proposed copy contract: a placed part creates fresh IDs, remaps internal edges/note attachments/subsystems, preserves relative positions and valid configurations, and inserts once into undo history. No live link back to its source. External edges are not silently included. Save/placement rejects invalid selections or limits before partial mutation.

Acceptance: source and placed copies can be edited independently; imports cannot introduce dangling executable references, collisions or unsafe markup; empty search has a clear recovery; revisions of a saved part do not change existing placements. Final inclusion rules and retention limits must be approved in the contract gate.

## R08 — Local history, branches and publishing

History presents working edits, immutable commits and published versions. A branch has its own working state and parent history. Publishing merges explicitly into local main, checks its expected head, resolves conflicts, validates the result and creates an immutable published record atomically. D20/D27/D28 govern run/check requirements; D11 governs branch switching. Publications cannot be undone (D26); corrections use new verified commits/publications. Source branch closes by default after successful publication, with preserved work/history and explicit reopening (D29). Failure/cancel leaves branch closure unchanged.

Acceptance: initially no uploads or authenticated-author claims; branch working state survives reload; run evidence matches exact executable state, scenario inputs/check definitions/scope/assumptions, seed and runner version. Commit/publication requires completed passing evidence for every configured scenario, with at least one scenario. No diagram exemption, required-subset selector, disabled-scenario bypass or failed-check override. Failed, skipped, errored or unevaluated checks do not count as passing. Updating checks changes identity and requires rerunning. Autosave/checkpoints preserve incomplete/failing work. Publish cannot succeed with unresolved conflicts or a moved main head. Cancel/failed persistence leaves source and target intact. Old-data compatibility is not required.

## R09 — Results and run evidence

Compact strip plus expandable General/Components detail. Preserve live versus completed versus saved/imported provenance, elapsed duration, root/message distinctions, workload comparability and units. Reveal on canvas and Open settings refer to the correct node/run context.

Acceptance: no results before measurement, no decorative fake series, no unsupported p99/pressure/prediction. Each added metric has a documented source, definition, sample interval, aggregation, denominator and unavailable state. Partial runs are labelled partial. Stop/Pause/Reset behavior is explicit. A current editor graph cannot silently replace a saved run's snapshot in details.

## R10 — Entry and transfer

Retain templates, blank canvas and validated import; refresh their presentation. D12 defers natural-language generation and includes CSV and Mermaid. Share/move-to-team from the boards remain excluded from this local-only release.

JSON remains the lossless portable project format; Mermaid is an explicitly lossy diagram representation; CSV exports selected run metrics with units/provenance, protects spreadsheet formula interpretation and does not fabricate missing values. Export feature limitations are stated at the action, not buried in documentation.

Minimum Mermaid output: selected authored view's element names, directed connections with available labels and relationship kinds, and wholly represented subsystem boundaries where Mermaid subgraphs can express them. Generate collision-free IDs independently of labels and escape untrusted labels. Notes, positions/appearance, typed behavior/resource configuration, scenarios, history and observed metrics are explicitly omitted; structural arrows are descriptive, not executable calls. No Mermaid import/round-trip promise. RV-02g defines exact syntax/escaping and unsupported nesting fallback before implementation.

## R11 — Accessible adaptive behavior

Preserve full small-screen editing as confirmed in D14. Every hover/drag affordance has keyboard/touch access; visible focus and meaningful labels; overlays return focus; invalid fields link to errors; colors have textual equivalents. Review contrast against WCAG AA, including focus/non-text controls, and record any visual deviation needed.

Acceptance: desktop reference sizes plus 1024×768, 768×1024 and 390×844; 200% text zoom; long names; empty/large data; reduced motion. Narrow screens contain the canvas and use usable panels without page-level horizontal scrolling. No introduction of a dark theme based solely on an alternative board.

Evergreen paper is light-only in this scope, including when the OS prefers dark mode; native controls use the same light color scheme. A future dark theme needs its own design. Contrast corrections are centralized in [foundation accessibility](contracts/foundation-accessibility.md).

## R12 — Resumable delivery

Every implementation task has an owner, base commit, exact allowed files, dependencies, referenced screens/requirements, expected evidence and a checkpoint. Claude reviews foundations, state/persistence and each merged feature; Codex accepts/rejects against requirements. No task becomes DONE from an implementer's assertion alone.

## R13 — Runnable models across use cases

One authoring model supports behavioral scenarios for frontend, backend/service, code/data flow and infrastructure, with fullstack composition. Run uses modeled inputs and behavior, traces/assertions and optional timed resource simulation. Actual source-code execution is deferred. S01–S05 in `execution-model.md` define lead-proposed acceptance examples to refine in contract review.

Acceptance: each family has a deterministic input/output fixture and a failure case; structural relationships never accidentally execute as calls; view collapse does not change behavior; aggregate/refined submodels do not double-count work. Missing behavior blocks the affected scenario with actionable issues; partial coverage is explicit. No latency/throughput is invented for purely logical runs.

The specific acceptance traces, outcomes and failure cases are defined in [execution slices](contracts/execution-slices.md); a trivial arbitrary example per family does not satisfy R13. Exact shared types and adapter interfaces remain gated through the [contract register](contracts/README.md).

## R14 — Deployment-independent local core

Design model, command, repository, run and sync boundaries for local, hosted and self-hosted bundles. Initial implementation stays local; GitHub/server sync and async team workflows are future delivery tracks; live coediting comes later. Model identity cannot depend on a specific auth or storage provider.

Acceptance now: no credentials/vendor identity embedded in portable documents; stable IDs, explicit revision checks and separation of shared content/personal preferences/run artifacts. Future remote acceptance must distinguish saved-locally/synced/published, enforce permissions server-side and recover idempotently from interrupted sync. Self-hosting cannot require a company-hosted API.

## R15 — Future canvas-based AI collaboration

The future AI buddy discusses and proposes app-development decisions/changes against structured project context. Canvas-linked decisions, proposals and evidence become durable records rather than depending on external Markdown or chat history. No AI service, chat UI, code agent or provider integration is included now.

Acceptance now: current domain commands, stable references, candidate diff/validation, provenance and run identity can be reused by a later agent adapter without bypassing invariants or scraping the UI. RV-02 documents extension seams for future decision/proposal/code-evidence records without creating unused subsystems. Local operation remains independent of AI. See `ai-collaboration.md` for future workflow and review criteria.
