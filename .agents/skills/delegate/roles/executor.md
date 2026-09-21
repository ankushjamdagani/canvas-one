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

Models by cost tier:
- Light: `gpt-5.6-luna`, `gpt-5.5`
- Medium: `gpt-5.6-terra`
- Heavy: `gpt-5.6-sol`

## claude (Claude models)

```bash
claude -p "<prompt>" --model <model> > <scratchpad>/exec-<id>.txt 2>&1
echo $? > <scratchpad>/exit-<id>.txt
```

Models by cost tier:
- Light: `claude-haiku-4-5-20251001`
- Medium: `claude-sonnet-4-6`
- Heavy: `claude-opus-4-8`

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
