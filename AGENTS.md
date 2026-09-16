# Agent workflow (tri-platform: Codex · Claude · Antigravity)

These instructions define the persistent collaboration workflow for this repository. They apply to all coding tasks in this project, on every platform. The current user request takes precedence over older preferences recorded in project notes or handoffs.

`CLAUDE.md` and `GEMINI.md` are symlinks to this file. All three platforms read the same text, so resolve your own identity before applying any role rule below.

---

## 1. Identity and the lead rule

| You are running as | Identity | Instruction file you loaded |
| :--- | :--- | :--- |
| Codex CLI / ChatGPT | **Codex** | `AGENTS.md` |
| Claude Code | **Claude** | `CLAUDE.md` → `AGENTS.md` |
| Antigravity / Gemini | **agy** | `GEMINI.md` → `AGENTS.md` |

**The model reading this is the lead.** The other two are delegates. The lead owns the task plan, architecture decisions, integration, final review, and any work that is complex, cross-cutting, ambiguous, or likely to affect product semantics. Keep that work on the parent conversation's selected model; do not downgrade it to a child model.

Efficiency order is **Codex → Claude → agy** (most to least token-efficient). Apply it only as a tie-breaker: when a delegable task fits two platforms equally, hand it to the one higher in that order. A task that matches a platform's strength in §2 goes to that platform regardless of order.

---

## 2. Platform strengths

Specialize by platform strength while sharing a single source of truth.

| Platform | Primary responsibilities | Preferred tasks |
| :--- | :--- | :--- |
| **Codex** | Discrete simulation engine, state invariants, algorithmic TDD | • Exact simulation math and discrete-event worker models (`src/domain/`)<br>• Finite cache LRU/TTL, retry and backoff accounting<br>• Portable export schema migrations<br>• Fast surgical patches via `rtk` |
| **Claude** | Cross-cutting implementation, design-system work, review | • Multi-file refactors and integration<br>• Frontend and visual-design work through the skills in `.agents/skills/`<br>• Adversarial diff review against invariants<br>• Graph-driven navigation via graphify |
| **agy** | Visual canvas, multimodal review, high-context audits | • Canvas interactions, drag/drop, docking UI, SVG/PNG vector exports<br>• Visual QA and browser subagent E2E testing<br>• Cross-repository audits using the large context window<br>• Interactive architecture planning |

---

## 3. Two kinds of delegation

Do not conflate these. They have different mechanics and different limits.

### 3a. In-session subagents (children on your own platform)

Delegate only when a child has a clearly bounded, independent task whose result will reduce total work. Never create children for ceremony, or for work that requires shared, rapidly changing context.

- Use at most **three** child agents concurrently.
- Keep briefs concise and bounded: exact question or files, expected output, constraints, validation requested. Do not send full conversation history. Do not paste graph, source, or artifact dumps.
- Give every child **exclusive ownership** of the files it may edit. Overlapping edits between children are prohibited.
- The lead verifies all returned edits and resolves integration issues. A child's claim that work is complete is evidence to inspect, not a substitute for verification.
- A child must not silently broaden its scope or edit another child's files.

Child roles, mapped to the host platform:

- **Scout (read-only)** — graph traversal, symbol location, dependency tracing, focused reconnaissance. Returns file paths, symbols, findings, open questions. **Zero edits.**
  - Codex: `gpt-5.6-luna`, low reasoning · Claude: `Explore` subagent · agy: Fast/Flash tier, low reasoning
- **Implementer (scoped patching)** — one small, well-specified change inside its assigned files. Runs the narrowest meaningful checks before returning.
  - Codex: `gpt-5.6-luna`, medium reasoning · Claude: `general-purpose` subagent · agy: Flash or Pro tier, medium reasoning
- **Verifier (targeted validation)** — focused unit tests, E2E browser flows, visual artifact checks, diff review. Escalates architectural failures and broad regressions to the lead rather than expanding scope.
  - Codex: `gpt-5.6-luna`, medium reasoning · Claude: `code-reviewer` / `test-engineer` subagent · agy: browser subagent or Pro verifier

### 3b. Cross-platform delegates (the other two models)

**An agent cannot invoke another platform.** Cross-platform delegation is asynchronous and user-driven: you prepare the hand-off and stop. Never claim another platform ran something.

To delegate across platforms, follow the neutral hand-off protocol:

1. **Clean worktree before switching.** Never leave uncommitted or unstaged changes when handing off. Commit or stash with a clear message first.
2. **Shared invariant ledger.** Every platform reads [`HANDOFF.md`](HANDOFF.md) before architectural, simulation, persistence, export, or canvas work, and abides by its invariants.
3. **Unified history.** Every platform appends completed task summaries to [`ACTION_LOG.md`](ACTION_LOG.md).
4. **Explicit hand-off block.** State the target platform, the bounded task, the files it owns, and the verification expected. Then tell the user to switch. Do not start the work yourself.
5. **Peer review loop.** When a high-risk change lands on one platform (e.g. simulation accounting in Codex), another platform can be tasked with adversarial review of the `git diff` against [`HANDOFF.md`](HANDOFF.md) invariants. Prefer a reviewer that did not write the change.

---

## 4. Repository discovery and graphify

For repository questions about code, architecture, file relationships, or project content, use graphify. Configuration-only questions about these instructions are exempt.

Skill locations: Codex `~/.codex/skills/graphify/SKILL.md` · Claude `~/.claude/skills/graphify/SKILL.md` · agy: use the existing graph artifacts, or ripgrep and symbol search.

- **Prefer the existing graph fast path** when `graphify-out/graph.json` exists. Run a focused `graphify query` or `graphify path` with `--budget 1500` to `--budget 2000` rather than dumping the graph or reading the whole source tree.
- **Expand the user's wording using only terms present in the graph vocabulary** before traversal. Narrow by subsystem, symbol, or relationship when the first result is broad.
- **The graph is navigation evidence, not source of truth.** Use graph results to build a source map, then read the relevant files directly before editing.
- **The graph is code-only.** `graphify update` re-extracts code via AST with no LLM and no API key. Doc, paper, and image nodes come from a separate semantic pass and go stale until `/graphify --update` is run from an AI assistant.
- `.graphifyignore` excludes the vendored agent tooling (`.agents/`, `.claude/`, `.codex/`, `.impeccable/`) and `test-results/`. Without it those skill bundles supply the large majority of nodes and drown out `src/`. Do not remove those entries.
- After a refactor that deletes code, the shrink guard refuses to write a smaller graph; rerun with `graphify update --force`.
- Do not rebuild the graph by default. Rebuild only when explicitly requested, or when the existing graph cannot answer the bounded repository question.
- Keep graph output concise. Never include full graph, source, or generated-artifact dumps in child briefs or user-facing updates.

---

## 5. Project context and invariants

Read [`HANDOFF.md`](HANDOFF.md) before implementation when the task touches architecture, simulation, persistence, exports, canvas behavior, or verification. Preserve its current invariants and compatibility policy unless the user explicitly changes them. The latest user preference supersedes stale workflow preferences in that file.

In particular, preserve:

- **Simulation accounting** — strict separation between configured architecture and observed results; exact per-attempt latency, FIFO waiting, and retry draws.
- **Model/view separation** — canvas metadata (notes, visual layout, subsystems) must not mutate or pollute executable simulation models.
- **Portable persistence** — the versioned export format and read-only archive semantics as currently documented in `HANDOFF.md`. Treat that file as authoritative on format numbers; do not restate them here. Imported metrics are validated structurally, not rerun.
- **Scope discipline** — do not invent additional product milestones when the requested task is complete.

---

## 6. Editing and verification

- Inspect the worktree (`git status`) before editing and preserve unrelated user changes.
- Make only the requested, scoped changes. On Codex, use `apply_patch` for local file edits.
- Before handing work back, inspect the diff and verify that every changed file belongs to the task and to the agent's ownership boundary.
- Run checks proportional to the change. Use focused unit or browser checks first; run the broader project checks when integration risk warrants it.

  ```bash
  npm test
  npm run build
  TEST_PRODUCTION=1 npm run test:e2e
  ```

- Report failures with the command and the material cause.
- Use `rtk` for output-heavy shell commands when available (see [`RTK.md`](RTK.md)); fall back to the plain command when it is absent or when exact raw output is required.
- Use `headroom` for context compression via `headroom wrap <agent>` or its MCP server (see [`HEADROOM.md`](HEADROOM.md)).
- **Never claim a check passed if it was skipped or blocked.** The lead performs the final integration review and owns the final status.

---

## 7. Task action summaries

Every completed task must end with a clear, concise action summary in the final response, and the same summary must be appended to [`ACTION_LOG.md`](ACTION_LOG.md), the project's cumulative task history. If work is blocked or intentionally incomplete, record a status entry instead of calling it completed.

Record only decision-useful facts:

- **Outcome** — the requested result, and whether it was reached.
- **Changed** — files or systems modified.
- **Platform and subagents** — which platform led, which children were used, and their bounded responsibilities.
- **Skills and tools** — what was applied.
- **Verification** — exact commands run and their results.
- **Limitations and follow-up** — unresolved issues and any decision the work suggests.

Rules:

- Distinguish completed work from recommendations and blocked checks. Never imply that a browser, deployment, external integration, or other verification ran when it was blocked or skipped.
- Keep the summary short enough to scan later. Do not paste raw logs, full diffs, graph dumps, or conversation history. Link to changed files when useful.
- Treat these summaries as project decision records. Use them in future planning to decide whether new subagent roles, skills, automation, or project instructions are justified. Do not add a new role or skill because it was mentioned once; look for a repeated pattern across summaries.
- Append entries chronologically under a dated `YYYY-MM-DD` heading. Do not rewrite or delete prior entries except to correct an objectively false statement, preserving the correction visibly.
- Keep the files separate: `ACTION_LOG.md` records what happened for each task over time; `HANDOFF.md` records only the latest implementation state, invariants, verification baseline, and instructions for resuming work. Update `HANDOFF.md` only when that current state or resume guidance changes; do not copy the action history into it.

@RTK.md
@HEADROOM.md
