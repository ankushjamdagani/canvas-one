# Agent Workflow for Complex Tasks

**Date:** 2026-09-23
**Status:** Draft — deferred. Captured for a future session; nothing here is adopted yet. `AGENTS.md` remains authoritative until this is approved.

---

## Problem

Large initiatives stall in the docs phase. Evidence from this repo:

| Period | Commits | Output | Planning shape |
|---|---|---|---|
| 2026-09-06 → 09-17 | ~50 | Features shipped (templates, organization, export, custom components, canvas-first UI) | `plans/<feature>.md` (19–78 lines) → build → `plans/<feature>-result.md` |
| 2026-09-19 → 09-23 | ~20 | Docs only; zero revamp code | `specs/revamp/`: 24 files (~2,000 lines after consolidating from 127), D01–D30, RV-00…RV-16 with sub-steps, 3-model protocol, 4+ review rounds, self-imposed implementation hold |

Root causes:

1. **Whole-initiative design before first contact with code.** Each review finds gaps, contracts grow, the next review finds more. Only running code ends that cycle.
2. **Coordination protocol sized ahead of need.** Lanes, integration slots, ledger, preflight rehearsal and lead/reviewer/implementer roles were designed before any parallel work existed.
3. **Overlapping process kits.** superpowers, agent-skills, engineering plugin and the local `/delegate` each define plan/spec/review steps; ~10 design-taste skills overlap. Each session can pick a different "process", so work re-plans.
4. **Context bloat.** `ACTION_LOG.md` (~119 KB) and `HANDOFF.md` (~24 KB) are mostly history, loaded or skimmed every session.

Goal: one repeatable workflow for future complex tasks that keeps the good parts (specs, independent review, verification, logs) and removes the loop.

---

## Proposed workflow: thin-slice loop

### Levels

| Level | Size | Artifact |
|---|---|---|
| Initiative | weeks | `specs/<initiative>/brief.md` (≤1 page) + `slices.md` (ordered checklist) |
| Slice | 1–2 days, vertical, visible | `plans/<slice>.md` (≤60 lines) + `plans/<slice>-result.md` |
| Task | one session, one commit | step inside the slice plan |

### Loop

0. **Shape initiative** (one session). Brief: goal, in/out, top 3–5 risks, slice list ordered riskiest/most-learning first. Open questions are listed, not resolved. Skill: brainstorming or grilling.
1. **Plan slice.** Files, steps, acceptance checks (commands + expected observation). Contracts only for what the slice touches. Skill: writing-plans.
2. **Build.** One session, one agent. TDD for domain/simulation logic. Commit per task. Unknowns → throwaway spike (`prototype`, ≤2h) instead of more spec.
3. **Verify.** `npm test`, `npm run build`, `TEST_PRODUCTION=1 npm run test:e2e`, preview screenshot. Skill: verification-before-completion.
4. **Review.** One independent pass, preferably a different model. One fix round; leftovers go to backlog.
5. **Close** (~10 min). Result doc (shipped, deviations, follow-ups), update handoff state, short log entry. Retro: amend the brief only where reality contradicted it; re-order remaining slices.

### Stop rules

| Rule | Trigger |
|---|---|
| Planning ≤ ~20% of slice time | A doc over one page with no code yet → stop and build or spike |
| Max 2 review rounds on any plan | Round 3 is speculation; code answers |
| Every slice changes something observable (UI, test, run output) | Otherwise merge it into a slice that does |
| Gates must be executable | "Contract accepted" is not a gate; "S01 runs green" is |

---

## Agent coordination: tiered, not all-or-nothing

Open point raised by the user: multi-agent coordination is real coordination (agents share no memory), and practicing it solo has value. Agreed. The issue is not the protocol's existence but paying its full cost before parallel work exists. Coordination cost is paid in docs, and scales with the number of concurrent writers, so the protocol should scale with it too.

| Tier | When | Roles | Ceremony |
|---|---|---|---|
| T0 Solo | Default; first slices of any initiative; unstable seams | One agent builds, verifies | Slice plan + result doc |
| T1 Solo + reviewer | Any slice touching simulation accounting, persistence/export format, or shared state | One builder; different model reviews diff | + review record in result doc |
| T2 Parallel lanes | ≥3 independent tasks on disjoint files **and** stable slice plan | Lead + executors via `/delegate`, reviewer | + file ownership list, worktrees, ledger rows for active lanes only |

Rules:
- Escalate tier per slice, not per initiative.
- Protocol pieces (integration slots, preflight rehearsal, shared-file single-writer) are introduced the first time a slice needs them, and recorded in `delivery.md` then — not designed up front.
- Practicing T2 deliberately is fine; pick a slice that genuinely parallelizes (e.g. independent fixtures/runners), not the first slice.

---

## Skill cleanup (needs its own brainstorming session)

Direction only; the actual keep/remove list is to be brainstormed.

- Pick **one process kit** as the backbone. Candidate: superpowers chain — brainstorming → writing-plans → executing-plans / subagent-driven-development → test-driven-development → verification-before-completion → requesting-code-review → finishing-a-development-branch.
- Keep a small set of extras: systematic-debugging, grilling, prototype, graphify, one design skill (e.g. impeccable), `/delegate` for T2.
- Disable or remove duplicates: agent-skills plan/spec/build/review/test, engineering plan-like skills, redundant taste variants (design-taste-frontend v1/v2, taste, gpt-taste, high-end-visual-design, etc.).
- Document the chosen chain in `AGENTS.md` so every platform (Claude, Codex, agy) follows the same steps.

Questions for that session:
- Which kit maps best across all three platforms?
- Which design skill(s) survive, and for what (build vs. critique)?
- Should `/delegate` roles reuse the chosen kit's review skill?
- Global (`~/.claude/skills`) vs. project (`.agents/skills`) placement.

---

## Log and handoff structure

Open point raised by the user: split files instead of one large file. Proposal:

```
HANDOFF.md                          index, ≤60 lines: active initiatives (links), Now, Next, Blockers, verification baseline
specs/<initiative>/status.md        per-initiative handoff: current slice, state, resume steps
logs/YYYY-MM.md                     action log, one file per month (append-only)
logs/README.md                      entry format
plans/<slice>-result.md             per-slice detail (already exists as a pattern)
```

- `ACTION_LOG.md` becomes a pointer to `logs/`, or existing content moves to `logs/2026-09.md` (history preserved in git either way).
- Log entries stay short (outcome, files, platform, verification, limitations); detail lives in result docs.
- `HANDOFF.md` holds only current state; completed-milestone narratives move to the relevant result doc or initiative status.

Alternatives to decide between:
- Log per month vs. per initiative. Monthly keeps append-only simple; per-initiative groups context but splits cross-cutting work.
- `status.md` per initiative vs. sections inside `HANDOFF.md`.

`AGENTS.md` §6 needs updating when this is adopted.

---

## Applying to the revamp (when resumed)

1. Freeze `specs/revamp/` as reference; edit only when a slice proves it wrong.
2. Write `specs/revamp/slices.md` from the existing packages, ordered as vertical slices.
3. Slice 1: RV-01 foundation — Evergreen tokens + restyled shell visible in browser (low risk, T0).
4. Slice 2: RV-14a+b — S01 model-based run end to end with a visible result (highest risk, T1).
5. Continue slice by slice; introduce T2 lanes once runner and schema seams are stable.

Lifting the implementation hold remains the user's decision.

---

## Next steps

1. Brainstorm skill cleanup → keep/remove list.
2. Decide log/handoff split → migrate files, update `AGENTS.md` §5–6.
3. Add workflow section to `AGENTS.md` (tiers, stop rules, slice artifacts).
4. Pilot on revamp slice 1; revise this spec from the result.
