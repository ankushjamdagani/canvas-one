---
name: delegate
description: Orchestrate a task across multiple AI agents — planner, critic, parallel executors, reviewer
config:
  critic: self
  reviewer: self
  critique_max_loops: 3
  review_max_loops: 2
  timeout_sec: 300
  runs_dir: .delegate/runs
  executor_targets:
    - cli: agy
      model: gemini-3.8-flash-low
      args: ["--mode", "accept-edits"]
  executor_concurrency: 3
  scarce_clis: [codex, claude]
  scarce_max_subtasks: 1
  fallback_executor: null
  failure_patterns: []
---

# Delegate — Multi-Agent Task Orchestration

Orchestrate a task through four phases: Plan → Critique → Execute → Review.
You are the orchestrator. Use your Bash tool throughout. `$SKILL` below is this skill's directory.

## Configuration

Precedence (later wins, top-level keys replace): frontmatter above → project file `.agents/delegate.json` (optional, same keys as JSON) → invocation flags.

- **Target**: `{"cli": "agy|codex|claude", "model": "...", "effort": "...", "args": [...], "timeout_sec": N}`. Only `cli` and `model` are required. `args` are extra CLI flags (permission modes, `--add-dir`); see `roles/executor.md`.
- `critic` / `reviewer`: `self` (you, inline) or a target. A bare CLI name (`claude`) means that CLI with its default model from `roles/executor.md`. A CLI target always runs as a separate process — use it when you want an independent critique/review.
- `executor_targets`: list of targets. The planner prefers non-scarce ones (see Token budget).
- `timeout_sec`: default per-process limit; a target's own `timeout_sec` overrides it.
- `scarce_clis`, `scarce_max_subtasks`, `fallback_executor`: see Token budget.
- `failure_patterns`: extra regexes that mark an exit-0 executor run as failed (added to the built-in denial patterns in `scripts/state.py`).

Example `.agents/delegate.json` — Gemini critiques and implements, Claude spends quota only on the final review:
```json
{
  "critic": {"cli": "agy", "model": "gemini-3.1-pro-high"},
  "reviewer": {"cli": "claude", "model": "claude-sonnet-4-6", "timeout_sec": 600},
  "executor_targets": [{"cli": "agy", "model": "gemini-3.8-flash-low", "args": ["--mode", "accept-edits"]}]
}
```

### Token budget

CLIs in `scarce_clis` (default `codex`, `claude`) have tight usage quotas. Spend them sparingly:
- Executors: the planner assigns non-scarce targets by default. A scarce target gets a subtask only when it clearly needs that model, and at most `scarce_max_subtasks` per round. Pick the lightest model tier that can do the job.
- Critic/reviewer: prefer `self` or a non-scarce CLI; use a scarce CLI for at most one of them.
- Quota exhaustion (usage/rate-limit text on a failed run) gives status `quota`. The next `dispatch` reruns that subtask on `fallback_executor` (default: first non-scarce executor target) and keeps the old output as `<id>.quota.*`. A quota-hit critic or reviewer falls back to `self`.

## Parsing Arguments

- `--critic=<self|cli[:model]>`, `--reviewer=<self|cli[:model]>`
- `--executors="cli:model[:effort],..."` — replaces `executor_targets`
- `--resume=<path/to/state.json>` — continue an interrupted run (see Resume); ignores other flags
- Remaining text after all flags is the task string

## Phase 0: Startup

Read all four role files first: `roles/planner.md`, `roles/critic.md`, `roles/reviewer.md`, `roles/executor.md`.

Check CLI availability:
```bash
for c in agy codex claude; do command -v $c >/dev/null && echo "$c: ok" || echo "$c: MISSING"; done
```
- Missing executor CLI → drop that target and warn. None left → abort: `ERROR: No executor CLIs available. Install agy, codex, or claude.`
- Missing critic/reviewer CLI → fall back to `self` and warn.

Create the run directory inside the repo (keep `runs_dir` gitignored) so every agent can read it and it survives temp cleanup:
```bash
SCRATCHPAD="$(git rev-parse --show-toplevel)/<runs_dir>/$(date +%Y%m%d-%H%M%S)"
STATE="$SCRATCHPAD/state.json"
python3 "$SKILL/scripts/state.py" init "$STATE" '<task>' '<merged config JSON>'
```
Echo: `Delegate run started. State: $STATE (resume with --resume=$STATE)`

State fields: `phase` (next phase to run: `plan|critique|execute|review|done`), `plan`, `critique`, `review_loop`, `executions`, `review`. Always write state through `scripts/state.py` (atomic writes). Set `phase` as the **last** step of each phase.

## Resume

With `--resume=<state.json>`: run the Phase 0 role-file read and CLI check, set `STATE` to the path and `SCRATCHPAD` to its `scratchpad` field, echo `Resuming at phase <phase>`, then jump:
- `plan` → Phase 1. `critique` → Phase 2, continuing the loop count in `critique.loop`.
- `execute` → Phase 3. `dispatch` skips subtasks of the current round that already have a `.exit` file, and stops (process group only) and reruns any that were orphaned mid-run.
- `review` → Phase 4, continuing the loop count in `review_loop`. `done` → echo the stored result.

If the run directory is unknown, the newest run is `ls -td <runs_dir>/*/ | head -1`.

## Phase 1: Plan

Adopt the Planner persona. Produce subtasks JSON; assign executors from `executor_targets` per Token budget (copy the whole target into `assigned_executor`):
```json
{
  "version": 1,
  "subtasks": [
    {
      "id": "e1",
      "title": "brief title ≤60 chars",
      "prompt": "Full executor prompt. What to do, which files to touch, current state, expected outcome, how to verify. Written for an executor that has never seen this codebase.",
      "files": ["src/path/to/file.ts"],
      "assigned_executor": {"cli": "agy", "model": "gemini-3.8-flash-low", "args": ["--mode", "accept-edits"]}
    }
  ]
}
```
Invalid JSON → retry once with "Output ONLY valid JSON, no prose, no code fences." Still invalid → abort: `ERROR: Planner failed to produce valid JSON. State: $STATE`.

```bash
python3 "$SKILL/scripts/state.py" set "$STATE" plan - <<'JSON'
<plan JSON>
JSON
python3 "$SKILL/scripts/state.py" set "$STATE" phase '"critique"'
```

## Phase 2: Critique Loop

Loop counter starts at 0 (or `critique.loop` on resume).

**`critic: self`** → adopt the Critic persona and produce critique JSON inline.

**CLI critic** → write the prompt to a file and run it through the timeout wrapper:
```bash
P="$SCRATCHPAD/critic-<loop>"
{ cat "$SKILL/roles/critic.md"; echo; echo "Task: <task>"; echo; echo "Plan:"; python3 "$SKILL/scripts/state.py" get "$STATE" plan; } > "$P.in"
"$SKILL/scripts/run-agent.sh" "$P" <timeout_sec> <cli> <model> [effort] -- [args...]
```
If `python3 "$SKILL/scripts/state.py" quota "$STATE" "$P"` exits 0, the CLI is out of quota: warn and switch the critic to `self` for the rest of the run. Otherwise read `$P.out` as the critique. Exit ≠ 0 (124 = timeout) or output not valid JSON → retry once with "Respond with ONLY valid JSON, no prose." prepended. Still bad → treat as `{"verdict": "fail", "issues": ["critic failed: <exit code / raw output>"], "revised_plan_hints": []}`.

Rules:
- `pass` → set `phase` to `"execute"`, go to Phase 3.
- `fail` and loop < `critique_max_loops` → increment, revise the plan as Planner using `revised_plan_hints`, save plan, critique again.
- `fail` at the limit → abort: `ERROR: Critique failed after <n> attempts. State: $STATE`, then echo all critique feedback.

After each loop: `state.py set "$STATE" critique '{"loop": <n>, "passed": <bool>, "feedback": <issues>}'`.

## Phase 3: Execute

`dispatch` writes `<id>.in` (subtask prompt plus a required `DELEGATE_STATUS` footer) and a runner script for each unfinished subtask of the current round (`$SCRATCHPAD/r<review_loop>/`); `xargs -P` enforces `executor_concurrency`:
```bash
python3 "$SKILL/scripts/state.py" dispatch "$STATE" | xargs -P <executor_concurrency> -n 1 bash
python3 "$SKILL/scripts/state.py" collect "$STATE"
```
`run-agent.sh` runs each agent in its own process group with a hard timeout (GNU `timeout`/`gtimeout` when installed, otherwise a background watcher). On timeout it sends TERM to that group only, then KILL after 10s, and records exit `124`. Full stdout/stderr remain in `<id>.out` / `<id>.err`.

`collect` stores per subtask: `status`, `reason`, `exit_code`, `stdout_path`, `stderr_path` and a short tail `excerpt`. Status is `done` only when **all** hold: exit 0, non-empty stdout, no permission/tool-denial text, and a final `DELEGATE_STATUS: done` line. Otherwise it is `timeout` (124), `quota` (failed run showing usage/rate-limit text), `error` (non-zero exit) or `failed` (exit 0 but empty, denied, blocked or unmarked). Never upgrade a `failed` status yourself; hand it to the reviewer.

If any subtask is `quota`, run the `dispatch | xargs` and `collect` lines once more; `dispatch` moves those subtasks to the fallback target. No fallback target → leave them `quota` for the reviewer.

If Bash tool time limits are shorter than the run, launch the `dispatch | xargs` line in the background and poll for `.exit` files. After `collect`, set `phase` to `"review"`.

## Phase 4: Review Loop

Loop counter is `review_loop` (starts at 0).

**`reviewer: self`** → adopt the Reviewer persona. Read every `stdout_path` and `stderr_path` in full and inspect `git status` / `git diff`; the excerpts in state are not enough.

**CLI reviewer** → same wrapper pattern as the critic, with `P="$SCRATCHPAD/review-<review_loop>"` and a prompt built from `roles/reviewer.md`, the task, and `state.py get "$STATE" executions`. The reviewer must read the full output files itself (they are inside the repo), so give it read access (see `roles/executor.md`).

Quota-hit CLI reviewer (`state.py quota`) → warn and review as `self`. Malformed review or other reviewer failure → retry once. Still bad → treat as `{"verdict": "fail", "failures": [{"subtask_id": "all", "reason": "reviewer failed: <exit code / raw output>"}], "summary": ""}`.

Rules:
- `pass` → set `review` and `phase` `"done"`; echo `SUCCESS: <summary>` and `State: $STATE`.
- `fail` and `review_loop` < `review_max_loops` → as Planner, re-plan using the task, execution outputs and reviewer feedback; save the plan, increment `review_loop` (new round directory), set `executions` to `[]` and `phase` to `"execute"`; re-run Phase 3, then Phase 4.
- `fail` at the limit → set `phase` `"done"`; echo `PARTIAL RESULT: <what succeeded>`, `REVIEW DIAGNOSIS: <failures>`, `State: $STATE`.

After each loop: `state.py set "$STATE" review '{"loop": <n>, "passed": <bool>, "feedback": <failures>, "summary": "..."}'`.
