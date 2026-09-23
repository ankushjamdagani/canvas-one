# CLI Invocation (executors, CLI critic, CLI reviewer)

Every headless agent runs through `scripts/run-agent.sh`; never call a CLI directly:

```bash
scripts/run-agent.sh <prefix> <timeout_sec> <cli> <model> [effort] -- [extra args...]
```

It reads the prompt from `<prefix>.in`, writes full `<prefix>.out` / `<prefix>.err`, and writes `<prefix>.exit` last (`124` = timed out). Extra args come from the target's `args`.

## Commands the wrapper builds

| cli | command | default model |
| :-- | :-- | :-- |
| agy | `agy --print="<prompt>" --model <model> [--effort <effort>] <args>` | `gemini-3.8-flash-low` |
| codex | `codex exec -c model="<model>" <args> - < <prefix>.in` | `gpt-5.6-terra` |
| claude | `claude -p --model <model> <args> < <prefix>.in` | `claude-sonnet-4-6` |

Models:
- agy: the tier is part of the model ID (`agy models`): `gemini-3.8-flash-{low,medium,high}`, `gemini-3.7-flash-*`, `gemini-3.1-pro-{low,high}`. `effort` is optional.
- codex: light `gpt-5.6-luna`, `gpt-5.5`; medium `gpt-5.6-terra`; heavy `gpt-5.6-sol`.
- claude: light `claude-haiku-4-5-20251001`; medium `claude-sonnet-4-6`; heavy `claude-opus-4-8`.

codex and claude are quota-limited (`scarce_clis`); agy is the default workhorse. See Token budget in `SKILL.md`.

## Permissions (`args`)

Headless runs cannot answer prompts, so a missing permission often yields exit 0 with a refusal. `collect` marks that `failed`; grant what the role needs up front:

| need | agy | codex | claude |
| :-- | :-- | :-- | :-- |
| edit files | `--mode accept-edits` | `--sandbox workspace-write` | `--permission-mode acceptEdits` |
| run commands | no per-command flag | `--sandbox workspace-write` | `--allowedTools "Bash(npm test:*)"` |
| extra directories | `--add-dir <dir>` | `--add-dir <dir>` | `--add-dir <dir>` |

Critic and reviewer targets stay read-only (no edit flags). Blanket bypass flags (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`) need explicit user approval.

## Prompt context

Executors have no conversation history. Every prompt must embed:

```
Repository: <absolute repo path>. Context: <one-paragraph summary of the relevant area>
Relevant files: <comma-separated list>

Task: <subtask prompt>
```

Keep embedded context under 2000 characters. `dispatch` appends the `DELEGATE_STATUS` footer; do not add your own.
