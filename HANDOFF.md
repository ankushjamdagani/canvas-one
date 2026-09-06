# Development handoff

## Current milestone — expandable components and continuous traffic motion

The approved light docked workspace now reveals the existing queue/processor model inside each canvas node. Use a node chevron or the inspector's “Show internals on canvas” button. Traffic reveals its seeded generator; services and database reveal FIFO queues, one processing slot, sampled busy/idle state and processed/rejected counts; cache adds configured hit/miss routing and observed hits.

Expansion is **presentation only**: `Project.expandedNodeIds` is stored separately from `Graph`. It never replaces the model or resets the worker. Local save/reopen and version-1 JSON export/import retain expanded views; old version-1 files remain compatible.

Traffic stutter root cause: rebuilding controlled nodes without their measured dimensions caused React Flow to drop handle bounds and remount connections every 125 ms. `ArchitectureCanvas` now preserves renderer-only dimensions. `TrafficEdge` has a continuous browser-clock animation with stable phase through pause/resume, visibility handling, reduced-motion support and no moving dots at zero expected demand. Dots indicate direction, not measured request counts.

## Verification

- `npm test`: 12 tests, including graph/reference invariance through expansion and expanded-view import/export compatibility.
- `npm run build`: TypeScript and production build pass.
- `npm run test:e2e`: seven journeys cover the initial end-to-end experiments plus expanded model/persistence, unchanged final seeded results, animation clock continuity, pause/resume, reduced motion and readable mobile expansion.
- Expansion during the overloaded run still yields exactly 5,346 rejections and 499 waiting database requests at 30 seconds, as before.
- Screenshots: `artifacts/expanded-database.png`, `artifacts/expanded-mobile.png`; original experiment evidence remains in `artifacts/VERIFICATION.md`.
- Preview: http://localhost:5173/ (`npm run dev` if it is no longer running).

## Git checkpoints

- `c4feeb1`: initial domain, deterministic engine, worker, persistence and editor.
- `91ad86a`: docked workspace, metrics/replay, project UI and browser journeys.
- `67c6164`: verified first prototype, mobile fixes, documentation and screenshots.
- Latest milestone commit: expandable component views and traffic animation continuity (see `git log -1`). No remote push or deployment.

## Resume

1. Project: `/Users/ankushjamdagani/personal/system-design-planner`.
2. Read PRODUCT.md for commitments, README.md for controls/model semantics, DESIGN.md for visual authority.
3. `npm ci` if needed; `npm run dev` to preview.
4. Verify with `npm test`, `npm run build`, `npm run test:e2e`. Browser runtime: `npx playwright install chromium`.
5. Preserve the user-approved light docked design, deterministic comparisons and separation between presentation and simulation.

## Model and future scope

One supported execution path: traffic → service → optional cache → database. Seeded Poisson arrivals; deterministic service time 1/capacity; FIFO queues default 500; global deadline default 2 seconds; fixed 8 ms response overhead; separate deterministic cache draws. Expired queued requests are skipped; expired active work still occupies capacity until completion. Observation windows end with outstanding work explicitly counted as in flight.

These are illustrative learning assumptions, not real hardware benchmarks. Expanded internals currently inspect this existing model; they are not editable nested architecture graphs. Future milestones may add editable subsystems, richer workloads, other supported paths or saved measured comparisons. Add those deliberately with model validation and deterministic tests. No cloud sync; running simulation state/results are ephemeral. The main JS bundle is approximately 511 KB minified (~162 KB gzip), with code splitting a later performance opportunity.
