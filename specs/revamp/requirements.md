# Requirements and acceptance contracts

These IDs must appear in work packages and review evidence. Confirmed feature scope does not settle the open semantics in `decisions.md`.

## R01 — Preserve the product

All currently supported project creation, rename/switch, templates, guides, configuration, traffic/workload editing, run/pause/resume/reset/replay, live metrics, saved results/compare/restore, checkpoints/revisions, diagram editing, notes, grouping, layout, JSON import/export and SVG/PNG export remain reachable. Archive restrictions remain effective in state actions, not just disabled UI.

Acceptance: existing unit and production browser journeys pass or are deliberately updated for approved interaction changes with equivalent assertions. A navigation relabel is not permission to delete a capability. Catalog totals are derived from actual entries; diagram-only components never claim executable behavior.

## R02 — Foundation fidelity

Evergreen tokens and explicit semantic variants govern the app. Components cover rest, hover, pressed, focus-visible, selected, disabled, loading and invalid states where applicable. Domain editors compose shared controls; custom appearance belongs in the foundation rather than repeated screen overrides.

Acceptance: reviewed specimen matrix plus browser computed-style checks on representative Button, Input, Switch, Tabs and overlay instances. Verify readable text, visible focus, nested menus, portal positioning, keyboard operation and long labels. No application runtime dependency on exported design HTML/JSX.

## R03 — Shell and commands

One project identity, a distinct branch switch target when versioning is ready, one main Run action, History/Library entry points, overflow/project actions and a searchable command surface. Every menu item invokes an available capability or states why it is unavailable. No fake sharing, team membership or generation controls.

Acceptance: project switch flushes or safely handles autosave failure; rename preserves identity/history; Escape restores focus; command availability respects selection, archive state and simulation state. Browser-reserved shortcuts in specimens (e.g. Cmd+R/H) are not copied blindly. Define one collision-reviewed shortcut map, ignore text entry/composition and show platform-appropriate key labels.

## R04 — Panel workspace

History and Library can dock left/right, float, stack on a side and collapse to a rail. Their contents retain state across placement changes. Header placement menus provide a full alternative to dragging. Dragging exposes targets; Escape cancels; pointer cancellation restores the pre-drag state. Widths are remembered per side. Reset width and close remain available.

Acceptance: test each 23A–G state; keyboard placement/resize; touch placement; both side stacks; reopening; short viewport; window shrink and reload. Canvas geometry responds without losing the user's camera/selection. Floating rectangles are clamped so the header and close controls remain reachable. Panel operations do not create graph undo entries or reset simulation. Inspector occupancy policy is decided before integration.

## R05 — Canvas and dock

Keep XYFlow interaction behavior while restyling nodes, edges, boundaries, notes, selection and the single main floating dock. Dock commands come from one registry, with selection-aware enablement. Include customization, ordering, overflow and restore defaults. All customization works without drag.

Acceptance: create/connect/move/duplicate/delete, undo/redo, multi-select/group/align/distribute, notes, expand/collapse and viewport preservation remain correct. Drag/move changes remain atomic undo operations. No duplicate global dock. Selection-local actions must not obscure handles or intercept canvas gestures. Metrics in nodes remain observed, not configured capacity presented as throughput.

## R06 — Contextual editing

Configuration, validation and measured results remain separate. The new inspector visually follows `2A workspace` but preserves all behavior-specific settings and read-only restrictions. D10 confirms draft editing.

Draft acceptance: edit several fields without mutating the engine model; invalid Apply preserves the draft and focuses the first error; valid Apply updates atomically; Cancel restores the original values; one Undo reverses the whole Apply. Selection/project/branch changes and closing a dirty inspector use an explicit Apply/discard/cancel path. A run must use committed editor values; never silently run unapplied fields. Concurrent external changes to the same target are detected before Apply.

## R07 — Library and reusable parts

Catalog and saved parts share search, categories, list/grid views and a focus/touch-accessible detail surface. Dock entry and panel entry use the same content/actions. Include save-selection-as-part and placement; do not fabricate a team catalog.

Proposed copy contract: a placed part creates fresh IDs, remaps internal edges/note attachments/subsystems, preserves relative positions and valid configurations, and inserts once into undo history. No live link back to its source. External edges are not silently included. Save/placement rejects invalid selections or limits before partial mutation.

Acceptance: source and placed copies can be edited independently; imports cannot introduce dangling executable references, collisions or unsafe markup; empty search has a clear recovery; revisions of a saved part do not change existing placements. Final inclusion rules and retention limits must be approved in the contract gate.

## R08 — Local history, branches and publishing

History presents working edits, immutable commits and published versions. A branch has its own working state and parent history. Publishing merges explicitly into local main, checks its expected head, resolves conflicts, validates the result and creates an immutable published record atomically. D09 governs run requirements; D11 governs branch switching.

Acceptance: no uploads or authenticated-author claims; branch working state survives reload according to policy; run evidence matches the exact executable state, workload, seed and engine version; editing after a run invalidates eligibility where required. Publish cannot succeed with unresolved conflicts or a moved main head. Cancel/failed persistence leaves source and target intact. Older revisions/checkpoints/results remain accessible with truthful legacy labels. Diagram exceptions must be visible rather than producing a fake run.

## R09 — Results and run evidence

Compact strip plus expandable General/Components detail. Preserve live versus completed versus saved/imported provenance, elapsed duration, root/message distinctions, workload comparability and units. Reveal on canvas and Open settings refer to the correct node/run context.

Acceptance: no results before measurement, no decorative fake series, no unsupported p99/pressure/prediction. Each added metric has a documented source, definition, sample interval, aggregation, denominator and unavailable state. Partial runs are labelled partial. Stop/Pause/Reset behavior is explicit. A current editor graph cannot silently replace a saved run's snapshot in details.

## R10 — Entry and transfer

Retain templates, blank canvas and validated import; refresh their presentation. D12 defers natural-language generation and includes CSV and Mermaid. Share/move-to-team from the boards remain excluded from this local-only release.

JSON remains the lossless portable project format; Mermaid is an explicitly lossy diagram representation; CSV exports selected run metrics with units/provenance, protects spreadsheet formula interpretation and does not fabricate missing values. Export feature limitations are stated at the action, not buried in documentation.

## R11 — Accessible adaptive behavior

Preserve full small-screen editing as confirmed in D14. Every hover/drag affordance has keyboard/touch access; visible focus and meaningful labels; overlays return focus; invalid fields link to errors; colors have textual equivalents. Review contrast against WCAG AA, including focus/non-text controls, and record any visual deviation needed.

Acceptance: desktop reference sizes plus 1024×768, 768×1024 and 390×844; 200% text zoom; long names; empty/large data; reduced motion. Narrow screens contain the canvas and use usable panels without page-level horizontal scrolling. No introduction of a dark theme based solely on an alternative board.

## R12 — Resumable delivery

Every implementation task has an owner, base commit, exact allowed files, dependencies, referenced screens/requirements, expected evidence and a checkpoint. Claude reviews foundations, state/persistence and each merged feature; Codex accepts/rejects against requirements. No task becomes DONE from an implementer's assertion alone.
