# Legacy retirement audit

Status: read-only source/caller audit, 2026-09-21. No code removed. User confirmed old-data compatibility can be dropped (D19). Keeping archive viewers, old format readers/converters or legacy engine replay is not a target requirement. No existing local records are deleted during planning.

## Current product versus compatibility

New projects and examples use the open graph. `App.tsx` enables Run only for open graphs, and loads non-open local/imported records read-only. Old lookup/jobs engines still exist behind `Simulation`, and `useSimulation` can initialize them, but they are not an independently runnable current UI mode. Saved results can be displayed without rerunning their original engine.

An imported symbol, a unit-test caller and a mounted editable UI path are different kinds of evidence. The scout's initial claims were checked against source; the table below uses the corrected call paths.

| Candidate | Verified evidence | Recommendation / removal gate |
|---|---|---|
| `components/MetricsPanel.tsx` | No source imports found; App uses OpenMetricsPanel | Strong orphan candidate. Verify dynamic entrypoints/style consumers, then remove in a small patch. No runtime redesign needed. |
| `state/editor.ts` actions `useScenario`, `loadExperiment` | Declarations/implementations and tests; no production UI callers found | Retire unused production creation actions after moving any still-useful fixtures to tests and migrating dependent actions. |
| `domain/experiments.ts` | Imported by `openExamples.ts` and legacy ExperimentCoach | Not dead. Rewrite active open examples directly against the current model before removing old constructors. Preserve learning content, not old engine promises. |
| `components/Inspector.tsx`, WorkloadControls, JobControls, ExperimentCoach | Legacy Inspector is conditionally mounted inside a disabled fieldset for archives | Retire archive UI and obsolete controls after extracting any still-needed current behavior. No replacement archive viewer required. |
| `ComponentInternals.tsx`, `ServiceModelEditor.tsx`, JobInternals | ArchitectureCanvas chooses its open inline view first; these are in the non-open rendering branch | Retire non-open rendering family after checking shared consumers. Do not claim ServiceModelEditor currently edits open behavior incorrectly: the open branch bypasses it. |
| `simulation/engine.ts` LookupSimulation, `simulation/jobs.ts`, Simulation dispatch | Worker uses Simulation; useSimulation may reset valid legacy graphs; unit tests explicitly exercise them | Retire old dispatch/engines as startup switches to current schema only. Keep useful shared primitives and exact open kernel behavior/tests. No archive replay requirement remains. |
| `domain/model.ts` scalar node fields and scenario flags | makeOpenNode still calls makeNode; model/helpers/export/conversion/tests use both | Define current-only schema and constructors, then stop dual-writing fields and remove obsolete consumers. No legacy codecs required. |
| `domain/routing.ts`, old insertion/settings branches | Legacy editor actions, constructors and tests still use them | Consolidate current creation on open routing behavior; keep only explicit conversion/fixture dependencies until replaced. |
| `domain/openGraph.ts` createRunnableCopy | Mounted archive conversion route; current examples also need a conversion-dependency check | Retire after current examples instantiate current schema directly. No automatic conversion of old records is promised. |
| `persistence/projects.ts` format 7/8 handling | Both formats validated and imported; non-open archives loaded read-only by App | Replace with explicitly versioned current-schema reader/writer; unsupported files get a clear error. Do not silently reinterpret old formats. |
| `ResultsPanel.tsx`, domain/results | Current and legacy saved results are reachable | Keep current result capability; retire obsolete model-version branches. Never relabel old measurements as new runner output. |
| Global and feature CSS | Multiple stylesheet families remain; earlier control rules were partially layered already | Delete by verified selector/consumer ownership and visual checks, not file age or historical critique. |
| `specs/shared-team-architecture.md` | Prior unimplemented provider-specific architecture | Mark historical proposal; reconsider provider/offline choices against hosted/self-hosted requirements. |

## Confirmed compatibility policy

One current authoring/execution model; no backward-compatible reader, converter, archive viewer or old runtime required. Old lookup/jobs/diagram scenarios no longer shape the product schema. Existing tests are evidence of behavior, not a reason to retain an abandoned mode.

Lead rollout decision: use a fresh explicitly versioned storage namespace for the redesigned schema, leaving prior IndexedDB records untouched but unsupported. Reject incompatible imports with a useful version message. This avoids accidental data interpretation or broad database deletion without imposing ongoing compatibility code. A reset/delete operation, if later needed, is a separate explicit user action.

## Retirement sequence

1. Inventory top-level exports, static/dynamic imports, App render branches, worker entrypoints, store callbacks and relevant tests. Record delete candidates with evidence.
2. Define current-schema fixtures and incompatible-version rejection cases. Keep valuable accounting/graph/history fixtures even if their old constructors are replaced.
3. Make current creation/examples independent of legacy constructors/converters; freeze current model types.
4. Switch startup, worker dispatch, editor and persistence together to current data only, using the new namespace. Reject unsupported imported versions.
5. Verify current round-trip, reload and incompatible-file handling; ensure startup never clears or rewrites old database records.
6. Remove obsolete runtime/editing paths in small reviewed commits. Replace obsolete tests with migration/archive assertions where that is the surviving requirement; retain exact open-engine invariant tests.
7. Remove unused styles/dependencies and historical UI vocabulary; update graph after code deletion using the documented force option if needed.

## Acceptance

No imports/callers remain for deleted production symbols; current new project/template/run paths work; current-format round trips preserve authored content/results; unsupported old files fail clearly; prior database records are not silently deleted or converted; no hidden old worker startup; bundle diff and focused browser checks recorded. No blanket test deletion to make cleanup pass.

This audit did not execute fresh application tests. The prior 233-unit/46-of-51-browser baseline remains the recorded baseline, not new verification of cleanup. Deletion work requires its own checks.
