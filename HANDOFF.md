# Development handoff

## Active initiative — System Studio design revamp (21 September 2026)

2026-09-22 USER HOLD: planning and read-only reviews only. Do not implement, dispatch implementation, or treat a reviewer approval as permission to execute. Finalize requirements, implementation architecture, delivery/execution and delegation through multiple reviews first; only a later explicit user instruction lifts this hold. Gemini was stopped before edits; its isolated worktree is clean and its temporary node_modules symlink removed. Preserve planning documents.

Current review state: P1 requirements, P2 architecture and P3 execution/delegation returned and were reconciled by Codex; fresh P4 closure passed planning baseline 6824bae. Read `specs/revamp/review-plan.md`, `reviews/2026-09-22-disposition.md` and `contracts/README.md`. D26 is settled: publications cannot be undone. D27/D28 require passing checks for every configured scenario before both commit and publish. D25 blocks Run until drafts are Applied or Cancelled; D29 closes source branches by default, with reopening allowed. D23 panel policy and conservative sequence conflict resolution are confirmed. D30 is confirmed in the decision register: Library commands focus/expand one existing instance. These changes supersede the earlier P4-reviewed completion-only/undo defaults. Focused Claude review returned REVISE for one stale D30 cross-reference only; Codex corrected and verified that reference. See specs/revamp/reviews/2026-09-22-policy-review.md and policy-update.md; this is not a fresh Claude PASS or detailed-contract acceptance. Run/transaction/fixture documents do not freeze the remaining schemas: RV-02d/e/f/g still require concrete types, measured limits and UI/transfer APIs before any future dependent implementation. Generic delegate skill shell loops are not approved for code dispatch without scoped preflight/recovery evidence. Resume planning only, starting with the contract register; do not dispatch RV-01a from its historical clearance.

Delegation update: the user requests automatic orchestration rather than manual platform switching. Codex may invoke installed Claude/Gemini CLIs for bounded review/implementation tasks, retaining the assigned roles and review gates. See `specs/revamp/handoffs.md`; the historical manual-only rule is superseded for this initiative.

Future product goal (D22/R15): an AI buddy collaborates on application development through the canvas, with structured decisions, proposals, discussions and evidence rather than dependence on external Markdown/chat history. See `specs/revamp/ai-collaboration.md`. Enforce shared validated domain commands, stable revision-aware links, provenance and provider-independent adapters in current architecture. No AI implementation now; Claude RV-00/RV-02 must review these seams without adding speculative infrastructure.

Latest pre-execution architecture decisions supersede conflicting history below: model-based runs across frontend/backend/fullstack, code/data flow, service flow and infrastructure; actual source execution later. One current model with no permanent diagram-only mode. Commits/publication require completed exact-scenario runs; incomplete work uses autosave/checkpoints. The user explicitly permits dropping old-data compatibility, including archive/conversion/legacy engine requirements; no existing data has been deleted. Plan for local, hosted and self-hosted bundles plus GitHub/server sync, async collaboration first and live coediting later. Read `specs/revamp/execution-model.md`, `legacy-retirement.md` and `deployment-and-sync.md`. RV-00 is expanded Claude review; implementation remains gated on that review and concrete RV-02 contracts.

Planning entry point: [`specs/revamp/README.md`](specs/revamp/README.md). The user assigns Codex planning/verification, Claude senior review, and Gemini/agy implementation. No revamp application code has been implemented yet. Read the decision register and task ledger before continuing; the next cross-platform assignment is Claude's read-only RV-00 plan review.

Confirmed visual/local scope: the supplied claude.design HTML ZIP, Evergreen paper, useful capabilities preserved, local branches/commits/publishing/merge, saved parts, customizable dock and movable/stacked/collapsed panels. Configuration uses atomic Apply/Cancel; branches preserve autosaved work. CSV/Mermaid exports and full adaptive phone editing are included; AI generation is deferred; Lucide is retained. Earlier diagram exemptions and mandatory legacy preservation are superseded by the paragraph above.

Current source exports legacy graphs as format 7 and open-system graphs as format 8; import validates both. This describes the pre-revamp implementation only. D19 permits replacing these paths with a current-only schema; plan an explicit storage cutover and unsupported-version handling, not silent coercion. Old storage records remain untouched during planning.

Fresh verification: 233 unit tests pass; production build passes with a large-chunk warning; production Chromium suite has 46 passing and 5 failing mobile journeys out of 51. See [`specs/revamp/verification.md`](specs/revamp/verification.md) for exact commands and symptoms. Earlier passing browser baselines below are historical.

## Active work — canvas-first workspace (16 September 2026)

The user authorized implementation of `specs/canvas-first-workspace.md` on branch `codex/canvas-first-workspace`. This scope delivers the 6-part canvas-first UI contract: compact top bar (brand, project switcher, catalog drawer trigger, workloads trigger, undo/redo, run/pause/reset), searchable 29-component catalog drawer, single contextual inspector dock (mutually exclusive node, edge, workload, and tutorial views), and compact status/results strip with expandable details and compare actions.

Integrated in the worktree:
- Canvas-first layout, shell, styling, and responsive mobile adaptation (`src/components/canvasFirst.css`, `src/App.tsx`).
- Single contextual inspector dock replacing disparate overlays; closing the inspector or clicking empty canvas clears active selection.
- Searchable 29-component catalog drawer (`.canvas-first-catalog-drawer`) supporting repeated component additions.
- Compact results strip (`.canvas-first-strip`) with state, time, root throughput, p95 latency, and failures, plus expandable details and compare actions.
- Preserved open system simulation runtime, resource bounds, discrete-event accounting, format-8 persistence, and format-7 read-only archive semantics.
- `ResizeObserver` refit behavior in `ArchitectureCanvas.tsx` preserves user zoom and pan across width changes (such as opening/closing the inspector dock) while refitting on major height adjustments (>50px, e.g. results panel toggle).
- Polished topbar row structure, segmented Undo/Redo pill group, 2-row mobile topbar (<560px), elevated floating dock aesthetics with transparent/hover states, and symmetrical canvas organizer alignment (`src/components/canvasFirst.css`, `src/components/canvasActions.css`, `src/components/DiagramOrganization.tsx`).
- ReactFlow 20px grid snapping and dotted background, HTML5 drag-and-drop from component catalog onto canvas, visible-center click-to-add accounting for canvas pan and zoom, brand logo vertical alignment, and strict baseline alignment for the simulation Failures stat.
- Zoom level and camera viewport preservation on component addition, note addition, and component deletion (`src/components/ArchitectureCanvas.tsx`), preventing unwanted `fitView` zoom jumps while preserving `fitView` for template and example loads.
- Catalog drawer search input padding and alignment standardized to 32px height, 10px horizontal padding, 8px gap, and 24px input height for centered magnifying glass alignment and clean spacing above category headings.
- Primary nested menu dropdown card (`.canvas-first-primary-menu`) under `.project-switch` toggle with 6 collapsible categories (`open` by default): Create project (Blank, From template [Chat, Ecommerce, Events], Tutorials/Examples), Checkpoints options, Export options (Canvas, JSON, Import), Switch project with active project checkmark, Architecture Revisions, and Saved runs & comparisons with direct restore. Topbar elevated to `z-index: 900` over backdrop (`z-index: 800`) to guarantee `.project-switch` toggle clicks are never intercepted.
- In-place project rename input (`aria-label="Project name"`) and visible `✓ Save` button (`.canvas-first-project-save-btn`) in the topbar row, supporting instant renaming on Save click, Enter key, or blur with accessible toast feedback.
- Zoom-adaptive canvas dot grid dynamically scaling gap (20px at zoom ≥ 0.85, 40px at 0.45–0.85, 80px below 0.45), dot radius (1.8 to 2.5), and contrast for effortless visibility at every camera distance without dot crowding or moiré patterns.
- Left Studio Activity Bar (`.canvas-first-left-rail`) housing primary workspace activity buttons: Add Component catalog toggle (`button[aria-label="Add component"]`), Workloads inspector toggle (`button[aria-label="Workloads"]`), Architecture Revisions drawer toggle (`button[aria-label="Architecture Revisions"]`), Saved Runs trigger (`button[aria-label="Saved runs"]`), and bottom utility Export (`button[aria-label="Export options"]`) and Guide.
- Consolidated Canvas Floating Dock (`.canvas-floating-dock`) grouping Undo, Redo, Select, Pan, Group, Add Note, Zoom In/Out, and Fit View directly at the bottom-center of the canvas.
- Single unified Studio Menu (`.studio-menu-card`, `src/components/StudioMenu.tsx`) anchored to `.project-switch` dropdown in the topbar, integrating project switching, `+ New project`, starter templates, checkpoint creation and rollback, revisions, portable JSON export/import, and saved comparisons.
- Floating Component Catalog panel and Architecture Revisions panel (`.canvas-first-catalog-drawer`) floating seamlessly over the canvas, preserving zoom and avoiding layout shifts.
- Tailwind CSS v4 integration via `@tailwindcss/vite` and `@theme inline` with Zinc/Neutral shadcn design tokens in `src/styles.css`.
- Reusable shadcn-ui component primitives in `src/components/ui/`: `Button`, `Dialog`, `DropdownMenu`, `Tooltip`, `Badge`, `Input`, `Separator`, `Tabs`.
- Decomposed layout architecture in `src/components/layout/`: `TopBar.tsx`, `ActivityRail.tsx`, `CanvasFloatingDock.tsx`, and `ResultsStrip.tsx` extracted from monolithic `App.tsx`.
- Form controls modernization: `NumberField`, `JobControls`, and `ServiceModelEditor` upgraded to shadcn `Input` and `Button` primitives.
- OpenInspector modernization (`src/components/OpenInspector.tsx`): Subsystem action buttons, behavior badges, identity text inputs, and node action buttons (Generate Traffic, Duplicate Node, Delete Node) upgraded with shadcn `Button`, `Badge`, and `Input`.
- Component catalog drawer modernization (`src/App.tsx`): Standardized search bar with shadcn `Input` and search icon, category count badges with `Badge`, and drawer close trigger with `Button`.
- Modal overlays modernization: `ExamplesPanel.tsx` and `StudioMenu.tsx` upgraded with shadcn `Button`, `Badge`, and `Input` while strictly preserving accessible ARIA roles, labels, and keyboard navigation.
- Secondary panels and controls modernization:
  - `src/components/DiagramExport.tsx`: Standalone SVG and PNG export triggers modernized with shadcn `Button` (`export-svg-btn`, `export-png-btn`).
  - `src/components/CanvasNotes.tsx`: `NoteInspector` upgraded with shadcn `Input` for note title and shadcn `Button` for Apply, Cancel, Collapse/Expand, and Delete note actions.
  - `src/components/SubsystemsPanel.tsx`: Subsystem member counts and dormant indicator converted to shadcn `Badge`, with ungroup action upgraded to shadcn `Button`.
  - `src/components/OpenWorkloadControls.tsx`: Add/remove workload actions, workload enabled/disabled status, and request class additions, deletions, name, and tag inputs modernized with shadcn `Button`, `Badge`, and `Input` primitives.
  - `src/components/RevisionsPanel.tsx`: New revision trigger, draft save and cancel, finalize draft, and restore to canvas actions modernized with shadcn `Button`; revision fields modernized with shadcn `Input`.
  - `src/components/OpenConnectionEditor.tsx`: Done/close triggers, Confirm Connection, and Delete Connection actions modernized with shadcn `Button`; connection label, protocol, and match value inputs upgraded with shadcn `Input`.
  - `src/components/DiagramOrganization.tsx`: Selection mode toggle, clear selection, 4 directional alignment buttons, and horizontal/vertical distribution actions upgraded with shadcn `Button`.
  - `src/components/RoutingPanel.tsx`: Add service instance action modernized with shadcn `Button`.
  - `src/components/CanvasContextMenu.tsx`: Subsystem creation and renaming dialog inputs and actions modernized with shadcn `Input` and `Button`, with full ArrowDown/ArrowUp/Home/End keyboard accessibility.
  - `src/components/ResultsPanel.tsx`: Close button, undo delete trigger, saved result name input, model restore, and delete result buttons upgraded with shadcn `Button` and `Input`.
  - `src/components/ArchitectureCanvas.tsx`: Diagram connection editor delete action and label/protocol inputs modernized with shadcn `Button` and `Input`.
  - `src/components/Inspector.tsx`: Diagram category badge, name/custom-type inputs, duplicate component button, delete component button, and inspect internals toggle modernized with shadcn `Button`, `Input`, and `Badge`.
  - `src/App.tsx`: Tutorial guide close and dismiss actions modernized with shadcn `Button`.
- Semantic `data-testid` test identifiers across layout chrome, activity rail, dock, and results strip, with IPv4 loopback alignment in `playwright.config.ts`.
- E2E timing resilience: Settle wait added after subsystem collapse before capturing `collapsedViewport` in `tests/export.spec.ts`, and pause confirmation added before asserting throughput in `tests/internals.spec.ts`.

Current verification baseline:
- 233 unit tests across 36 files (`npm test`, 2.59s).
- Passing production build (`npm run build`, 550ms).
- 45 passing production Chromium journeys across 5 workers (`TEST_PRODUCTION=1 npm run test:e2e`, 30.0s).
- Clean whitespace and format (`git diff --check`).

Authored architecture revisions are now implemented as optional `Project.revisions` metadata. Up to 20 immutable draft/final snapshots include graph (and notes), subsystems and expanded component views, with author, timestamp, reason, explanation and optional http/https issue URL. Finalization creates a new final copy linked to the saved draft; it does not capture current canvas edits. Project controls provide comparison against current canvas or another revision and restore. Restore uses a history entry with optional view metadata so Undo/Redo restores graph and presentation together; ordinary graph edits keep the previous dormant-subsystem behavior. Project identity, camera, checkpoints and saved results remain intact. Version-7 exports/imports preserve revision IDs and links within a new project copy. Authors are self-reported; no shared accounts, team approval or cloud sync is implemented.

Current architecture-component milestone: a separate diagram scenario offers 29 searchable components across six system layers, including a generic custom type, up to 100 nodes/200 connections, free directed wiring, editable names and responsibility/technology notes. Every diagram node can be duplicated as a configured, independent unconnected copy. Diagram mode is explicitly non-executable: it hides traffic-rate edge labels, disables Run/Reset, and keeps the existing exact simulations unchanged.

Three architecture templates create fresh editable real-time chat, ecommerce checkout and event-processing graphs. Loading is explicit and one-step undoable; project identity, checkpoints, saved results and dormant view metadata remain intact.

Diagram canvases support transient multi-selection by Shift-click or an explicit component checklist. Alignment, equal-gap distribution and selected-set dragging update positions atomically with one Undo/Redo entry. Collapsed subsystem members are excluded, expanded boundaries resize around moved members, and diagram-only collapsed groups use architecture copy instead of simulation counters.

Diagram mode now exports the complete current subsystem view as standalone SVG or PNG from the bottom guidance strip. Export ignores editor viewport and selection, preserves positions and classified paths, and leaves JSON backup behavior unchanged. PNG shares the vector renderer and applies bounded raster dimensions before browser image decoding.

Connection semantics now persist on diagram edges: optional 60-character relationship label, 30-character protocol, and sync/async/data classification. Selected edges open a touch-safe canvas editor and render solid/dashed/dotted paths respectively.

Canvas notes are implemented as presentation metadata on diagram graphs. They support five types (decision, assumption, future scope, question and general note), 80-character titles, 1,000-character bodies and up to 100 notes. **Add canvas note** creates a note and selects it; the inspector applies or cancels edits. Notes can move, collapse, and delete through undoable history. Optional node, edge and subsystem attachments remain in place and preserve unresolved targets so undo can restore the link. Checkpoints and version-7 JSON exports preserve notes separately from the executable worker model. SVG/PNG export includes notes with compact visible text; SVG titles retain full note content.

Current finite-cache semantics: keys depend on seed, request ordinal and normalized URL popularity independently of arrivals. Finite LRU begins empty, decides at cache completion and fills only on live database completion. TTL starts at fill; hits refresh recency only. Expired active work holds its slot; timeout-before-database-completion cannot fill. There is no miss coalescing, write or invalidation model. All service instances share the cache. Observed hit rate uses completed hits plus misses, excluding pre-decision rejection/expiry.

Agent workflow is defined in `AGENTS.md`: use the current lead model for complex architecture, integration and review; use bounded `gpt-5.6-luna` scout, implementer and verifier children when independent work benefits from delegation; optionally use external `agy` only for bounded, low-risk proposals with parent verification. Use graphify's existing-graph fast path for code exploration and verify source before editing.

## Current status — canvas notes and canvas organization implemented

The user authorized all remaining concrete steps and explicitly removed backward-compatibility requirements. Completed the agreed milestones: background jobs, canvas subsystem composition, guided experiments, and typed canvas notes. No additional milestones are being pursued automatically. No push or deployment.

### Checkpoints

- `398de12`: previous concurrent-service-worker milestone.
- `d690abb`: queued background-job engine, components, accounting and current portable format.
- `94de180`: editable subsystem composition and initial guide scaffolding.
- Final guide/verification/documentation checkpoint: `git log -1`.
- `130b3b6`: load-balanced service instances and browser verification.
- `e2360df`: bounded finite-cache helper with expiry and LRU boundary tests.
- `b84834e`: completed finite-cache and URL-popularity milestone.
- `e65cfe7`: searchable architecture component library and diagram mode.
- `a942f8c`: editable diagram relationship labels, protocols and flow types.

### What works

- Three runnable paths: traffic → service → optional cache → database; traffic → round-robin load balancer → service instances → shared optional cache/database; producer → queue → worker pool.
- Steady, burst and ramp workloads with seeded exact replay, per-worker capacities, bounded FIFO waiting and absolute deadlines.
- Background jobs separate admission/producer acknowledgements from job completion, use seeded per-attempt failure draws, bounded fixed-delay retries and explicit permanent failure accounting.
- Expandable component views and atomic inline service/job settings; Undo/Redo, inspector synchronization, local projects/checkpoints, portable exports and immutable saved comparisons.
- One-level non-overlapping named subsystems wrap real components. Collapse shows aggregate waiting/active work and boundary connections; expand exposes editable children. Group dragging moves members together. Subsystems are view metadata, never a replacement engine model.
- Six guided starters: cache pressure, worker scaling, job burst recovery, retry cost, horizontal service scaling and finite-cache warm-up.
- `Warm a finite cache` demonstrates a cold finite cache under hot-link traffic and compares cache size using the same seeded arrivals.

### Important semantics

Worker capacity is per worker; total is workers × capacity. Each attempt/request takes 1 / per-worker capacity. Service/job workers support 1–16 slots. Database/cache stay serial. Utilization divides occupied processor time by workers × elapsed time. Workers are ideal independent slots, not hardware replicas.

For jobs, successful admission schedules a producer acknowledgement 8 ms later, independently of the eventual outcome. Acknowledgement does not mean completion or a real durable broker. Deadline starts at original submission and includes waiting, retry backoff and attempts. Backoff uses no worker; expired active work holds its slot until processing ends. Initial queue-full admission is rejected. Full retry re-entry or exhausted retries fails permanently. No crashes or duplicate delivery.

Job invariant: generated = completed + admission rejected + expired + permanently failed + in flight. Accepted = generated − admission rejected. Acknowledgements are separate and may lag at the observation boundary. Successful-job latency includes waiting/retries. Observed attempt rates include retry work.

### Persistence and compatibility policy

Current portable format is version 7; old portable formats are intentionally not imported. Browser-local records are not deleted or reset. Very old saved result models can remain in local records but may need rerunning before importing a current export containing them; preserve old exports as archives. Current lookup results use url-lookup/5, load-balanced lookup uses the same model with routing measurements, and jobs use background-jobs/1. Imported metrics are validated structurally, not authenticated or rerun.

URL popularity is part of the workload: uniform and hot-link distributions are intentionally unmatched comparisons. Cache mode, capacity and TTL are architecture changes and remain comparable when the popularity workload matches.

Subsystems belong to Project.subsystems; missing members remain dormant through model undo. Creating new groups retains groups relevant to the current model. Graph.guideId is learning metadata excluded from the worker-reset signature. Renderer measurements are retained for components and groups so worker updates do not hide/remount views. Viewport restoration accounts for canvas height and node identity, preserving manual zoom for unchanged layouts.

### Verification and evidence

- Fresh verification on 8 September 2026: all 96 unit tests pass across 19 files, including template factory isolation, metadata, history and project-data preservation.
- Canvas-organization verification on 9 September 2026: 102 unit tests pass across 20 files; focused production browser coverage passes 2 journeys in 4.8 seconds, and the complete production suite passes all 35 journeys in 38.5 seconds. Production build passes at 599.82 KB / 188.55 KB gzip with the existing chunk-size warning.
- All 33 production Chromium journeys pass, including all three editable templates, custom-component desktop/mobile flows, diagram editing, finite caches, routing, jobs, saved results, subsystems and legacy lookup workflows. Command: `TEST_PRODUCTION=1 npm run test:e2e`.
- TypeScript and Vite build pass. Main entry 590.22 KB /186.17 KB gzip; the known chunk-size warning remains. Results UI is deferred; no mobile-device frame-rate claim.
- Direct bounded visual QA: artifacts/background-jobs.png, background-jobs-mobile.png, subsystem-collapsed.png, subsystem-expanded.png, subsystem-mobile.png, guided-experiment.png, guided-mobile.png. No new independent visual review is claimed.
- Full evidence and historical milestones: artifacts/VERIFICATION.md. Usage: README.md. Product/design authority: PRODUCT.md, DESIGN.md.

### Resume instructions

Workspace: /Users/ankushjamdagani/personal/system-design-planner. Preview: http://localhost:5173/ (npm run dev if not running). Run npm test, npm run build and TEST_PRODUCTION=1 npm run test:e2e for production verification. Preserve the light docked design, exact accounting, separation of configured/observed values, and view/model boundaries. Current finite roadmap is complete; do not invent endless extras.

Latest image-export verification: 115 unit tests, production build (608.58 KB /192.18 KB gzip main entry), and all 37 production Chromium journeys pass. SVG metadata is escaped; PNG source sizing occurs before decoding. Full notes are in SVG titles, and visible text is bounded. No additional milestone is started automatically.

Current canvas-notes verification (10 September 2026): all 127 unit tests across 24 files pass; TypeScript and the production build pass (617.09 KB main entry / 194.52 KB gzip). The complete production Chromium suite passes all 39 journeys with 5 workers in 38.3 seconds, including export, notes, organization, mobile containment and pause/resume. Both focused export journeys also pass. Earlier intermittent timing failures did not reproduce in this run; this does not establish that all flakiness is eliminated. SVG metadata is escaped, full note content is retained in SVG titles, and visible export text is bounded. The existing bundle-size warning remains. Verification is complete; no new milestone is started automatically.

Current authored revisions verification (12 September 2026): all 133 unit tests across 25 files pass; TypeScript and the production build pass (625.74 KB main entry / 196.60 KB gzip). Playwright revision journeys pass on desktop and mobile (tests/revisions.spec.ts: 2 passed; tests/notes.spec.ts: 2 passed). Revisions provide local immutable snapshots, metadata, draft/final copies, visual comparison and undoable restore. No additional milestone is started automatically.

## Product goals recorded for future work

The longer-term collaboration goal is shared team architecture workspaces. Local authored revisions now provide metadata, draft/final snapshots, comparison and restore. Future collaboration scope expands this with:
- Shared storage, authenticated authorship, team review, access control and a multi-user conflict model.
- Scoped subsystem revisions and concurrent review cycles: dedicated UX for proposing, reviewing, and tracking changes to specific subsystems or component groups, supporting multiple in-flight revisions simultaneously with distinct canvas identification and targeted feedback threads.
- Cross-project architecture linking and impact analysis: enabling independent teams to maintain their own system architectures and connect them via typed external links (sync RPC, async streams, shared data, schema contracts), with automated detection and impact analysis when linked external services change.
- Collaboration with AI as a visual decision-making playground: establishing the canvas as the shared playground for architectural decision-making between developers and AI agents. Instead of blind vibe coding with untracked architectural choices made implicitly in source code, developers visually review the system implementation plan first, co-design through iterative AI revision proposals, test tradeoffs with deterministic simulations, and conclude a finalized architecture plan before writing code.
