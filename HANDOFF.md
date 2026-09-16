# Development handoff

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

Current verification baseline:
- 233 unit tests across 36 files (`npm test`, 2.38s).
- Passing production build (`npm run build`, 330ms).
- 45 passing production Chromium journeys across 5 workers (`npx playwright test`, 40.3s).
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
