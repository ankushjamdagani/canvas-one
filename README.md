# System studio

An interactive architecture-learning prototype. Build a URL-shortener request path, run a seeded workload, find the bottleneck, add a cache, and replay the same arrivals.

## Run locally

Requires Node.js 22.12+ (verified with Node 24.5).

```sh
npm ci
npm run dev
```

Open http://localhost:5173. Production build: `npm run build`.

## First experiment

1. Run the initial 100 requests/s model for 30 simulated seconds (4× playback).
2. Select **700 req/s**, then **Run**. Inspect the database: its 500 lookups/s capacity cannot keep up; its bounded queue fills and new requests are rejected.
3. Select **Add cache**. This connects a cache with an 80% hit rate and stores **Before cache** and **After cache** checkpoints.
4. Run again. Expand **Live metrics** to compare completed runs. The same seed and traffic preserve the exact arrival sequence. Expected database demand is now 700 × (1 − 0.8) = 140 lookups/s; observed demand varies with sampled hits.

Pause/resume preserves simulation state; Reset starts from the seed. Changing model parameters starts a fresh run. Moving/renaming nodes does not change the simulation model.

## Try changing traffic over time

Select empty canvas space (or configure the traffic source), then choose **Steady**, **Burst**, or **Ramp** under Traffic pattern.

- **Steady** keeps a fixed average request rate.
- **Burst** uses the baseline rate, switches to a configured burst rate between its start/end times, then returns to baseline. Defaults: 100 → 700 → 100 requests/s, from 10–20 seconds in a 30-second run.
- **Ramp** changes the arrival rate linearly from starting to ending traffic over the complete run. Increasing and decreasing ramps are supported.

The inspector previews the configured workload. Expand Live metrics to see the configured traffic and observed queue on aligned time axes. A queue may be empty at the end even though cumulative latency still includes earlier waits. Compare a burst before/after adding cache using the same seed, full profile, duration and timeout.

Profiles save with local projects and checkpoints. JSON exports now use **version 2** to mark the new workload semantics; version-1 imports still work. The 100 req/s and 700 req/s shortcut buttons reset the profile to Steady.

## Reveal the model

Use a node's chevron, or **Show internals on canvas** in the inspector, to expand it. The same canvas reveals:

- Traffic: the seeded Poisson generator and observed arrival count.
- Service/database: bounded FIFO queue occupancy, one processing slot, processing time, sampled busy/idle state and processed/rejected counts.
- Cache: the same queue and processing details plus configured hit/miss routing and observed hits.

Expanding, collapsing and moving components do not restart or replace the simulation. Expanded views are saved with the project and included in JSON exports. Queue bars summarize occupancy; they are not individual queued requests. Busy/idle is a sampled state, while busy-time percentage is cumulative.

Traffic dots run continuously on the browser's animation clock, pause/resume without losing their phase, and are disabled for reduced-motion preferences. Dots show direction, not request count or measured speed.

## Editing and persistence

- Add components from the library, drag nodes, connect source and target handles, select a connection and press Delete, or delete a component from its inspector. Undo/redo preserves recent edits. Unsupported graphs remain editable and explain why Run is disabled.
- Select a component → Configuration for capacity, queue size, and cache hit rate. Select empty canvas for traffic, seed, duration and timeout.
- Projects autosave to IndexedDB in this browser. The project menu renames, reopens, creates, imports and exports projects. JSON exports are versioned; import creates a new copy.
- Checkpoints store the graph and workload settings. Project storage also includes canvas viewport. Running simulation state is intentionally not saved.
- On narrow screens, the readable canvas can be panned, the inspector follows below it, and Checkpoints is a disclosure above the workspace.

No cloud synchronization or remote account is involved. Export JSON to preserve a portable backup; browser site-data deletion removes local projects.

## Model assumptions

This is a learning model, not a hardware benchmark or architecture sizing tool.

- One supported request path: traffic → service → optional cache → database.
- Poisson arrivals from a deterministic seed, following the configured steady, burst or linear-ramp rate. Integrated arrival intensity is inverted analytically; unused exponential hazard is carried across burst boundaries, without fixed time-step approximations. Cache outcomes use a separate per-request deterministic draw, so adding the cache does not perturb arrivals.
- One effective serial server per component; processing time is `1 / capacity`. Service defaults to 2,000 requests/s; database 500; cache 5,000.
- FIFO waiting queues default to 500 slots. Queue limits exclude the actively processed request. Full queues reject new arrivals.
- A global deadline defaults to 2,000 ms and includes a fixed 8 ms response overhead. An expired queued request is skipped. Already-processing expired work still consumes capacity until it completes, but never becomes a successful response.
- Cache hit probability is fixed (no warm-up, eviction, writes, consistency or key popularity).
- Runs stop at the selected observation window. Outstanding requests are counted as in flight rather than silently marked successful. Generated = succeeded + rejected + timed out + in flight.
- Throughput and utilization are cumulative averages. p95 and mean latency include successful requests only. The chart samples queue length each simulated second.
- Replication, retries, frontend processing, network contention, branches and nested subsystems are not implemented. Future visual expansion must preserve the underlying simulation semantics.

## Structure

- `src/domain`: framework-independent project/graph types and validation.
- `src/simulation`: deterministic event heap, request lifecycle, worker and React adapter.
- `src/persistence`: Dexie project repository and versioned import/export.
- `src/state`: Zustand graph editing, history and checkpoints.
- `src/components`: React Flow canvas, inspector and observed metrics.
- `src/App.tsx`: workspace composition and project persistence orchestration.

## Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Simulation tests cover baseline, overload, exact accounting, timeout cancellation, deterministic replay, chunk equivalence, cache demand reduction, zero queue slots and unsupported graphs. Browser journeys cover full experiments, pause/reset, local reopen, checkpoint restoration, import/export, invalid-graph repair, viewport persistence, connections and narrow-screen access.

Exact stable package versions are pinned in `package.json` and `package-lock.json`. `HANDOFF.md` records milestone commits, measured verification and concrete continuation steps. No remote push or deployment has been performed.
