# Requirements

Work packages and reviews cite these IDs. Exact rules live in the linked contracts.

## R01 — Keep the product

**Keep:** project create/rename/switch; templates and guides; configuration; scenario and workload editing; run controls; measured results with compare/restore; autosave/checkpoints; canvas authoring; notes/grouping/layout; JSON/SVG/PNG transfer. The old revision and mode UX is replaced by the new history/scenario model. Archive viewers, legacy replay and old formats are dropped (D19).

**Accept:**
- Tests for kept behavior pass.
- Tests for removed modes are retired with a recorded reason; deleting obsolete tests never excuses a regression in a current capability.
- Catalog totals come from real entries, and components claim only the behavior they model.

## R02 — Foundation fidelity

Evergreen tokens and semantic variants everywhere. Components cover rest, hover, pressed, focus-visible, selected, disabled, loading and invalid states. Editors compose shared controls, and appearance lives in the foundation, not per-screen overrides.

**Accept:**
- A specimen matrix, plus browser computed-style checks on Button, Input, Switch, Tabs and overlays.
- Readable text, visible focus, nested menus, portal positioning, keyboard use and long labels.
- No runtime dependency on the exported design HTML/JSX.

## R03 — Shell and commands

One project identity, a separate branch switcher, one Run action, History/Library entries, overflow actions and a searchable command surface. Every item works or says why it's unavailable. No fake sharing, team or generation controls.

**Accept:**
- Project switch flushes autosave or handles its failure; rename keeps identity and history.
- Escape restores focus.
- Availability follows selection, readiness and run state.
- One collision-checked shortcut map ([commands.md](contracts/commands.md)) with platform key labels; shortcuts are ignored while typing or composing.

## R04 — Panel workspace

History and Library can dock left/right, float, stack on a side and collapse to a rail, keeping their contents across moves. Header menus fully replace dragging. Dragging shows targets; Escape or pointer-cancel restores the prior state. Widths are remembered per side; reset width and close are always available. Inspector space follows D23.

**Accept:**
- Each 23A–G state; keyboard and touch placement and resize; both side stacks; reopen.
- Short viewport, shrink and reload; floating panels are clamped so header and close stay reachable.
- Canvas camera and selection survive layout changes.
- Panel actions create no graph undo and don't reset the simulation.

## R05 — Canvas and dock

Keep XYFlow behavior while restyling nodes, edges, boundaries, notes, selection and the single floating dock. Dock commands come from the registry with selection-aware enablement; customization, ordering, overflow and restore defaults all work without drag.

**Accept:**
- Create/connect/move/duplicate/delete, undo/redo, multi-select/group/align/distribute, notes, expand/collapse, viewport preservation.
- Moves are atomic undo steps; no duplicate dock.
- Selection actions don't cover handles or steal canvas gestures.
- Node metrics show observed values, never configured capacity as throughput.

## R06 — Contextual editing

The inspector follows `2A workspace` and keeps every behavior-specific setting, with configuration, validation and measurements separate. Drafts use Apply/Cancel (D10).

**Accept:**
- Multi-field edits don't touch the model until Apply. An invalid Apply keeps the draft and focuses the first error; a valid Apply is atomic; Cancel restores; one Undo reverses an Apply.
- A dirty draft on selection/project/branch change or close asks Apply/Discard/Stay.
- External changes to the same target are detected before Apply.
- **Run is blocked while a draft is dirty (D25)**, from the toolbar, shortcut and command alike. It runs only after Apply or Cancel, on an immutable applied snapshot.
- **Workloads** keep enablement, entry, rate/interval/profile, timeout, request classes, weights, operations, tags and key distribution, and survive reload and one-step undo without silent defaults. Pure logical scenarios expose typed input events, not traffic-rate fields.

## R07 — Library and parts

Catalog and saved parts share search, categories, list/grid views and a focus/touch-accessible detail view. The dock and panel entries use the same content. Save-selection-as-part and placement are included; no team catalog. One Library instance (D30): every entry point focuses/expands it or opens its last valid placement, the dock icon shows its open state, and no second compact picker opens while it's open. History is also a single instance, with open and close as distinct commands.

**Accept:**
- A placed part gets fresh IDs, remapped internals and relative positions, and inserts as one undo; no link back to its source.
- External edges are never silently included, and invalid selections or limits are rejected before any mutation.
- Source and copy edit independently; imports can't add dangling references or unsafe markup; empty search has a way out.
- New part revisions don't change existing placements.
- Rules: [parts-and-export.md](contracts/parts-and-export.md).

## R08 — Local history, branches, publishing

History shows working edits, immutable commits and publications, and each branch has its own working state (D11). Publishing merges explicitly into local main with a head check, conflict resolution, validation and an immutable record, atomically. Commit and publish need passing runs for every scenario (D20/D27/D28). No publication undo (D26). The source branch closes by default and can reopen (D29).

**Accept:**
- **No false claims:** no uploads and no claims of authenticated authors.
- **Branches:** working state survives reload.
- **Run evidence:**
  - It matches the exact executable state, inputs, checks, scope, assumptions, seed and runner version, and there is at least one scenario.
  - Failed, skipped, errored or unevaluated checks don't pass.
  - Changing a check requires a rerun.
  - No diagram exemption, subset selector, disabled-scenario bypass or failure override.
- **Incomplete work** goes to autosave or checkpoints.
- **Publish:** fails on unresolved conflicts or a moved main. A cancelled or failed publish leaves both branches intact.
- Rules: [transactions.md](contracts/transactions.md), [run-identity.md](contracts/run-identity.md).

## R09 — Results and evidence

A compact strip plus expandable General/Components detail. Keep live vs completed vs saved/imported provenance, elapsed time, root vs message distinction, workload comparability and units. Reveal-on-canvas and Open settings target the right node and run.

**Accept:**
- **Data:** nothing shows before measurement; no fake series; no p99, pressure or prediction values.
- **New metrics:** each needs a source, definition, interval, aggregation, denominator and unavailable state.
- **Run state:** partial runs are labelled; Stop/Pause/Reset behavior is explicit (the product ships Pause/Resume/Reset; a true Stop needs its own contract).
- **Saved runs:** the current editor graph never replaces a saved run's snapshot in its details.

## R10 — Entry and transfer

Keep templates, blank canvas and validated import, restyled. No natural-language generation (D12). CSV and Mermaid are added. No share or team actions.

**Formats:**
- JSON is the lossless portable format.
- Mermaid is lossy: element names, directed connections with labels and kinds, and whole view groups as subgraphs. Collision-free IDs and escaped labels; no import or round-trip.
- CSV exports a saved run's metrics with units and provenance, spreadsheet-safe, with no invented values.
- Limitations are shown at the export action.

**Accept:** escaping, formula-injection defense, Unicode/long names and empty measurements. Exact encoding: [parts-and-export.md](contracts/parts-and-export.md).

## R11 — Accessible, adaptive

Full phone editing (D14). Every hover or drag affordance has a keyboard/touch equivalent. Visible focus, meaningful labels, overlays return focus, errors are linked to fields, and color always has a text equivalent. WCAG AA contrast, including focus and non-text indicators. Light-only (D24), including native controls.

**Accept:**
- **Viewports:** reference desktop sizes, 1024×768, 768×1024 and 390×844.
- **Stress cases:** 200% text zoom, long names, empty/large data, reduced motion.
- **Layout:** narrow screens keep a usable canvas with no page-level horizontal scroll.

Token corrections: [design.md](design.md#accessibility-corrections).

## R12 — Resumable delivery

Every task has an owner, base commit, exact files, dependencies, requirements/screens, expected evidence and a checkpoint. Claude reviews, Codex accepts, and nothing is done on the implementer's word alone. See [delivery.md](delivery.md).

## R13 — Runnable models for every family

One model supports frontend, backend/service, code/data flow and infrastructure scenarios, plus fullstack composition. Runs use modeled inputs and behavior, traces and assertions, with optional timed resource simulation. Real source execution is deferred.

**Accept:**
- **Coverage:** S01–S05 each have deterministic success and failure cases ([model-and-runner.md §11](contracts/model-and-runner.md#11-reference-scenarios)); a trivial per-family example doesn't count.
- **Semantics:** structural relations never execute; view collapse never changes behavior; refinement never double-counts.
- **Honesty:** missing behavior blocks the scenario with actionable issues; no latency is invented for logical runs.

## R14 — Deployment-independent local core

Model, command, repository, run and sync boundaries work for local, hosted and self-hosted delivery (D18). Only local is built now.

**Accept now:** no credentials or vendor identity in portable data; stable IDs; explicit revision checks; separation of shared content, personal preferences and run artifacts. Remote acceptance comes later ([architecture.md §7](architecture.md#7-future-boundaries-not-built-now)).

## R15 — Future AI collaboration

The architecture must let a future assistant use domain commands, stable references, candidate diffs and validation, provenance and run identity without bypassing invariants or scraping the UI (D22). No AI service, chat UI, agent or provider now, and local use never depends on AI.
