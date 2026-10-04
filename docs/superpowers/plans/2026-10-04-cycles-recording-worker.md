# Cycles: Recording and Worker (Stage 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace wall-clock pacing with a playhead-throttled live recording: the worker computes ahead of a main-thread playhead, streams flow records, finished cycles and summary checkpoints, and the UI plays them back from a `PlaybackStore`.

**Architecture:** The worker steps the runner until its simulated clock is `LOOKAHEAD_MS` ahead of the playhead the main thread reports, then idles until the playhead moves (Stop lifts the limit). It posts three new updates besides the existing `flow` and `batch`: finished `cycles`, periodic `checkpoint` summaries and a `buffer` state. A pure `PlaybackStore` on the main thread owns the playhead clock, the retained window (flow records and cycles, with a history limit for streams) and the checkpoints, and answers `stateAt(t)`. `RunController` feeds the store, releases flow records, trace events and the terminal result as the playhead passes them, and exposes `setSpeed` (a playback speed, `Infinity` = jump to the live edge).

**Tech Stack:** TypeScript, Vitest (`src/**/*.test.ts`), the worker protocol in `src/features/runs/protocol.ts`, `RunController`, `InProcessTransport` for tests.

**Spec:** `docs/superpowers/specs/2026-10-04-cycle-playback-design.md` (sections 4 and 9, stage 2).

## Global Constraints

- No backward compatibility (spec decision 13): rename and remove freely; ask if you believe compatibility is needed.
- Time stays in the model; the playhead is the only "run time" the UI knows (spec decision 1).
- Defaults (assumptions the user approved with the spec): `LOOKAHEAD_MS = 30_000`, `HISTORY_MS = 120_000`, `CHECKPOINT_MS = 5_000` (simulated ms).
- Stop lifts the lookahead limit; Pause freezes the playhead and the worker (spec decision 10).
- Results and trace stay truthful (HANDOFF invariant): nothing is shown as measured that was not.
- Hidden `studio.runSpeed` localStorage override stays as the test hook: `0` or absent-with-test-config means "jump to the live edge" (`Infinity`); a positive number is a playback multiplier. (The spec said the override would go; a hook is still needed until stage 4 adds a real speed control, so only its meaning changes.)
- `npx tsc -b`, `npm test`, `npm run build` (Workspace chunk under 500 kB), isolated production Playwright with `TEST_PRODUCTION=1` and a config file inside the repo (LESSONS).
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; ACTION_LOG entry and a `Lesson:` line at the end (Task 8).

## Decision to flag (made here, reported to the user)

A stream cannot "play endlessly" under today's budgets: the trace stops at `maxTraceRows` (default 10,000) and `processedEvents` stops at `maxEvents` (default 100,000), and either ends the run `incomplete`. For **streams only**, this plan makes the trace truncate (the D47 behaviour: `trace.truncatedBy` set, checks that read trace rows unevaluated, counts and metrics keep covering the run) and exempts the `maxEvents` budget, because the lookahead limit now bounds computation. Bulk runs keep both budgets. The kernel's own hard limits (1,000,000 events, 100,000 live ops) still apply and end a run `incomplete`.

## File Structure

| File | Responsibility | Change |
| :-- | :-- | :-- |
| `src/domain/studio/runner/scenario-runner.ts` | stream trace truncation and budget exemption; `checkpoint()`; `drainCycles()` | modify |
| `src/domain/studio/runner/cycles.ts` | tracker aggregates, `drainFinished()`, optional discard of finished cycles | modify |
| `src/domain/studio/runner/types.ts` | `RunCheckpoint` | modify |
| `src/features/runs/protocol.ts` | remove pace; playhead message; lookahead; checkpoint, cycles, buffer updates | modify |
| `src/features/runs/playback.ts` | `PlaybackStore` (pure): clock, window, checkpoints, `stateAt` | create |
| `src/features/runs/RunController.ts` | feed the store, release by playhead, speed, pause | modify |
| `src/features/workspace/Workspace.tsx` | speed hook, nothing else | modify |
| `src/features/runs/pacing.test.ts` | replaced by `lookahead.test.ts` | rename and rewrite |
| `src/features/runs/playback.test.ts` | store tests | create |
| `src/features/runs/run-controller.test.ts` | adapt to the clock | modify |
| `tests/studio-run-pace.spec.ts` | adapt (real time vs jump) | modify |
| docs | D57, model-and-runner §8, configuration-reference §8, HANDOFF, ACTION_LOG | modify |

---

### Task 1: Streams truncate the trace instead of ending the run

**Files:**
- Modify: `src/domain/studio/runner/scenario-runner.ts` (the trace append failure in the kernel-step loop, and the `maxEvents` checks used by timed mode)
- Test: `src/domain/studio/runner/run-end.test.ts`

**Interfaces:**
- Produces: for a scenario with an enabled stream source, a full trace cap or `maxEvents` no longer ends the run; `summary.trace.truncatedBy` is `'trace-rows'` or `'trace-bytes'`, and the run keeps counting.

- [ ] **Step 1: Write the failing tests** (append to `run-end.test.ts`; `build`, `stream`, `bulk`, `ready`, `runScenario` are already defined there)

```ts
describe('stream traces truncate instead of ending the run (D57)', () => {
  const tinyBudgets = { ...DEFAULT_SCENARIO_BUDGETS, maxEvents: 200, maxTraceRows: 50 };
  const withBudgets = (doc: Document): Document => ({ ...doc, scenarios: [{ ...doc.scenarios[0], budgets: tinyBudgets }] });

  it('a stream keeps running past the trace and event budgets, with the trace marked truncated', async () => {
    const doc = withBudgets(build(stream(100)));
    ready(doc);
    const result = await runScenario(doc, doc.scenarios[0].id, 'stream-budget', { stopAtMs: 3000 });
    expect(result.status).toBe('completed');
    expect(result.summary.rootCounts.generated).toBeGreaterThan(200);
    expect(result.summary.trace?.truncatedBy).toBe('trace-rows');
    expect(result.events.length).toBeLessThanOrEqual(50);
    expect(result.summary.cycles.total).toBe(result.summary.rootCounts.generated);
  });

  it('a bulk still ends incomplete at its budgets', async () => {
    const doc = withBudgets(build(bulk(500, { spreadMs: 1000 })));
    ready(doc);
    const result = await runScenario(doc, doc.scenarios[0].id, 'bulk-budget');
    expect(result.status).toBe('incomplete');
    expect(result.reason).toMatch(/Budget exhausted/);
  });
});
```

- [ ] **Step 2: Run to verify the first fails**

Run: `rtk npx vitest run src/domain/studio/runner/run-end.test.ts -t "truncate"`
Expected: the stream test FAILS with status `incomplete`.

- [ ] **Step 3: Implement.** In `ScenarioRunner`:
  1. Add a field `private traceFull = false;` and a getter `private get budgetsEndStreams(): boolean { return !this.hasStream; }`.
  2. In the timed kernel-step loop, where `appendRes.ok` is false: when `this.hasStream`, set `this.traceFull = true` and `continue` to the next event (do not end the run); keep the existing incomplete path otherwise. Skip calling `recorder.append` once `this.traceFull` is true.
  3. In every `processedEvents >= / > maxEvents` check on the timed path (the one near the step start and the one inside the kernel loop), guard with `this.budgetsEndStreams`.
  4. `getResult().summary.trace.truncatedBy` already reads `recorder.truncatedBy`; confirm the recorder's `status.reason` is returned there (it is set when the append failed). If `recorder.truncatedBy` is only set on `stopInfo`, no change is needed because the failed append sets it.
- [ ] **Step 4: Run to verify they pass:** `rtk npx vitest run src/domain/studio/runner`. Expected: PASS.
- [ ] **Step 5: Commit** `git add -A src && git commit -m "Streams truncate the trace and ignore the event budget instead of ending the run"` (with the trailer).

---

### Task 2: CycleTracker with running aggregates and streamed-out cycles

**Files:**
- Modify: `src/domain/studio/runner/cycles.ts`
- Modify: `src/domain/studio/runner/cycles.test.ts`

**Interfaces:**
- Produces:
  - `new CycleTracker({ discardFinished?: boolean })` (default false, so `cycles()` keeps everything as today).
  - `drainFinished(): Cycle[]`: cycles that completed since the last call, in completion order. With `discardFinished: true` they are also removed from memory after being drained.
  - `summary()` is computed from running aggregates, so it stays correct after cycles are discarded.

- [ ] **Step 1: Write the failing tests** (append to `cycles.test.ts`)

```ts
describe('CycleTracker streaming out', () => {
  const run = (t: CycleTracker, id: string, start: number, end: number) => {
    t.record(fact({ kind: 'admitted', time: start, unitIdentity: id }));
    t.record(settled(end, id, 'succeeded'));
  };

  it('drainFinished hands out each completed cycle once, in completion order', () => {
    const t = new CycleTracker();
    run(t, 'w-0', 0, 2);
    run(t, 'w-1', 0, 1);
    t.record(fact({ kind: 'admitted', time: 0, unitIdentity: 'w-2' }));
    expect(t.drainFinished().map((c) => c.id)).toEqual(['w-0', 'w-1']);
    expect(t.drainFinished()).toEqual([]);
    t.record(settled(3, 'w-2', 'succeeded'));
    expect(t.drainFinished().map((c) => c.id)).toEqual(['w-2']);
  });

  it('discardFinished frees drained cycles but the summary still counts them', () => {
    const t = new CycleTracker({ discardFinished: true });
    run(t, 'w-0', 0, 1);
    run(t, 'w-1', 0, 3);
    t.record(fact({ kind: 'admitted', time: 0, unitIdentity: 'w-2' }));
    t.drainFinished();
    expect(t.cycles().map((c) => c.id)).toEqual(['w-2']);
    const s = t.summary();
    expect(s).toMatchObject({ total: 3, open: 1, byOutcome: expect.objectContaining({ ok: 2 }) });
    expect(s.completionLatencyMs).toEqual({ mean: 2000, max: 3000 });
  });

  it('a cycle that reopens after it was drained is handed out again when it completes', () => {
    const t = new CycleTracker();
    run(t, 'w-0', 0, 1);
    expect(t.drainFinished()).toHaveLength(1);
    t.record(msg(2, 'w-0:p:e:', 'w-0'));
    t.record(settled(4, 'w-0:p:e:', 'succeeded', 'message'));
    expect(t.drainFinished().map((c) => [c.id, c.completedAtMs])).toEqual([['w-0', 4000]]);
    expect(t.summary().byOutcome.ok).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail:** `rtk npx vitest run src/domain/studio/runner/cycles.test.ts` (FAIL: `drainFinished` missing).
- [ ] **Step 3: Implement.** In `cycles.ts`:
  - Constructor `constructor(private readonly options: { discardFinished?: boolean } = {})`.
  - Keep aggregates: `private readonly byOutcome = emptyOutcomeCounts()`, `private respN = 0, respSum = 0, respMax = 0`, `compN, compSum, compMax`, `private discardedTotal = 0`, and `private finished: string[] = []` (ids queued for `drainFinished`).
  - When a cycle completes (in `settle`, the branch that sets `c.outcome`): add it to the aggregates and push its id to `finished`. When a cycle **reopens** (in `record` on `message_created` with `c.outcome !== null`): subtract its contribution from the aggregates before clearing it (so it is counted once at its final completion).
  - `drainFinished()`: map `finished` ids to `Cycle`s (skipping ids no longer present), clear the queue; if `discardFinished`, delete them from `byId` and `discardedTotal++` each.
  - `summary()`: `total = byId.size + discardedTotal`, `open = number of byId entries with outcome === null`, `byOutcome`, and latencies from the aggregates.
- [ ] **Step 4: Run to verify they pass:** `rtk npx vitest run src/domain/studio/runner/cycles.test.ts src/domain/studio/runner/run-end.test.ts`. Expected: PASS (the existing summary tests keep passing).
- [ ] **Step 5: Commit** `git add -A src && git commit -m "CycleTracker: running aggregates and drainFinished so a stream's cycles can leave memory"` (with the trailer).

---

### Task 3: Runner checkpoints and cycle draining

**Files:**
- Modify: `src/domain/studio/runner/types.ts`
- Modify: `src/domain/studio/runner/scenario-runner.ts` (options, `checkpoint()`, `drainCycles()`)
- Modify: `src/domain/studio/runner/resource-adapter.ts` (construct the tracker with `discardFinished`)
- Test: `src/domain/studio/runner/run-end.test.ts`

**Interfaces:**
- Produces:

```ts
// types.ts
export type RunCheckpoint = {
  readonly atMs: number;
  readonly rootCounts: Counts;
  readonly messageCounts: Counts;
  readonly cycles: CycleSummary;
  readonly elementMetrics: readonly ElementMetric[];
};
// ScenarioRunnerOptions gains: readonly streamOutCycles?: boolean
// ScenarioRunner gains: checkpoint(): RunCheckpoint; drainCycles(): Cycle[]
```

`streamOutCycles: true` makes the adapter's tracker discard finished cycles after `drainCycles()` hands them out; `getResult().cycles` is then only the cycles not yet drained. Default false (tests and headless runs keep every cycle).

- [ ] **Step 1: Write the failing tests** (append to `run-end.test.ts`)

```ts
describe('checkpoints and cycle draining (D57)', () => {
  it('checkpoint() reports cumulative counts and cycle summary at the current clock', async () => {
    const doc = build(bulk(40, { spreadMs: 2000 }));
    ready(doc);
    const runner = new ScenarioRunner(doc, doc.scenarios[0].id, 'cp');
    while (runner.simulatedMs < 1000) await runner.step();
    const early = runner.checkpoint();
    while (await runner.step()) { /* run to the end */ }
    const end = runner.checkpoint();
    expect(early.atMs).toBeGreaterThanOrEqual(1000);
    expect(early.rootCounts.generated).toBeGreaterThan(5);
    expect(end.rootCounts.generated).toBe(40);
    expect(end.cycles.total).toBe(40);
    expect(end.atMs).toBeGreaterThanOrEqual(early.atMs);
    expect(end.elementMetrics.length).toBeGreaterThan(0);
  });

  it('drainCycles() hands out finished cycles once; with streamOutCycles they leave memory', async () => {
    const doc = build(bulk(20, { spreadMs: 1000 }));
    ready(doc);
    const runner = new ScenarioRunner(doc, doc.scenarios[0].id, 'drain', { streamOutCycles: true });
    const seen: string[] = [];
    while (await runner.step()) seen.push(...runner.drainCycles().map((c) => c.id));
    seen.push(...runner.drainCycles().map((c) => c.id));
    expect(new Set(seen).size).toBe(20);
    expect(runner.getResult().cycles).toEqual([]);
    expect(runner.getResult().summary.cycles).toMatchObject({ total: 20, open: 0 });
  });
});
```

- [ ] **Step 2: Run to verify they fail:** `rtk npx vitest run src/domain/studio/runner/run-end.test.ts -t "checkpoints"` (FAIL: no `checkpoint`).
- [ ] **Step 3: Implement.**
  - Add `RunCheckpoint` to `types.ts`.
  - `ScenarioRunnerOptions.streamOutCycles?: boolean`; store `this.streamOutCycles`.
  - `ResourceAdapterOptions` and the `'document'` init gain `streamOutCycles?: boolean`; construct `new CycleTracker({ discardFinished: !!streamOutCycles })` (the field initializer becomes a constructor assignment).
  - `ScenarioRunner.checkpoint()`: `{ atMs: this.currentTimeMs, rootCounts: this.totalRootCounts(), messageCounts: { ...this.messageCounts }, cycles: this.adapter?.cycleTracker.summary() ?? emptyCycleSummary(), elementMetrics: this.adapter ? this.adapter.snapshot().metrics : [] }`.
  - `ScenarioRunner.drainCycles()`: `this.adapter?.cycleTracker.drainFinished() ?? []`.
  - In `getResult()`, `cycles` stays `this.adapter?.cycleTracker.cycles() ?? []`.
- [ ] **Step 4: Run to verify they pass:** `rtk npx vitest run src/domain/studio/runner`. Expected: PASS.
- [ ] **Step 5: Commit** `git add -A src && git commit -m "Runner: checkpoint() and drainCycles() for a streamed recording"` (with the trailer).

---

### Task 4: Worker protocol: playhead, lookahead, checkpoints, no pace

**Files:**
- Modify: `src/features/runs/protocol.ts`
- Rename and rewrite: `src/features/runs/pacing.test.ts` to `src/features/runs/lookahead.test.ts`
- Modify: `src/features/runs/protocol.test.ts` (any `speed` use)
- Modify: `src/features/runs/runner.worker.ts` only if it enumerates message types (check)

**Interfaces:**
- Produces (exact):

```ts
export const LOOKAHEAD_MS = 30_000;
export const CHECKPOINT_MS = 5_000;

export type PlayheadMessage = { readonly type: 'playhead'; readonly runId: string; readonly simulatedMs: number };
// WorkerMessage = CompileRequestMessage | StartRequestMessage | ControlRequestMessage | PlayheadMessage

export type ProtocolCyclesUpdate = { readonly kind: 'cycles'; readonly runId: string; readonly cycles: readonly Cycle[] };
export type ProtocolCheckpointUpdate = { readonly kind: 'checkpoint'; readonly runId: string; readonly checkpoint: RunCheckpoint };
export type ProtocolBufferUpdate = {
  readonly kind: 'buffer';
  readonly runId: string;
  /** `computing`: stepping; `idle`: waiting for the playhead (at the lookahead); `draining`: Stop was pressed. */
  readonly state: 'computing' | 'idle' | 'draining';
  readonly computedMs: number;
};
```

- `StartRequestMessage.speed` is removed. A run starts with `playheadMs = 0`.
- Worker behaviour for timed runs: before each step, if no Stop was requested and `runner.nextEventAtMs()` is not null and exceeds `playheadMs + LOOKAHEAD_MS`, the worker posts one `buffer {state:'idle'}` (only on the transition) and stops scheduling steps. A `playhead` message with a larger `simulatedMs` (Infinity allowed), a `stop` control or a `resume` wakes it. After each batch it posts `cycles` (from `drainCycles()`, only when non-empty) and, when `runner.simulatedMs >= lastCheckpointMs + CHECKPOINT_MS`, a `checkpoint`. The runner is created with `streamOutCycles: true`.
- Logical runs are not throttled (no clock).
- The terminal message still carries `summary` and `checks`; its `summary.cycles` is the final aggregate. Before the terminal the worker posts a last `cycles` batch.

- [ ] **Step 1: Write the failing tests** (`lookahead.test.ts`; keep the helpers `start`, `terminalOf`, `s06` from the old file, minus `speed`)

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document, Emission } from '../../domain/studio/model';
import { DEFAULT_BUILD_VERSIONS } from '../../persistence/studio/types';
import { CHECKPOINT_MS, LOOKAHEAD_MS, WorkerProtocolHandler, type HostMessage } from './protocol';

const s06 = JSON.parse(readFileSync(join(process.cwd(), 'specs/revamp/fixtures/s06.json'), 'utf8')) as Document;
const withEmission = (emission: Emission): Document => ({
  ...s06,
  scenarios: s06.scenarios.map((s, i) => (i === 0 ? { ...s, workloads: s.workloads.map((w) => ({ ...w, emission })) } : s)),
});
const STREAM: Emission = { mode: 'stream', ratePerSecond: 100, profile: { kind: 'steady' } };
const BULK: Emission = { mode: 'bulk', requests: 300, arrival: { spreadMs: 3000 } };

async function start(doc: Document) {
  const messages: HostMessage[] = [];
  const handler = new WorkerProtocolHandler((m) => messages.push(m), { stepBatchSize: 20 });
  const scenarioId = doc.scenarios[0].id;
  await handler.handleMessage({ type: 'compile', requestId: 'r', snapshot: { id: 'snap', document: doc }, scenarioId, versions: DEFAULT_BUILD_VERSIONS });
  const compiled = messages[0];
  if (compiled.type !== 'compile-result' || compiled.result.status !== 'ready') throw new Error('compile failed');
  await handler.handleMessage({ type: 'start', runId: 'run', snapshotId: 'snap', planId: compiled.result.plan.planId, workerSessionId: compiled.result.plan.workerSessionId });
  const updates = () => messages.flatMap((m) => (m.type === 'update' ? [m.message] : []));
  const waitFor = async (what: () => unknown, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (!what() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
  };
  const buffer = () => updates().filter((u) => u.kind === 'buffer');
  const terminal = () => updates().find((u) => u.kind === 'terminal');
  return { handler, updates, waitFor, buffer, terminal };
}

describe('lookahead (D57)', () => {
  it('a stream computes only about LOOKAHEAD_MS ahead of the playhead, then goes idle', async () => {
    const run = await start(withEmission(STREAM));
    await run.waitFor(() => run.buffer().some((b) => b.kind === 'buffer' && b.state === 'idle'));
    const idle = run.buffer().find((b) => b.kind === 'buffer' && b.state === 'idle');
    expect(idle && idle.kind === 'buffer' ? idle.computedMs : -1).toBeGreaterThanOrEqual(LOOKAHEAD_MS - 2000);
    expect(idle && idle.kind === 'buffer' ? idle.computedMs : Infinity).toBeLessThan(LOOKAHEAD_MS + 5000);
    expect(run.terminal()).toBeUndefined();
  });

  it('moving the playhead lets it compute further; a Stop lifts the limit and it completes', async () => {
    const run = await start(withEmission(STREAM));
    await run.waitFor(() => run.buffer().some((b) => b.kind === 'buffer' && b.state === 'idle'));
    const before = run.updates().filter((u) => u.kind === 'checkpoint').length;
    await run.handler.handleMessage({ type: 'playhead', runId: 'run', simulatedMs: 20_000 });
    await run.waitFor(() => run.updates().filter((u) => u.kind === 'checkpoint').length > before + 2);
    expect(run.updates().filter((u) => u.kind === 'checkpoint').length).toBeGreaterThan(before);
    await run.handler.handleMessage({ type: 'control', runId: 'run', kind: 'stop' });
    await run.waitFor(run.terminal, 20000);
    const t = run.terminal();
    expect(t && t.kind === 'terminal' ? t.status : null).toBe('completed');
  }, 30000);

  it('an Infinity playhead means no limit: a bulk runs to its end by itself', async () => {
    const run = await start(withEmission(BULK));
    await run.handler.handleMessage({ type: 'playhead', runId: 'run', simulatedMs: Infinity });
    await run.waitFor(run.terminal, 20000);
    const t = run.terminal();
    expect(t && t.kind === 'terminal' ? t.status : null).toBe('completed');
  }, 30000);

  it('posts finished cycles and a checkpoint about every CHECKPOINT_MS of simulated time', async () => {
    const run = await start(withEmission(BULK));
    await run.handler.handleMessage({ type: 'playhead', runId: 'run', simulatedMs: Infinity });
    await run.waitFor(run.terminal, 20000);
    const cycles = run.updates().flatMap((u) => (u.kind === 'cycles' ? u.cycles : []));
    expect(new Set(cycles.map((c) => c.id)).size).toBe(300);
    const checkpoints = run.updates().flatMap((u) => (u.kind === 'checkpoint' ? [u.checkpoint] : []));
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < checkpoints.length; i++) expect(checkpoints[i].atMs - checkpoints[i - 1].atMs).toBeGreaterThanOrEqual(CHECKPOINT_MS - 1);
  }, 30000);

  it('cancel still discards, with no results kept', async () => {
    const run = await start(withEmission(STREAM));
    await run.handler.handleMessage({ type: 'control', runId: 'run', kind: 'cancel' });
    await run.waitFor(run.terminal, 5000);
    const t = run.terminal();
    expect(t && t.kind === 'terminal' ? [t.status, t.measured] : null).toEqual(['cancelled', false]);
  });
});
```

- [ ] **Step 2: Run to verify they fail:** `git mv src/features/runs/pacing.test.ts src/features/runs/lookahead.test.ts`, replace its content with the above, then `rtk npx vitest run src/features/runs/lookahead.test.ts` (FAIL: no `playhead` message, no `LOOKAHEAD_MS`).
- [ ] **Step 3: Implement** in `protocol.ts`:
  1. Remove `speed` from `StartRequestMessage`, `ActiveRun.speed/paceWallMs/paceSimMs`, `OPEN_RUN_MIN_SPEED`, `anchorPacing`, `paceDelayMs`, and the pacing wait in `stepRun` (`waitMs`).
  2. Add the exported constants and update types listed above; add `PlayheadMessage` to `WorkerMessage`; extend `ProtocolRunUpdate` with the three new updates.
  3. `ActiveRun` gains: `playheadMs: number` (0), `stopping: boolean`, `idle: boolean`, `lastCheckpointMs: number`, `timed: boolean`.
  4. `handleStart`: create the runner with `{ signal, streamOutCycles: true }`; post `buffer {state:'computing', computedMs: 0}` after the initial `state` update.
  5. `handleMessage` case `'playhead'`: `active.playheadMs = Math.max(active.playheadMs, msg.simulatedMs)`; if `active.idle` and the playhead now clears the limit (`computeLimit(active) > next event time`), set `idle = false`, post `buffer computing` and `scheduleStepping`.
  6. `handleControl` `stop`: `active.stopping = true`; post `buffer {state:'draining'}`; if idle, wake it (as above). Keep the existing pause/resume/cancel semantics (a paused worker simply stops stepping; the main thread freezes its own playhead).
  7. `computeLimit(active)`: `active.stopping || !active.timed ? Infinity : active.playheadMs + LOOKAHEAD_MS`.
  8. In `stepRun`'s loop, before `runner.step()`: `const next = active.runner.nextEventAtMs(); if (next !== null && next > computeLimit(active)) { reachedLimit = true; break; }`. After the loop and the existing flow/batch posting: post `cycles` (`runner.drainCycles()`, if non-empty), post a `checkpoint` when `runner.simulatedMs >= active.lastCheckpointMs + CHECKPOINT_MS` (then update `lastCheckpointMs`), and if `reachedLimit` post `buffer {state:'idle', computedMs: runner.simulatedMs}` once (`active.idle = true`) and **return without scheduling** (the wake-ups in steps 5 and 6 reschedule).
  9. Before the terminal (`!hasMore`), post a final `cycles` batch.
- [ ] **Step 4: Run to verify they pass:** `rtk npx vitest run src/features/runs/lookahead.test.ts src/features/runs/protocol.test.ts` (fix any `speed` leftovers in `protocol.test.ts`). Expected: PASS.
- [ ] **Step 5: Commit** `git add -A src && git commit -m "Worker: playhead-throttled lookahead, checkpoints and finished cycles; run pace removed"` (with the trailer).

---

### Task 5: PlaybackStore

**Files:**
- Create: `src/features/runs/playback.ts`
- Create: `src/features/runs/playback.test.ts`

**Interfaces:**
- Consumes: `FlowRecord`, `Cycle`, `RunCheckpoint` from `domain/studio/runner/types`.
- Produces (exact):

```ts
export const HISTORY_MS = 120_000;

export type PlaybackOptions = {
  /** Connection id to the element it leads to, so queued and active counts can be placed on elements. */
  readonly connectionTargets: ReadonlyMap<string, string>;
  /** Raw records older than `playhead - historyMs` are dropped; null keeps everything (a bulk). */
  readonly historyMs: number | null;
};

export type LegAt = { readonly key: string; readonly connectionId: string; readonly direction: 'out' | 'back'; readonly progress: number };
export type NodeAt = { readonly queued: number; readonly active: number };
export type StateAt = {
  readonly atMs: number;
  readonly legs: readonly LegAt[];
  readonly nodes: ReadonlyMap<string, NodeAt>;
  /** Cycles started by `atMs`, with the ones finished by then marked. */
  readonly cycles: { readonly started: number; readonly finished: number };
  /** The newest checkpoint at or before `atMs`, or null before the first. */
  readonly checkpoint: RunCheckpoint | null;
};

export class PlaybackStore {
  constructor(options: PlaybackOptions);
  // ingest (the worker is ahead of the playhead)
  ingestFlow(records: readonly FlowRecord[]): void;
  ingestCycles(cycles: readonly Cycle[]): void;
  ingestCheckpoint(checkpoint: RunCheckpoint): void;
  setComputedEdge(ms: number): void;       // monotonic
  setEnded(endMs: number): void;           // the run has finished computing; no more records
  // clock
  readonly playheadMs: number;
  readonly computedMs: number;
  readonly windowStartMs: number;
  readonly ended: boolean;
  readonly endMs: number | null;
  speed: number;                           // 1 = real time; Infinity = jump to the live edge
  playing: boolean;
  advance(realDtMs: number): void;         // playhead += dt * speed, clamped to the computed edge; never past endMs
  seek(ms: number): void;                  // clamped to [windowStartMs, computedMs]
  atEdge(): boolean;                       // playhead >= computedMs (waiting for the worker)
  atEnd(): boolean;                        // ended and playhead >= endMs
  // reads
  flowBetween(fromMs: number, toMs: number): FlowRecord[];   // records with atMs in (fromMs, toMs]
  stateAt(ms: number): StateAt;
}
```

Semantics of `stateAt` (derived from flow records; all times in simulated ms): a record with `phase:'sent'` starts an outbound leg `[atMs, arriveAtMs]` on `connectionId` (lost legs have `arriveAtMs === null` and show no progress past 1 at their start; they are listed with `progress` 0 until `atMs`, then dropped); `phase:'response'` starts a back leg likewise. `progress = (t - atMs) / (arriveAtMs - atMs)` while `atMs <= t < arriveAtMs`. A key's element is `connectionTargets.get(sentRecord.connectionId)`. A key is *queued* on its element between its `queued` and next `processing`/`settled` record, and *active* between `processing` and `settled`.

- [ ] **Step 1: Write the failing tests** (`playback.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import type { Cycle, FlowRecord, RunCheckpoint } from '../../domain/studio/runner/types';
import { PlaybackStore } from './playback';

const targets = new Map([['c1', 'svc'], ['c2', 'db']]);
const store = (historyMs: number | null = null) => new PlaybackStore({ connectionTargets: targets, historyMs });
const rec = (p: Partial<FlowRecord> & Pick<FlowRecord, 'key' | 'phase' | 'atMs'>): FlowRecord =>
  ({ connectionId: 'c1', arriveAtMs: null, outcome: null, ...p });
const cycle = (id: string, start: number, end: number): Cycle => ({
  id, workloadId: 'w', startedAtMs: start, responseAtMs: end, completedAtMs: end, outcome: 'ok',
  counts: { ok: 1, expired: 0, rejected: 0, 'timed-out': 0, failed: 0, lost: 0, stuck: 0 },
});
const checkpoint = (atMs: number, generated: number): RunCheckpoint => ({
  atMs, rootCounts: { generated, succeeded: generated, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
  messageCounts: { generated: 0, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
  cycles: { total: generated, open: 0, byOutcome: { ok: generated, expired: 0, rejected: 0, 'timed-out': 0, failed: 0, lost: 0, stuck: 0 }, responseLatencyMs: null, completionLatencyMs: null },
  elementMetrics: [],
});

describe('PlaybackStore clock', () => {
  it('advances at the speed and waits at the computed edge', () => {
    const s = store();
    s.setComputedEdge(1000);
    s.playing = true;
    s.advance(400);
    expect(s.playheadMs).toBe(400);
    s.speed = 4;
    s.advance(400);
    expect(s.playheadMs).toBe(1000);
    expect(s.atEdge()).toBe(true);
    s.setComputedEdge(5000);
    s.advance(250);
    expect(s.playheadMs).toBe(2000);
  });

  it('does not move while paused, and Infinity jumps to the edge', () => {
    const s = store();
    s.setComputedEdge(3000);
    s.advance(500);
    expect(s.playheadMs).toBe(0);
    s.playing = true;
    s.speed = Infinity;
    s.advance(1);
    expect(s.playheadMs).toBe(3000);
  });

  it('never passes the end of an ended run, and reports atEnd', () => {
    const s = store();
    s.setComputedEdge(2000);
    s.setEnded(1500);
    s.playing = true;
    s.speed = Infinity;
    s.advance(1);
    expect(s.playheadMs).toBe(1500);
    expect(s.atEnd()).toBe(true);
  });

  it('seeks within the retained window', () => {
    const s = store();
    s.setComputedEdge(2000);
    s.seek(5000);
    expect(s.playheadMs).toBe(2000);
    s.seek(-5);
    expect(s.playheadMs).toBe(0);
  });
});

describe('PlaybackStore recording', () => {
  it('releases records between two playhead times', () => {
    const s = store();
    s.ingestFlow([rec({ key: 'a', phase: 'sent', atMs: 100, arriveAtMs: 200 }), rec({ key: 'a', phase: 'received', atMs: 200 }), rec({ key: 'b', phase: 'sent', atMs: 300, arriveAtMs: 400 })]);
    expect(s.flowBetween(0, 250).map((r) => r.phase)).toEqual(['sent', 'received']);
    expect(s.flowBetween(250, 350).map((r) => r.key)).toEqual(['b']);
  });

  it('drops raw records and cycles older than the history window, keeps checkpoints', () => {
    const s = store(10_000);
    s.setComputedEdge(60_000);
    s.ingestFlow([rec({ key: 'old', phase: 'sent', atMs: 1000, arriveAtMs: 1100 }), rec({ key: 'new', phase: 'sent', atMs: 55_000, arriveAtMs: 55_100 })]);
    s.ingestCycles([cycle('c-old', 1000, 1100), cycle('c-new', 55_000, 55_100)]);
    s.ingestCheckpoint(checkpoint(5000, 10));
    s.playing = true;
    s.speed = Infinity;
    s.advance(1);
    expect(s.windowStartMs).toBe(50_000);
    expect(s.flowBetween(-1, 60_000).map((r) => r.key)).toEqual(['new']);
    expect(s.stateAt(60_000).cycles.started).toBe(1);
    expect(s.stateAt(60_000).checkpoint?.atMs).toBe(5000);
  });

  it('a null history keeps everything', () => {
    const s = store(null);
    s.setComputedEdge(500_000);
    s.ingestFlow([rec({ key: 'old', phase: 'sent', atMs: 1, arriveAtMs: 2 })]);
    s.playing = true;
    s.speed = Infinity;
    s.advance(1);
    expect(s.windowStartMs).toBe(0);
    expect(s.flowBetween(-1, 10).length).toBe(1);
  });
});

describe('PlaybackStore.stateAt', () => {
  const trip = [
    rec({ key: 'a', phase: 'sent', atMs: 100, arriveAtMs: 200, connectionId: 'c1' }),
    rec({ key: 'a', phase: 'received', atMs: 200, connectionId: 'c1' }),
    rec({ key: 'a', phase: 'queued', atMs: 200, connectionId: 'c1' }),
    rec({ key: 'a', phase: 'processing', atMs: 300, connectionId: 'c1' }),
    rec({ key: 'a', phase: 'settled', atMs: 400, connectionId: 'c1', outcome: 'succeeded' }),
    rec({ key: 'a', phase: 'response', atMs: 400, arriveAtMs: 500, connectionId: 'c1', outcome: 'succeeded' }),
  ];

  it('places a request on the connection while it travels, with its progress', () => {
    const s = store();
    s.ingestFlow(trip);
    const at150 = s.stateAt(150);
    expect(at150.legs).toEqual([{ key: 'a', connectionId: 'c1', direction: 'out', progress: 0.5 }]);
    expect(s.stateAt(99).legs).toEqual([]);
    expect(s.stateAt(450).legs).toEqual([{ key: 'a', connectionId: 'c1', direction: 'back', progress: 0.5 }]);
    expect(s.stateAt(600).legs).toEqual([]);
  });

  it('counts queued then active work on the element the connection leads to', () => {
    const s = store();
    s.ingestFlow(trip);
    expect(s.stateAt(250).nodes.get('svc')).toEqual({ queued: 1, active: 0 });
    expect(s.stateAt(350).nodes.get('svc')).toEqual({ queued: 0, active: 1 });
    expect(s.stateAt(450).nodes.get('svc') ?? { queued: 0, active: 0 }).toEqual({ queued: 0, active: 0 });
  });

  it('a lost leg shows nothing once it has left', () => {
    const s = store();
    s.ingestFlow([rec({ key: 'x', phase: 'sent', atMs: 100, arriveAtMs: null })]);
    expect(s.stateAt(150).legs).toEqual([]);
  });

  it('counts cycles started and finished by the time, and picks the newest checkpoint at or before it', () => {
    const s = store();
    s.ingestCycles([cycle('a', 100, 300), cycle('b', 200, 900)]);
    s.ingestCheckpoint(checkpoint(1000, 5));
    s.ingestCheckpoint(checkpoint(2000, 9));
    expect(s.stateAt(250).cycles).toEqual({ started: 2, finished: 1 });
    expect(s.stateAt(250).checkpoint).toBeNull();
    expect(s.stateAt(1500).checkpoint?.atMs).toBe(1000);
    expect(s.stateAt(5000).checkpoint?.atMs).toBe(2000);
  });
});
```

- [ ] **Step 2: Run to verify they fail:** `rtk npx vitest run src/features/runs/playback.test.ts` (FAIL: module missing).
- [ ] **Step 3: Implement** `playback.ts`:
  - Store flow records in an array kept sorted by `atMs` (insert with binary search or push + sort on ingest since the worker sends in order); `flowBetween` uses binary search on the first index with `atMs > fromMs`.
  - `advance(dt)`: if `!playing` return; `target = speed === Infinity ? computedMs : playheadMs + dt * speed`; `limit = Math.min(computedMs, endMs ?? Infinity)`; `playheadMs = Math.min(target, limit)`; then `evict()`.
  - `evict()`: when `historyMs !== null`, `windowStartMs = Math.max(windowStartMs, playheadMs - historyMs)`; drop flow records with `atMs < windowStartMs` **only if no later record of the same key is needed**: simplest correct rule: drop records whose `atMs < windowStartMs` and whose key has no record at or after `windowStartMs`; drop cycles with `completedAtMs < windowStartMs`. Keep every checkpoint (small).
  - `stateAt(t)`: iterate retained records once, building per-key state (leg start, element, queued/processing/settled times) and aggregate as specified; `cycles.started` counts retained cycles with `startedAtMs <= t`, `finished` those with `completedAtMs <= t`.
  - `seek(ms)`: `playheadMs = clamp(ms, windowStartMs, Math.min(computedMs, endMs ?? Infinity))`.
- [ ] **Step 4: Run to verify they pass:** `rtk npx vitest run src/features/runs/playback.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git add -A src && git commit -m "PlaybackStore: playhead clock, retained window, checkpoints and stateAt"` (with the trailer).

---

### Task 6: RunController drives the store and releases by playhead

**Files:**
- Modify: `src/features/runs/RunController.ts`
- Modify: `src/features/runs/run-controller.test.ts` and any controller test that relied on pacing
- Modify: `src/features/workspace/Workspace.tsx` (the hidden speed effect only)

**Interfaces:**
- Consumes: `PlaybackStore`, the worker updates from Task 4.
- Produces (exact):
  - `RunControllerOptions.clock?: PlaybackClock` where `type PlaybackClock = { readonly schedule: (run: () => void, ms: number) => unknown; readonly cancel: (handle: unknown) => void; readonly now: () => number }` (default: `setTimeout`/`clearTimeout`/`performance.now`). Tests inject a manual clock.
  - `setSpeed(speed: number)`: playback speed, simulated seconds per real second; `Infinity` jumps to the live edge; invalid or non-positive values mean `Infinity` (instant). `getSpeed()` returns it. Default speed: `1`.
  - `getPlayback(): PlaybackStore | null`: the current run's store.
  - `subscribeFlow(listener(runId, records, ended))` keeps its signature but now delivers each record when the playhead passes its `atMs`, and `ended = true` when the playhead reaches the end of the run (before the terminal result is applied).
  - `state.events` grows as the playhead passes trace events (`event.atMs`; events with `atMs === null` are released with the next event that has a time).
  - The terminal result is **held** until `store.atEnd()`: `handleTerminal` runs when the playhead reaches `endMs` (`summary.elapsedMs ?? store.computedMs`). `reset()` and `cancel()` clear everything.
  - `pause()`/`resume()` also set `store.playing`; pausing before the terminal arrives freezes the clock; `stop()` is unchanged (it also lets the playhead keep playing through the drain).
  - On `playhead` messages: after every clock tick the controller posts `{type:'playhead', runId, simulatedMs: store.playheadMs}` when the playhead moved by at least 250 simulated ms since the last post, or always when speed is `Infinity` (it posts `Infinity` once, at start, instead).

- [ ] **Step 1: Write the failing tests** (in `run-controller.test.ts`, using the in-process transport and a manual clock the tests control)

```ts
describe('playback pacing (D57)', () => {
  function manualClock() {
    let now = 0;
    const tasks: { at: number; run: () => void; id: number }[] = [];
    let seq = 0;
    return {
      clock: {
        now: () => now,
        schedule: (run: () => void, ms: number) => { const id = ++seq; tasks.push({ at: now + ms, run, id }); return id; },
        cancel: (h: unknown) => { const i = tasks.findIndex((t) => t.id === h); if (i >= 0) tasks.splice(i, 1); },
      },
      /** Advances real time, running due tasks, yielding to the event loop so worker messages are handled. */
      async tick(ms: number, step = 16) {
        for (let t = 0; t < ms; t += step) {
          now += step;
          for (const task of tasks.filter((x) => x.at <= now)) { tasks.splice(tasks.indexOf(task), 1); task.run(); }
          await new Promise((r) => setTimeout(r, 0));
        }
      },
    };
  }

  it('holds the terminal result until the playhead reaches the end of the run', async () => {
    const { controller, params } = await makeBulkController({ requests: 100, spreadMs: 2000 }); // helper: builds the controller with an InProcessTransport and the manual clock, speed 1
    void controller.run(params);
    await tickUntil(() => controller.getPlayback()?.ended === true);
    expect(controller.getState().phase).toBe('running');
    expect(controller.getState().current?.terminal).toBeNull();
    await tick(4000);
    expect(controller.getState().phase === 'saving' || controller.getState().phase === 'done').toBe(true);
    expect(controller.getState().current?.terminal?.status).toBe('completed');
  });

  it('speed Infinity jumps to the live edge and finishes without waiting', async () => {
    const { controller, params } = await makeBulkController({ requests: 100, spreadMs: 2000, speed: Infinity });
    const result = await controller.run(params);
    expect(result?.status).toBe('completed');
  });

  it('pause freezes the playhead; resume continues it', async () => {
    const { controller, params } = await makeBulkController({ requests: 200, spreadMs: 4000 });
    void controller.run(params);
    await tickUntil(() => (controller.getPlayback()?.playheadMs ?? 0) > 500);
    controller.pause();
    const frozen = controller.getPlayback()!.playheadMs;
    await tick(500);
    expect(controller.getPlayback()!.playheadMs).toBe(frozen);
    controller.resume();
    await tick(500);
    expect(controller.getPlayback()!.playheadMs).toBeGreaterThan(frozen);
  });

  it('releases flow records as the playhead passes them', async () => {
    const { controller, params } = await makeBulkController({ requests: 50, spreadMs: 2000 });
    const seen: number[] = [];
    controller.subscribeFlow((_run, records) => { for (const r of records) seen.push(r.atMs); });
    void controller.run(params);
    await tickUntil(() => (controller.getPlayback()?.playheadMs ?? 0) > 800);
    const playhead = controller.getPlayback()!.playheadMs;
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.max(...seen)).toBeLessThanOrEqual(playhead);
  });
});
```

(The helpers `makeBulkController`, `tick`, `tickUntil` are defined at the top of the same describe from the existing test file's controller construction: reuse its repository and transport setup, set the S06-derived document's emission to the given bulk, build `new RunController({ repository, transport, mintId, clock })` and `controller.setSpeed(speed ?? 1)`. Read the top of `run-controller.test.ts` and reuse its fakes; do not invent new fakes.)

- [ ] **Step 2: Run to verify they fail:** `rtk npx vitest run src/features/runs/run-controller.test.ts -t "playback pacing"` (FAIL: no clock option).
- [ ] **Step 3: Implement** in `RunController.ts`:
  1. Replace `private speed = 0` with `private speed = 1`; `setSpeed(speed)`: `this.speed = Number.isFinite(speed) && speed > 0 ? speed : Infinity` (so `0`, `NaN` and `Infinity` all mean instant) and, if a store exists, `store.speed = this.speed`.
  2. Add `private playback: PlaybackStore | null`, `private pendingTerminal`, `private clockHandle`, `private lastTickMs`, `private lastPlayheadPostMs`, `private releasedFlowMs`, `private releasedEventIndex`, `private heldEvents: TraceEvent[]`.
  3. On `start`: create the store with `connectionTargets` from the document (`new Map(document.connections.map((c) => [c.id, c.target.elementId]))`) and `historyMs: hasStream ? HISTORY_MS : null`; set `store.speed = this.speed`, `store.playing = true`; remove `speed` from the start message; if `speed === Infinity` post `{type:'playhead', runId, simulatedMs: Infinity}` immediately; start the clock loop (`schedule(tick, 16)`).
  4. Worker updates: `flow` to `store.ingestFlow`; `cycles` to `store.ingestCycles`; `checkpoint` to `store.ingestCheckpoint` and `setComputedEdge(checkpoint.atMs)`; `batch`: append to `heldEvents` (respecting the existing cap) and `setComputedEdge(max atMs of the batch)`; `buffer` to `setComputedEdge(computedMs)`; `terminal`: `store.setComputedEdge(end)`, `store.setEnded(end)` with `end = Math.max(store.computedMs, summary.elapsedMs ?? 0)` and keep `pendingTerminal`; if the phase is not running (a compile failure terminal has no store) handle it immediately as today.
  5. `tick()`: `dt = now - lastTickMs`; `store.advance(dt)`; release flow records `flowBetween(releasedFlowMs, playheadMs)` to flow listeners; release held events whose `atMs <= playheadMs` into `bufferedEvents` and `setState({ events })`; post the playhead message per the 250 ms rule (not needed when speed is `Infinity`); if `store.atEnd()` and `pendingTerminal`: notify flow listeners `ended = true`, stop the loop, run the existing `handleTerminal(pendingTerminal)` (which saves, using **all** held events flushed into `bufferedEvents` first); else `schedule(tick, 16)`.
  6. `pause()`: also `store.playing = false`; `resume()`: `store.playing = true` and `lastTickMs = now`. `reset()`/`cancel()`: clear the loop, store and held state. `stop()` leaves `playing` untouched.
  7. `getPlayback()` returns the store.
  8. Workspace: change the hidden effect that read `studio.runSpeed` so `0` or invalid maps to `controller.setSpeed(Infinity)` (it already calls `setSpeed(0)`; `setSpeed(0)` now means instant, so only the comment changes) and any positive value is passed through.
- [ ] **Step 4: Run to verify they pass:** `rtk npx vitest run src/features/runs`. Fix other controller tests by calling `controller.setSpeed(Infinity)` right after construction where they await `run()` to completion (a one-line change per test file helper).
- [ ] **Step 5: Commit** `git add -A src && git commit -m "RunController plays the recording: playhead clock, results released as it passes"` (with the trailer).

---

### Task 7: Browser specs and the interim canvas

**Files:**
- Modify: `tests/studio-run-pace.spec.ts`, `playwright.config.ts` (comment only)
- Modify: `src/features/workspace/livePackets.tsx` only if it assumed the worker clock

- [ ] **Step 1:** Run the suite pieces that touch runs: `npm run build`, then `TEST_PRODUCTION=1 npx playwright test -c pw-iso.tmp.config.ts tests/studio-run-pace.spec.ts tests/studio-runs.spec.ts` (create the config inside the repo as in LESSONS; delete it afterwards). Read the failures.
- [ ] **Step 2:** Adapt `studio-run-pace.spec.ts`: "real time takes real time; Instant does not" keeps its meaning (speed `1` vs the config's `0` = instant); the stream spec still presses Stop; the packet spec uses speed `1` and still expects the stage labels (the interim `livePackets` consumes playhead-released flow records, so it behaves as before).
- [ ] **Step 3:** Add one spec: with speed `1`, a 6 s bulk shows the Stop button absent, the playhead-gated results badge not `completed` after 2 s and `completed` after about 6 s; and a stream keeps going past 40 s of simulated time at a high speed (set `studio.runSpeed` to `100`): after about 1 s of real time the run is still going (it did not end at a budget) and Stop completes it.
- [ ] **Step 4:** Run the whole production suite on the isolated port (LESSONS) and record passed/skipped.
- [ ] **Step 5: Commit** `git add -A tests src && git commit -m "Browser specs for the playhead-gated run"` (with the trailer).

---

### Task 8: Docs, log, handoff

**Files:** `specs/revamp/decisions.md` (D57), `specs/revamp/contracts/model-and-runner.md` §8 (protocol: playhead, lookahead, checkpoint, cycles, buffer; pace removed; stream budgets), `specs/revamp/configuration-reference.md` §8 (pace and Stop text), `HANDOFF.md`, `ACTION_LOG.md`, `LESSONS.md` if a rule applies.

- [ ] **Step 1:** Write D57: playhead-throttled live recording (lookahead 30 s, history 120 s for streams, checkpoints 5 s), run pace removed, stream trace truncates and ignores `maxEvents`, hidden `studio.runSpeed` now means jump (0) or a playback multiplier.
- [ ] **Step 2:** Update the contract and configuration reference; HANDOFF marks stage 2 done and stages 3 to 4 open (`stateAt` exists but nothing draws from it yet; results still appear at the end of playback, not as of the playhead).
- [ ] **Step 3:** Run `npx tsc -b`, `npm test`, `npm run build`, the isolated production suite; fill the ACTION_LOG entry with the real numbers and limitations (runner-internal maps still grow with the number of requests; the kernel's 1,000,000-event hard limit still ends very long streams).
- [ ] **Step 4: Commit** `git add -A && git commit -m "Cycles stage 2: docs, log and handoff (D57)"` (with the trailer).

---

## Self-review against the spec (stage 2 scope)

- 4.1 worker no longer paced, `speed` removed: Task 4. 4.2 lookahead and history: Tasks 4 and 5. 4.3 checkpoints: Tasks 3, 4, 5 (results as of the playhead are consumed in stage 4; the store already returns the checkpoint). 4.4 protocol: Task 4. 4.5 budgets: the Decision section and Task 1. 4.6 `PlaybackStore` with `stateAt`: Task 5. Spec section 6 controls and the timeline: stage 4. Section 5 canvas states: stage 3 (the interim packets keep working through playhead-released flow).
- Names used across tasks: `LOOKAHEAD_MS`, `CHECKPOINT_MS`, `HISTORY_MS`, `PlayheadMessage`, `RunCheckpoint`, `drainFinished`, `drainCycles`, `checkpoint()`, `streamOutCycles`, `PlaybackStore`, `PlaybackClock`, `flowBetween`, `stateAt`, `getPlayback`, `setSpeed`; each is defined in the task that produces it.
