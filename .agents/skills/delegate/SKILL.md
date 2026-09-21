---
name: delegate
description: Orchestrate a task across multiple AI agents — planner, critic, parallel executors, reviewer
config:
  critic: self
  reviewer: self
  critique_max_loops: 3
  review_max_loops: 2
  executor_targets:
    - cli: agy
      model: gemini-3.8-flash
      effort: low
  executor_concurrency: 3
---

# Delegate — Multi-Agent Task Orchestration

Orchestrate a task through four phases: Plan → Critique → Execute → Review.
You are the orchestrator. Use your Bash tool throughout.

## Parsing Arguments

Parse flags from the invocation line:
- `--critic=<self|claude|codex>` — who runs critique
- `--reviewer=<self|claude|codex>` — who runs review
- `--executors="cli:model:effort,..."` — executor targets (overrides config entirely when provided)
- Remaining text after all flags is the task string

Flags override config defaults. Store merged result as run config.

## Phase 0: Startup

Read all four role files before doing anything else:
- `roles/planner.md`
- `roles/critic.md`
- `roles/reviewer.md`
- `roles/executor.md`

Check CLI availability:
```bash
which agy 2>/dev/null && echo "agy: ok" || echo "agy: MISSING"
which codex 2>/dev/null && echo "codex: ok" || echo "codex: MISSING"
which claude 2>/dev/null && echo "claude: ok" || echo "claude: MISSING"
```

Rules:
- Missing executor CLI → remove that target from executor_targets and warn. If all executor targets missing → abort: `ERROR: No executor CLIs available. Install agy, codex, or claude.`
- Missing critic/reviewer CLI (when not `self`) → fall back to `self` and warn.

Create scratchpad:
```bash
SCRATCHPAD="${TMPDIR:-/tmp}/delegate-$(date +%s)"
mkdir -p "$SCRATCHPAD"
STATE="$SCRATCHPAD/state.json"
```

Write initial state to `$STATE`:
```json
{
  "task": "<task string>",
  "config": {
    "critic": "self",
    "reviewer": "self",
    "executor_targets": [{"cli": "agy", "model": "gemini-3.8-flash", "effort": "low"}],
    "executor_concurrency": 3,
    "critique_max_loops": 3,
    "review_max_loops": 2
  },
  "plan": null,
  "critique": null,
  "executions": [],
  "review": null
}
```

Echo: `Delegate run started. State: $STATE`

## Phase 1: Plan

Adopt the Planner persona from `roles/planner.md`.

Produce subtasks JSON. Assign each subtask an executor by cycling through `executor_targets` round-robin (e1 → targets[0], e2 → targets[1], e3 → targets[0], ...).

Your output must be valid JSON matching this schema exactly:
```json
{
  "version": 1,
  "subtasks": [
    {
      "id": "e1",
      "title": "brief title ≤60 chars",
      "prompt": "Full executor prompt. Include: what to do, which files to touch, current state, expected outcome, how to verify. Write as if the executor has never seen this codebase.",
      "files": ["src/path/to/file.ts"],
      "assigned_executor": {"cli": "agy", "model": "gemini-3.8-flash", "effort": "low"}
    }
  ]
}
```

If your output is not valid JSON: prepend "Output ONLY valid JSON, no prose, no code fences." and retry once. If still invalid: abort — `ERROR: Planner failed to produce valid JSON. State: $STATE`.

Update state:
```bash
python3 -c "
import json, sys
s = json.load(open('$STATE'))
s['plan'] = json.loads(sys.argv[1])
json.dump(s, open('$STATE', 'w'), indent=2)
" '<your plan JSON>'
```

## Phase 2: Critique Loop

Initialize loop counter to 0.

**If `critic` is `self`:** Adopt the Critic persona from `roles/critic.md`. Produce critique JSON inline.

**If `critic` is `claude`:**
```bash
PLAN=$(python3 -c "import json; print(json.dumps(json.load(open('$STATE'))['plan']))")
TASK=$(python3 -c "import json; print(json.load(open('$STATE'))['task'])")
CRITIQUE=$(claude -p "$(cat roles/critic.md)

Task: $TASK

Plan: $PLAN" --model claude-sonnet-4-6 2>&1)
```

**If `critic` is `codex`:**
```bash
PLAN=$(python3 -c "import json; print(json.dumps(json.load(open('$STATE'))['plan']))")
TASK=$(python3 -c "import json; print(json.load(open('$STATE'))['task'])")
CRITIQUE=$(codex exec "$(cat roles/critic.md)

Task: $TASK

Plan: $PLAN" -c model="gpt-4o-mini" 2>&1)
```

If critique JSON is malformed: retry once with "Respond with ONLY valid JSON, no prose." prepended. Still malformed → treat as `{"verdict": "fail", "issues": ["<raw output>"], "revised_plan_hints": []}`.

Rules:
- `verdict: pass` → proceed to Phase 3
- `verdict: fail` AND loop < `critique_max_loops`:
  - Increment loop counter
  - Adopt Planner persona, revise plan using `revised_plan_hints`
  - Update state with new plan
  - Run critique again
- `verdict: fail` AND loop = `critique_max_loops`:
  - Abort: `ERROR: Critique failed after 3 attempts. State: $STATE`
  - Echo all collected critique feedback

Update state after each loop:
```bash
python3 -c "
import json, sys
s = json.load(open('$STATE'))
s['critique'] = {'loop': int(sys.argv[1]), 'passed': sys.argv[2]=='pass', 'feedback': sys.argv[3]}
json.dump(s, open('$STATE', 'w'), indent=2)
" '<loop_count>' '<verdict>' '<issues summary>'
```

## Phase 3: Execute

Read `roles/executor.md` for exact CLI invocation patterns.

Fire each subtask using its `assigned_executor`. Respect `executor_concurrency` — run at most N processes at once.

```bash
CONCURRENCY=3  # from config
PIDS=()
IDS=()
BATCH=0

for subtask in <subtasks from state>; do
  ID=<subtask.id>
  CLI=<subtask.assigned_executor.cli>
  MODEL=<subtask.assigned_executor.model>
  EFFORT=<subtask.assigned_executor.effort>  # only for agy
  PROMPT=<subtask.prompt>
  OUT="$SCRATCHPAD/exec-$ID.txt"
  EXIT_FILE="$SCRATCHPAD/exit-$ID.txt"

  # Build command per roles/executor.md, background it with timeout
  (
    case "$CLI" in
      agy)    echo "$PROMPT" | agy --model "$MODEL" --effort "$EFFORT" > "$OUT" 2>&1 ;;
      codex)  codex exec "$PROMPT" -c model="$MODEL" > "$OUT" 2>&1 ;;
      claude) claude -p "$PROMPT" --model "$MODEL" > "$OUT" 2>&1 ;;
    esac
    echo $? > "$EXIT_FILE"
  ) &
  PIDS+=($!)
  IDS+=($ID)
  BATCH=$((BATCH + 1))

  if [ $BATCH -ge $CONCURRENCY ]; then
    wait "${PIDS[@]}"
    PIDS=()
    IDS=()
    BATCH=0
  fi
done

# Wait for remaining
[ ${#PIDS[@]} -gt 0 ] && wait "${PIDS[@]}"
```

Note: the 5-minute timeout is enforced by executor_targets config. For longer-running tasks, kill stalled processes manually.

After all complete, read outputs and update state:
```bash
python3 - <<'EOF'
import json, os
state_path = os.environ['STATE']
scratchpad = os.environ['SCRATCHPAD']
s = json.load(open(state_path))
executions = []
for subtask in s['plan']['subtasks']:
    eid = subtask['id']
    out_file = f"{scratchpad}/exec-{eid}.txt"
    exit_file = f"{scratchpad}/exit-{eid}.txt"
    output = open(out_file).read() if os.path.exists(out_file) else ""
    exit_code = int(open(exit_file).read().strip()) if os.path.exists(exit_file) else -1
    status = "done" if exit_code == 0 else ("timeout" if exit_code == -1 else "error")
    executions.append({
        "id": eid,
        "status": status,
        "output": output[:4000],  # truncate very long outputs
        "exit_code": exit_code,
        "executor": subtask["assigned_executor"]
    })
s['executions'] = executions
json.dump(s, open(state_path, 'w'), indent=2)
EOF
```

## Phase 4: Review Loop

Initialize loop counter to 0.

**If `reviewer` is `self`:** Adopt the Reviewer persona from `roles/reviewer.md`. Produce review JSON inline.

**If `reviewer` is `claude`:**
```bash
EXECUTIONS=$(python3 -c "import json; print(json.dumps(json.load(open('$STATE'))['executions']))")
TASK=$(python3 -c "import json; print(json.load(open('$STATE'))['task'])")
REVIEW=$(claude -p "$(cat roles/reviewer.md)

Task: $TASK

Execution results: $EXECUTIONS" --model claude-sonnet-4-6 2>&1)
```

**If `reviewer` is `codex`:**
```bash
EXECUTIONS=$(python3 -c "import json; print(json.dumps(json.load(open('$STATE'))['executions']))")
TASK=$(python3 -c "import json; print(json.load(open('$STATE'))['task'])")
REVIEW=$(codex exec "$(cat roles/reviewer.md)

Task: $TASK

Execution results: $EXECUTIONS" -c model="gpt-4o-mini" 2>&1)
```

If review JSON is malformed: retry once. Still malformed → treat as `{"verdict": "fail", "failures": [{"subtask_id": "all", "reason": "<raw output>"}], "summary": ""}`.

Rules:
- `verdict: pass` → echo `SUCCESS: <summary>` and `State: $STATE`. Done.
- `verdict: fail` AND loop < `review_max_loops`:
  - Increment loop counter
  - Adopt Planner persona, re-plan using original task + execution outputs + reviewer feedback
  - Update state with new plan (reset executions to [])
  - Re-run Phase 3, then Phase 4
- `verdict: fail` AND loop = `review_max_loops`:
  - Echo `PARTIAL RESULT: <summary of what succeeded>`
  - Echo `REVIEW DIAGNOSIS: <failures>`
  - Echo `State: $STATE`
  - Done

Update state after each loop:
```bash
python3 -c "
import json, sys
s = json.load(open('$STATE'))
s['review'] = {'loop': int(sys.argv[1]), 'passed': sys.argv[2]=='pass', 'feedback': sys.argv[3]}
json.dump(s, open('$STATE', 'w'), indent=2)
" '<loop_count>' '<verdict>' '<failures summary>'
```
