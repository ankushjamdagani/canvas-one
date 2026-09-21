# Task ledger

Statuses: READY → CLAIMED → IN_PROGRESS → REVIEW → ACCEPTED. BLOCKED records the specific dependency. A paused task remains owned until released. Feature UI with fixtures is REVIEWABLE evidence, not accepted product behavior.

| ID | Status | Owner | Blocking condition / next action |
|---|---|---|---|
| PLAN | REVIEW | Codex | Expanded architecture documented; Claude review pending |
| ARCH-01 | REVIEW | Codex planning | User decisions settled; S01–S05 and retirement/deployment proposals await senior review |
| RV-00 | IN_PROGRESS | Claude CLI; Codex coordinator | Read-only initial architecture review dispatched against 680827b; result pending. Full source/design coverage still needs verification. |
| RV-01 | BLOCKED | Unclaimed; Gemini intended | RV-00 accepted; freeze exact foundation files |
| RV-02 | BLOCKED | Codex planning / Claude review | RV-00 findings; execution/current-schema contracts and R15 extension seams; no AI implementation |
| RV-03 | BLOCKED | Unclaimed | RV-01/02 accepted |
| RV-04 | BLOCKED | Unclaimed | RV-01/02 accepted |
| RV-05 | BLOCKED | Unclaimed | RV-01/02; atomic editor API contract |
| RV-06 | BLOCKED | Unclaimed | RV-01/02; fixtures then RV-09 integration |
| RV-07 | BLOCKED | Unclaimed | RV-01/02 |
| RV-08 | BLOCKED | Unclaimed | RV-02 current-schema acceptance; RV-14 run evidence API |
| RV-09 | BLOCKED | Unclaimed | RV-02 |
| RV-10 | BLOCKED | Unclaimed | RV-01/02 |
| RV-11 | BLOCKED | Unclaimed | RV-01/02 and RV-08 API |
| RV-12 | BLOCKED | Unclaimed | Assign per integration slice, reserve shared files |
| RV-13 | BLOCKED | Codex verification / Claude review | Integrated release candidate |
| RV-14 | BLOCKED | Unclaimed; Gemini intended | RV-02 typed scenario/runner contracts and S01–S05 fixtures |
| RV-15 | BLOCKED | Unclaimed; Gemini intended | RV-02 current schema; retained behavior replacements and exact deletion manifest |
| RV-16 | BLOCKED | Unclaimed; Gemini intended | RV-02 local adapter contracts; no remote-service implementation |

## Claim record (required per assignment)

Copy into a task-specific file under `specs/revamp/work/` before editing:

```text
Task and subtask:
Owner/platform/session:
Status:
Base commit:
Branch/worktree:
Exact allowed files (including tests):
Read-only dependencies:
Requirement IDs and reference screens:
Frozen API/contract revision:
Implementation sequence (bounded):
Acceptance commands and browser scenarios:
Latest checkpoint commit:
Completed evidence:
Remaining work and blocker:
Claude review status/findings:
Codex acceptance status:
Next exact action:
```

Never let multiple agents edit this central ledger concurrently. Send a claim/completion record to the coordinator; Codex updates ledger ownership. Changes to a ready contract invalidate dependent claims until explicitly reconciled.
