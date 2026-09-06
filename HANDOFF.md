# Development handoff

## Current milestone — steady, burst and ramp workloads

Resumed with richer workloads after offering next-step options and proceeding with the stated default. The existing light workspace now supports configured steady traffic, a timed burst, or an increasing/decreasing linear ramp. Controls are in Experiment settings or the traffic source Configuration tab. Workload previews show configured rates; the metrics panel aligns configured traffic with observed queue history. Node/edge expected rates update at the current simulation time.

`src/domain/workload.ts` owns rate evaluation, analytic inversion of integrated Poisson intensity, validation and semantic workload comparison. Burst boundaries carry unused hazard; ramps use a numerically stable quadratic inversion. Constant workloads preserve the earlier exact seeded totals. Profiles persist in projects/checkpoints. JSON exports are version 2 so old readers cannot silently ignore a new arrival model; current imports accept versions 1 and 2.

### Verification

- `npm test`: 20 tests pass, including burst-boundary inversion, increasing/decreasing ramps, queue recovery, chunk-independent replay, profile comparison and import validation/backward compatibility.
- `npm run test:e2e`: 9 browser journeys cover burst recovery, cache replay with identical generated arrivals, ramp/mobile persistence and all existing functionality.
- `npm run build`: passes. Main JS bundle remains about 516 KB minified /164 KB gzip; splitting is a future performance task.
- Default burst (seed 42, 100→700→100/s, 10–20s, duration 30s): 8,983 generated, 7,474 successful, 1,509 rejected, zero in flight at end. Sampled aggregate queue peaked at 502 (database plus service) and drained to zero. p95 of successful responses: 1,010.4 ms. Cache replay has identical generated arrivals and zero failures.
- Evidence: `artifacts/burst-workload.png`, `artifacts/ramp-mobile.png`, `artifacts/VERIFICATION.md`.

### Checkpoints and resume

- `e73ad9f`: deterministic burst/ramp domain and engine milestone.
- Latest commit completes workload controls, comparison, export format and verification (`git log -1`).
- Preview: http://localhost:5173/. `npm run dev` if needed. See README.md for controls and semantics.
- Future scope remains editable nested subgraphs, additional paths, saved measured results and performance profiling. No cloud sync or remote deployment.

## Previous milestone — expandable components and continuous traffic motion

The approved light docked workspace now reveals the existing queue/processor model inside each canvas node. Use a node chevron or the inspector's “Show internals on canvas” button. Traffic reveals its seeded generator; services and database reveal FIFO queues, one processing slot, sampled busy/idle state and processed/rejected counts; cache adds configured hit/miss routing and observed hits.

Expansion is **presentation only**: `Project.expandedNodeIds` is stored separately from `Graph`. It never replaces the model or resets the worker. Local save/reopen and JSON export/import retain expanded views; old version-1 files remain compatible.

Traffic stutter root cause: rebuilding controlled nodes without their measured dimensions caused React Flow to drop handle bounds and remount connections every 125 ms. `ArchitectureCanvas` now preserves renderer-only dimensions. `TrafficEdge` has a continuous browser-clock animation with stable phase through pause/resume, visibility handling, reduced-motion support and no moving dots at zero expected demand. Dots indicate direction, not measured request counts.

## Previous milestone verification

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

## Saved-results milestone in progress (7 September)

Prior workload checkpoint `3041861` was complete and clean when resuming after the usage reset. Continuing with named saved experiments and comparisons. Domain metrics now live separately from the engine; completed snapshots store model/workload, metrics, model version and provenance. Worker responses carry run IDs and are matched to immutable start-of-run graphs, preventing late messages attaching to a newer experiment. Save/rename/delete/undoable model restore are implemented in editor state, with a 20-result limit and no automatic eviction.

Version-3 JSON exports include saved results; version-1/2 imports remain accepted. Import validation checks request accounting and sample structure, and all imported results are labeled as imported rather than claimed verified. Twenty-six unit tests and eleven browser journeys passed. A post-test visual correction is being verified: the canvas now reframes when opening/resizing the docked results panel. Finish documentation, final checks and the UI commit remain.
