# Agent Workflow (Dual-Platform: ChatGPT / Codex & Gemini / Antigravity)

These instructions define the persistent collaboration workflow for this repository across both **ChatGPT / Codex** and **Gemini / Antigravity**. They apply to all coding tasks in this project. The current user request takes precedence over older preferences recorded in project notes or handoffs.

---

## 1. Dual-Platform Collaboration Strategy

When developing with both ChatGPT/Codex and Gemini/Antigravity, agents must specialize according to their platform strengths while sharing a single source of truth:

| Platform / Lead | Primary Responsibilities | Preferred Tasks |
| :--- | :--- | :--- |
| **Gemini / Antigravity** | Visual Canvas, Presentation, Multimodal Review & High-Context Audits | • Canvas interactions, drag/drop, docking UI, SVG/PNG vector exports<br>• Visual QA & browser subagent E2E testing<br>• Cross-repository audits leveraging large context window<br>• Interactive architecture planning |
| **ChatGPT / Codex** | Discrete Simulation Engine, State Invariants & Algorithmic TDD | • Exact simulation math, discrete-event worker models (`src/domain/`)<br>• Finite cache LRU/TTL, retry backoff accounting<br>• Portable export JSON schema migrations<br>• Fast surgical patches via RTK |

### The Neutral Hand-off Protocol
1. **Clean Worktree Before Switching**: An agent must never leave uncommitted or unstaged changes when handing off to another platform. Commit or stash work with a clear message before switching tools.
2. **Shared Invariant Ledger**: Both platforms must read [`HANDOFF.md`](file:///Users/ankushjamdagani/personal/system-design-planner/HANDOFF.md) before starting any architectural or simulation work and abide by its invariants.
3. **Unified History**: Both platforms must append completed task summaries to [`ACTION_LOG.md`](file:///Users/ankushjamdagani/personal/system-design-planner/ACTION_LOG.md).
4. **Peer Review Loop**: When a high-risk change is implemented on one platform (e.g., discrete simulation accounting in Codex), the other platform (e.g., Gemini) can be tasked with adversarial review of the `git diff` against [`HANDOFF.md`](file:///Users/ankushjamdagani/personal/system-design-planner/HANDOFF.md) invariants.

---

## 2. Lead and Delegation

- **Lead Agent Ownership**: The lead agent (the active conversational model) owns the task plan, architectural decisions, integration, final review, and any cross-cutting or ambiguous work. Never downgrade lead responsibilities to child subagents.
- **Bounded Delegation**: Delegate only when a child has a clearly bounded, independent task whose result directly reduces total work. Never delegate for ceremony or trivial work.
- **Concurrency & Ownership Limits**:
  - Maximum 3 child agents concurrently.
  - Briefs must be concise and bounded: specify exact files, target symbols, constraints, and validation.
  - **Exclusive file ownership**: Every child has exclusive write permissions over its assigned files. Overlapping edits are strictly prohibited.
  - The lead verifies all returned diffs and owns final integration.

### Platform-Agnostic Child Roles

Subagents should be mapped to the appropriate model depending on the host environment:

- **Scout (Read-Only)**
  - *Codex model:* `gpt-5.6-luna` (low reasoning)
  - *Antigravity model:* Fast / Flash tier (low reasoning)
  - *Scope:* Graph traversal, symbol location, dependency tracing, file reconnaissance. Returns paths, symbols, findings, and open questions. **Zero edits permitted.**
- **Implementer (Scoped Patching)**
  - *Codex model:* `gpt-5.6-luna` (medium reasoning)
  - *Antigravity model:* Flash or Pro tier (medium reasoning)
  - *Scope:* Focused modifications strictly within assigned files. Runs narrowest meaningful checks before returning.
- **Verifier (Targeted Validation & QA)**
  - *Codex model:* `gpt-5.6-luna` (medium reasoning)
  - *Antigravity model:* Browser subagent or Pro verifier
  - *Scope:* Focused unit tests, E2E browser flows, visual artifact checks, and diff review. Escalate architectural failures to the lead.

---

## 3. Repository Discovery and Graph Tools

- **In Codex**: When `/Users/ankushjamdagani/.codex/skills/graphify/SKILL.md` and `graphify-out/graph.json` exist, prefer the fast path (`graphify query` or `path` with `--budget 1500` to `2000`).
- **In Antigravity / Gemini**: Use ripgrep / symbol search or existing graph artifacts to locate relevant source files.
- **Invariant**: Traversal results are navigation evidence only. Always view and verify the current source code before making changes. Do not dump entire graphs or source trees into agent briefs.

---

## 4. Project Invariants and Persistence

Always read [`HANDOFF.md`](file:///Users/ankushjamdagani/personal/system-design-planner/HANDOFF.md) before implementing changes to:
- **Simulation Accounting**: Strict separation between configured architecture and observed results; exact per-attempt latency, FIFO waiting, and retry draws.
- **Model / View Separation**: Canvas metadata (notes, visual layout, subsystems) must not mutate or pollute executable simulation models.
- **Portable Persistence**: Respect the versioned export format (currently version 7). Structurally validate imported metrics without rerun mutations.
- **Scope Discipline**: Do not invent speculative milestones. Focus strictly on the user's requested scope.

---

## 5. Editing and Verification Baseline

- **Worktree Integrity**: Inspect `git status` before starting; do not overwrite or discard unrelated user changes.
- **Verification Baseline**: Every change must be validated against the standard project test suite:
  ```bash
  npm test
  npm run build
  TEST_PRODUCTION=1 npm run test:e2e
  ```
- Use `rtk` (Rust Token Killer) when available in the shell for output-heavy commands (see [`RTK.md`](file:///Users/ankushjamdagani/personal/system-design-planner/RTK.md)), but fall back to standard commands if `rtk` is absent.
- Use `headroom` for agent context optimization and tool output compression (see [`HEADROOM.md`](file:///Users/ankushjamdagani/personal/system-design-planner/HEADROOM.md)) via `headroom wrap <agent>` or MCP integration (`headroom mcp`).
- Never claim a check passed if it was skipped or blocked.

---

## 6. Task Action Summaries

Every completed task must conclude with a concise action summary in the final response and be appended to [`ACTION_LOG.md`](file:///Users/ankushjamdagani/personal/system-design-planner/ACTION_LOG.md) under a dated heading (`YYYY-MM-DD`):
- **Outcome**: The specific problem solved or capability added.
- **Changed**: Key files or subsystems modified.
- **Platform / Subagents**: Which environment (Codex / Gemini) and subagents were used.
- **Verification**: Exact commands run and results obtained.
- **Follow-up / Invariants**: Any follow-up decisions or noted edge cases.

Keep [`ACTION_LOG.md`](file:///Users/ankushjamdagani/personal/system-design-planner/ACTION_LOG.md) (chronological task history) and [`HANDOFF.md`](file:///Users/ankushjamdagani/personal/system-design-planner/HANDOFF.md) (current system state and invariants) strictly separated.

@RTK.md
@HEADROOM.md
