# Canvas-first workspace

Status: execution authorized on 15 September 2026. Previous simulator checkpoint: `6f1c601` (233 unit tests, 44 production browser tests, production build). Implement on `codex/canvas-first-workspace`.

## Product decision

Apply the six accepted concept samples as complementary states of one workspace. Keep the existing light palette, React Flow canvas, domain/runtime and persistence contracts. The image is composition guidance; real controls, constraints and metrics must come from current source. Node and connection settings replace each other in one inspector; the mockup's simultaneous settings are not a requirement.

## Layout and interaction contract

1. **Canvas first:** compact top bar with brand, project menu, Add component, Workloads, Undo/Redo and Run/Pause/Reset. Remove the permanent full catalog and large explanatory heading/footer. The Add component drawer is searchable, includes all 29 kinds and current limits, and can stay open for repeated additions. Project tools expose Examples & tutorials, checkpoints, revisions, saved runs, exports and model assumptions. Empty state offers Add component with a secondary Examples action.
2. **One contextual inspector:** one right-side panel region, with mutually exclusive node, connection, note, subsystem, workload or tutorial content. A node/edge selection opens its configuration; a canvas click clears the inspector. Closing the panel clears its selection where appropriate. Workload/tutorial panels use explicit close buttons. Panels use stable viewport space, never float over graph controls. On narrow screens use a bounded, scrollable panel below the canvas and maintain a usable canvas height.
3. **Workloads:** global seed/duration and workload editing live in a dedicated panel opened by Workloads. Show compact workload summaries; disclose arrival settings, request classes and key distributions only when editing. Node Generate Traffic opens that workload panel. Preserve exact existing behavior, bounds, validation and stable workload IDs; no simulation reset for merely opening/closing a panel.
4. **Results:** before a run show compact readiness text and expandable actionable validation details. After time advances show a compact summary with state/time, root throughput, p95 and failures, plus Details, Compare and Save result when applicable. Details reveals real request/message/resource counters. Compare opens existing saved results. Opening results must not alter model or restart execution. Incomplete/error runs remain visibly incomplete and cannot be saved. Root failure total uses rejected + failed + expired and cannot be confused with async message outcomes.
5. **Selection:** retain Select/Pan/zoom/fit and right-click grouping. Show alignment/distribution only for eligible multi-selection. Keep a reachable touch/keyboard selection checklist via Selection actions without a persistent organizer covering nodes. Preserve node selection, selected-set dragging, context menu, group naming/rename/collapse/ungroup, notes and undo. Right-click on blank canvas exposes Add note; keyboard/touch equivalent remains available. Never allow a form keypress to mutate canvas selection.
6. **Tutorials:** optional tutorial panel selected through Examples & tutorials in project tools. Close hides guidance without changing model, guide metadata or ongoing run; allow reopen while a guide is associated. Loading a different example remains one undoable model replacement. UI panel state is ephemeral, resets on project switch and never enters exports or simulation signatures.

## Implementation boundaries

- Packet A: small shared presentation contracts and inspector/workload presentation changes; assigned components only. Build and focused tests.
- Packet B: App shell, panel coordination, canvas selection/edge callbacks and compact results integration. UI-only state and props; no runtime or persistence changes. Build plus new focused browser journeys.
- Packet C: update existing browser journeys for intentional UI entry points while preserving semantic assertions; run full unit/build/browser checks and report actual exit codes. Fix defects in owned UI files under the same scope. No skipping, forced clicks, silent fallbacks, weakening bounds/accounting or arbitrary sleeps to hide failures.

The lead may combine tightly dependent UI files into one packet to avoid conflicting ownership. Documentation reconciliation is allowed after implementation. Do not add shared-team infrastructure, new simulation semantics, dependencies or unrelated design work.

## Acceptance

- Blank app has a large visible canvas, compact header and no open inspector/catalog/results detail. All 29 kinds, examples, project data and exports are reachable.
- Build source → processor → storage manually through handles; configure traffic, run, inspect separate root/message metrics, save and compare.
- Selecting an edge replaces the node inspector; no connection overlay covers nodes. Closing controls restores keyboard focus appropriately.
- Workloads and tutorials open/close during a paused/running simulation without resetting time or results. Node Generate Traffic is discoverable and opens the workload editor.
- Multi-select → right-click → group, rename/collapse/ungroup, align and drag retain exact behavior and undo. Mobile selection actions provide the equivalent path.
- Notes, checkpoints, revisions, saved results, portable export/import, read-only archive reopen and runnable-copy preservation continue to pass.
- Desktop and 390px mobile screenshots verify density, readable controls, no horizontal page overflow and usable canvas dimensions. Use one visual inspection batch plus at most one confirmation after fixes.
