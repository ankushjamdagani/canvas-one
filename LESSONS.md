# Lessons

Rules learned from past failures, corrections and wasted effort. Loaded every session on every platform. Follow them; cite the rule when it changes your approach.

Maintenance (see `AGENTS.md` §6 and `/retro`):

- A rule lands here only if it would change what a future agent does. No history, no current state.
- Format: imperative rule, then `Why:` with the source `ACTION_LOG.md` date.
- Contradicted rule → replace it. Stale rule (tool fixed, invariant changed) → delete it.
- Hard cap: 50 rules. Over the cap → merge or drop the weakest.

---

## Environment and tools

- **Treat headless `agy` exit 0 with empty output as a failure.** In plan mode it auto-denies `read_file`/`command` and exits silently. Why: 2026-09-23 EXEC-PREFLIGHT.
- **Don't retry `agy` in a restricted sandbox.** It needs localhost binding and writes under `~/.gemini/antigravity-cli/`; request elevated permissions once or record the task as blocked. Why: 2026-09-10, three failed retries.
- **Don't rely on `timeout` or `agy --print-timeout` on macOS.** Use `perl -e 'alarm N; exec @ARGV' <cmd>`. Why: 2026-09-23, 25s timeout ran 79s.
- **`.claude/skills` and `.codex/skills` are symlinks into `.agents/skills`.** Check with `ls -l`; `diff -rq` follows the links and misleads. Why: 2026-09-16 wrong duplication finding.
- **Production e2e needs localhost binding.** In a sandbox, ask for elevation up front; if denied, report the browser check as blocked. Why: 2026-09-10 and 2026-09-12.

## Verification

- **Run the full browser suite before calling UI work done.** Fixing the named selectors is not enough; removed modes, selection side effects and overlays broke other suites. Why: 2026-09-14 status correction.
- **After any stylesheet or app-shell change, run `TEST_PRODUCTION=1 npm run test:e2e`.** The desktop export journey regressed from CSS alone. Why: 2026-09-15.
- **One passing run doesn't prove a flaky test is fixed.** Say so in the log. Why: 2026-09-10.
- **The large-chunk build warning predates this work.** Don't chase it; do report any new warning. Why: recurring since 2026-09-10.

## Delegation and review

- **Check delegate output against source before integrating.** Delegates repeatedly got FIFO/reservation accounting, cancellation order and random draws wrong. Why: 2026-09-13.
- **Verify reviewer claims before applying them.** Reviewers have cited wrong callers and stale decisions. Why: 2026-09-22.
- **Self-reviewed corrections don't close a review.** Closure needs an independent reviewer (fresh session or subagent). Why: 2026-09-23 S05.
- **Smoke-test an executor with a no-edit prompt before dispatching real lanes.** Why: 2026-09-23 preflight caught a blocked executor cheaply.

## Workflow

- **On long tasks, record status in `ACTION_LOG.md`/`HANDOFF.md` as you go, not only at the end.** A session that runs out of tokens leaves work unrecorded. Why: 2026-09-23 Codex round.
- **Before deleting a branch, prove it is merged into the intended target with `git merge-base --is-ancestor <branch> <target>` (or `git cherry` for rebased work).** `git branch -d` only checks the current checkout, and this repo has no remote, so a deleted unmerged branch is gone. Why: 2026-09-29 cleanup.
- **In zsh, unquoted `$VAR` holding several paths is one word; loop over them explicitly.** A multi-file `cp`/`checkout` silently did nothing. Why: 2026-09-29 RV-17 before/after build.
