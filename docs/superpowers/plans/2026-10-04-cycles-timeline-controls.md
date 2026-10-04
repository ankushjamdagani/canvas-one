# Cycles: Timeline and Controls (Stage 4) Implementation Plan

> **For agentic workers:** Execute task by task with the repository delegate workflow. Stage 3 is complete; keep the floating connection bar and recording persistence out of scope.

**Goal:** Make the retained recording scrubbable, with cycle bands, video-style controls and truthful results at the playhead.

**Architecture:** PlaybackStore owns interpretation, cycle revisions, timeline bounds, and historical summaries. RunController owns seek/play/pause/replay and worker lookahead. A lazy PlaybackPanel composes the existing ResultsRegion and a compact timeline using foundation controls; Workspace only supplies context and restart. Finished recordings stay in memory until reset/restart; reload does not restore them.

**Tech Stack:** React, TypeScript, ReactFlow, Vitest, Playwright.

### 1. Recording and playback runtime
- [ ] Record cycle start/response/completion revisions without duplicating cycle counts or leaking finished stream cycles. Keep future response/completion/outcomes hidden when reading earlier times.
- [ ] Extend PlaybackStore with `cyclesAt(t)`, `resultsAt(t)` and `cycleStep(t, direction)`. Results include root/message counts, cycle outcomes/latencies and element metrics; retain a baseline at eviction. Record sufficient timestamped changes to avoid displaying future or checkpoint-only values as current measurements.
- [ ] Add controller `seek(ms)`, `stepCycle(-1|1)`, `goLive()`, `setLoop(boolean)`, `getLoop()` and replay via play/pause after completion. Seeking pauses playback and reports the playhead. Stop resumes a paused recording and drains; completion persists once, replay does not persist again. Loop only finished bulks. Preserve logical runs and Run all.
- [ ] Replace `setSpeed/getSpeed` with `setPlaybackSpeed/getPlaybackSpeed` (finite supported multipliers 0.25, 0.5, 1, 2, 4, 8, 16; default 1). Remove `studio.runSpeed` and Instant behavior. Tests use the actual speed control or explicit controller API. No compatibility aliases.
- [ ] Unit tests: seek bounds, cycle steps/revisions, checkpoint plus changes, results before first checkpoint and backward reads, stream eviction baseline, pause/Stop, replay/loop, persistence once, completion at the edge.

### 2. Timeline and results UI
- [ ] Create pure timeline layout helpers/tests: full retained time axis, response marks, completed/open bands with outcome only when known, bulk density above 200 cycles, fault windows and stuck regions, and computed-edge indicator.
- [ ] Create a compact lazy `src/features/runs/PlaybackPanel.tsx` and timeline component using existing Button, Select, Tooltip and checkbox/range primitives. Show Play/Pause, seeker, speed, previous/next cycle, bulk Loop, stream Go live, Stop and Restart. Include waiting/computing/draining/finished states; keyboard controls and phone layout must work.
- [ ] Route ResultsRegion through playhead summaries and time, hiding final checks and whole-run-only values before the end. Logical and saved results retain their existing behavior. Show cycle outcomes plus response/completion latencies. Canvas and results use the same playhead; seeking does not invent trace data.
- [ ] Audit the scenario editor against section 6.3; retain per-source fields already shipped, remove any residual completion/pace/horizon fields. Avoid redesign.
- [ ] Port the old hidden-speed Playwright setup to the visible playback control. Add browser checks for bands/density, pause/seek/speed, changing Results when seeking back, final replay, stream Stop/Go live, keyboard and mobile controls.

### 3. Verify and finish
- [ ] Run `npx tsc -b`, `npm test`, `npm run build`, and foundation Storybook when changed. Workspace and other production chunks stay below 500 kB; use `lazyComponent`, not React.lazy/Suspense (LESSONS).
- [ ] Build first, then full production Playwright on an isolated port, two workers/no retries. Rerun authoring connect flakes alone; remove temporary config. Inspect desktop/mobile screenshots and keyboard behavior.
- [ ] Independent review; inspect all diffs. Update ACTION_LOG, HANDOFF, D59 and relevant contracts. Mark the plan complete and commit with `Co-Authored-By: GPT-6.1 <noreply@anthropic.com>`.

Defaults: speed starts at 1 unless changed through the visible control; no hidden storage override. Cycle-density threshold is 200. Replay is in-memory; no new persisted recording format or old-run compatibility.
