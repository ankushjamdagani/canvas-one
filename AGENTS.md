# Agent workflow

Applies to all platforms in this repo. Current user request overrides anything here.

`CLAUDE.md` and `GEMINI.md` are symlinks to this file.

---

## 1. Identity

| Running as | Identity | File loaded |
| :--- | :--- | :--- |
| Codex CLI / ChatGPT | **Codex** | `AGENTS.md` |
| Claude Code | **Claude** | `CLAUDE.md` → `AGENTS.md` |
| Antigravity / Gemini | **agy** | `GEMINI.md` → `AGENTS.md` |

The model reading this is the lead. It owns task planning, architecture decisions, integration, and final review.

---

## 2. Delegation

Use `/delegate` (`.agents/skills/delegate/SKILL.md`) for longer or complex tasks that benefit from parallelism or multi-model execution. All mechanics, roles, and executor options are defined in that skill; this repo's critic/reviewer/executor defaults are in `.agents/delegate.json`.

---

## 3. Repository discovery

Use graphify for questions about code, architecture, or file relationships. Config-only questions are exempt.

- Skill: `~/.claude/skills/graphify/SKILL.md` (Claude) · `~/.codex/skills/graphify/SKILL.md` (Codex)
- Prefer `graphify query/path --budget 1500` when `graphify-out/graph.json` exists
- Graph results are navigation evidence — read files directly before editing
- `graphify update` re-extracts code only; doc/image nodes need `/graphify --update` from an AI assistant
- `.graphifyignore` excludes `.agents/`, `.claude/`, `.codex/`, `.impeccable/` — do not remove these entries
- Do not rebuild the graph unless explicitly requested

---

## 4. Project state

Read [`HANDOFF.md`](HANDOFF.md) at the start of each task. It holds current implementation state, project invariants and resume instructions; preserve those invariants.

Do not invent milestones beyond the requested task.

---

## 5. Editing and verification

- Check `git status` before editing; preserve unrelated changes
- Make only scoped changes; on Codex use `apply_patch`
- Inspect diff before handing back — every changed file must belong to the task
- Run checks proportional to the change:
  ```bash
  npm test
  npm run build
  TEST_PRODUCTION=1 npm run test:e2e
  ```
- Use `rtk` for output-heavy commands (see [`RTK.md`](RTK.md)); use `headroom` for context compression (see [`HEADROOM.md`](HEADROOM.md))
- Never claim a check passed if it was skipped or blocked

---

## 6. Action summaries

Append every completed task to [`ACTION_LOG.md`](ACTION_LOG.md). If blocked, record a status entry instead.

Include: outcome, files changed, platform/subagents used, verification results, limitations.

Keep entries short — no raw logs, diffs, or dumps. Append under a `YYYY-MM-DD` heading chronologically.

`ACTION_LOG.md` = cumulative task history. `HANDOFF.md` = current implementation state and resume instructions. Keep them separate.

@RTK.md
@HEADROOM.md
