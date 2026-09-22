# Future package subgates and shared-file ownership

All rows BLOCKED by the user implementation hold. These are planned subgates, not dispatched work or accepted code. Exact file lists, contract hashes, base/worktree and checks are recorded in a separate claim before any future dispatch.

Global gate EXEC-PREFLIGHT is BLOCKED: Codex must record a successful task-scoped Gemini no-edit ownership/read acknowledgement, permitted writes/test commands, and interruption/timeout recovery rehearsal after the user lifts the hold. No implementation claim may enter IN_PROGRESS until EXEC-PREFLIGHT is ACCEPTED; each later claim rechecks its own scope/base/permissions. This gate authorizes no product implementation itself. Review evidence goes in work/exec-preflight.md when performed; that file does not yet exist.

This is a subgate supplement to the [main task ledger](../tasks.md), not its replacement. RV-05 (inspector) is tracked there, with package scope and acceptance in [delivery plan](../delivery-plan.md); retirement requires that package's actual ACCEPTED replacement checkpoint.

## RV-08 versioning microtasks

| Subgate | Dependency | Deliverable | Status |
|---|---|---|---|
| RV-08a | RV-02 identity/storage contracts; RV-14a evidence interface | Immutable snapshot/run-evidence storage and eligibility predicates | BLOCKED |
| RV-08b | RV-08a | Branch working copies, autosave/checkpoints, switch/save-failure handling | BLOCKED |
| RV-08c | RV-08b | Deterministic typed three-way diff/merge and reference conflicts | BLOCKED |
| RV-08d | RV-08c; RV-14a–f all ACCEPTED | Isolated candidate validation and exact-state run eligibility across all five families | BLOCKED |
| RV-08e | RV-08d; RV-16a | Atomic irreversible publication, default source closure/reopen and stale-head cases | BLOCKED |
| RV-08f | RV-08e | Current-format history round trip, retention/reference integrity | BLOCKED |

Only a named accepted subgate unblocks its consumers. RV-08a may use contract fixtures after the evidence interface is accepted; real commit/publish acceptance requires actual runner-produced evidence. Full RV-08 completion requires all rows and integrated journeys.

## RV-16 local repository microtasks

| Subgate | Dependency | Deliverable | Status |
|---|---|---|---|
| RV-16a | Accepted RV-02 schema/storage/transaction contracts | Fresh namespace, immutable rows, CAS/receipts, preferences, quota/recovery primitives and repository port | BLOCKED |
| RV-16b | RV-16a; RV-08 history and RV-14 saved evidence | Current-format import/export, pruning/reference integrity and integrated recovery journeys | BLOCKED |

RV-08a may develop pure eligibility with repository fixtures, but durable acceptance requires RV-16a. RV-08e requires RV-16a, not completion of RV-16b. RV-16b follows versioning integration; this prevents a dependency cycle. No server, GitHub provider or remote sync implementation belongs to either subgate.

## RV-14 execution microtasks

| Subgate | Dependency | Deliverable | Status |
|---|---|---|---|
| RV-14a | Accepted RV-02 types/identity/budgets | Scenario readiness, canonical manifest and durable evidence interface, trace envelope | BLOCKED |
| RV-14b | RV-14a | S01 state/events interpreter | BLOCKED |
| RV-14c | RV-14a | S03 data-operation interpreter | BLOCKED |
| RV-14d | RV-14a | Retained resource characterization, finite-input/trace/completion adapter, S02 business outcomes | BLOCKED |
| RV-14e | RV-14d | S04 deployment/fault scheduler with exact failure accounting | BLOCKED |
| RV-14f | RV-14b/c/d/e | S05 composition/refinement and full five-family acceptance | BLOCKED |

RV-14b/c may run in parallel after shared interfaces freeze. RV-14d/e are always serialized: RV-14e starts only after RV-14d is ACCEPTED, regardless of proposed files. RV-08 consumes the versioned evidence interface frozen in RV-14a; this does not require waiting for every UI/runtime slice before pure history fixture work.

## RV-12 integration slot protocol

The coordinator owns a single integration lock across `src/App.tsx`, `src/state/editor.ts`, `src/domain/model.ts`, `src/persistence/projects.ts`, `src/components/StudioMenu.tsx` and any reserved shared CSS/contracts/package files. These are an exclusion list, not blanket write permission. Each slot lists the exact subset it may edit.

1. A feature submits its accepted checkpoint and requested adapter/wiring changes. Coordinator verifies dependencies and drafts `work/rv-12-<slice>.md` with exact files, base and acceptance journeys.
2. Register one ACTIVE slot below; no second slot or feature writer may hold any shared file concurrently, even in another worktree if it would create unreviewed integration divergence.
3. Gemini performs only the slot's implementation. Claude reviews actual diff and Codex verifies tests and integration behavior.
4. Mark slot ACCEPTED at its actual checkpoint, release locks explicitly, then assign the next slot. If it fails, retain ownership and publish its specific pending corrections; do not advance dependent slots.

| Slot | Owner | Files | State | Checkpoint |
|---|---|---|---|---|
| None | None | None | User hold | None |

Small independent feature modules can continue outside those files after their own gates. Integration ordering is dependency-driven: foundation → shell/canvas → inspector → library/results/entry → history, with current-schema/runner/retirement slices coordinated before incompatible consumers are wired.

## Retirement gate

RV-15 never owns `OpenInspector.tsx` by default; RV-05 retains current inspector functionality. Legacy `Inspector.tsx` and internals/control families are separate candidates. Every removal manifest names live callers and replacement acceptance evidence; orphan removal has verified no-caller evidence. Shared model/editor/worker/persistence changes go through one RV-12 slot. An active file cannot transfer to retirement while its current task is IN_PROGRESS or REVIEW. Coordinator records explicit release/transfer and new ownership only after replacement behavior is ACCEPTED. No blanket folder deletion or arbitrary worktree reset.
