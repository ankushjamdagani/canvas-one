# Development handoff

## Active work — open system simulator (13 September 2026)

The user authorized implementation of `specs/open-system-simulator.md`, ahead of shared team workspaces. This active scope supersedes the historical “roadmap complete” notices below. Use one executable canvas, an unrestricted component catalog backed by configured behaviors, optional examples/tutorials and right-click subsystem grouping. Implementation is delegated to `agy` using the explicitly confirmed `gemini-3.8-flash-low`; the lead reviews and integrates patches.

Integrated in the main worktree: execution contracts/compiler/defaults, complete open runtime (synchronous calls, routing/cache, messages, competing/broadcast brokers and consumer reservations), open graph factories/conversion, worker adapter, format-8 persistence and open-result validation/comparison, unified open canvas/editor, optional examples/tutorials, behavior/workload inspectors, root/message metrics, archive read-only handling, and right-click subsystem grouping. Current verification is 233 unit tests across 36 files, a passing production build, and 44 passing production Chromium journeys; the existing chunk-size warning remains. `git diff --check` passes. The full browser suite now covers the unified canvas, optional examples/tutorials, notes, exports, revisions, archive copies, saved results, routing, jobs, workloads, grouping and mobile behavior.

Verification is complete for the requested local implementation. Temporary delegation artifacts are under `/private/tmp/system-studio-agy.JSwUbZ`; `repo/` is the isolated implementation checkout. Runtime no longer has unsupported-behavior guards. Format8 opens only new-schema graphs/history; format7 remains an archive. App calls editor.load(project, !isOpenGraph(project.graph)) and skips archive autosave; current load defaultfalse is for legacy internal tests.

External delegation is authorized: on 13 September the user explicitly approved sending task-relevant source and implementation briefs to agy/Gemini with gemini-3.8-flash-low. Use the existing `run-packet.py` with a brief followed by exact source paths. Patch-only delegation handles agy's headless terminal-permission limitation: Gemini generates code, the lead applies and tests it. Outputs may have malformed patch headers or fictional test context; allowlist paths and verify actual source before applying. Parent review corrected source double counting, live-operation release, cancellation/expiry ordering, seeded draw quality, percentile indexing and per-operation routing/cache seeds. No model substitutions. Preserve unrelated worktree changes and existing archive/model invariants.

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

The longer-term collaboration goal is shared team architecture workspaces. Local authored revisions now provide metadata, draft/final snapshots, comparison and restore. Shared storage, authenticated authorship, team review, access control and a multi-user conflict model remain future scope; current projects are browser-local.
