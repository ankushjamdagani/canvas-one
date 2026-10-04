# Resume prompt (paste into any coding model that picks this work up)

You are continuing work on a React + Vite + TypeScript system-design studio (Dexie, ReactFlow, Vitest, Playwright) in `/Users/ankushjamdagani/personal/system-design-planner`. A previous model ran out of context mid-task. Do not start over and do not redesign.

## Read first, in this order
1. `AGENTS.md` (also `CLAUDE.md`): the workflow rules, including the ACTION_LOG and LESSONS requirements. Follow them.
2. `HANDOFF.md`: current state, invariants, open debt.
3. `LESSONS.md`: rules learned from past failures. Cite a rule when it changes your approach.
4. `docs/superpowers/specs/2026-10-04-cycle-playback-design.md`: the approved design (cycles, live recording, timeline playback). It has 4 stages.
5. The plan file for the stage in progress under `docs/superpowers/plans/` (stage 1: `2026-10-04-cycles-domain-kernel.md`; later stages have their own file, newest date last).
6. The tail of `ACTION_LOG.md`: what was last finished and the known limitations.

## Where the work stands
Run `git log --oneline | head -15` and `git status`. The last commit message names the last finished step. Stage 1 (domain and kernel) is done. Stages 2 to 4 follow the spec in order: 2 = worker lookahead, history window, checkpoints, remove run pace; 3 = canvas packets driven by the playback store; 4 = timeline, playback controls, results as of the playhead, final scenario editor. If the plan file for the current stage has unchecked steps, continue from the first unchecked one; if a step is half done in the working tree, finish it rather than redoing it.

## Standing rules from the user
- Terse chat replies ("caveman" style); code, commits and docs are written normally.
- No backward compatibility is needed (the product is not live). If you think compatibility is required for a change, ASK before preserving it.
- Do the next stage only when told to. Do not invent milestones beyond the request.
- Commit trailer: `Co-Authored-By: <your model name> <noreply@anthropic.com>`.
- Never claim a check passed if it was skipped or blocked. Report failures with their output.

## Design decisions already made (do not reopen)
- Time stays in the model (latency, queues, timeouts, faults) but is never a run setting.
- A source is a bulk (N requests, instant / evenly over D / ramping) or a stream (a rate, until Stop), with a start delay.
- A cycle is one request and everything it causes; it completes when the last descendant has settled; results report response latency and completion latency.
- The worker computes ahead of the playhead (lookahead about 30 s of simulated time), keeps about 120 s of history for streams, and writes a running-summary checkpoint about every 5 s of simulated time. Results are shown as of the playhead.
- Stop ends emission and drains; Pause freezes the playhead and the worker's lookahead.
- Connections show transit only; nodes show queued and processing; up to 6 packets in transit per connection are drawn individually, above that an aggregate.

## How to verify (run what fits the change)
```bash
npx tsc -b                       # never `tsc --noEmit -p .`
npm test                         # src/**/*.test.ts only
npm run build                    # Workspace chunk must stay under 500 kB
# browser suite: copy a throwaway config INTO the repo, isolated port, then delete it
TEST_PRODUCTION=1 npx playwright test -c pw-iso.tmp.config.ts
```
The throwaway config: `testDir ./tests`, `workers: 2`, `retries: 0`, a free port, `webServer: npx vite preview --host 127.0.0.1 --port <port>` with `reuseExistingServer: false`. Browser tests choose ×16 through the visible playback control using `tests/fixtures.ts`; there is no hidden speed override. Run `npm run build` first so the preview serves fresh code. `tests/studio-authoring.spec.ts` connect-gesture tests flake about 1 run in 2 on the previous commits too; rerun them alone before blaming your change.

## When you finish a step
Append a short entry to `ACTION_LOG.md` (outcome, files, verification numbers, limitations, a `Lesson:` line if something surprised you), commit, and tell the user in a few plain sentences what changed and what is next.
