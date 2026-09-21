# Cross-model handoffs and recovery

## First handoff — Claude senior review

Run after the planning/source checkpoint is committed and the worktree is clean. User switches to Claude; no automatic cross-platform execution is available here.

> Review the expanded System Studio revamp plan in `specs/revamp/README.md`, starting with execution-model.md, legacy-retirement.md and deployment-and-sync.md, then the visual plan and supplied ZIP. You are the senior reviewer; Codex is technical lead/final verifier, Gemini implements. Read AGENTS.md/HANDOFF.md; latest user decisions override historical compatibility policy. Model-based runs must cover S01–S05; real source execution and live coediting are deferred. Old-data compatibility may be dropped; commits/publication require completed runs, incomplete work uses autosave/checkpoints. Do not implement. Return severity-ranked findings with requirement/screen/source evidence. Review typed behavior/structural relationships, scenario coverage, run identity, exact accounting reuse, legacy deletion dependencies, current storage cutover, future hosted/self-hosted/GitHub/server boundaries, foundation quality, atomic merge/publish and parallel ownership. Reconsider old Supabase/Google/Hocuspocus assumptions. State which gates can proceed and which contracts remain insufficient. RV-00 owns no source files; do not mark later tasks complete.

The target platform is Claude; bounded task RV-00; files owned: none; expected verification: read-only source/design review and a concrete findings report. Codex records accepted findings in the plan.

Additional required review scope (D22/R15): read `ai-collaboration.md`. The long-term product is human/AI app-development collaboration through structured canvas decisions/proposals/evidence. Check current contracts allow that without Markdown parsing, UI scraping, direct state writes or vendor coupling. Keep AI implementation out of scope; report both missing extension boundaries and unnecessary speculative abstractions.

## Gemini implementation template

> Implement only task [ID/subtask] from the accepted revamp plan. Your base is [commit], worktree [path], allowed files [exact list]. Read [decision/contract versions], requirement IDs [IDs] and supplied reference screens [full labels]. Follow the shadcn foundation and retain existing simulation/persistence invariants. Execute these bounded steps: [steps]. Use these fixtures: [fixtures]. Run [commands/scenarios]. Stop if a required change exceeds ownership or the contract is ambiguous. Return commit, file list, screenshots, test results, limitations and next exact action. Do not mark accepted; Claude reviews and Codex verifies. Do not modify App/editor/persistence/global tokens unless explicitly listed.

## Claude implementation review template

> Review [base..head] for [task] against its approved requirements/contracts/design frames. Read actual source and evidence. Prioritize data loss, incorrect semantics, stale run eligibility, accessibility and visual mismatch. Check changes stay within ownership. Return actionable findings with file/line, severity and reproduction; identify skipped checks. Do not broaden implementation or approve from screenshots alone. State approve/revise, with residual risks.

## Integration and session transfer

1. Preserve unrelated work. Use isolated worktrees/branches named `codex/revamp-...` where this host creates them; record the real name if another platform differs.
2. Before switching platforms, commit scoped work (or an explicitly named WIP checkpoint). Don't stash another agent's changes. Record failing checks accurately; a WIP commit is not acceptance.
3. Freeze file ownership. The next session reads the task record and `git diff base...HEAD` before editing; it does not repeat completed work blindly.
4. The integrator applies one reviewed checkpoint at a time; reruns affected checks; resolves merge conflicts as reviewable edits. Codex verifies rather than implementing integration fixes.
5. Agent output includes reproducible evidence and exact next action. A token-expired session is resumed from its checkpoint by another session/model only after ownership transfers.
6. Codex updates central ledger; every completed platform task appends its action summary to ACTION_LOG and updates HANDOFF only when the latest runtime/resume state changes.

## Useful parallelism

Claude may review a frozen completed branch while Gemini works on a different accepted package. Multiple Gemini sessions may own independent lanes; shared files stay locked to the integrator. Use at most three active implementation lanes. No concurrency against the same checkout for app edits. Codex scouts can provide bounded read-only evidence; they do not replace Claude's requested review or Gemini's implementation role.

If a required user decision blocks one feature, keep that package blocked and choose another READY package. Do not invent semantics to maintain velocity. If all available tasks are blocked, stop with the specific decision or reviewer output needed.
