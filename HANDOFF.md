# Development handoff

## Active finite roadmap — user authorized all remaining steps

User removed backward-compatibility requirements. Preserve local projects; portable imports now accept current format only.

1. **Background jobs — complete.** Separate job engine, shared heap/RNG/latency helpers, queue/worker components, inline controls, path selector and job-specific metrics verified. 40 unit tests, 18 production browser journeys and build pass. Current checkpoint includes initial subsystem metadata/state scaffolding; subsystem rendering follows next.
2. **Canvas subsystems — complete.** Named non-overlapping groups wrap real components, collapse to waiting/active summaries and expose editable children on expansion. Projection only remaps rendered boundary endpoints; original graph identity/metrics remain unchanged. 43 unit tests, targeted desktop/mobile journeys and build pass. Group renderer measurements are retained across worker samples.
3. **Guided experiments — implementing.** Finite starter scenarios and explanations connecting both paths, subsystem views and saved comparisons. Finish this roadmap without inventing additional milestones.

Resume from current Git diff; do not recreate job implementation. Background jobs checkpoint is `d690abb`. Subsystem checkpoint follows in Git. Guided experiment factories and coach scaffold are present, with dedicated verification next. Job path is producer → queue → worker. Producer ack follows admission by 8 ms independently of job completion. Retries use fixed backoff and rejoin FIFO; full retry admission fails permanently. Absolute TTL covers all attempts; expired active jobs keep slots until processing ends. Queue/worker state and producer/job outcomes remain distinct. Version-5 exports/imports are current-only; no browser-local records are deleted.

## Current milestone — concurrent service workers (7 September 2026)

Services support 1–16 independent workers. `capacity` is explicitly per-worker req/s; total capacity is `workers × capacity`, while each request still takes `1 / capacity` seconds. Workers share one bounded FIFO queue excluding active requests. Arrivals use the first free worker; completions take the oldest nonexpired waiting request. Equal-time events retain insertion-order ties. Timed-out active work does not release its worker until completion. Utilization is summed occupied time divided by workers × elapsed time. Database/cache stay single-processor.

`ModelNode.workers` is optional: absent means one, preserving old projects. Shared `workerCount`, `totalCapacity` and worker-limit helpers serve UI/domain/engine. New snapshots include sampled activeWorkers. Version-4 portable exports include concurrency; v1–v3 imports remain supported, with no hidden concurrent settings accepted in old formats. New results use `url-lookup/3`; historical `url-lookup/2` results remain unchanged and labeled, and cross-version deltas are suppressed. No IndexedDB schema migration is required.

Expanded service controls apply worker count, per-worker rate and queue limit atomically with Cancel/Escape and Undo. Inspector fields synchronize; total capacity and an aggregate occupied-slot meter are explicit. Saved models/checkpoints retain worker counts. Mobile fits up to sixteen slots and all editing controls in a 580 px canvas. Workers model ideal concurrency, not hardware replicas or contention.

Verification: 36 unit tests cover default seeded counts, concurrent bounds/accounting/utilization, expired active/queued work, zero slots, latency semantics, burst/ramp chunk invariance and historical compatibility. Sixteen production Chromium journeys cover the existing features and worker apply/undo, matched arrivals, saved restoration/reload, inspector synchronization, validation and mobile fit. Production build passes (entry about 530 KB /168 KB gzip; size warning remains). Screenshots inspected: `artifacts/concurrent-service.png`, `artifacts/concurrent-service-mobile.png`.

Checkpoints: `f67704a` engine/domain/compatibility; final UI/documentation commit is `git log -1`. Preview http://localhost:5173/. No push/deployment. Next scope could add a second supported path such as queued background jobs; specify routing, acknowledgment and failure semantics before implementing. Nested editable subgraphs and realistic contention remain future work.

## Previous milestone — editable service internals

Expanded service nodes now edit processing capacity and queue slots directly on the canvas. Drafts leave the current run untouched. Apply changes/Enter validates and commits both values in one undo step, resetting the run through the existing model-change path. Cancel/Escape discards drafts. Inspector edits, Undo/Redo, project reload and saved-model restoration synchronize both fields. Saved runs remain immutable. Other component internals are unchanged.

`src/components/ServiceModelEditor.tsx` owns local drafts and dispatches the existing `updateNode` action. No engine, domain or portable format changes. Mobile allocates 500 px to the canvas while service controls are expanded. This is parameter editing in the existing serial processor model; worker concurrency and nested graph editing remain future scope.

Verification: 27 unit tests, 14 browser journeys and production build pass. New journeys cover draft isolation, atomic apply/reset/undo, inspector synchronization, saved result restoration/reload, native validation, keyboard editing and mobile bounds. Desktop/mobile screenshots inspected: `artifacts/editable-service.png`, `artifacts/editable-service-mobile.png`. Main entry approximately 527 KB /167 KB gzip; known size warning remains.

Checkpoint: `git log -1`. Preview http://localhost:5173/. No push or deployment. Next suggested milestone: multiple processing workers with explicit concurrency semantics and deterministic tests.

## Previous milestone — measured simulation performance (7 September 2026)

Resumed from clean saved-results checkpoint `0d787bd`. Metrics snapshots merge newly sorted latencies into an existing index instead of sorting all responses repeatedly. Exact metrics and model version are preserved. A 120-second, 700 requests/s local paired profile reduced median computation from about 2612 ms to 387 ms; see artifacts/VERIFICATION.md for scope, measurements and reproduction. The index trades extra memory for CPU savings.

Saved-results code loads when its panel opens, with an accessible loading state. Initial JS is 525.29 KB /166.92 KB gzip, plus 6.85 KB /2.48 KB gzip deferred results. The entry-size warning remains; no claim of measured frame-rate or real-device improvement.

Verification: 27 unit tests, 11 existing browser journeys, and three production saved-results journeys including deferred-network-loading coverage. Build passes. `TEST_PRODUCTION=1 npm run test:e2e` uses a local production preview on port 5174 after building. Preview for normal development remains http://localhost:5173/.

Final checkpoint: `git log -1`. No push or deployment. Next product scope is still editable nested subgraphs or additional supported request paths; these need explicit simulation semantics. Current expanded internals remain presentation-only.

## Previous milestone — saved experiment results (7 September 2026)

Resumed after the usage reset from clean completed workload checkpoint `3041861`. Named completed experiments now preserve their immutable starting graph, full workload, metrics/history, model version and provenance. A docked results panel compares saved runs, reports model changes and suppresses deltas for mismatched workloads. Local autosave and version-3 JSON exports include results; imports accept versions 1, 2 and 3. Imported results are explicitly labeled and have not been rerun. Validation checks structure/accounting, not authenticity.

Save result appears after completion. Up to 20 results may be saved per project, with no automatic eviction. Rename, delete/undo delete and undoable Restore model are available. Worker run IDs prevent late messages from attaching measurements to another model. Opening/resizing results reframes the desktop canvas; mobile retains readable nodes and full result controls.

### Verification and checkpoints

- `npm test`: 26 tests pass, including immutable results, import accounting/provenance, comparison eligibility and undoable model restoration.
- `npm run test:e2e`: 11 Chromium journeys cover all previous milestones plus saved comparisons, reload/rename/restore/undo, portable results and mobile delete/undo.
- `npm run build`: passes; main JS approximately 530 KB minified /168 KB gzip. Code splitting remains future work.
- Screenshots inspected directly: `artifacts/saved-comparison.png`, `artifacts/saved-results-mobile.png`. Browser regression verifies nodes remain inside the resized canvas.
- `8d5c9c0`: immutable completed experiment domain, worker identity and validated imports. Final UI/documentation checkpoint: see `git log -1`.
- Preview: http://localhost:5173/. No remote push or deployment.

## Previous milestone — steady, burst and ramp workloads

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
- Future scope remains editable nested subgraphs, additional paths and performance profiling. No cloud sync or remote deployment.

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

These are illustrative learning assumptions, not real hardware benchmarks. Expanded internals currently inspect this existing model; they are not editable nested architecture graphs. Future milestones may add editable subsystems, richer workloads, other supported paths. Add those deliberately with model validation and deterministic tests. No cloud sync; running simulation state is ephemeral, while explicitly saved completed results persist. The main JS bundle is approximately 511 KB minified (~162 KB gzip), with code splitting a later performance opportunity.
