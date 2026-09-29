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

- **Branch:** `master` holds everything: app, specs, ledger and agent workflow. Merged `@ 3b4bda9` from the UI line, the ledger branch and the two workflow branches (`/retro` learning loop, `/delegate` hardening). No remote is configured; nothing has been pushed.
- **Revamp:** RV-01 to RV-17 are complete. RV-13 (release acceptance) and RV-17 (design conformance) were accepted by the user. The app runs only on the studio model and `system-studio-local-v1`. Ledger: [`specs/revamp/delivery.md`](specs/revamp/delivery.md). Reports: [`rv13-acceptance.md`](specs/revamp/rv13-acceptance.md), [`rv15-retirement.md`](specs/revamp/rv15-retirement.md).
- **Verification baseline on master:** 1,416 unit tests (122 files); `npx tsc -b` clean; production build passes (main JS 1,643.89 kB / 442.29 kB gzip, CSS 115.71 kB, existing large-chunk warning); production Chromium 77 passed / 4 skipped (dev-only specimen).

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
| Stale TODO comments (manifest sorting, request-ID derivation, storage limits, readiness, trace envelope) | `domain/studio/{canonical,model,validate}.ts` | All implemented since (manifest.ts, machine.ts, validate.ts budgets, readiness.ts, runner/trace.ts); comments mislead |
| Superseded logical runner kept alive by its own test | `domain/studio/runner/logical.ts` + test | RV-14b interpreter; production uses the composed `scenario-runner` |
| Replaced run control kept alive by its own test | `features/runs/ScenarioRunControl.tsx` + test | Replaced by `features/scenarios/ScenarioSwitcher.tsx` in RV-12i |
| Unused modules | `components/ui/collapsible.tsx`, `features/scenarios/ScenariosPreview.tsx`, barrels `domain/studio/runner/index.ts`, `features/catalog/index.ts` | Not imported by the app, tests or specimen |
| Unused dependencies | `zustand`; `@radix-ui/react-collapsible` (only the unused primitive) | `npm audit --omit=dev`: 0 vulnerabilities |
| Group bounds use an estimated card height | `features/workspace/projection.ts` (`ESTIMATED_ELEMENT_NODE_HEIGHT`) | Expanded members can overflow their group frame |
| Bundle size | main JS 1.64 MB | architecture.md suggests lazy-loading history, merge and results |
| "Filled" field placeholder (RV-01 residual) | primitives | Needs the Design System board, which isn't on this machine |
| No automated test for Button `loading` + `asChild` spinner | `components/ui/button.tsx` | Unit config excludes TSX |

Accepted limitations (by design, not debt): router + bridge routes rejected by readiness until the runner supports them; runtime refinement maps one level of ports; the 16E picker is catalog-only (saved parts live in the Library panel); Replace part has no contracted command.

## Resume

1. Work on `master`. The main checkout was still on `codex/canvas-first-workspace` at consolidation because of an uncommitted `.claude/launch.json`; switch it to `master` once that change is committed or set aside. The old branches `codex/canvas-first-workspace` and `claude/rv-01a-tokens` are fully merged and can be deleted afterwards.
2. Read the invariants above, then the relevant `specs/revamp/` contract before changing domain, runner, persistence or canvas behavior.
3. Run checks proportional to the change and record the task in `ACTION_LOG.md` (with a `Lesson:` line when something surprised you).
