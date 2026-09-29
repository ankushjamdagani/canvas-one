# RV-15 retirement audit (first slice)

The production entry is `src/main.tsx` → `src/App.tsx` → `features/session/openStudioRepository`, which opens only `persistence/studio` (`system-studio-local-v1`). The browser worker is created in `features/workspace/Workspace.tsx` from `features/runs/runner.worker.ts`; its protocol uses the current scenario runner. The v9 reader/writer lives in `persistence/studio`. The old editor, project persistence, and simulation worker/engine files are absent. `src/legacy-boundaries.test.ts` rejects new production imports of those paths.

The former revision helper is retained: although it has no direct runtime caller, `domain/model.ts` imports its `ArchitectureRevision` type. No source files or tests were retired in this slice. The old graph/results/notes types remain connected to `domain/execution.ts` and `domain/workload.ts`, which the open simulation kernel still uses; they need a separate type decoupling before removal. The open kernel and its golden files were not changed. GSAP and its React wrapper had no source imports and were removed from the dependency manifest and lockfile.

Bundle baseline (`npm run build` at `116f078`): main JS 1,599.67 kB (430.34 kB gzip), worker JS 234.94 kB, CSS 153.47 kB (28.90 kB gzip). After this slice on that base: identical emitted assets (0.00 kB delta), as expected for removing packages with no source imports.

After rebasing onto the newer UI commit `847ada6`, the build emits main JS 1,626.71 kB (438.02 kB gzip), worker JS 234.94 kB, and CSS 153.73 kB (28.93 kB gzip). Verification on the rebased commit: 1,391 unit tests, TypeScript/Vite build, and production Chromium journeys (69 passed, 4 skipped) pass.

Remaining gates: decouple current execution types from the old graph schema, then retire the remaining legacy domain island and tests with migrated assertions; audit stylesheet selectors with visual verification. The new-project, template, run, import rejection, and old-database untouched journeys still need production browser verification after any broader retirement.
