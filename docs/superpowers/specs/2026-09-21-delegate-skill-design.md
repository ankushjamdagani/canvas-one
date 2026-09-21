# Delegate Skill — Multi-Agent Task Orchestration

**Date:** 2026-09-21
**Status:** Approved for implementation

---

## Overview

A platform-agnostic skill (`/delegate`) that orchestrates multi-agent task execution. Invokable from Claude Code, Codex CLI, agy, or any agent that can load skill files. Whoever invokes acts as the Planner. A Critic challenges the plan before execution. Multiple executor agents run subtasks in parallel — executor targets are configurable per-model and per-CLI. A Reviewer validates the output.

---

## Architecture

### File Structure

```
.agents/skills/delegate/
├── SKILL.md              — platform-agnostic workflow + config defaults
└── roles/
    ├── planner.md        — decompose task → subtasks JSON
    ├── critic.md         — adversarial challenge prompt
    ├── reviewer.md       — post-execution quality check prompt
    └── executor.md       — per-CLI invocation patterns + prompt template
```

Platform-specific skill symlinks point here:
- `.claude/skills/delegate` → `.agents/skills/delegate`
- `.codex/skills/delegate` → `.agents/skills/delegate`
- `.impeccable/skills/delegate` → `.agents/skills/delegate`

Any platform that doesn't support symlinks copies the directory.

### Role Ownership

| Role | Runs on | Notes |
|---|---|---|
| Planner | Invoking model (self) | Adopts planner persona, outputs structured plan |
| Critic | Configurable: `self`, `claude` CLI, `codex` CLI | Adversarial pre-execution challenge |
| Executor × N | Configurable list of `{ cli, model }` targets | One process per subtask, parallel |
| Reviewer | Configurable: `self`, `claude` CLI, `codex` CLI | Post-execution quality check |

`self` = in-conversation persona shift, no shell out.
Any other value = shell out to that CLI with `--model`, capture stdout.

### Configuration

Frontmatter defaults in SKILL.md, overridable per invocation:

```yaml
critic: self
reviewer: self
critique_max_loops: 3
review_max_loops: 2

# Executor pool — subtasks distributed round-robin across these targets
executor_targets:
  - cli: agy
    model: gemini-2.5-pro
  - cli: agy
    model: gemini-2.0-flash
  - cli: codex
    model: gpt-4o-mini

# Max concurrent executor processes
executor_concurrency: 3
```

**Invocation examples:**
```
/delegate "add retry logic to the cache layer"
/delegate --critic=claude --reviewer=codex "add retry logic to the cache layer"
/delegate --executors="agy:gemini-2.5-pro,claude:claude-sonnet-4-6" "refactor cache module"
```

Inline `--executors` flag accepts `cli:model` pairs, comma-separated. Overrides `executor_targets` entirely when provided.

---

## Data Flow

### State File

Written to scratchpad at run start: `<scratchpad>/delegate-run-<timestamp>.json`

```json
{
  "task": "original user task string",
  "config": {
    "critic": "claude",
    "reviewer": "self",
    "executor_targets": [
      { "cli": "agy", "model": "gemini-2.5-pro" },
      { "cli": "codex", "model": "gpt-4o-mini" }
    ],
    "executor_concurrency": 3
  },
  "plan": {
    "version": 2,
    "subtasks": [
      {
        "id": "e1",
        "title": "...",
        "prompt": "...",
        "files": ["src/cache.ts"],
        "assigned_executor": { "cli": "agy", "model": "gemini-2.5-pro" }
      }
    ]
  },
  "critique": { "loop": 2, "passed": true, "feedback": "..." },
  "executions": [
    { "id": "e1", "status": "done", "output": "...", "exit_code": 0,
      "executor": { "cli": "agy", "model": "gemini-2.5-pro" } }
  ],
  "review": { "loop": 1, "passed": false, "feedback": "..." }
}
```

State is always written on abort — path echoed to user for inspection.

### Pipeline

```
/delegate <task>
    │
    ▼
[STARTUP] Verify configured CLIs exist; warn + fall back to self if missing
    │
    ▼
[PLAN] Planner reads task → emits subtasks[] to state
       Each subtask gets an assigned_executor (round-robin from executor_targets)
    │
    ▼
[CRITIQUE LOOP — max 3]
    Critic reads task + plan → pass | fail + feedback
    ├── pass → proceed to execution
    └── fail → Planner revises plan using feedback, repeat
    (loop exhausted → abort, echo state path + all critique feedback)
    │
    ▼
[EXECUTE] Shell executor CLI per subtask in parallel (background processes)
    Each subtask uses its assigned_executor { cli, model }
    Collect stdout + exit codes into state.executions[]
    │
    ▼
[REVIEW LOOP — max 2]
    Reviewer reads task + plan + all execution outputs → pass | fail + feedback
    ├── pass → report success summary to user
    └── fail → Planner receives task + failed outputs + reviewer feedback
               → emits revised subtasks with fresh executor assignments, re-run
    (loop exhausted → report partial results + review diagnosis)
```

### Executor Parallelism

Executor processes fire as Bash background jobs (`&`), each writing output to `<scratchpad>/exec-<id>.txt`. Parent waits with `wait`, then reads all output files into state. Concurrency capped at `executor_concurrency`; excess subtasks queue and start as slots free.

---

## Role Output Schemas

**Critique schema** (Critic must output valid JSON):
```json
{
  "verdict": "pass" | "fail",
  "issues": ["issue description"],
  "revised_plan_hints": ["hint for planner"]
}
```

**Review schema** (Reviewer must output valid JSON):
```json
{
  "verdict": "pass" | "fail",
  "failures": [{ "subtask_id": "e1", "reason": "..." }],
  "summary": "one-line result"
}
```

Malformed JSON from Critic: retry once with stricter prompt, then treat as `fail` using raw text as feedback.
Malformed JSON from Reviewer: retry once, then treat as `fail`.

---

## Executor Invocation Contract

Each CLI has its own invocation pattern, defined in `roles/executor.md`:

```bash
# agy
agy --model <model> \
    --context "$(cat <state-file>)" \
    --task "<subtask prompt>" \
    --output-file "<scratchpad>/exec-<id>.txt"

# codex
codex --model <model> \
    --quiet \
    --input "<subtask prompt with context>" \
    > "<scratchpad>/exec-<id>.txt"

# claude
claude --model <model> \
    --print \
    "<subtask prompt with context>" \
    > "<scratchpad>/exec-<id>.txt"
```

`roles/executor.md` is the single place to update when any CLI's interface changes. Exact flags must be verified against each CLI's `--help` before first use.

Timeout per executor process: 5 minutes. On timeout: kill process, mark subtask `timeout`.

---

## Error Handling

| Error | Phase | Response |
|---|---|---|
| Planner outputs invalid subtasks JSON | Plan | Retry once with stricter prompt, then abort |
| Critique JSON malformed | Critique loop | Treat as `fail`, use raw text as feedback, continue loop |
| Executor non-zero exit | Execute | Mark subtask `error`, continue other executors, pass error text to Reviewer |
| Executor timeout (>5 min) | Execute | Kill process, mark subtask `timeout` |
| All executors for a subtask exhausted | Execute | Mark subtask `failed`, surface in review |
| Critique loop exhausted (3×) | Critique | Abort run, echo state path + all critique feedback |
| Review loop exhausted (2×) | Review | Report partial results + review diagnosis, no re-run |
| CLI binary unavailable at startup | Startup | Fall back to `self` for critic/reviewer; for executors remove that target and warn |

**CLI availability check:** On skill start, run `which <cli>` for every configured CLI. Fail fast for missing executor CLIs (can't execute without them). Degrade gracefully for missing critic/reviewer CLIs (fall back to `self`).

---

## Constraints & Non-Goals

- Executors do not share state with each other — each gets a full copy of the state file as read-only context.
- No nested delegation — executors cannot themselves invoke `/delegate`.
- No cloud persistence — state files are local scratchpad only.
- Subtask count is bounded by `executor_concurrency` (default 3 concurrent) to avoid runaway parallelism.
- Executor target assignment is round-robin; no load-balancing or capability-based routing in this version.
- No streaming — executor output is collected after process exits, not streamed live.
