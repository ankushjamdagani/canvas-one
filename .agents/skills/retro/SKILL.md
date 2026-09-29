---
name: retro
description: Consolidate lessons from ACTION_LOG.md into LESSONS.md — add rules from repeated failures and corrections, merge duplicates, prune stale rules. Use when the user says "retro", "consolidate lessons", or periodically after several sessions.
---

# Retro

Turn recent history into rules future sessions will follow. `ACTION_LOG.md` is history, `LESSONS.md` is rules; this skill moves signal from one to the other.

## Steps

1. **Find the range.** Locate the last `### Retro` entry in `ACTION_LOG.md`. Scan only entries after it (all entries if none exist). Also run `git log --oneline` for the same dates.
2. **Collect signal.** From that range, pull out:
   - `Lesson:` lines
   - failures, blocked checks, retries, timeouts
   - corrections ("corrected", "was wrong", "status correction", reviewer REVISE findings)
   - user redirections recorded in outcomes
3. **Decide per item.** It becomes a rule only if it would change what a future agent *does*. Prefer items seen ≥2 times or ones that cost a whole session. Skip one-off product facts, current state (that belongs in `HANDOFF.md`) and anything already covered.
4. **Review existing rules.** For each rule in `LESSONS.md`: is it contradicted, obsolete (tool fixed, invariant changed) or duplicated? Mark it for replace, delete or merge.
5. **Propose, don't write.** Show the user a diff-style proposal: `+ add`, `~ edit`, `- delete`, each with its source date. Wait for approval.
6. **Apply.** Edit `LESSONS.md` in its format (imperative rule, `Why:` with date, grouped by section). Stay at or under 50 rules.
7. **Mark.** Append to `ACTION_LOG.md` under today's date:

   ```
   ### Retro (<platform>)
   - **Range**: <first date> → <last date>, <n> entries
   - **Changed**: LESSONS.md +a ~e -d (now <total> rules)
   ```

## Rules

- Never delete or rewrite `ACTION_LOG.md` history; only append the marker.
- Keep rules concrete: name the command, file or check. "Be careful with X" is not a rule.
- When unsure whether something generalizes, leave it out. A short list that gets followed beats a long one that gets skimmed.
