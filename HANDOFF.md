# Development handoff

## Current status — load-balanced instances milestone complete

The user authorized all remaining concrete steps and explicitly removed backward-compatibility requirements. Completed the agreed three milestones: background jobs, canvas subsystem composition, and guided experiments. No additional milestones are being pursued automatically. No push or deployment.

### Checkpoints

- `398de12`: previous concurrent-service-worker milestone.
- `d690abb`: queued background-job engine, components, accounting and current portable format.
- `94de180`: editable subsystem composition and initial guide scaffolding.
- Final guide/verification/documentation checkpoint: `git log -1`.

### What works

- Two runnable paths: traffic → service → optional cache → database; producer → queue → worker pool.
- Steady, burst and ramp workloads with seeded exact replay, per-worker capacities, bounded FIFO waiting and absolute deadlines.
- Background jobs separate admission/producer acknowledgements from job completion, use seeded per-attempt failure draws, bounded fixed-delay retries and explicit permanent failure accounting.
- Expandable component views and atomic inline service/job settings; Undo/Redo, inspector synchronization, local projects/checkpoints, portable exports and immutable saved comparisons.
- One-level non-overlapping named subsystems wrap real components. Collapse shows aggregate waiting/active work and boundary connections; expand exposes editable children. Group dragging moves members together. Subsystems are view metadata, never a replacement engine model.
- Four guided starters: cache pressure, worker scaling, job burst recovery and retry cost. Suggested steps and measured observations live in the inspector; toolbar Guide returns to them. Guide identity follows model Undo/checkpoints; clearing a guide preserves a live run.

### Important semantics

Worker capacity is per worker; total is workers × capacity. Each attempt/request takes 1 / per-worker capacity. Service/job workers support 1–16 slots. Database/cache stay serial. Utilization divides occupied processor time by workers × elapsed time. Workers are ideal independent slots, not hardware replicas.

For jobs, successful admission schedules a producer acknowledgement 8 ms later, independently of the eventual outcome. Acknowledgement does not mean completion or a real durable broker. Deadline starts at original submission and includes waiting, retry backoff and attempts. Backoff uses no worker; expired active work holds its slot until processing ends. Initial queue-full admission is rejected. Full retry re-entry or exhausted retries fails permanently. No crashes or duplicate delivery.

Job invariant: generated = completed + admission rejected + expired + permanently failed + in flight. Accepted = generated − admission rejected. Acknowledgements are separate and may lag at the observation boundary. Successful-job latency includes waiting/retries. Observed attempt rates include retry work.

### Persistence and compatibility policy

Current portable format is version 5; old portable formats are intentionally not imported. Browser-local records are not deleted or reset. Very old saved result models can remain in local records but may need rerunning before importing a current export containing them; preserve old exports as archives. Current lookup results use url-lookup/3, jobs background-jobs/1, and different experiment models/workloads do not produce misleading deltas. Imported metrics are validated structurally, not authenticated or rerun.

Subsystems belong to Project.subsystems; missing members remain dormant through model undo. Creating new groups retains groups relevant to the current model. Graph.guideId is learning metadata excluded from the worker-reset signature. Renderer measurements are retained for components and groups so worker updates do not hide/remount views. Viewport restoration accounts for canvas height and node identity, preserving manual zoom for unchanged layouts.

### Verification and evidence

- 54 unit tests pass: existing URL semantics, jobs/retries/deadlines/accounting, deterministic profiles, round-robin routing and shared-bottleneck accounting, current import validation, group identity/projection and meaningful guided comparisons.
- All 22 production Chromium journeys pass. Final focused viewport regression covers guide switching/reopen, subsystem movement and manual viewport restoration.
- TypeScript and Vite build pass. Main entry approximately 551 KB /175 KB gzip; the known chunk-size warning remains. Results UI is deferred; no mobile-device frame-rate claim.
- Direct bounded visual QA: artifacts/background-jobs.png, background-jobs-mobile.png, subsystem-collapsed.png, subsystem-expanded.png, subsystem-mobile.png, guided-experiment.png, guided-mobile.png. No new independent visual review is claimed.
- Full evidence and historical milestones: artifacts/VERIFICATION.md. Usage: README.md. Product/design authority: PRODUCT.md, DESIGN.md.

### Resume instructions

Workspace: /Users/ankushjamdagani/personal/system-design-planner. Preview: http://localhost:5173/ (npm run dev if not running). Run npm test, npm run build and TEST_PRODUCTION=1 npm run test:e2e for production verification. Preserve the light docked design, exact accounting, separation of configured/observed values, and view/model boundaries. Current finite roadmap is complete; do not invent endless extras.
