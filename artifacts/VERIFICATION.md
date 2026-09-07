# Prototype verification

Verified on 6 September 2026 with Chromium through Playwright, plus Vitest and a production build.

## Observed seeded experiment

30 simulated seconds, seed 42, mean traffic 700 requests/s, service capacity 2,000 requests/s, database capacity 500 lookups/s, queues 500, deadline 2,000 ms. Cache: capacity 5,000 requests/s and 80% fixed hit probability.

| Observed result | Without cache | With cache |
|---|---:|---:|
| Generated requests | 20,845 | 20,845 |
| Successful responses | 14,995 | 20,837 |
| Throughput, rounded | 500/s | 695/s |
| Successful-response p95 | 1,010.5 ms | 11.4 ms |
| Queue-full rejections | 5,346 | 0 |
| Timed out | 0 | 0 |
| In flight at observation end | 504 | 8 |
| Database arrivals, average | 694.8/s | 140.8/s |
| Cache hits | — | 16,622 |

These are simulator results, not measured real-system performance. The configured expected cache-miss demand is 140/s; the observed 140.8/s comes from the seeded sample. Arrival sequences are identical across both runs. Screenshots `desktop-overload.png` and `desktop-cache.png` show these runs.

## Checks

- Vitest: baseline, overload, conservation of request counts, deadlines, queue bounds, zero queue slots, 100% hits, deterministic replay, incremental stepping, invalid graphs, versioned import/export, unfinished portable drafts.
- Playwright: complete baseline/overload/cache journey, comparison, automatic before/after checkpoints, restore and local reopen, pause/reset, invalid topology/undo, project naming and export/import, connection deletion/restore, viewport persistence, narrow-screen overflow, readable mobile nodes and checkpoint creation.
- Production TypeScript and Vite build.
- Independent bounded visual review: **Pass**. Resolved cache clipping, mobile readability, mobile checkpoint access, heading spacing and secondary-caption contrast. Review confirms visual evidence; interaction behavior is covered by the browser tests. This is not a claim of full accessibility conformance.
- Mechanical design detector: one font-preference warning for Inter. Kept intentionally to match the user-selected crisp sans-serif reference.

## Known limits

The simulator supports a single linear URL lookup path; no nested submodels, branching execution, retries, replication, eviction, writes or realistic hardware/network modeling. Black boxes have explicit models; no hidden model substitution. Projects are browser-local, with no cloud sync. In-progress runs and unsaved previous comparisons are ephemeral; milestone 6 adds explicitly saved completed results. Build currently emits a ~505 KB minified main chunk (~161 KB gzip); code splitting is a future performance improvement.

## Final visual-review verdict

**Pass** — bounded review of the selected light docked workspace.

| Original material finding | Final verdict |
|---|---|
| Cache spacing and database clipping | Resolved |
| Mobile graph legibility | Resolved |
| Mobile checkpoint access | Resolved |
| Heading spacing | Resolved |
| Faint secondary captions | Resolved |

## Milestone 4 — expansion and continuous motion

- Twelve unit tests and seven Chromium journeys pass; production build passes.
- Expanding/collapsing the database during a paused run preserves the displayed metrics and resumes the same worker. Its final seeded overload totals remain 5,346 rejections and 499 queued requests.
- Expanded views persist through browser reopen and JSON export/import, with old version-1 exports supported.
- Browser animation-clock assertions verify continuous progress across worker samples, stable phase during pause, continued phase after resume and reduced-motion suppression. No measured frame-rate claim is made.
- Root cause fixed: renderer measurements were missing from controlled-node updates, causing React Flow to clear handle bounds and remount connections. Measurements now remain in rendering state only.
- Desktop and mobile expansion screenshots were inspected, including a regression assertion preventing heading overlap on narrow screens. See `expanded-database.png` and `expanded-mobile.png`.
- Expansion reveals the existing model. Editable nested subgraphs remain future work.

## Milestone 5 — changing workloads

Twenty unit tests and nine Chromium journeys cover steady, burst and linear-ramp profiles, semantic workload comparison, local/checkpoint persistence, version-2 JSON exports and version-1 imports. The production build passes. Configured traffic and observed queue are plotted on aligned time axes.

Default burst: seed 42, baseline 100/s, burst 700/s from 10–20 seconds, 30-second window. Observed 8,983 generated requests, 7,474 successes, 1,509 queue-full rejections, zero timed out and zero in flight at the end. Aggregate sampled queue peaked at 502 (across components) and drained to zero. Successful-response p95 was 1,010.4 ms. Cache replay generates the same arrivals and has no failures. These are illustrative simulation results, not hardware measurements.

Screenshots: `burst-workload.png`, `ramp-mobile.png`.


## Milestone 6 — saved results (7 September 2026)

26 unit tests and 11 Chromium journeys pass, along with the TypeScript/Vite production build. Saved-result tests cover immutable model capture, completion checks, imported accounting/provenance, workload matching, model restoration and undo. Browser journeys save and compare no-cache/cache runs, reload and rename results, restore/undo the model, export/import measurements, and delete/undo on mobile. Existing workload, expansion, animation, editing and viewport journeys remain covered.

Direct screenshot inspection found graph clipping when the results dock reduced canvas height. Resize-aware framing resolves this; a browser assertion checks all nodes remain within the canvas. Desktop and mobile evidence: `saved-comparison.png`, `saved-results-mobile.png`. This milestone used direct visual QA, not an additional independent review.

Saved results are manual, capped at 20 per project without eviction, and imported data is not rerun or authenticated. The main production chunk is approximately 530 KB minified /168 KB gzip.


## Milestone 7 — simulation profiling and deferred results (7 September 2026)

Incremental snapshots now sort only newly completed latencies and merge them with an existing sorted index. Percentile values and the order of floating-point summation remain exact; unchanged snapshots reuse their statistics. This adds one numeric index entry per successful response and a transient merge array, trading additional memory for less repeated sorting. The model version and exported metrics format do not change.

Local CPU profile: 700 requests/s, seed 42, baseline no-cache graph, 120 simulated seconds, snapshots every 0.5 seconds. Four paired runs compared the prior engine at `0d787bd` with the new engine. Measured old times: 2681.85, 2592.23, 2631.65, 2591.28 ms; new: 389.38, 384.42, 389.25, 380.21 ms. Median improved from approximately 2612 ms to 387 ms (about 85%). These are local computation timings, excluding worker transport/rendering, not device or frame-rate guarantees. Exact final-metrics comparison passed on all four pairs. The profiling harness timeout was raised from 5 to 60 seconds to accommodate both engines; its completed verification then passed.

To reproduce, copy `artifacts/performance-profile.test.ts.txt` to `src/simulation/performance.test.ts`, write `git show 0d787bd:src/simulation/engine.ts` to `src/simulation/engine.before.ts`, and run `npx vitest run src/simulation/performance.test.ts`. Remove those two temporary source files afterward. The retained regular regression compares irregular incremental snapshots and repeat reads against direct runs at low, baseline and overload traffic.

ResultsPanel now loads on demand with an accessible loading state. Production entry JavaScript: 525.29 KB /166.92 KB gzip versus 530.38 KB /167.89 KB gzip before; deferred results chunk: 6.85 KB /2.48 KB gzip. Total JavaScript is not reduced and the 500 KB entry warning remains. No vendor splitting was used merely to hide that warning.

Verification: 27 unit tests; 11 existing browser journeys; production results journeys plus a request-level check that ResultsPanel is fetched only after opening Saved runs. Production browser mode is available via `TEST_PRODUCTION=1 npm run test:e2e` after `npm run build`.


## Milestone 8 — editable service parameters

27 unit tests and 14 Chromium journeys pass; production build passes. The new service journeys verify drafts leave completed metrics intact, both settings apply/reset as one undo step, inspector changes synchronize, zero queue slots work, replay results retain their model through save/restore/reload, empty/fractional drafts are rejected, Escape/Cancel restore values, Backspace does not delete the node, and Enter applies. Mobile assertions verify the entire expanded service fits the canvas and the page does not overflow.

Direct desktop/mobile screenshot inspection: `editable-service.png`, `editable-service-mobile.png`. Fields retain the existing docked design. Only service parameters are editable inside the canvas; concurrency and nested subsystems are not introduced. No independent visual review was performed for this scoped addition.


## Milestone 9 — concurrent service workers

36 unit tests and 16 production Chromium journeys pass; TypeScript/Vite build passes. Defaults preserve the historical 700 req/s, seed-42, 30-second counts: 20,845 generated, 14,995 succeeded, 5,346 rejected, zero timed out and 504 in flight. Absent and explicit one-worker configurations produce identical current snapshots.

Concurrency tests check shared queue/worker bounds, request conservation, throughput scaling, normalized utilization, zero waiting slots, retained occupancy after active timeouts, skipping expired queued work, per-worker latency semantics, and burst/ramp replay independently of snapshot cadence. Compatibility tests round-trip current worker graphs/checkpoints/results and v1–v3 historical projects/results, reject concurrency hidden in old format versions, retain historical metrics unchanged, and suppress cross-model deltas.

Browser checks exercise one-to-four worker replay with matching generated arrivals, worker-count change descriptions, atomic apply/Undo/Redo, immutable saved model restoration/reload, inspector synchronization, invalid-count drafts, Escape and a sixteen-slot mobile view. Desktop/mobile evidence: `concurrent-service.png`, `concurrent-service-mobile.png`. Direct visual inspection confirms controls fit the approved light workspace; no additional independent visual review is claimed.

Workers are ideal independent processors, not machine replicas. No scheduler contention, pool overhead or database/cache parallelism is added. Capacity is per-worker, total rate is workers × capacity, the queue is shared, and utilization averages across workers. New result model is `url-lookup/3`; historical `url-lookup/2` results remain readable. Version-4 export prevents older readers silently ignoring worker counts. Entry JS remains about 530.23 KB /168.33 KB gzip; existing chunk warning is retained.


## Background-job path checkpoint

40 unit tests, 18 production Chromium journeys and production build pass. Job tests cover separate admission acknowledgements, shared queue bounds, attempt limits/backoff, retained active slots after expiry, rejected retry re-entry, request conservation, profile replay and portable result accounting. The URL engine retains its seeded results after extracting shared heap/RNG/exact-latency primitives. Current-format-only import tests replace retired compatibility promises.

Desktop/mobile screenshots: `background-jobs.png`, `background-jobs-mobile.png`. A small persisted viewport after closing a results pane was corrected by recording canvas height and reframing when reopening at a materially different height; manual viewport restoration remains covered. No browser-local data is deleted.


## Completed finite roadmap — subsystems and guided experiments

45 unit tests pass, including view-only graph identity, subgroup endpoint projection, current portable metadata, executable guided starters and measured effects of concurrency/retry changes. All 22 production browser journeys pass; final focused viewport checks cover changing guides with equal node counts, reopening expanded controls, group dragging and existing manual zoom persistence. Build passes; main entry is approximately 551 KB /175 KB gzip.

Subsystems collapse real nodes into an aggregate summary without changing engine input, replay or live metrics. Browser tests verify collapse during a paused run, resume, stable boundary edges across samples, reopen, editing children, ungrouping and mobile access. Group dragging is checked by equal displacement of both members, accounting for React Flow's drag-start threshold.

Guided starters cover cache pressure, worker scaling, job bursts and retry cost. Coach observations use actual measurements. Tests verify guide/model Undo, portable checkpoints, returning from node inspection, local reopen and switching to free exploration without resetting a run. Mobile/desktop layouts were inspected directly. Screenshots: subsystem-collapsed.png, subsystem-expanded.png, subsystem-mobile.png, guided-experiment.png, guided-mobile.png.

Visual corrections: retain measured group dimensions to prevent collapsed cards/edges disappearing across worker samples; reframe on node identity changes, not merely node count, to avoid clipping expanded controls when switching guides. No new independent visual review or real-device performance claim is made. The user-authorized finite roadmap is complete; current-format-only imports are intentional and browser-local records were not deleted.
