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
- **Revamp:** RV-01 to RV-17 are complete. RV-13 (release acceptance) and RV-17 (design conformance) were accepted by the user. The app runs only on the studio model and `system-studio-local-v1`. Ledger: [`specs/revamp/delivery.md`](specs/revamp/delivery.md). Reports: [`rv13-acceptance.md`](specs/revamp/rv13-acceptance.md), [`rv15-retirement.md`](specs/revamp/rv15-retirement.md).
- **Verification baseline on master:** 1,420 unit tests (123 files); `npx tsc -b` clean; production build passes with no chunk over 500 kB (entry path 702 kB / 197 kB gzip across `react-vendor`, `storage-vendor` and `index`; workspace chunk 384 kB plus `canvas-vendor` 178 kB, prefetched on idle); production Chromium 78 passed / 4 skipped (dev-only specimen) in about 32 s.

## Code map

| Area | Location |
|---|---|
| Studio model, validation, readiness, closure, manifest | `src/domain/studio/` |
| Scenario runner (S01–S05 families) and trace | `src/domain/studio/runner/` |
| Versioning (branches, checkpoints, commits, merge, publish) | `src/domain/versioning/` |
| Parts copy engine | `src/domain/parts/` |
| Local repository (Dexie `system-studio-local-v1`), import/export, pruning | `src/persistence/studio/` |
| Retained open kernel + goldens | `src/simulation/open/` (types in `src/domain/execution.ts`, arrivals in `workload.ts`) |
| App shell and features | `src/App.tsx`, `src/features/{session,workspace,inspector,library,catalog,panels,history,runs,scenarios,transfer,entry}` |
| Primitives, tokens, specimen | `src/components/ui/`, `src/components/studio/`, `src/styles.css` |
| Reference fixtures S01–S05 | `specs/revamp/fixtures/` (also the entry-screen examples) |

## Running and verifying

```bash
npm run dev          # http://localhost:5173
npm test             # unit (src/**/*.test.ts only; TSX tests need deliberate setup)
npm run build
```

Production e2e: `playwright.config.ts` reuses any server already on port 5174, which can test a stale build. For acceptance runs use a throwaway config with an isolated port, `reuseExistingServer: false`, 2 workers and no retries, then run `TEST_PRODUCTION=1 npx playwright test --config <that file>`.

## Open debt

Tracked here until resolved; none blocks release.

| Item | Where | Notes |
|---|---|---|
| "Filled" field placeholder (RV-01 residual) | primitives | Needs the Design System board (`System Studio Design System.dc.html`), which isn't on this machine |
| No automated test for Button `loading` + `asChild` spinner | `components/ui/button.tsx` | Unit config excludes TSX |

Resolved 2026-09-29 (see `ACTION_LOG.md`): stale TODOs, the superseded RV-14b logical runner (its tests now run on `runScenario` and exposed the budget-status bug below), the replaced `ScenarioRunControl`, unused modules and dependencies, estimated group heights (now measured), bundle size (code-split), and an e2e spec writing screenshots into the repo.

Accepted limitations (by design, not debt): router + bridge routes rejected by readiness until the runner supports them; runtime refinement maps one level of ports; the 16E picker is catalog-only (saved parts live in the Library panel); Replace part has no contracted command.

## Code-splitting notes

- `src/lib/lazyComponent.tsx` is the split primitive. Don't use `React.lazy` + Suspense for these boundaries: React 19 throttles Suspense reveals (~300 ms) even for cached chunks, which made opening a project ~830 ms.
- The main thread must not import the runner: take protocol types with `import type`, keep `InProcessTransport` (tests) in `features/runs/inProcessTransport.ts`, and load `compile`/`scenario-runner` dynamically (publish candidates). A barrel `export *` of a module keeps it in the graph and makes dynamic imports ineffective; the build prints `INEFFECTIVE_DYNAMIC_IMPORT` when that happens.
- Entry examples come from `features/entry/exampleCatalog.ts` (lazy); `fixtures.ts` stays for tests.

## Resume

1. Work on `master` in the main checkout; it is the only branch and there are no extra worktrees.
2. Read the invariants above, then the relevant `specs/revamp/` contract before changing domain, runner, persistence or canvas behavior.
3. Run checks proportional to the change and record the task in `ACTION_LOG.md` (with a `Lesson:` line when something surprised you).
