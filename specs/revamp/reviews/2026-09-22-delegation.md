Raw reviewer output; reviewed by Codex separately. Claims below are not automatically accepted.

Now I have sufficient evidence. Compiling findings.

---

## P3 Execution and Delegation Review — `REVISE`

**Scope reviewed:** `review-plan.md`, `delivery-plan.md`, `tasks.md`, `handoffs.md`, `work/rv-01a.md`, `verification.md`, `components.md`, `.agents/skills/delegate/SKILL.md`

---

### HIGH — Orchestration blockers

**H1: `delegate/SKILL.md` uses headless `-p` mode — the exact failure from RV-01a**

Phase 3 fires `claude -p "$PROMPT" --model claude-sonnet-4-6 > "$OUT" 2>&1`. The RV-01a post-mortem (`review-plan.md` §"Current interruption evidence") records: *"exit 0 with a read permission denial and no implementation output"* — i.e. headless one-shot mode silently swallowed a permission denial and claimed success. `review-plan.md` explicitly bans this: *"A headless read denial means preflight failed; use an interactive scoped permission flow or report the blocker."* The delegate skill's default executor path reproduces the failure mode without correction.

**Correction required:** Phase 3 must treat exit-0 + empty/error output as a failure. Headless mode is only appropriate for read-only review tasks; implementation tasks require an interactive-session invocation or an explicit scoped-permission grant that is recorded in the claim record.

---

**H2: Scratchpad is the only orchestration state — not resumable**

The delegate skill writes all state to `$TMPDIR/delegate-<timestamp>/state.json`. `review-plan.md` §"Revised delegation contract" says: *"Persist orchestration state outside transient chat: task state references durable work records; prompts/results are saved under task-specific review/work evidence paths before acceptance. Temporary process IDs alone are not resumable state."* The scratchpad path is exactly "temporary process IDs." A session death, timeout, or user interruption loses all orchestration state; multi-session resumption cannot begin.

**Correction required:** Phase 0 must write state to `specs/revamp/work/<task-id>/delegate-state.json` (or equivalent durable path within the repo). The skill must accept a `--resume <path>` argument that re-loads existing state and skips completed phases.

---

**H3: No timeout implementation despite the spec's requirement**

The skill documents: *"the 5-minute timeout is enforced by executor_targets config"* — but `executor_targets` has no `timeout` field, and Phase 3's bash loop uses bare `wait` with no `timeout` wrapper. `review-plan.md` says read-only reviews use a bounded 5-minute attempt; per-assignment timeouts apply to implementation. No enforcement mechanism exists.

**Correction required:** Wrap each background executor subshell with `timeout <seconds>`. On expiry, write exit status `-1` to the exit file and record `"status": "timeout"` in state. Map timeout to interrupted task ownership, not completion.

---

**H4: No preflight phase — violates pre-dispatch checklist**

`review-plan.md` §"Revised delegation contract": *"Before future code dispatch: verify trusted workspace and read access; run a no-edit acknowledgement of task boundary; establish allowed writes and test commands; then dispatch."* The delegate skill's Phase 0 only runs `which agy/codex/claude`. It does not verify: worktree is clean, base commit matches claim record, file ownership list is confirmed, no concurrent writer holds those paths, test commands are reachable.

**Correction required:** Add a Phase 0.5 Preflight between startup and planning. Each executor target must execute a read-only task-boundary acknowledgement and return structured confirmation before any planning or execution runs.

---

**H5: SIGINT/user interruption has no handler — partial state not captured**

Phase 3 uses `wait "${PIDS[@]}"` with no `trap`. If the user interrupts or the coordinator process dies: background subagents keep running untracked, no partial diffs are captured, ownership is not marked interrupted. `review-plan.md`: *"Unexpected exit, timeout or user interruption marks task interrupted, retains ownership until released, captures actual diff, and never implies completion. Terminate the specific session, not every CLI process on the machine."*

**Correction required:** Install `trap 'handle_interrupt' SIGINT SIGTERM` before Phase 3. The handler must: kill each tracked PID individually (not all processes), write `"status": "interrupted"` to state, attempt to capture any partial output, and preserve ownership in the durable state file.

---

### MEDIUM — Ownership and recovery gaps

**M1: Delegate skill role assignment conflicts with project platform roles**

The delegate skill assigns executors round-robin from `executor_targets` (default: `agy` only) and defaults `critic: self`, `reviewer: self`. This means Codex self-critiques its own plan and self-reviews implementation — cutting out the required Claude senior review gate. The project's `delivery-plan.md` mandates: Codex plans/verifies, Claude reviews, Gemini implements. A self-critique loop satisfies none of these.

**Correction required:** The delegate skill invocation for project tasks must override defaults: `--critic=claude --reviewer=claude` and executor targets must be `agy` (Gemini) for implementation, `claude` for review. Document this as the project-standard invocation in `handoffs.md`. Do not rely on the skill's config defaults.

---

**M2: Phase 3 review-loop re-execution does not reset ownership or worktree state**

On `verdict: fail` in Phase 4, the skill re-plans and re-fires Phase 3 against the same executor targets. If the first execution produced partial file edits (e.g. some components written, others not), the re-execution receives the same prompt without knowing the prior partial state. Two concurrent executors could write to overlapping files on the second run. `delivery-plan.md`: *"Give each executor a one-checkpoint task, with explicit exclusion paths and stop-on-ambiguity rules."*

**Correction required:** Before any Phase 3 re-run, the coordinator must: check actual git diff against the expected owned-file list, record partial state to durable output, reset the worktree to the last clean checkpoint or explicitly note the delta, and re-validate exclusive file ownership before re-dispatching.

---

**M3: Output truncated to 4000 chars — acceptance evidence lost**

Phase 3 records `output[:4000]` to state. `review-plan.md` requires recording: model, CLI version, base commit, worktree, exact prompt, session/process identity, start/end, stdout/stderr, exit status, and diff. The claim record template alone (13 fields) exceeds 4000 chars for any non-trivial task. Screenshot paths, test results, and diff summaries are silently dropped.

**Correction required:** Write full output to `$SCRATCHPAD/exec-<id>.txt` (already done), and record the file path in state rather than truncating content. Phase 4 reviewer must read the file path, not the truncated inline string.

---

**M4: RV-12 integration slot reservation has no defined protocol**

`delivery-plan.md` says RV-05/RV-15/shared-file edits "occur only in RV-12 slots" and integration files are "exclusively assigned." But the task ledger has one RV-12 row, no slot sub-entries, and no protocol for how an upstream package (e.g. RV-05) requests an integration slot or how the coordinator serializes those assignments. Multiple RV-12 slices across different branches with one ownership row creates an invisible concurrency risk.

**Correction required:** Define the RV-12 slot protocol: each slice gets its own `work/rv-12-<slice>.md` claim record; the central ledger gains sub-rows or a separate RV-12 slot table; exclusive lock on `App.tsx` / `state/editor.ts` / `persistence/projects.ts` transfers explicitly per slot; prior slot must be accepted before next is claimed.

---

**M5: RV-08 sequential microtasks have no partial-progress state in the ledger**

RV-08 is "Gemini in sequential microtasks; Claude adversarial review at each subgate." Six subtasks are implied (snapshot/run-identity → branches → diff/merge → run eligibility → publish/undo → validation). The ledger has one RV-08 row with a single status field. A failure at microtask 3 with microtasks 1–2 accepted has no representation. A new session cannot determine where to resume.

**Correction required:** Either add RV-08a through RV-08f as explicit ledger rows, each with their own claim record file and gate; or define a RV-08 subtask ledger in `work/rv-08.md` with its own status table, and require the main ledger to reference the subtask file's current head status.

---

**M6: RV-05/RV-15 serialization mechanism is undefined**

`delivery-plan.md`: *"RV-15 shares no files concurrently with RV-05."* RV-15's dependency is listed as "RV-02 current schema; retained behavior replacements ready before removing their dependencies." "Retained behavior replacements ready" is a subjective judgment with no objective gate. RV-05 owns `OpenInspector.tsx`; RV-15 retires it. If RV-15 is dispatched while RV-05 is in REVIEW state, the same file is owned by two tasks.

**Correction required:** Replace the behavioral judgment with a precise gate: RV-15 cannot claim `OpenInspector.tsx` and related files until RV-05 status is ACCEPTED and the exact file inventory transitions to RV-15 ownership via coordinator ledger update. Add this as an explicit blocking condition on RV-15.

---

**M7: Delegate skill writes no ledger updates — coordinator role is implicit**

`review-plan.md`: *"Coordinator alone writes central ledger/HANDOFF/logs."* The delegate skill produces a scratchpad state file but has no phase that updates `tasks.md`, `ACTION_LOG.md`, or `HANDOFF.md`. The skill's `SUCCESS` echo and scratchpad path are the only outputs. A coordinator running the delegate skill must manually extract results and update durable project records — but this hand-off is not specified in the skill or in `handoffs.md`.

**Correction required:** Document in `handoffs.md` (and optionally in a delegate skill post-run hook) the exact coordinator steps after `SUCCESS` or `PARTIAL RESULT`: read `exec-<id>.txt` files, extract claim record fields, update task ledger status, append ACTION_LOG entry, update HANDOFF if runtime state changed.

---

### LOW — Future task detail gaps (not orchestration blockers)

**L1: RV-14 partial-subtask gate for RV-08 unspecified**

`tasks.md` lists RV-08 as blocked on "RV-14 run evidence API." RV-14 has five sequential scenario slices; which slice produces the "run evidence API" is unspecified. If RV-14 is in progress on slice S03, is RV-08 unblocked? This is a future specification gap, not a current orchestration failure, but will become a blocker when both are dispatched.

**Correction required (before dispatch):** RV-02 contract must name the specific run-identity/fingerprint interface that RV-08 depends on, and RV-14's claim record must include a sub-gate marking that interface as stable.

---

**L2: Single-shot headless process is not a realistic execution model for multi-day packages**

The delegate skill fires `agy --effort low` as a single background process for each subtask. RV-03 through RV-16 are each multi-file, multi-day implementation tasks requiring iterative reads, verification runs, and stop-on-ambiguity escalation. A single `agy ... > output.txt` cannot implement these reliably.

**This is a future task detail gap**, not a current plan defect — the implementation hold means no packages will be dispatched this way yet. The skill may be appropriate for bounded sub-subtasks within packages, but should not be the default for top-level RV-XX dispatch. Record this distinction before lift.

---

### Dependency graph — no cycles detected

The flowchart in `delivery-plan.md` is a DAG. No dependency cycles found. The diamond at RV-12 (all feature packages converging) is correct but tight; the RV-12 slot protocol gap (M4 above) is the execution risk, not a graph error.

---

### Interruption/recovery evidence — adequately documented

The RV-01a failure evidence in `review-plan.md` §"Current interruption evidence" and `work/rv-01a.md` is accurate and complete. The clean worktree claim is plausible given no implementation was dispatched. No recovery action needed beyond the H1 fix that prevents the same failure mode from repeating.

---

### Summary

**Verdict: REVISE**

Seven findings require resolution before any implementation dispatch is authorized:

| ID | Severity | Fix target |
|---|---|---|
| H1 | HIGH | delegate/SKILL.md Phase 3 exit-0 false-positive + headless mode restriction |
| H2 | HIGH | Durable orchestration state path + `--resume` support |
| H3 | HIGH | Per-executor timeout enforcement |
| H4 | HIGH | Preflight phase added to delegate skill |
| H5 | HIGH | SIGINT trap with ownership preservation |
| M1 | MEDIUM | Project-standard delegate invocation documented with correct roles |
| M2 | MEDIUM | Review-loop worktree reset before re-execution |
| M3 | MEDIUM | Full output file path in state, not truncated content |
| M4 | MEDIUM | RV-12 slot sub-ledger protocol defined |
| M5 | MEDIUM | RV-08 subtask ledger rows or sub-task file |
| M6 | MEDIUM | RV-15/RV-05 ownership transfer gate made precise |
| M7 | MEDIUM | Post-delegate coordinator ledger update steps documented |

L1 and L2 are pre-dispatch specification tasks, not current blockers. None of the findings require implementation; all are corrections to the plan documents and the delegate skill configuration.

