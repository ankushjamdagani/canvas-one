# Agent workflow

These instructions define the persistent collaboration workflow for this repository. They apply to all future coding tasks in this project. The current user request takes precedence over older preferences recorded in project notes or handoffs.

## Lead and delegation

- The lead agent owns the task plan, architecture decisions, integration, final review, and any work that is complex, cross-cutting, ambiguous, or likely to affect product semantics. Keep this work on the parent conversation’s selected model; do not downgrade it to a child model.
- Delegate only when a child has a clearly bounded, independent task whose result will reduce total work. Never create children for ceremony or for work that requires shared, rapidly changing context.
- Use at most three child agents concurrently. Keep briefs concise and bounded: state the exact question or files, expected output, constraints, and validation requested. Do not send full conversation history. Do not delegate merely to create activity.
- Give every child exclusive ownership of the files it may edit. Avoid overlapping edits between children. The lead verifies all returned edits and resolves integration issues.

### Preferred child roles

- **Scout:** use `gpt-5.6-luna` with low reasoning for read-only graph traversal, source location, dependency tracing, and focused reconnaissance. Return file paths, symbols, findings, and open questions; do not edit.
- **Implementer:** use `gpt-5.6-luna` with medium reasoning for a small, well-specified change in its assigned files. Keep the patch focused and run the narrowest meaningful checks.
- **Verifier:** use `gpt-5.6-luna` with medium reasoning for focused tests, documentation checks, and review of an assigned change. Escalate complex failures, architecture questions, or broad regressions to the lead rather than expanding scope.

Use the lead model directly for architecture, integration, review, and failures that cross the child brief. A child must not silently broaden its scope or edit another child’s files.

## Repository discovery and graphify

For repository questions about code, architecture, file relationships, or project content, use the graphify skill at `/Users/ankushjamdagani/.codex/skills/graphify/SKILL.md`. Configuration-only questions about these instructions are exempt.

- Prefer the existing graph fast path when `graphify-out/graph.json` exists. Run a focused `graphify query` or `path` with `--budget 1500` to `--budget 2000` rather than dumping the graph or reading the whole source tree. Reuse the graph only for navigation, then verify current source.
- Expand the user’s wording using only terms present in the graph vocabulary before traversal, as the graphify skill requires. Narrow queries by subsystem, symbol, or relationship when the first result is broad.
- Use graph results to build a source map, then verify the relevant source files directly before editing. Treat graph edges as navigation evidence, not as a substitute for current source.
- Do not rebuild the graph by default. Rebuild or update it only when explicitly requested or when the existing graph cannot answer the bounded repository question.
- Keep graph output concise. Never include full graph, source, or generated-artifact dumps in child briefs or user-facing updates.

## Project context and invariants

Read `HANDOFF.md` before implementation when the task touches architecture, simulation, persistence, exports, canvas behavior, or verification. Preserve its current invariants and compatibility policy unless the user explicitly changes them. The latest user preference supersedes stale workflow preferences in that file.

In particular, preserve the separation between configured architecture and observed results, exact simulation accounting, model/view boundaries, portable persistence rules, and the documented verification commands. Do not invent additional product milestones when the requested task is complete.

## Editing and verification

- Inspect the worktree before editing and preserve unrelated user changes.
- Make only the requested, scoped changes. Use `apply_patch` for local file edits.
- Before handing work back, inspect the diff and verify that every changed file belongs to the task and to the agent’s ownership boundary.
- Run checks proportional to the change. For product behavior, use the focused unit or browser checks first; run the broader project checks when integration risk warrants them. Report failures with the command and the material cause.
- The lead performs the final integration review and owns the final status. A child’s claim that work is complete is evidence to inspect, not a substitute for verification.

## Task action summaries

- Every completed task must end with a clear, concise action summary in the final response and append the same summary to [`ACTION_LOG.md`](ACTION_LOG.md), the project’s cumulative task history. If work is blocked or intentionally incomplete, record a status entry instead of calling it completed.
- Record only decision-useful facts: the requested outcome, files or systems changed, sub-agents used and their bounded responsibilities, skills or tools applied, verification performed and its result, unresolved limitations, and any follow-up decision the work suggests.
- Distinguish completed work from recommendations and blocked checks. Never imply that a browser, deployment, external integration, or other verification ran when it was blocked or skipped.
- Keep the summary short enough to scan later. Do not paste raw logs, full diffs, graph dumps, or conversation history. Link to the changed files when useful.
- Treat these summaries as project decision records: use them in future planning to decide whether new sub-agent roles, skills, automation, or project instructions are justified. Do not add a new role or skill solely because it was mentioned once; look for a repeated pattern across summaries.
- Append entries chronologically under a dated heading in `ACTION_LOG.md`; do not rewrite or delete prior entries except to correct an objectively false statement, preserving the correction visibly.
- Keep the files separate: `ACTION_LOG.md` records what happened for each task over time; `HANDOFF.md` records only the latest implementation state, invariants, verification baseline, and instructions for resuming work. Update `HANDOFF.md` only when that current state or resume guidance changes; do not copy the action history into it.

@RTK.md
@HEADROOM.md
