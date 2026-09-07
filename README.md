# System studio

An interactive architecture-learning workspace. Explore URL lookups and queued background jobs, inspect component internals, group subsystems, run seeded workloads, and compare saved results.

## Run locally

Requires Node.js 22.12+ (verified with Node 24.5).

```sh
npm ci
npm run dev
```

Open http://localhost:5173. Production build: `npm run build`.

## Guided experiments

Choose a **Guided experiment** in the library:

- **Relieve database pressure:** compare overloaded URL lookups before and after adding cache.
- **Scale a worker pool:** compare one worker with four at unchanged per-worker speed.
- **Absorb a job burst:** inspect waiting and expiry, then scale consumers.
- **Understand retry cost:** compare zero retries with two, measuring extra attempts and permanent failures.

Each loads a real editable starter model. The inspector provides a question, suggested steps and observations calculated from the current run. Use **Guide** in the toolbar to return after selecting a component. The selected guide follows the model through Undo, checkpoints and export. **Explore freely** hides the guide without resetting a running experiment. Loading a different guide or path replaces the model with an undoable edit; saved results remain intact.

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

Profiles save with local projects and checkpoints. JSON exports use **version 6** and include lookup, load-balanced lookup, background jobs, worker counts, service instances and saved results. Imports accept the current format only; existing browser-local projects are not deleted. The 100 req/s and 700 req/s shortcut buttons reset the profile to Steady.

## Save and compare experiments

After a run finishes, choose **Save result**, name it, and save. Open **Saved runs** in the library to revisit up to 20 completed experiments per project. Results retain the exact starting model, workload and measured history, even as you continue editing. Saving is explicit; reaching the limit never removes older results automatically.

Choose a baseline and comparison in the bottom results panel. The table and shared-scale queue chart compare the saved measurements. Deltas appear only when model version, complete workload and generated arrival counts match; differences are explained otherwise. Model changes are listed alongside the measurements.

Rename a result in the panel, **Restore model** to edit or replay its setup, or delete it. Model restoration supports regular Undo; deletion offers **Undo delete** while the panel remains open. Local autosave and JSON exports retain saved results. Imported results are labeled as imported and have not been rerun: validation checks structure and accounting, not authenticity.

## Reveal the model

Use a node's chevron, or **Show internals on canvas** in the inspector, to expand it. The same canvas reveals:

- Traffic: the seeded Poisson generator and observed arrival count.
- Service: one bounded shared FIFO queue, 1–16 processing workers, per-worker processing time, sampled worker occupancy and processed/rejected counts.
- Database: bounded FIFO queue, one processing slot and observed counters.
- Cache: the same queue and processing details plus configured hit/miss routing and observed hits.

Expanding, collapsing and moving components do not restart or replace the simulation. Expanded views are saved with the project and included in JSON exports. Queue bars summarize occupancy; they are not individual queued requests. Worker occupancy is a sampled aggregate count, not a trace of individual worker identities. Utilization is cumulative occupied processor time divided by worker count × elapsed time.

Expanded **service** nodes also include per-worker capacity, worker-count and queue-limit inputs. Type the values, then choose **Apply changes** (or press Enter). Applying makes one undoable model edit and resets the current run; drafting, canceling and expanding do not. Escape cancels a draft. Inspector edits, Undo/Redo and restored models synchronize the canvas fields. Capacity accepts 1–100,000 req/s per worker; worker count accepts whole numbers from 1–16; queue limits accept 0–10,000 whole waiting slots. Saved results keep their original models. Database and cache internals remain read-only on canvas and configurable in the inspector.

Traffic dots run continuously on the browser's animation clock, pause/resume without losing their phase, and are disabled for reduced-motion preferences. Dots show direction, not request count or measured speed.

## Scale service workers

Try a service at 200 req/s per worker with 700 req/s incoming traffic. Run with one worker, save the result, then change Workers to four, Apply and replay. The service now has 800 req/s total capacity, while each request still needs 5 ms of service processing. The database can become the next bottleneck.

Workers take requests from one shared FIFO queue. New arrivals use the first free worker; otherwise they wait or are rejected if the queue is full. Completing workers take the oldest nonexpired waiting request. Equal-time events use stable insertion order. Expired active work occupies its worker until processing completes. Workers are ideal independent processing slots: no contention, scheduling overhead, connection pools or machine-level scaling are modeled.

Missing worker count defaults to one. Portable exports/imports use the current version-6 format; old-format import shims are not maintained. Existing browser-local records are not deleted. Re-export a local project with the current app; very old saved result models may need a fresh run before portable import. Keep the original export as an archive if it contains unsupported historical results.

## Load-balanced service instances

Choose **Load-balanced lookup** in Experiment path. The instantaneous round-robin balancer sends each arrival to the next service instance in listed order. Each instance has its own worker pool and bounded FIFO queue; a full queue rejects that arrival and never reroutes it. Add up to eight instances from the expanded Load balancer panel; a new instance copies the first instance’s capacity, worker count and queue limit. Instances share the optional cache and database, so horizontal scaling can move the bottleneck downstream. The routing panel reports expected equal share before a run and routed, waiting, rejected and busy values after it. Moving or renaming nodes does not change routing order.

## Background jobs

Choose **Background jobs** in Experiment path. Switching loads a starter graph and supports Undo. The path is producer → bounded job queue → worker pool. Expand the queue or worker to edit settings atomically. Failure probability is sampled independently for each seeded job attempt; retries use a fixed delay and join the FIFO tail, up to the configured limit.

Producer acknowledgment follows successful queue admission after 8 ms. It is separate from job completion and may occur even if the job subsequently fails or expires. The deadline starts at original submission and includes waiting, attempts and retry backoff. Backoff does not occupy a worker; already-processing expired work does. A full queue rejects initial admission; full retry re-entry or exhausted retries permanently fail the job. No crash recovery, duplicate delivery or real durable broker is modeled.

Job accounting satisfies **generated = completed + admission rejected + expired + permanently failed + in flight**. Accepted = generated − admission rejected. Producer acknowledgements are a separate counter; the observation window may end before an acknowledgement arrives. Successful-job latency includes waiting and retries. Queue-to-worker edges show observed attempt rate after starting, and configured capacity before starting.

## Subsystems on the same canvas

Open **Subsystems → Create subsystem**, name the group and choose at least two components. Groups are non-overlapping and one level deep. Collapse the group to see combined waiting/active counts and boundary connections; expand to edit the actual components and connections. Drag its header to move members together. Ungroup keeps every component.

Grouping and collapse are view changes, so a running experiment continues with the same graph and exact results. Groups persist with local projects and portable exports. A group whose components are absent after loading another scenario stays dormant and can reappear when that model edit is undone. This is visual composition around executable nodes, not a replacement simulation model.

## Editing and persistence

- Add components from the library, drag nodes, connect source and target handles, select a connection and press Delete, or delete a component from its inspector. Undo/redo preserves recent edits. Unsupported graphs remain editable and explain why Run is disabled.
- Select a component → Configuration for capacity, queue size, and cache hit rate. Select empty canvas for traffic, seed, duration and timeout.
- Projects autosave to IndexedDB in this browser. The project menu renames, reopens, creates, imports and exports projects. JSON exports are versioned; import creates a new copy.
- Checkpoints store the graph and workload settings. Project storage also includes canvas viewport. Running simulation state is intentionally not saved; completed measurements persist only after Save result.
- On narrow screens, the readable canvas can be panned, the inspector follows below it, and Checkpoints is a disclosure above the workspace.

No cloud synchronization or remote account is involved. Export JSON to preserve a portable backup; browser site-data deletion removes local projects.

## Model assumptions

This is a learning model, not a hardware benchmark or architecture sizing tool.

- Supported paths: traffic → service → optional cache → database, and producer → job queue → worker pool.
- Poisson arrivals from a deterministic seed, following the configured steady, burst or linear-ramp rate. Integrated arrival intensity is inverted analytically; unused exponential hazard is carried across burst boundaries, without fixed time-step approximations. Cache outcomes use a separate per-request deterministic draw, so adding the cache does not perturb arrivals.
- Service defaults to one worker at 2,000 requests/s per worker. Total service capacity is `workers × capacity`; processing time for each request is `1 / capacity`. Database and cache each retain one serial processor at 500 and 5,000 requests/s respectively.
- FIFO waiting queues default to 500 slots. Queue limits exclude all active workers. New arrivals are rejected when every worker is busy and the waiting queue is full.
- A global deadline defaults to 2,000 ms and includes a fixed 8 ms response overhead. An expired queued request is skipped. Already-processing expired work still consumes capacity until it completes, but never becomes a successful response.
- Cache hit probability is fixed (no warm-up, eviction, writes, consistency or key popularity).
- Runs stop at the selected observation window. Outstanding requests are counted as in flight rather than silently marked successful. Generated = succeeded + rejected + timed out + in flight.
- Throughput and utilization are cumulative averages. p95 and mean latency include successful requests only. The chart samples queue length each simulated second.
- URL lookups do not retry. Job retries follow the explicit policy above. Replication, worker crashes, duplicate delivery, frontend execution, network contention and branched execution are not modeled. Subsystems are one level of visual grouping around the same executable components.

## Structure

- `src/domain`: framework-independent project/graph types, metrics, immutable saved results and validation.
- `src/simulation`: deterministic event heap, request lifecycle, worker and React adapter; run IDs associate worker output with its starting model.
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
# Verify built assets with a separate local preview:
TEST_PRODUCTION=1 npm run test:e2e
```

Simulation tests cover baseline, overload, exact accounting, timeout cancellation, deterministic replay, chunk equivalence, cache demand reduction, zero queue slots and unsupported graphs. Browser journeys cover full experiments, pause/reset, local reopen, checkpoint restoration, import/export, invalid-graph repair, viewport persistence, connections and narrow-screen access.

Exact stable package versions are pinned in `package.json` and `package-lock.json`. `HANDOFF.md` records milestone commits, measured verification and concrete continuation steps. No remote push or deployment has been performed.

Metrics updates retain exact latency statistics using incremental sorted merges. Saved-results UI code loads when opened. Measured performance and the memory tradeoff are documented in `artifacts/VERIFICATION.md`; no real-device frame-rate claim is made.
