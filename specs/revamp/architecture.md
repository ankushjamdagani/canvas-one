# Architecture

How the revamp is structured. Exact types and rules live in [contracts/](contracts/README.md); this doc explains the shape and the reasons.

## 1. Product model

**One workspace, many views, one Run loop:** input → validate → run → trace/results → compare. Frontend, backend, fullstack, code/data flow, service flow and infrastructure all get a path to meaningful model-based execution (D17). A sketch with missing behavior is an incomplete model, not a separate "diagram mode" (D20, D21).

| Concept | Meaning | Example |
|---|---|---|
| Element | Stable identity and responsibility | Checkout page, order service |
| View | A layout of chosen elements/relationships; references IDs, never copies | Fullstack overview; deployment view |
| Behavior | What happens when an input arrives | Validate order; transition UI state; queue message |
| Scenario | Scope, initial state, inputs, assumptions, checks | Payment timeout with a repeated click |

- **Behavioral connections** (call, message, data) carry work. **Structural relations** (contains, deployed-on, descriptive) don't. A structural relation only affects a run through a declared compiler rule, e.g. a failed host makes its resources unavailable.
- **Evidence types.** One scenario can mix logical behavior and optional timed resource modeling, and results state which evidence they contain:
  - A logical trace shows causal order, never invented milliseconds.
  - A resource simulation is an estimate under its stated assumptions, not a benchmark.
  - An animation is not evidence that code works.
  - Actual source execution is deferred (D17).
- **Refinement.** An element may have an internal submodel. Each scenario picks either the aggregate or the refined model, never both. Collapsing or expanding a view never changes execution.
- **Readiness** progresses sketch → behavior specified → scenario configured → runnable → evidence available. Missing pieces show as issues on the relevant elements. Template defaults are labelled as such. Every assumption records its source: author, template or measured (self-reported).

## 2. What exists today

- `specs/open-system-simulator.md` already replaced the fixed experiment/diagram modes: `newOpenProject()` is the default, and a component's `kind` is separate from its explicit behavior.
- Behaviors in `src/domain/execution.ts`: source, processor, router, storage, cache, broker. Edges are calls/messages; workloads carry rate/profile, request classes, tags and key distribution. It's a good resource/traffic simulator.
- **Limits:**
  - no payload transforms or UI state machines
  - route conditions only on class/operation/tag
  - synchronous cycles rejected
  - one shared resource config shape
  - `defaultBehavior()` numbers are assumptions, not facts about a technology
- **Legacy paths.** The non-open path exists mainly for archive compatibility: `App.tsx` loads archives read-only and enables Run only for open graphs. Legacy engines still sit behind `useSimulation`/worker dispatch.
- **Current boundaries:**
  - `App.tsx` composes boot, save, switch, selection, simulation and UI state.
  - `state/editor.ts` owns graph changes and history.
  - `persistence/projects.ts` uses Dexie `system-studio` v1. It exports formats 7 (legacy) and 8 (open) and uses a 2,000,000-character size check (not a byte limit).
- The main JS chunk is ~769 kB minified.

What gets reused and what is new is listed in [model-and-runner.md §10](contracts/model-and-runner.md#10-reuse-vs-new-work).

## 3. Module layout (new code)

| Path | Contents |
|---|---|
| `components/ui/` | Accessible low-level controls only |
| `components/studio/` | Shared compositions: field, metric, panel header, status, node chrome |
| `features/workspace/` | Command registry, layout preferences, panel reducer, shell |
| `features/library/`, `features/history/`, `features/results/` | Presentation plus adapters |
| `domain/versioning/`, `domain/parts/` | Pure typed operations, validation, deterministic diff/merge (no React/Dexie) |
| Domain scenario/behavior/compiler + versioned runners | S01–S05 execution (exact files assigned per task) |
| `persistence/` | Validated local repositories, transactions, portable format |

- These are destinations for new code; existing files aren't moved for their own sake.
- Existing editors and the canvas are reused through adapters, and old surfaces are retired once their replacements are proven.
- Domain operations return results; the UI never mutates snapshots directly.
- Simulation stays in its worker. Subscriptions stay narrow, so dragging panels or metric ticks don't re-render every node. Lazy-load history, merge and results where practical. Record bundle-size deltas and don't add chart/editor packages by default.
- `App.tsx` integration is one serialized task per wave. Never leave old and new navigation side by side, or immediate and draft fields mixed.

## 4. Versioning model

- **History.** An immutable commit DAG with branch head pointers, plus separately autosaved working snapshots per branch (D11). Graph undo/redo is session-only and is not history. A new project has a working branch and no commit.
- **Main** changes only by publication. Editing published work means a branch.
- **Branch switch.** Flush the save queue, resolve any dirty inspector draft (Apply / Discard / Stay), then load the target. A save failure never looks like a successful switch, and an unsaved completed run is never dropped.
- **Commit and publish** need completed, passing, exact-fingerprint runs for **every** configured scenario (D27, D28). There's no diagram exemption, subset or waiver; incomplete or failing work lives in autosave/checkpoints. [run-identity.md](contracts/run-identity.md) defines the fingerprint and eligibility.
- **Merge.** Three-way, by stable ID and field. Conflicts are explicit, and ordered sequences conflict whole (D25). The merged candidate must itself pass validation and runs before publishing, which usually means resolve → validate → run candidate → review → publish.
- **Publish** is one compare-and-set transaction. It checks the expected main head, advances main, records an immutable publication and closes the source branch by default (D29). If main moved in another tab, it rejects and the user recomputes. Publication can't be undone (D26); restoring an old version produces a draft.

Details are in [transactions.md](contracts/transactions.md) and [storage.md](contracts/storage.md).

**Other state:**
- **Inspector drafts** allow invalid intermediate text. Apply is atomic with one undo, and Run is blocked while a draft is dirty (D10, D25).
- **Parts** are detached copies with full ID remapping, inserted as one undo step ([parts-and-export.md](contracts/parts-and-export.md)).
- **Panel and dock preferences** are per-browser, versioned separately, outside the model, fingerprint and undo. Resizing never moves nodes. Small screens adapt without overwriting desktop preferences.

## 5. Storage cutover (D19)

- **Old formats dropped.** No legacy reader, converter, archive viewer or old runtime is kept.
- **New namespace.** The new Dexie database `system-studio-local-v1` starts empty. The old `system-studio` is left untouched and unsupported, and startup never clears or rewrites it. Resetting or deleting it later would be a separate explicit user action.
- **Imports.** Portable format v9. Versions 7/8 and unknown versions are rejected with a clear message.
- **No fake history.** Old projects never get fabricated commits to look verified, and imported current-format data never gains verification just by parsing.

## 6. Legacy retirement

Evidence from a read-only caller audit (2026-09-21). An imported symbol, a test-only caller and a mounted UI path are different kinds of evidence.

| Candidate | Evidence | Removal gate |
|---|---|---|
| `components/MetricsPanel.tsx` | No imports; App uses OpenMetricsPanel | Orphan: check dynamic/style consumers, then remove |
| `state/editor.ts` `useScenario`, `loadExperiment` | Tests only | Move useful fixtures to tests, then remove |
| `domain/experiments.ts` | Used by `openExamples.ts` and ExperimentCoach | Rewrite examples on the current model first |
| `Inspector.tsx`, WorkloadControls, JobControls, ExperimentCoach | Archive-only, in a disabled fieldset | Extract anything still needed; no archive viewer |
| `ComponentInternals.tsx`, `ServiceModelEditor.tsx`, JobInternals | Non-open rendering branch only | Retire the family after checking shared consumers |
| `simulation/engine.ts`, `simulation/jobs.ts`, Simulation dispatch | Worker plus tests | Retire with the startup cutover; keep open-kernel behavior and tests |
| `domain/model.ts` scalar fields, scenario flags | `makeOpenNode` calls `makeNode`; used widely | Current-only schema and constructors; stop dual-writing |
| `domain/routing.ts`, old insertion branches | Legacy actions/tests | Consolidate on open routing |
| `domain/openGraph.ts` `createRunnableCopy` | Archive conversion; check examples | Retire after examples use the current schema directly |
| `persistence/projects.ts` formats 7/8 | Both imported | Replace with the v9 reader/writer |
| `ResultsPanel.tsx`, `domain/results` | Current and legacy saved results | Keep current capability; drop old branches; never relabel old metrics |
| `architectureDiagram`, `isDiagramGraph`, legacy scenario constructors, `domain/revisions.ts` | Mixed | Retire after current replacements are accepted |
| Global/feature CSS | Several stylesheet families | Delete by verified selector ownership and visual check |
| `specs/shared-team-architecture.md` | Unimplemented Supabase/Hocuspocus plan | Historical only |

**Order:**
1. Inventory exports, imports, render branches, worker entrypoints and tests.
2. Build current-schema fixtures and rejection cases.
3. Make creation and examples independent of legacy code.
4. Switch startup, worker, editor and persistence together to the new namespace.
5. Verify round trips, reload and bad-file handling, and that the old DB is untouched.
6. Delete obsolete paths in small reviewed commits.
7. Remove unused styles and dependencies.

**Acceptance:** no callers remain for deleted symbols; new-project, template and run paths work; unsupported files fail clearly; no hidden legacy worker startup; bundle diff recorded. Every retired test records why it no longer represents a requirement. Never delete tests wholesale.

## 7. Future boundaries (not built now)

Two confirmed future directions constrain today's design without adding code.

**Hosted, self-hosted and sync (D18).** Local, hosted and self-hosted bundles share one core; GitHub/server sync and async review come first, live coediting later. Required now:
- **IDs.** Project, document, element, branch and scenario IDs never depend on a provider or on names.
- **Commands.** Typed domain commands with atomic change groups, expected revisions and origin metadata, instead of whole-project replacement.
- **Separate storage** for document content, immutable history, run artifacts, personal preferences and (future) presence.
- **No credentials or vendor IDs** in portable data.
- **Actors.** An actor records origin (a local self-reported name vs a server principal); a name never grants permission.
- **Formats.** Versioned, deterministically encoded portable data. Unknown behavior versions never run with old semantics.
- **Adapters.** Only local adapters are implemented. A future sync layer adds an idempotent outbox, expected-head updates, tombstones and server-side permission checks.

Later decisions (not now):
- **GitHub** is a snapshot/review destination, not a per-keystroke collaboration server. Studio commit IDs map to Git SHAs. Git merges are always followed by domain validation.
- **Live coediting** (e.g. Yjs) is a separate design and must not rewrite immutable history.
- **Self-hosting** must not require any company-hosted API.
- The old `shared-team-architecture.md` choices are not binding.

**AI collaboration through the canvas (D22).** A future assistant discusses and proposes changes against structured project context: decisions, proposals and evidence stored as project records, not Markdown or chat logs. Required now:
- UI-independent validated commands, candidate diff/validation, stable revision-aware references, provenance and run identity. A future agent is just another client of these; it never writes Zustand/Dexie directly or scrapes the UI.
- Proposals will carry a base revision, operations, rationale and evidence refs; stale proposals are rebased or rejected, never applied blindly.
- No AI providers, chat UI, agent services, plugin frameworks or speculative tables now. Local use never requires AI.
