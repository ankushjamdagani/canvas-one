# Planning review and execution hold

Updated 2026-09-22. This document implements the user's instruction to finalize the plan through multiple reviews, including delegation. No implementation is authorized. A technical clearance does not lift the user hold.

## Review rounds

| Review | Reviewer | Independent question | Required evidence |
|---|---|---|---|
| P1 Requirements | Claude, fresh read-only session | Does the plan preserve confirmed scope without invented features, omitted capabilities or contradictory outcomes? | Requirement/decision IDs, design/source anchors, genuine unresolved product questions |
| P2 Implementation architecture | Claude, fresh read-only session | Can the bounded architecture express all five examples and future sync/AI seams without overbuilding? | Concrete contract defects, retained-kernel boundaries, storage/data-loss cases, previously raised findings disposition |
| P3 Execution and delegation | Claude, fresh read-only session | Can agents carry out/resume independent tasks safely with this ownership graph and tooling? | Dependency cycles, exact ownership gaps, permission/timeout/result failures, handoff/recovery requirements |
| P4 Closure review | Claude, fresh session after revisions; Codex final check | Were accepted findings fixed consistently and are unresolved items visibly gated? | Finding-by-finding pass/revise; no acceptance from prose summaries alone |

Codex owns final decisions and source validation. Reviewers have Read/Glob/Grep only and no write/delegation tools. Read-only Codex scouts may validate bounded source claims; they do not replace Claude senior review. Gemini is the future implementer; do not send it implementation or code-writing prompts during this hold. A later read-only feasibility check may be separately bounded without granting write access.

## Acceptance levels

- **Plan accepted**: requirements/scope settled; architecture and delivery graph coherent; no unresolved high-risk architecture/data-loss finding; remaining per-package details named with owner, deliverable and gate. This does not claim every future package is implementation-ready.
- **Contract accepted**: named interface/schema/fixture document passes its targeted peer review and lead verification. A high-level plan does not satisfy this.
- **Task executable**: user hold lifted, plan and relevant contracts accepted, exact ownership/base/worktree/acceptance evidence recorded, delegate preflight passed.
- **Task accepted**: actual diff and tests reviewed by Claude and verified by Codex; fixture-only UI cannot count as integrated functionality.

Never mark all RV-02 complete while storage versions, numeric budgets, command APIs or scenario types remain unspecified. These may be explicit pre-dispatch deliverables in an accepted delivery plan, but remain implementation blockers.

## Revised delegation contract

Codex plans and verifies; Claude reviews; Gemini implements only after user authorization. Platform names in a brief are not evidence a process ran. Record model, CLI version, base commit, worktree, exact prompt, session/process identity, start/end, stdout/stderr, exit status and diff. Exit 0 with no output or a tool-permission denial is a failed assignment, as observed in the first agy headless attempt.

Use automatic CLI coordination where available. The repository's older manual-only instruction is superseded for this initiative, but the implementation hold takes precedence. No `--dangerously-skip-permissions`, blanket global grants or global permission changes. Request/approve only scoped operations already authorized by the task. A headless read denial means preflight failed; use an interactive scoped permission flow or report the blocker. Do not repeatedly relaunch an unverified setup.

Before future code dispatch: verify trusted workspace and read access; run a no-edit acknowledgement of task boundary; establish allowed writes and test commands; then dispatch. Do not interpret model-list availability as a successful end-to-end execution check. Shared dependencies are never writable through a symlink. Isolated worktrees need their own dependency install if package changes are allowed.

The generic delegate skill is a planning aid, not an approved production dispatcher for this project. Its shell examples lack the required durable resume, preflight, reliable timeout/interrupt handling and complete evidence review. Do not run its Phase 3/4 verbatim. Project orchestration overrides its self-critic/self-review defaults: Claude is both critic and reviewer; Gemini is the implementation target. Any future automated runner must first pass a no-edit preflight and interruption/timeout test with task-scoped permissions. Until then use coordinator-managed bounded sessions with explicit state records; do not implement a new orchestration tool during this hold.

Durable record before dispatch: `work/<task-id>.md` plus `work/<task-id>-state.json`, containing exact prompt/evidence paths, base/contract hashes, allowed files, model/CLI, active process/session, phase, attempt number, timeout, current owner and permission mode. Keep full stdout/stderr in referenced evidence files, not a 4000-character truncation. Reviewers inspect actual source/diff/test evidence rather than trusting exit status or summary. For read-only planning reviews, records live under `reviews/` and list actual artifacts.

Before retry, inspect and preserve the actual partial diff, explain what changed in the next brief, recheck locks/base/contracts and record a new attempt. Never automatically reset a worktree or overwrite partial work. Retry only unaccepted scope. On interruption terminate the specific tracked process group/session and record exit/remaining children; retain interrupted ownership until inspected and explicitly released. An OS/process restart requires checking the recorded process identity before sending signals, avoiding reused PIDs.

After every delegate return the coordinator reads the full report, checks nonempty task-relevant output and tool denials, verifies owned-file diff, records actual commands/results and updates ledger. Append ACTION_LOG and update HANDOFF only when resume guidance changes. `SUCCESS` emitted by a skill is not acceptance. Shared integration and versioning/runtime subgates follow [package-ledger.md](work/package-ledger.md).

At most three active delegate processes including reviewers, and at most three implementation lanes. Keep dependencies serial: shared contracts before consumers, kernel patches exclusive, integration one writer. Review a frozen checkpoint; new commits invalidate approval of touched scope. Give each executor a one-checkpoint task, with explicit exclusion paths and stop-on-ambiguity rules. Coordinator alone writes central ledger/HANDOFF/logs.

Persist orchestration state outside transient chat: task state references durable work records; prompts/results are saved under task-specific review/work evidence paths before acceptance. Temporary process IDs alone are not resumable state. Unexpected exit, timeout or user interruption marks task interrupted, retains ownership until released, captures actual diff, and never implies completion. Terminate the specific session, not every CLI process on the machine. Inspect clean state before removing any task-created worktree.

Timeout is a liveness check, not permission to drop work. Read-only reviews use a bounded 5-minute attempt; implementation timeout is set per bounded assignment, followed by a clean checkpoint/retry decision. Poll for actual state at reasonable intervals and report meaningful progress; do not end the coordinator turn with a running untracked review. Multi-session resumption begins with user hold, task ledger, last accepted contracts and actual Git diff.

## Current interruption evidence

The RV-01a agy headless attempt returned exit 0 with a read permission denial and no implementation output. An interactive attempt reached read-only commands; it was interrupted and exited on the user's hold. Isolated worktree `codex/revamp-foundation-a` at `/tmp/system-studio-foundation-a` has no source changes. The task-created node_modules symlink was removed; original dependency files were untouched. No implementation commit exists. Main-checkout changes are planning documents only.
