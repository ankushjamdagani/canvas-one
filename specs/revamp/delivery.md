# Delivery plan

## Status

**Hold lifted (user, 2026-09-23, `/delegate start revamp work`).** EXEC-PREFLIGHT passed; first lanes RV-01a and RV-02a are in review. The hold was set 2026-09-22.

Planning is complete: the plan passed four review rounds and every RV-02 contract finding is closed ([reviews.md](reviews.md)). The only remaining step is the user reviewing the plan and lifting the hold.

## Roles and rules

| Role | Who | Does |
|---|---|---|
| Lead | Codex | Plans, assigns bounded tasks, verifies, accepts. Sole writer of this ledger, HANDOFF and ACTION_LOG. |
| Reviewer | Claude | Reviews plans, contracts and every implementation diff. Doesn't implement fixes. |
| Implementer | Gemini/agy | Implements one bounded checkpoint at a time. |

- **Dispatch** uses the `/delegate` skill with this project's roles: Claude as critic and reviewer, Gemini as executor. Record the actual prompt, output, exit status and diff; a process exiting 0 isn't proof of work.
- **Before the first write dispatch** (EXEC-PREFLIGHT): Gemini does a no-edit run that acknowledges its file boundary. Confirm the allowed writes and test commands, and rehearse an interrupt/timeout. The earlier headless attempt that exited 0 with a permission denial doesn't count. No blanket permission bypasses.
- **One task = one checkpoint.** Each task records its base commit, worktree, exact allowed files (including tests), contract sections, fixtures, requirement IDs, screens, acceptance commands and stop conditions. Stop and escalate if a task needs files outside its list or hits an ambiguity; never invent semantics. "Implement RV-14" is not a valid task.
- **Lanes.** At most 3 implementation lanes, each in an isolated worktree with its own dependency install (never symlinked). Shared contracts come before consumers; kernel patches are exclusive.
- **Shared files have one writer at a time.** `src/App.tsx`, `src/state/editor.ts`, `src/domain/model.ts`, `src/persistence/projects.ts`, `src/components/StudioMenu.tsx`, and any reserved shared CSS, contract or package files change only in a reserved RV-12 integration slot. There is one slot at a time, holding an exact file subset; it is released explicitly when accepted.
- **Interruption.** Keep ownership and the partial diff and inspect them before retrying. Never auto-reset a worktree. Retry only the unaccepted scope.
- **Acceptance** needs Claude's review of the actual diff and test output, plus Codex verification. UI built on fixtures is *reviewable*, not integrated, until it runs on real state. A change to an accepted contract invalidates the tasks that depend on it.

## Dependency graph

```mermaid
flowchart TD
  A[RV-00 plan review] --> B[RV-01 Foundation]
  A --> C[RV-02 Contracts]
  B --> D[RV-03 Shell/panels] & E[RV-04 Canvas/dock] & F[RV-05 Inspector] & G[RV-06 Library UI] & H[RV-07 Results] & K[RV-10 Entry/transfer] & L[RV-11 History UI]
  C --> D & E & F & G & H & K
  C --> I[RV-08 Versioning] & O[RV-14 Runners] & P[RV-15 Retirement] & Q[RV-16 Local adapters] & J[RV-09 Parts domain]
  O --> I
  I --> L
  D & E & F & G & H & J & K & L & O & P & Q --> M[RV-12 Integration slots]
  M --> N[RV-13 Release acceptance]
```

Suggested first lanes once the hold lifts, and only on disjoint files: (1) foundation, (2) shared schema/validators, then pure runners, (3) repository base (RV-16a).

## Packages

| ID | Owner | Scope (owns) | Needs | Done when |
|---|---|---|---|---|
| RV-00 | Claude | Plan review | — | **Accepted** |
| RV-01 | Gemini | `components.json`, `src/styles.css`, exact `components/ui/` files, new `components/studio/`, specimen + tests; package/fonts only while holding the dependency lock | RV-00 | R02/R11; component/browser checks; matches the foundation canvas. No domain edits. |
| RV-02 | Codex / Claude | [contracts/](contracts/README.md) | RV-00 | **All findings closed**; shared TypeScript types are a later Gemini task |
| RV-03 | Gemini | New `features/workspace/`, `TopBar.tsx`, `ActivityRail.tsx`, shell tests | 01, 02 | R03/R04/R11; reducer tests; screens 22A nav, 13A/B, 14A, 18A, 23A–G; reload/viewport |
| RV-04 | Gemini | `ArchitectureCanvas`, `SubsystemNode`, `TrafficEdge`, `CanvasNotes`, `CanvasContextMenu`, `DiagramOrganization`, `layout/CanvasFloatingDock` + canvas CSS/tests | 01, 02 | R05/R11; notes/group/export/viewport journeys; 2A, 16A–D. No engine/editor edits. |
| RV-05 | Gemini | `OpenInspector`, `OpenConnectionEditor`, `OpenWorkloadControls`, `NumberField`, `SubsystemsPanel`, new typed forms | 01, 02; editor API via RV-12 | R06/R11/R13: no partial mutation, one undo, stale detection, truthful readiness |
| RV-06 | Gemini | New `features/library/` | 01, 02 (fixtures OK) | R07/R11; final acceptance needs RV-09 + integration; screens 12A–C, 16E |
| RV-07 | Gemini | `ResultsStrip`, `OpenMetricsPanel`, `ResultsPanel`, new `features/results/` | 01, 02 | R09/R11; identical numbers for the same model; partial/completed/imported states. No kernel instrumentation. |
| RV-08 | Gemini (sub-steps) | New `domain/versioning/` + repository files | 02, RV-14a, RV-16a | R08; see sub-steps below |
| RV-09 | Gemini | New `domain/parts/` + part repository | 02 | R07/R11: independent copies, exclusions, collisions, limits, failed placement leaves state unchanged |
| RV-10 | Gemini | Entry components, exporters, `ExamplesPanel`, `DiagramExport` (when reserved) | 01, 02 | R10/R11: escaping, formula safety, Unicode, empty data; keep SVG/PNG/JSON |
| RV-11 | Gemini | New `features/history/`, `RevisionsPanel`, tests (`StudioMenu` via RV-12) | 01, 02, RV-08 APIs | R08/R11: 22A–F; no false verified/team labels; keyboard conflict resolution; failed publish keeps state |
| RV-12 | Gemini | Shared files, one slot at a time | Accepted features | Real state wired; cutover tested; old UI removed; no duplicate commands or fixtures in production |
| RV-13 | Codex / Claude | Release verification | All, incl. RV-14 S01–S05 | [Release gates](verification.md#release-gates) |
| RV-14 | Gemini (sub-steps) | New scenario/behavior/compiler/runner modules; kernel only via exclusive sub-step | 02 | R13: S01–S05 success/failure; limits, cancellation and truncation explicit; fingerprints available to RV-08 |
| RV-15 | Gemini | `MetricsPanel`, legacy Inspector/internals/controls, legacy engines, per the manifest ([architecture §6](architecture.md#6-legacy-retirement)) | 02; replacements accepted | Unsupported formats rejected; old DB untouched; no legacy worker; each retired test justified |
| RV-16 | Gemini (sub-steps) | New local repository/run/artifact/preference adapters; Dexie boot only via RV-12 | 02 | R14: works offline; no credentials or vendor IDs; save-failure and stale-write tests. No remote code. |

Ownership notes:
- **RV-05 vs RV-15.** RV-05 owns `OpenInspector`; RV-15 owns the legacy `Inspector` and never modernizes code scheduled for retirement. A file moves to retirement only after its replacement is accepted.
- **Kernel files.** No UI task owns them.
- **Retirement edits.** RV-15 writes the deletion manifest; the serialized edits happen in RV-12 slots.

### Sub-steps

| Step | Needs | Delivers |
|---|---|---|
| RV-14a | RV-02 | Scenario readiness, canonical manifest, evidence interface, trace envelope |
| RV-14b | 14a | S01 machine interpreter |
| RV-14c | 14a | S03 data operations (parallel with 14b) |
| RV-14d | 14a | Retained-kernel characterization, finite-input/trace adapter, S02 outcomes |
| RV-14e | 14d **accepted** | S04 fault scheduler with exact failure accounting |
| RV-14f | 14b–e | S05 composition/refinement; five-family acceptance |
| RV-16a | RV-02 | New namespace, immutable rows, compare-and-set/receipts, preferences, quota/recovery, repository port |
| RV-16b | 16a, RV-08 history, RV-14 evidence | Import/export, pruning, recovery journeys |
| RV-08a | RV-14a, RV-16a (pure logic can use a port fake; durable acceptance needs 16a) | Snapshot/evidence storage, eligibility predicates |
| RV-08b | 08a | Branch working copies, autosave/checkpoints, switch/save-failure |
| RV-08c | 08b | Typed three-way diff/merge, reference conflicts |
| RV-08d | 08c, RV-14a–f all accepted | Isolated candidate runs; eligibility across all five families |
| RV-08e | 08d, RV-16a | Atomic publish, default closure/reopen, stale-head cases |
| RV-08f | 08e | History round trip, retention/reference integrity |

RV-14d and RV-14e are always serialized. RV-16b follows versioning integration, which avoids a dependency cycle.

**Integration order:** foundation → shell/canvas → inspector → library/results/entry → history. The current-schema, runner and retirement slices are coordinated before incompatible consumers are wired in.

## Task ledger

| ID | Status | Next |
|---|---|---|
| PLAN, RV-00, RV-02 | ACCEPTED (planning) | — |
| EXEC-PREFLIGHT | ACCEPTED 2026-09-23 | agy runs headless with `--dangerously-skip-permissions` (user choice) inside per-task worktrees; timeouts need a SIGTERM/SIGKILL watchdog (`alarm`/`--print-timeout` don't stop agy) |
| RV-01 foundation (a–h) | ACCEPTED (Claude sign-off 2026-09-23) | Branch `claude/rv-01a-tokens` @ `3631027`. RV-01h matched Button/fields/checkbox/tabs/toggle-group/tooltip/menus/tags/kbd to the Design System board (computed-style check). Residual (low): primary button text white vs board shell #FBFAF7; field 'filled' white state needs a placeholder; Button loading+asChild shows no spinner; toast has no layering token (contract gap); existing screens inherit the new primitive looks and are restyled in their own packages. Unblocks RV-03/04/05/06/07/10/11 UI work |
| RV-02a–g model core | REVIEW PASS, committed | Head `claude/rv-02g-manifest` @ `2ffa2d3`: D32/D33 applied to the validator; `buildManifest` + `ss-run-v1` fingerprint (Claude probes: presentation/reorder stable, latency/seed change it, other scenario isolated, no labels in manifest). Open gap: are scenario `entryPorts` a set (sorted) or ordered? |
| RV-05a inspector restyle (visual) | REVIEW PASS, committed | `a97836b` on foundation line. Apply/Cancel waits for RV-12; App.tsx wrapper 340px vs inspector 320px leaves a sliver (RV-12) |
| RV-04c nodes/edges/boundaries | REVIEW PASS, committed | `76e4a37`, merged on foundation line @ `8e869e5`: 176px cards with D35 kind stripes, wrapping titles/subtitles, legacy node card CSS removed (no !important). Drop-preview/dimmed node states not wired (need canvas data, later RV-04 slice) |
| RV-03a panel reducer | REVIEW PASS, committed | `claude/rv-03a-panel-reducer` @ `e9e3b58` (pure, 55 tests). Gaps: gesture payloads, activeOverlay representation, announce wording |
| RV-03b top bar + rail (22A) | REVIEW PASS, committed | `fe2bda7`, merged on `claude/rv-01a-tokens` @ `2262d55`. Temporary `header.canvas-first-topbar { z-index:1100 }` keeps the top bar above the RV-12-reserved StudioMenu backdrop (remove when StudioMenu becomes a DropdownMenu). Rail label clipping fixed in RV-03c `a1af2bd` (board short labels, full aria-labels; supplied 22A app mark) |
| RV-04a canvas dock (16A) | REVIEW PASS, committed | `c7a4020`, on foundation line. 16B overflow actions not in app (not invented); arbitrary shadow until elevation tokens exist; RV-04b `9fc4367`: 'More canvas tools' overflow popover on narrow screens (16B) and raised/popover/floating shadow tokens. Foundation line now `11b6bb0` |
| RV-02f remaining readiness rejects | REVIEW PASS, committed | `claude/rv-02f-readiness` @ `e75fc15`. 'Missing pipeline outputs' read as unresolvable output/error port (S03 shows unconnected outputs are legal) — contract round to confirm |
| RV-12a layout slot (App.tsx, StudioMenu.tsx, canvasFirst.css) | REVIEW PASS, committed; slot released | `5a93acf`, merged on foundation line @ `b4e73ca`: inspector dock 320px + 1px border (sliver gone), StudioMenu backdrop starts below the measured top bar (temporary z-index 1100 rule removed), mobile canvas fills remaining height. Production e2e 72/1/4 (was 68/5/4); remaining failure is the 40px Load-example target. Debt: `.system-canvas` mobile anchor uses `!important` to beat legacy `openWorkspace.css` (clean up when that file retires) |
| RV-07a results strip + metrics detail (visual) | REVIEW PASS, committed | `66885b1`, merged on foundation line @ `aa281c1`: text run-state badge, tabular numbers with units, General/Components sections (not tabs — both always shown), phone stacking. Three review rounds (fake tabs, unit on empty value, arbitrary sizes; mobile strip hid all stats). Production e2e 78/1/4. `ResultsPanel` (saved-run comparison) not restyled yet. Observed: the same example yields different numbers per run (e.g. 97.4 vs 100.4 req/s) — pre-existing, relevant to R09 'identical numbers' and RV-14 seeding |
| RV-14a runner start | ACCEPTED (user 2026-09-24, with RV-14) | `claude/rv-14a-runner-start` @ `3d413c4` (on model line `2ffa2d3`): `src/domain/studio/runner/` — `prepareScenario` (validate → buildManifest, cancel checks between steps; no worker/plan handles/startRun yet), trace envelope (IDs, deep-frozen content-addressed payload table, independent row/byte caps with no orphan payloads, `invalid-event` rejection, RunUpdateGuard), run-update/result types, evidence interface (eligibility left to RV-08a). 389 unit, tsc clean. Gaps: `buildManifest` takes no AbortSignal (cancel only observed between steps); `identity-unavailable` has no compile status (mapped to invalid); scheduled-events/live-roots limits have no default/max pair; `TraceRecorder.append` must be awaited sequentially by callers |
| RV-14b S01 machine interpreter | ACCEPTED (user 2026-09-24, with RV-14) | `f9c4f47` (Gemini): `runner/{expr,machine,logical,assertions}.ts` — Evaluator for all Value/Guard kinds, first-match machine with atomic effects, logical runner for machine+boundary scenarios, assertion evaluation. All three S01 scenarios pass every authored assertion plus §11 trace facts; deterministic. Gaps: request ID format `${rootId}:${counter}`; `trace` effects recorded as TraceEvent kind 'state'; non-machine behaviors rejected until later RV-14 steps |
| RV-14c S03 pipeline operations | ACCEPTED (user 2026-09-24, with RV-14) | `585b6fb` (Gemini): `runner/{pipeline,schema-value}.ts` — all six operations with row provenance, exact rowOutcomes, UTF-16 key order, overflow checks, output/error schema validation; map/filter via injected Evaluator. S03 reproduced exactly. Gaps: non-validate row errors send the original row to the error output (error schema must accept it); overflow fails only the overflowing row; schema-failure result shape; a row rejected after group-sum carries the aggregate row |
| Runner line | integrated | `claude/rv-14a-runner-start` @ `59cf20b` = RV-14a + shared `expr-api.ts` (`81f8b09`) + RV-14b + RV-14c; 456 unit, tsc clean. Pipelines are not yet wired into `runLogicalScenario` (S03 runs through `runPipeline` directly) |
| RV-14d retained kernel + S02 | ACCEPTED (user 2026-09-24) | Branch `claude/rv-14d-kernel`, merged on runner line @ `422187f`. 14d-1 `a7ac303`: 20 characterization tests / 19 golden metric files (kernel unchanged; mutated golden fails). 14d-2 `470ccc6`: additive kernel hooks, stepping, finite input injection (refuses clock jumps), null-key LRU miss; `runner/resource-adapter.ts` (admit/peekNext/stepNext/snapshot, horizon/drain). 14d-3 `40261f7`: `runner/{decision,scenario-runner}.ts` — one global timed scheduler; S02 allow/deny + worker-failure + max-2-retry variants; S01/S03 end to end. 544 unit, goldens unchanged, tsc clean. Review rounds fixed: clock jump, implicit workload disabling, invented 'k-0' key, success defaulted from a null outcome, prefix-matched message linkage. Broadcast fan-out settled by D36 (one message root per delivered copy); implemented in RV-14e. interruptHost → 14e, settleCall/bridge → 14f |
| RV-14e S04 faults + D36 | ACCEPTED (user 2026-09-24, with RV-14) | `8ee3bd7`, merged on runner line @ `01cac16`. Gemini hit quota mid-task; Sonnet finished from the partial state. Kernel fault support (inert without faults; goldens unchanged), adapter validation + interruptHost + one unit-level settled event per root, D36 broadcast roots. All three S04 scenarios incl. §11 per-arrival routes; fault-free S01/S02 byte-identical to `422187f`. 559 unit, tsc clean. Review rounds fixed: router→in-kernel resource routes crashing the runner, partial §11 assertions, duplicate settled events per rejected root, invented failing of waiting retries at outage. Note: the runner schedules faults through the kernel's own heap; adapter `interruptHost` is exercised only by unit tests |
| RV-14f S05 composition | ACCEPTED (user 2026-09-24) — RV-14 complete | `24aa89f` (Sonnet; Gemini quota), merged on runner line @ `3fbf6ae`. Bridge call frames (settle once, adopt child outcome/payload, outage-while-open), user root shared across the bridge, refinement selection (aggregate/refined, coverage, invalid combos), cancellation at batch boundaries, five-family acceptance (S01–S05 together, deterministic, chunk-independent). 591 unit, goldens unchanged, tsc clean. Review rounds: journeyId 'unknown' + kernel identities leaking into trace for delivered messages (present since 14d), and every invented default removed (missing outcome/payload/context now fails the run; root vs message by kernel category, not ID shape). S02 allow message 'generated' metric corrected 0→1. Gaps: router + bridge combination not implemented; runtime refinement resolves one level of port mapping (compile-time closure does the full walk) |
| RV-16a local repository base | REVIEW PASS, committed | `48331ba` (Gemini), merged on runner line @ `590fe19` (runner line now also carries the `fake-indexeddb` dev dependency, `bd9bbe2`, user-approved). `src/persistence/studio/`: Dexie `system-studio-local-v1` v1 with the §2 schema, immutable rows, CAS, operation receipts (checked before stale), §5 error set, quota/unavailable mapping, byte + count limits before mutation, §5 port with loadProject/loadBranch/savePreferences/deleteProject and project.create / project.rename / branch.create; other methods typed-unsupported. 620 unit, tsc clean. Review round: removed repository-generated branch IDs and the rename→main fallback (explicit IDs and branch envelope required). Gap: preferences use a single key 'user' |
| RV-08a evidence storage + eligibility | REVIEW PASS, committed | `19316bc` (Gemini), merged on runner line @ `d7efb19`. Unforgeable run start tokens (module-private registry bound to project/run/snapshot/manifest/fingerprint), atomic `saveRun` with local provenance, retention/summary limits without silent pruning, run reads; pure `runQualifies` / `evaluateCandidate` / `buildEvidenceManifest` in `src/domain/versioning/`. S01 end to end. 655 unit, tsc clean. Review round: project bound to the token (was resolved from any of three sources), validation against the registry binding, run ID/fingerprint/snapshot-hash matching. Note: the full suite timed out once under unrelated machine load (load avg 25); it passes when the load drops |
| RV-01 (rest), RV-03 … RV-16 | BLOCKED | Dependencies as ordered above |

Statuses: READY → CLAIMED → IN_PROGRESS → REVIEW → ACCEPTED, or BLOCKED (with the specific dependency named). A paused task stays owned until it is released.
