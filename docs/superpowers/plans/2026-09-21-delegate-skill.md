# Delegate Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a platform-agnostic `/delegate` skill that orchestrates tasks through planner → critic → parallel executors → reviewer, with executors running via `agy`, `codex`, or `claude` CLIs.

**Architecture:** Five markdown files in `.agents/skills/delegate/`. `SKILL.md` is the workflow entrypoint — the invoking model reads it and follows each phase using its Bash tool. Role files (`planner.md`, `critic.md`, `reviewer.md`, `executor.md`) contain persona prompts and exact CLI invocations. `.claude/skills/delegate` symlinks to `.agents/skills/delegate` so Claude Code resolves it as a skill.

**Tech Stack:** Bash (for executor shell-outs), Markdown (skill + role files), JSON (state file + role output schemas). No npm dependencies.

## Global Constraints

- All file paths relative to repo root unless stated otherwise
- agy model flag: `--model <name> --effort <low|medium|high>` — both required
- agy model names: `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash` (not API names)
- claude non-interactive flag: `-p` (not `--print`)
- codex non-interactive subcommand: `codex exec`
- State file lives in OS temp: `${TMPDIR:-/tmp}/delegate-<unix-timestamp>/state.json`
- Executor output files: `${TMPDIR:-/tmp}/delegate-<unix-timestamp>/exec-<id>.txt`
- No unit test framework — verification is file structure checks + smoke invocation

---

### Task 1: Directory scaffold and platform symlink

**Files:**
- Create: `.agents/skills/delegate/` (directory)
- Create: `.agents/skills/delegate/roles/` (directory)
- Create: `.claude/skills/delegate` → symlink to `../../.agents/skills/delegate`

- [ ] **Step 1: Create the skill directories**

```bash
mkdir -p .agents/skills/delegate/roles
```

- [ ] **Step 2: Create the Claude Code symlink**

```bash
ln -s ../../.agents/skills/delegate .claude/skills/delegate
```

- [ ] **Step 3: Verify symlink resolves**

```bash
ls -la .claude/skills/delegate
```

Expected output: `... .claude/skills/delegate -> ../../.agents/skills/delegate`

```bash
ls .claude/skills/delegate/
```

Expected output: `roles/` (empty for now, no error)

---

### Task 2: SKILL.md — workflow entrypoint

**Files:**
- Create: `.agents/skills/delegate/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

```markdown
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
```

- [ ] **Step 2: Verify SKILL.md YAML frontmatter is valid**

```bash
python3 -c "
import re, sys
content = open('.agents/skills/delegate/SKILL.md').read()
fm = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
if not fm: sys.exit('ERROR: no frontmatter')
import yaml
cfg = yaml.safe_load(fm.group(1))
assert cfg.get('name') == 'delegate', 'missing name'
assert 'config' in cfg, 'missing config'
print('YAML frontmatter: OK')
print('Config keys:', list(cfg['config'].keys()))
"
```

Expected output:
```
YAML frontmatter: OK
Config keys: ['critic', 'reviewer', 'critique_max_loops', 'review_max_loops', 'executor_targets', 'executor_concurrency']
```

Note: install `pyyaml` if needed: `pip3 install pyyaml --quiet`

---

### Task 3: roles/planner.md and roles/critic.md

**Files:**
- Create: `.agents/skills/delegate/roles/planner.md`
- Create: `.agents/skills/delegate/roles/critic.md`

- [ ] **Step 1: Write roles/planner.md**

```markdown
# Planner Role

You decompose a task into independent, parallelizable subtasks for executor agents.

## Rules

- Each subtask must be independently executable — no subtask may depend on another subtask's output
- Each subtask prompt must be fully self-contained: include the task description, relevant file paths, current state, and expected outcome. The executor has zero conversation history.
- Include how the executor should verify its own work
- Subtask count must not exceed `executor_concurrency` from config
- Assign executors round-robin from `executor_targets`

## Output

Output ONLY a valid JSON object. No prose. No markdown fences. No explanation. Just the JSON:

{
  "version": 1,
  "subtasks": [
    {
      "id": "e1",
      "title": "brief title, 60 chars max",
      "prompt": "Full self-contained executor prompt. What to do, which files to touch, current behavior, expected outcome, how to verify.",
      "files": ["src/path/to/file.ts"],
      "assigned_executor": {"cli": "agy", "model": "gemini-3.8-flash", "effort": "low"}
    }
  ]
}
```

- [ ] **Step 2: Write roles/critic.md**

```markdown
# Critic Role

You challenge plans adversarially before executors run. A bad plan wastes more time than a revision.

## Challenge Every Plan On These Axes

1. **Independence**: Can each subtask run without any other subtask's output? If e2 needs e1's result, they cannot run in parallel — that is a fatal flaw.
2. **Context completeness**: Does each prompt contain everything an executor with zero conversation history needs? Missing file paths, missing current behavior, or vague instructions are fatal flaws.
3. **Coverage**: Does the combined set of subtasks actually complete the original task? Missing steps are fatal flaws.
4. **Executor fit**: Is each subtask scoped to what one AI agent can do in a single run?
5. **Scope creep**: Does any subtask do more than asked? Scope creep is a flaw.

## Output

Output ONLY a valid JSON object. No prose. No markdown fences. No explanation. Just the JSON:

{
  "verdict": "pass",
  "issues": [
    "e2 prompt references output from e1 — these subtasks are not independent"
  ],
  "revised_plan_hints": [
    "Merge e1 and e2 into a single subtask since e2 depends on e1's result"
  ]
}

Set "verdict" to "pass" only when the plan is genuinely ready to execute.
Set "verdict" to "fail" when any issue is fatal (would cause an executor to fail or produce wrong output).
issues and revised_plan_hints must be parallel arrays — one hint per issue.
```

- [ ] **Step 3: Verify both files exist**

```bash
ls -la .agents/skills/delegate/roles/planner.md .agents/skills/delegate/roles/critic.md
```

Expected: both files listed with non-zero size.

---

### Task 4: roles/reviewer.md and roles/executor.md

**Files:**
- Create: `.agents/skills/delegate/roles/reviewer.md`
- Create: `.agents/skills/delegate/roles/executor.md`

- [ ] **Step 1: Write roles/reviewer.md**

```markdown
# Reviewer Role

You verify that executor outputs collectively complete the original task.

## Check Every Execution On These Axes

1. **Exit codes**: Any non-zero exit code is a failure unless the subtask prompt explicitly expected one.
2. **Completion**: Do the outputs demonstrate that the task is done? Partial work is a failure.
3. **Correctness**: Did each executor follow its subtask prompt? Unexpected output is a failure.
4. **Regressions**: Does any output suggest something outside the task scope was broken?

## Output

Output ONLY a valid JSON object. No prose. No markdown fences. No explanation. Just the JSON:

{
  "verdict": "pass",
  "failures": [
    {"subtask_id": "e2", "reason": "exit_code 1: cannot find module 'src/cache'"}
  ],
  "summary": "Added retry logic to cache layer with 3 attempts and exponential backoff"
}

Set "verdict" to "pass" only when all subtasks succeeded and the task is demonstrably complete.
Set "verdict" to "fail" for any exit code != 0, empty output, or incomplete result.
"summary" should describe what was accomplished even on failure.
```

- [ ] **Step 2: Write roles/executor.md**

```markdown
# Executor Invocation Patterns

Exact Bash commands for each CLI. Use these in Phase 3 of SKILL.md.

## agy (Gemini models)

```bash
echo "<prompt>" | agy --model <model> --effort <effort> > <scratchpad>/exec-<id>.txt 2>&1
echo $? > <scratchpad>/exit-<id>.txt
```

Valid model names (use exact strings):
- `gemini-3.8-flash` (latest, recommended)
- `gemini-3.7-flash`
- `gemini-3.6-flash`

Valid effort values: `low`, `medium`, `high`
Default: `gemini-3.8-flash` with `effort: low`

## codex (GPT models)

```bash
codex exec "<prompt>" -c model="<model>" > <scratchpad>/exec-<id>.txt 2>&1
echo $? > <scratchpad>/exit-<id>.txt
```

Model examples: `gpt-4o-mini`, `gpt-4o`, `o3`

## claude (Claude models)

```bash
claude -p "<prompt>" --model <model> > <scratchpad>/exec-<id>.txt 2>&1
echo $? > <scratchpad>/exit-<id>.txt
```

Model examples: `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`

## Embedding context for codex and claude

codex and claude do not support a `--context` flag. Embed context inline:

```
Repository context: <one-paragraph summary of the relevant codebase area>
Relevant files: <comma-separated list>

Task: <subtask prompt>
```

Keep embedded context under 2000 characters.

## Timeout enforcement

Wrap each executor in a background subshell with a 300-second kill:

```bash
(
  <executor command> &
  EXEC_PID=$!
  (sleep 300 && kill $EXEC_PID 2>/dev/null) &
  TIMER_PID=$!
  wait $EXEC_PID
  EXIT_CODE=$?
  kill $TIMER_PID 2>/dev/null
  [ $EXIT_CODE -eq 0 ] && echo 0 || echo $EXIT_CODE
) > <scratchpad>/exec-<id>.txt 2>&1
echo $? > <scratchpad>/exit-<id>.txt
```
```

- [ ] **Step 3: Verify all role files exist**

```bash
ls -la .agents/skills/delegate/roles/
```

Expected output: four files — `critic.md`, `executor.md`, `planner.md`, `reviewer.md`

---

### Task 5: Smoke test

**Goal:** Verify the skill resolves and the Phase 0 startup check runs without errors.

- [ ] **Step 1: Verify full skill tree**

```bash
find .agents/skills/delegate -type f | sort
```

Expected:
```
.agents/skills/delegate/SKILL.md
.agents/skills/delegate/roles/critic.md
.agents/skills/delegate/roles/executor.md
.agents/skills/delegate/roles/planner.md
.agents/skills/delegate/roles/reviewer.md
```

- [ ] **Step 2: Verify symlink resolves to all files**

```bash
find .claude/skills/delegate -type f | sort
```

Expected: same four files as above (resolved through symlink).

- [ ] **Step 3: Verify CLI availability**

```bash
which agy && echo "agy ready" || echo "WARNING: agy missing"
which codex && echo "codex ready" || echo "WARNING: codex missing"
which claude && echo "claude ready" || echo "WARNING: claude missing"
```

Expected: at least one executor CLI is ready.

- [ ] **Step 4: Invoke the skill with a trivial task**

In Claude Code, run:
```
/delegate "List all TypeScript files in src/ — just output the file paths"
```

Verify the model:
1. Reads all four role files (Phase 0)
2. Echoes `Delegate run started. State: /tmp/delegate-<ts>/state.json`
3. Produces a plan JSON with 1 subtask (Phase 1)
4. Runs critique and echoes `verdict: pass` (Phase 2)
5. Shells out to one executor and captures output (Phase 3)
6. Echoes `SUCCESS:` with the file list (Phase 4)

If Phase 3 executor output is empty or errors, check that `$SCRATCHPAD/exec-e1.txt` exists and read its contents for the error.
