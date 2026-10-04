# Prompt: start stage 3 (canvas traffic driven by the playback store)

You are continuing the cycles / live-recording / timeline-playback work in `/Users/ankushjamdagani/personal/system-design-planner` (React + Vite + TypeScript, ReactFlow, Vitest, Playwright). Stages 1 and 2 are done and committed. Your job is **stage 3 only**: draw the canvas traffic from `PlaybackStore.stateAt`. Do not start stage 4 (timeline, playback controls, results as of the playhead).

## Read first, in this order
1. `docs/superpowers/resume-prompt.md`: workflow rules, standing user rules, design decisions already made, how to verify. Follow it.
2. `AGENTS.md`, `HANDOFF.md`, `LESSONS.md`, and the tail of `ACTION_LOG.md` (stage 2 entry has the known limitations).
3. `docs/superpowers/specs/2026-10-04-cycle-playback-design.md`: section 5 ("Traffic states on the canvas") and section 9 (stage 3) are your requirements.
4. `docs/superpowers/plans/2026-10-04-cycles-recording-worker.md`: how stage 2 was planned; copy its format for your plan.
5. Code you will touch: `src/features/runs/playback.ts` (the store and `stateAt`), `src/features/runs/RunController.ts` (`getPlayback()`, `subscribeFlow`), `src/features/workspace/CanvasView.tsx`, `TrafficEdge.tsx`, `livePackets.tsx` (the stage-0 packet queue you replace), `NodeCard.tsx` (and `nodeVisuals.ts`), `src/styles.css` (`traffic-flow` keyframes), `tests/studio-run-pace.spec.ts` (packet and grid specs).

## What exists now (do not rebuild it)
- The worker is throttled by the playhead and posts flow records, finished cycles and checkpoints; `RunController` owns a `PlaybackStore` per timed run (`controller.getPlayback()`), moves its playhead, and releases flow records to `subscribeFlow` only as the playhead passes them.
- `PlaybackStore.stateAt(ms)` already returns: `legs` (`{key, connectionId, direction: 'out'|'back', progress 0..1}` for requests in transit), `nodes` (element id to `{queued, active}`), `cycles` (`{started, finished}`) and the newest `checkpoint`. It scans the retained records on each call.
- The canvas still draws the old stage-0 packets (`livePackets.tsx`: a per-packet stage queue with minimum display times, sampled to 2 per connection) fed by `subscribeFlow`. That is what you replace.

## Stage 3 scope (from spec section 5)
1. **Connections show transit only.** One packet per request in transit, positioned by `legs[].progress` along the connection path, heading reversed for `direction: 'back'`. No stage labels on the line, no minimum display times, no sampling.
2. **Density.** Up to 6 packets in transit on a connection (a named constant, `PACKET_THRESHOLD = 6`): each is its own packet. Above it, switch that connection to a labelled aggregate: a count badge ("412 in flight"), a flow animation whose density follows the load, and a split between outgoing and returning. Clicking a connection lists its units at the playhead (`legs` filtered by `connectionId`).
3. **Nodes show waiting and work.** From `stateAt(...).nodes`: a queue-depth bar for `queued` and an active ring or pulse with the count for `active`, on the node card. Foundation-first: put the primitive in `src/components/ui/` or the existing node visual helpers, not ad hoc in feature code.
4. **Brief marks at the ends** (sent pulse at the source, arrival tick, outcome flash) are in the spec; do them only if they fall out of `flowBetween` cheaply. If you defer them, say so in `ACTION_LOG.md`.
5. **Reduced motion:** static markers carrying the same information (counts and positions without animation).
6. **Driving it:** a hook (for example `usePlaybackState`) that reads the controller's store and recomputes `stateAt(playheadMs)` on each animation frame while a run plays, and renders nothing when there is no run. Rendering must not depend on `subscribeFlow` any more; once nothing else uses it, remove `subscribeFlow` from `RunController` and delete `livePackets.tsx`.
7. **Performance:** `stateAt` scans all retained records. Measure it at S06's flash-sale load (about 600 requests/s, 120 s of history). If a frame costs more than a few milliseconds, add an index in `PlaybackStore` (records grouped per key, a moving cursor for the playhead) and keep the same `stateAt` contract and tests. Do not optimise before measuring.

## Out of scope
The timeline track, cycle bands, speed/seek/step/loop controls, "go to live edge", results as of the playhead, the final scenario editor. Also the floating connection bar (user deferred it).

## How to work
- Use the `superpowers:writing-plans` skill to write `docs/superpowers/plans/<date>-cycles-canvas-traffic.md` (bite-sized tasks, tests first, exact commands), commit it, then execute it inline in order. Follow the user's rule: write the plan from reading the code, not from memory.
- Test first where a unit can be tested (the density switch and packet placement are pure functions of `stateAt`: extract them and unit-test them). Browser specs go in `tests/studio-run-pace.spec.ts` (replace the old stage-label packet spec; the old stages `sent/transit/received/returning/delivered` no longer exist on the line).
- Verify as in the resume prompt: `npx tsc -b`, `npm test`, `npm run build` (Workspace chunk is 494.69 kB, limit 500 kB, so watch it: lazy-load or split anything large), then the isolated production Playwright suite with `TEST_PRODUCTION=1` and a config file inside the repo (delete it afterwards). `tests/studio-authoring.spec.ts` connect-gesture tests flake about 1 run in 2 on older commits too.
- When done: update `ACTION_LOG.md` (real numbers, limitations, a `Lesson:` line if something surprised you), `HANDOFF.md` (stage 3 done, stage 4 open), add decision D58 to `specs/revamp/decisions.md`, commit with the trailer `Co-Authored-By: <your model name> <noreply@anthropic.com>`, then tell the user in a few plain sentences what changed and what stage 4 is.

## Standing rules (repeat of the important ones)
- Terse "caveman" chat replies; code, commits and docs normal.
- No backward compatibility needed; ask before preserving it.
- Never claim a check passed if it was skipped or blocked.
