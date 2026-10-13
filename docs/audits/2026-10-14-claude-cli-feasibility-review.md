# Claude Opus 5.5 review of CLI feasibility

2026-10-14. Source-embedded review using claude-opus-5-5 with tools disabled; exit 0, stderr empty. No visual or production integration review.

## Lead qualifications and disposition

- Executor-target finding is incorrect: that target and accept-edits flag predated this task and are unchanged. Keep the user-requested configuration change scoped to reviewer/critic model IDs; no executor was dispatched.
- Adopted: distinguish Codex app-server runtime from generated schema and exec evidence; document host CLI upgrade; clarify authority-enforced overlap pauses; add question-routing policy, state transitions, connection security tests and redacted reproducibility summaries.
- Ordinary explicit-ID continuation succeeded for all three CLIs after this review payload was prepared. It does not establish interrupted task recovery or live feedback.
- Numeric lease/heartbeat bounds remain an explicit prototype gate; choosing arbitrary values in planning would not prove correctness. The report is a proposed contract, not implementation-ready verification.
- No agy no-tool/read-only flag has been established that solves the failed critic; adding unverified flags or a timeout does not prove a working review gate. Record incomplete critique rather than claiming success.
- Exact-server scoped MCP allow-rule test also failed later; settings were restored byte-for-byte, fixture removed. This remains an integration gate without blanket bypass.

## Original reviewer output

```json
{
  "verdict": "revise_before_use",
  "issues": [
    {
      "severity": "high",
      "location": ".agents/delegate.json executor_targets",
      "reason": "You requested a reviewer and a critic only, but the config also adds an agy executor with `--mode accept-edits`. That implies edit permission on the repository during planning-only, non-design work. It also conflicts with the feasibility doc's rule to keep board tools isolated from unrelated shell and file capabilities. agy's headless permission behavior is still an open gate.",
      "fix": "Remove `executor_targets` for this phase. If an executor is added later, record that you authorized it explicitly and use a read-only or scoped mode limited to an isolated worktree."
    },
    {
      "severity": "high",
      "location": "ai-collaboration-plan.md 'Review traceability and status' vs feasibility doc Claude upgrade paragraph",
      "reason": "The plan says 'No ... dependency installation has occurred'. The feasibility doc records a Homebrew cask upgrade of Claude Code from 2.1.191 to 2.1.286, which also triggered Homebrew's automatic cleanup of old versions. Both are host-level changes. Neither doc says whether you authorized the upgrade.",
      "fix": "Reword to: 'No project dependencies installed; the Claude Code CLI was upgraded via Homebrew (cleanup also ran) to meet the Opus 5.5 minimum.' Note whether you authorized it."
    },
    {
      "severity": "medium",
      "location": ".agents/delegate.json critic",
      "reason": "The configured critic has never completed a repository-context review. The first run was denied a command, and the no-tool retry timed out with exit 124. The critic entry has no `timeout_sec` (the reviewer has 600) and no read-only/no-tool arguments, so the same failure will likely recur.",
      "fix": "Add an explicit `timeout_sec` and a no-tool/read-only mode, or document the critic as unverified. Do not treat the critic slot as a working gate until one critique completes."
    },
    {
      "severity": "medium",
      "location": "feasibility doc Evidence table, Codex row",
      "reason": "The row mixes runtime and advertised evidence. The streamed prompt/reply came from `exec` (CLI_STREAM_OK). Only initialize and model discovery ran on app-server. thread/turn/steer/interrupt are only present in the generated schema. The row also doesn't say which path ran the tool loop, yet the doc recommends app-server.",
      "fix": "Split the row into 'app-server observed: initialize/model list', 'schema-only: thread/turn/steer/interrupt' and 'exec observed: stream + tool loop'. Move app-server turns and interrupt into 'Still needs proof'."
    },
    {
      "severity": "medium",
      "location": "feasibility doc 'Recommended adapter approach' / local service bullets",
      "reason": "The proposed loopback service has no defined browser authentication contract. 'Authenticate the browser origin/session' does not cover DNS rebinding, Host/Origin validation, CSRF from other local pages, or token storage and rotation. Loopback binding alone does not stop these.",
      "fix": "Add contract items: strict Host and Origin allowlist, a per-launch secret delivered out of band, no wildcard CORS, and session expiry. Make a passing DNS-rebinding/cross-origin test an entry gate."
    },
    {
      "severity": "medium",
      "location": "plan 'Confirmed user decisions' Human overlap vs 'Layout and state specification' ('Pause is offered only when supported')",
      "reason": "Overlap handling requires pausing the affected action, but provider pause is described as optional. This leaves open whether overlap handling depends on CLI capability.",
      "fix": "State that overlap pause is enforced by the board authority (reject or hold the write and ask the user) and does not depend on provider pause. User-facing provider Pause stays optional."
    },
    {
      "severity": "medium",
      "location": "feasibility doc Common contract (Task) vs plan state list",
      "reason": "The Task record requires 'durable status', but there is no enumerated status set or transitions. The plan lists requested/working/waiting/interrupted/completed/stopped/failed, with no state for 'awaiting overlap decision' and no mapping of Attempt outcomes to Task status.",
      "fix": "Define a versioned task-state enum and transition table, including the overlap-wait and Stop/cancel-unacknowledged cases, and link Attempt terminal outcomes to it."
    },
    {
      "severity": "medium",
      "location": "feasibility doc Stop/fencing paragraph",
      "reason": "Bounded liveness expiry is required but has no owner, lease duration, heartbeat source, or defined cutoff. The verification that the plan requires can't be written without them.",
      "fix": "Specify the lease issuer (board authority), TTL, renewal source, how generations increment on expiry or Stop, and a cutoff test (no commit after lease expiry plus the transaction bound)."
    },
    {
      "severity": "medium",
      "location": "plan 'Conversation, task and proposal' (ordinary questions) + one active editing task",
      "reason": "There is no contract for routing an ordinary question to an agent whose provider session is running an active task. On the same thread, the question could steer or interrupt the task. On a separate thread, the session mapping is undefined.",
      "fix": "Add a Message routing rule: either questions use a separate provider session with no write authority, or they are blocked or visibly targeted while a task is active. Prove it per adapter."
    },
    {
      "severity": "low",
      "location": "plan 'Explicit choices' second-message row",
      "reason": "Listing 'queue' as an option sits awkwardly beside 'must not silently ... queue new edits' and the feasibility doc's 'Do not implement an invisible task queue'.",
      "fix": "Change it to 'visible staged task starting in Suggest' so the remaining option is consistent with both docs."
    },
    {
      "severity": "low",
      "location": "plan header status",
      "reason": "'Technical feasibility not yet verified' understates the partial evidence that now exists.",
      "fix": "Use 'partially probed; three-agent feasibility verdict pending (agy MCP permission gate open)' and link the feasibility doc."
    },
    {
      "severity": "low",
      "location": "feasibility doc evidence locations and Primary references",
      "reason": "Raw evidence lives only in /tmp and an ignored `.delegate` directory, so the claims can't be reproduced. This review did not verify the reference URLs.",
      "fix": "Commit a redacted evidence summary (versions, exact commands, terminal records). Verify the reference links before relying on them."
    }
  ],
  "summary": "The planning docs are mostly coherent and honest. They label the contract 'proposed, not implemented', treat agy's exit-zero SUCCESS-with-denied_actions as a failure, avoid claiming a three-agent verdict, and keep phone-to-desktop and concurrent agents as future scope, consistent with your confirmed decisions (desktop first, one active editing task per board). Completed work: Claude 2.1.286 + Opus 5.5 streaming and a scoped synthetic tool loop; Codex sign-in, app-server initialize/model list, exec streaming and a scoped synthetic tool loop; agy model discovery and basic streaming. Remaining proof obligations: Codex app-server turns/steer/interrupt/resume; Claude streaming-input acknowledgement, cancellation and cross-process resume; agy scoped MCP permission and any tool loop; a completed critic run; all board-authority, fencing, Undo and persistence guarantees. Main fixes before use: remove the unrequested accept-edits executor, disclose the Homebrew upgrade correctly, add a critic timeout and read-only mode, separate Codex runtime evidence from schema-only evidence, and add contracts for loopback auth, task states, liveness leases and question routing."
}
```


## Final independent review

Updated plan/report reviewed by the same requested model in a fresh CLI session with tools disabled. Exit 0, stderr empty. Verdict applies to documentation consistency and truthful scope, not production readiness. A subsequent two-message Claude input probe also passed; it does not prove active-turn steering.

```json
{
  "verdict": "pass",
  "errors": [],
  "summary": "Both documents and `.agents/delegate.json` are consistent with each other and honest about the spike's scope. The config's critic (agy/gemini-3.8-flash-high) and reviewer (claude/claude-opus-5-5) match the reported model-ID update. The pre-existing accept-edits executor target is disclosed as unchanged and not dispatched, and is kept separate from product permissions. The critic failure is disclosed accurately and no completed critique is claimed. The evidence table separates observed runtime behavior from schema/help-only evidence. agy's exit-0 `SUCCESS` with a denied MCP call is correctly classed as unsuccessful, and the temporary permission change and its byte-for-byte restoration are both disclosed. The Claude CLI Homebrew upgrade and automatic cleanup appear in both documents. The confirmed scope (desktop execution first, one active editing task per board, Suggest by default, task-bound board-wide Live grants) is stated the same way in the plan and the feasibility report. The task states, Stop fence, liveness/generation model and interrupted-Resume rules agree across both files. The plan's 'partially probed / verdict pending' status matches the report's 'no complete three-agent feasibility verdict'. The unresolved CLI-control, agy MCP, connection-security and lease/heartbeat gates are labeled as proposals or open gates, not claimed capabilities. That is appropriate for a technical-spike report. No actionable inconsistencies were found."
}
```
