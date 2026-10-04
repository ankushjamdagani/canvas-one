# Cycles: Canvas Playback (Stage 3) Implementation Plan

> **For agentic workers:** Execute this plan task by task with the repository delegate workflow. Keep stage 4 out of scope.

**Goal:** Draw exact transit and node occupancy from `PlaybackStore.stateAt(playheadMs)`.

**Architecture:** One animation-frame hook reads the controller's recording and provides connection legs and node occupancy. TrafficEdge retains its smooth-step routing, places directional packets by recorded progress, and switches to an exact aggregate above six legs. Node occupancy uses a shared visual primitive. Remove the superseded flow subscription after porting its tests.

**Tech Stack:** React, TypeScript, ReactFlow, Vitest, Playwright.

### 1. Transit rendering and node occupancy
- [ ] Add pure placement/density helpers in `src/features/workspace/playbackTraffic.ts` and unit tests in `playbackTraffic.test.ts`: endpoints, halfway, reversed heading, six individual legs, seven aggregate legs, and mixed directions.
- [ ] Add a frame hook/context in `src/features/workspace/playbackTraffic.tsx` (use a distinct basename from the pure helpers), wire `CanvasView.tsx`, and consume it in `TrafficEdge.tsx` and `NodeCard.tsx`.
- [ ] Draw each leg individually up to `PACKET_THRESHOLD = 6`; above six show exact count, outbound/returning split and load-dependent flow. Selected connections list every current unit in a bounded scrollable panel. No floating connection toolbar.
- [ ] Add queue-depth bar and active ring/count in `src/components/ui/`; use existing tokens. Reduced motion suppresses interpolation/flow animation while retaining counts and directional markers.
- [ ] Port `tests/studio-run-pace.spec.ts` and `src/features/runs/playback-controller.test.ts`, remove `subscribeFlow` and unused release queues from `RunController.ts`, then delete `livePackets.tsx`.

### 2. Profile and optimize only if needed
- [ ] Measure `stateAt` using flash-sale traffic around 600 requests/s with 120 s retained history. Record warmed frame timing and record count. If it exceeds a few ms, add a temporal index in `src/features/runs/playback.ts`, preserving seek, ingestion and eviction semantics with unit tests.

### 3. Verify and finish
- [ ] Run `npx tsc -b`, `npm test`, `npm run build`, and `npm run build-storybook`. Keep Workspace below 500 kB; split an existing boundary if necessary using the established lazy-component helper.
- [ ] Build first, then run `TEST_PRODUCTION=1 npx playwright test -c pw-iso.tmp.config.ts` with an isolated preview port, two workers, no retries, and Instant storage state. Rerun authoring connect failures alone; delete temporary config.
- [ ] Inspect every changed file. Update `ACTION_LOG.md`, `HANDOFF.md` and D58 in `specs/revamp/decisions.md`; mark plan complete and commit with `Co-Authored-By: GPT-6.1 <noreply@anthropic.com>`.

Sent/arrival/outcome flashes are optional and may be deferred explicitly in the log. Timeline, controls, playhead results and floating connection bar are excluded.
