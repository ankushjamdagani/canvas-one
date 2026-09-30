# Development handoff

Current state and how to resume. Task history is in [`ACTION_LOG.md`](ACTION_LOG.md), durable agent rules in [`LESSONS.md`](LESSONS.md), and the plan, ledger and contracts in [`specs/revamp/`](specs/revamp/README.md). Earlier handoff snapshots, including notes on the retired pre-revamp app, are in git history (this file at `3b4bda9`).

## Project invariants

Preserve in all work touching architecture, simulation, persistence, exports or canvas behavior:
- **Simulation accounting** — strict separation between configured architecture and observed results; exact per-attempt latency, FIFO queuing, retry draws. The retained open kernel (`src/simulation/open/`) is pinned by characterization goldens; change it only in an explicit kernel step.
- **Model/view separation** — canvas and view metadata (placements, groups, notes, labels) never enter the run manifest or executable model.
- **Portable persistence** — only the current `system-studio` v9 bundle imports; v7/v8 and unknown versions are rejected with a typed message (D19). The retired app's `system-studio` IndexedDB database is never read, migrated or deleted.
- **Truthful results** — nothing is reported as run, passed or measured unless it was; unsupported model shapes are rejected by readiness, not silently skipped.
- **Scope discipline** — do not invent milestones beyond the requested task. Future directions (hosted/sync D18, AI collaboration D22) start only when the user asks.

## Current state (2026-09-29)

- **Branch:** `master` holds everything: app, specs, ledger and agent workflow (merged `@ 3b4bda9` from the UI line, the ledger branch and the two workflow branches (`/retro` learning loop, `/delegate` hardening)). No remote is configured; nothing has been pushed.
- **Revamp:** RV-01 to RV-17 and RV-19 to RV-21 (16D selection actions, D46) are complete; RV-18 was dropped (D45). Realism audit phases 1–3 are done ([realism-audit.md](specs/revamp/realism-audit.md)). Phase 3 found runner and metric defects; B1–B5, B7, B8 and G1 are fixed (D47, runner `studio-runner/2`, so earlier run evidence is stale). Open: B9 (metric assertions never evaluate) and the ranked modelling issues (H11–H14, H1, H2, defaults), which need user decisions. RV-13 (release acceptance) and RV-17 (design conformance) were accepted by the user. The app runs only on the studio model and `system-studio-local-v1`. Ledger: [`specs/revamp/delivery.md`](specs/revamp/delivery.md). Reports: [`rv13-acceptance.md`](specs/revamp/rv13-acceptance.md), [`rv15-retirement.md`](specs/revamp/rv15-retirement.md).
- **Verification baseline on master:** 1,518 unit tests (134 files, including 20 statistical kernel oracles and 30 reference-architecture tests; 9 opt-in realism probes skipped); `npx tsc -b` clean; production build passes with no chunk over 500 kB (entry path 702 kB / 197 kB gzip across `react-vendor`, `storage-vendor` and `index`; workspace chunk 384 kB plus `canvas-vendor` 178 kB, prefetched on idle); production Chromium 88 passed / 4 skipped (dev-only specimen) in about 36 s; `node scripts/a11y-audit.mjs` reports no axe violations.
- **Design and accessibility reports:** [`visual-acceptance.md`](specs/revamp/visual-acceptance.md) (screens vs the design boards; open O1–O4 need design decisions), [`accessibility.md`](specs/revamp/accessibility.md) (WCAG 2.2 AA pass). The design package lives untracked in `artifacts/design/Copy of Elegant and modern design refresh/`.

## Running and verifying

```bash
npm run dev          # http://localhost:5173
npm test             # unit (src/**/*.test.ts only; TSX tests need deliberate setup)
npm run build
node scripts/a11y-audit.mjs   # axe over 11 states at desktop and phone (after a build)
```

Production e2e: `playwright.config.ts` reuses any server already on port 5174, which can test a stale build. For acceptance runs use a throwaway config with an isolated port, `reuseExistingServer: false`, 2 workers and no retries, then run `TEST_PRODUCTION=1 npx playwright test --config <that file>`.

## Open debt

Tracked here until resolved; none blocks release.

| Item | Where | Notes |
|---|---|---|
| B9: metric assertions (throughput, latency, utilization) always return unevaluated, in timed mode too | [`realism-audit.md`](specs/revamp/realism-audit.md) "Defects" | Not yet fixed; ask the user |
| Realism issues H11–H14 and defaults (router/service slot hold with 16-slot cap, 10 s message TTL and 500 queue limit, no caller retries, deterministic service time, stream delivery, 0 ms call latency, equal read/write cost, fixed-mode cache) | [`realism-audit.md`](specs/revamp/realism-audit.md) | Each needs a user decision; batch into one kernel version bump |
| Accessibility gaps not yet assessed: screen reader, keyboard-only canvas editing, text spacing, forced colours | [`accessibility.md`](specs/revamp/accessibility.md) | Automated and keyboard probes are clean |

Resolved 2026-09-30: visual open items O1–O4 (D44; O1 kept icon-only). Resolved 2026-09-29 (see `ACTION_LOG.md`): the Button spinner test, the filled-field state (design package found), stale TODOs, the superseded RV-14b logical runner (its tests now run on `runScenario` and exposed the budget-status bug below), the replaced `ScenarioRunControl`, unused modules and dependencies, estimated group heights (now measured), bundle size (code-split), and an e2e spec writing screenshots into the repo.

Accepted limitations (by design, not debt): a router's routes must reach resources (D45; readiness explains the fix); the 16E picker is catalog-only (saved parts live in the Library panel); Replace part has no contracted command.

## Code-splitting notes

- `src/lib/lazyComponent.tsx` is the split primitive. Don't use `React.lazy` + Suspense for these boundaries: React 19 throttles Suspense reveals (~300 ms) even for cached chunks, which made opening a project ~830 ms.
- The main thread must not import the runner: take protocol types with `import type`, keep `InProcessTransport` (tests) in `features/runs/inProcessTransport.ts`, and load `compile`/`scenario-runner` dynamically (publish candidates). A barrel `export *` of a module keeps it in the graph and makes dynamic imports ineffective; the build prints `INEFFECTIVE_DYNAMIC_IMPORT` when that happens.
- Entry examples come from `features/entry/exampleCatalog.ts` (lazy); `fixtures.ts` stays for tests.

## Resume

1. Work on `master` in the main checkout; it is the only branch and there are no extra worktrees.
2. Read the invariants above, then the relevant `specs/revamp/` contract before changing domain, runner, persistence or canvas behavior.
3. Run checks proportional to the change and record the task in `ACTION_LOG.md` (with a `Lesson:` line when something surprised you).
