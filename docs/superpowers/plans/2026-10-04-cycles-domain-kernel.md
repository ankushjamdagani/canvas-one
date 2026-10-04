# Cycles: Domain and Kernel (Stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scenario `completion` and rate-based workloads with bulk/stream sources and cycle records (response vs full completion, stuck and expired work), keeping the app running end to end.

**Architecture:** The scenario no longer carries a completion policy. A workload carries an `emission` (bulk N with an arrival shape, or an endless stream) and a start delay. The kernel gets deterministic bulk arrival times and an unbounded stream arrival process. A pure `CycleTracker` consumes kernel lifecycle facts and produces one `Cycle` per root request (complete when every descendant message has settled). The runner ends a run when all bulk sources have completed and everything has settled, or after Stop; when the kernel has nothing left to do, leftovers settle as `stuck`.

**Tech Stack:** TypeScript, Vitest (`src/**/*.test.ts` only), Playwright for e2e, the open kernel in `src/simulation/open/kernel.ts`.

**Spec:** `docs/superpowers/specs/2026-10-04-cycle-playback-design.md` (sections 3 and 9, stage 1).

## Global Constraints

- No backward compatibility: old scenarios are rejected with a typed validation message; no migration layer (spec decision 13).
- Time stays in the model (latency, queues, timeouts, rate limits, faults); it is never a run setting.
- Nothing is reported as run, passed or measured unless it was (HANDOFF invariant "Truthful results").
- Model/view separation: nothing from this stage enters the canvas or view metadata.
- Seeded determinism: same scenario and seed give the same run.
- Typecheck with `npx tsc -b` (never `--noEmit false`, never `-p .`).
- Unit tests are `src/**/*.test.ts`; `.tsx` tests never run (LESSONS).
- Workspace chunk stays under 500 kB (`npm run build`).
- Test graphs go through the app's planners where a graph is needed (LESSONS), but kernel-level tests may keep the existing hand-built helpers they already use.
- This stage keeps the run-pace plumbing in `protocol.ts`/`RunController.ts`; stage 2 removes it. A stream run is paced at least `OPEN_RUN_MIN_SPEED` (10x), exactly as the old `open` completion was, so the app stays usable between stages. Packet visuals are replaced in stage 3.
- Append the task to `ACTION_LOG.md` and add decision D56 to `specs/revamp/decisions.md` at the end (Task 9).
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility | Change |
| :-- | :-- | :-- |
| `src/domain/bulk-arrivals.ts` | Pure arrival time of the i-th request of a bulk | create |
| `src/domain/bulk-arrivals.test.ts` | its tests | create |
| `src/domain/workload.ts` | Stream arrival process; ramp can hold its end rate | modify |
| `src/domain/studio/model.ts` | `Workload.emission`, `startDelayMs`; remove `CompletionPolicy` | modify |
| `src/domain/studio/validate.ts` | Validate the new workload; reject old shape | modify |
| `src/domain/studio/manifest.ts`, `src/domain/versioning/merge-descriptor.ts`, `eligibility.ts` | Carry the new fields, drop `completion` | modify |
| `src/domain/execution.ts` | Kernel `WorkloadDefinition` gains `schedule` | modify |
| `src/simulation/open/kernel.ts` | Bulk and stream arrivals; message TTL optional; `unsettled()`; descendant facts | modify |
| `src/domain/studio/runner/cycles.ts` | `CycleTracker`: facts to cycles | create |
| `src/domain/studio/runner/cycles.test.ts` | its tests | create |
| `src/domain/studio/runner/resource-adapter.ts` | Map emission to kernel schedule; drop horizon/count options | modify |
| `src/domain/studio/runner/scenario-runner.ts` | New end rules, `stopAtMs`, stuck, cycles in summary | modify |
| `src/domain/studio/runner/types.ts` | `Cycle`, `CycleSummary`, `RunSummary.cycles` | modify |
| `src/domain/studio/readiness.ts` | Workload rules replace completion rules | modify |
| `src/domain/studio/port-settings.ts` | Message TTL default removed | modify |
| `specs/revamp/fixtures/*.json` | S01 to S06, combined: new workload shape | modify |
| `src/features/scenarios/*`, `src/features/runs/*`, `src/features/workspace/Workspace.tsx` | Minimal editor, protocol and switcher adaptation | modify |

---

### Task 1: Pure arrival helpers (bulk times, stream ramp hold)

**Files:**
- Create: `src/domain/bulk-arrivals.ts`
- Create: `src/domain/bulk-arrivals.test.ts`
- Modify: `src/domain/workload.ts` (ramp branch of `nextArrivalTime`, `rateAt`, `ArrivalSettings`)
- Test: `src/domain/workload.test.ts` (create if absent; otherwise append)

**Interfaces:**
- Produces:
  - `type BulkArrival = 'instant' | { readonly spreadMs: number } | { readonly ramp: { readonly spreadMs: number } }`
  - `bulkArrivalMs(index: number, requests: number, arrival: BulkArrival, startDelayMs: number): number`
  - `ArrivalSettings.holdFinalRate?: boolean`: when true a `ramp` profile keeps `endRate` after `duration` instead of ending.

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/bulk-arrivals.test.ts
import { describe, expect, it } from 'vitest';
import { bulkArrivalMs } from './bulk-arrivals';

describe('bulkArrivalMs', () => {
  it('sends every request at the start delay for instant', () => {
    for (let i = 0; i < 5; i++) expect(bulkArrivalMs(i, 5, 'instant', 250)).toBe(250);
  });

  it('spaces requests evenly over the spread, first at the delay', () => {
    const times = [0, 1, 2, 3].map((i) => bulkArrivalMs(i, 4, { spreadMs: 1000 }, 100));
    expect(times).toEqual([100, 350, 600, 850]);
  });

  it('ramp: arrival rate rises linearly, so the i-th arrival is at spread * sqrt(i / N)', () => {
    const t = (i: number) => bulkArrivalMs(i, 4, { ramp: { spreadMs: 1000 } }, 0);
    expect(t(0)).toBe(0);
    expect(t(1)).toBeCloseTo(500, 6);
    expect(t(4 - 1)).toBeCloseTo(1000 * Math.sqrt(3 / 4), 6);
  });

  it('keeps arrival times non-decreasing', () => {
    let prev = -1;
    for (let i = 0; i < 1000; i++) {
      const t = bulkArrivalMs(i, 1000, { ramp: { spreadMs: 5000 } }, 0);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });
});
```

```ts
// src/domain/workload.test.ts (append if the file exists)
import { describe, expect, it } from 'vitest';
import { nextArrivalTime } from './workload';

describe('nextArrivalTime ramp with holdFinalRate', () => {
  const settings = { traffic: 10, duration: 2, profile: { kind: 'ramp' as const, endRate: 30 }, holdFinalRate: true };

  it('keeps arriving at the end rate after the ramp ends', () => {
    expect(nextArrivalTime(settings, 5, 3)).toBeCloseTo(5 + 3 / 30, 9);
  });

  it('spans the ramp end when the hazard outlasts the ramp', () => {
    // mass in ramp from t=1: rate(1)=20, slope=10, remaining=1 => 20 + 5 = 25; hazard 28 leaves 3 at 30/s
    expect(nextArrivalTime(settings, 1, 28)).toBeCloseTo(2 + 3 / 30, 9);
  });

  it('still ends a ramp that does not hold', () => {
    const ending = { ...settings, holdFinalRate: false };
    expect(nextArrivalTime(ending, 1, 28)).toBe(Infinity);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `rtk npx vitest run src/domain/bulk-arrivals.test.ts src/domain/workload.test.ts`
Expected: FAIL (`bulk-arrivals` module missing; `holdFinalRate` ignored).

- [ ] **Step 3: Implement**

```ts
// src/domain/bulk-arrivals.ts
/** How a bulk of N requests spreads over time (D56). */
export type BulkArrival =
  | 'instant'
  | { readonly spreadMs: number }
  | { readonly ramp: { readonly spreadMs: number } };

/**
 * Arrival time (ms from run start) of the `index`-th (0-based) request of a bulk of `requests`.
 * `instant` sends all at the delay; `spreadMs` spaces them evenly (rate N / spread);
 * `ramp` makes the arrival rate rise linearly from 0, so the cumulative count is N * (t / spread)^2.
 */
export function bulkArrivalMs(index: number, requests: number, arrival: BulkArrival, startDelayMs: number): number {
  if (arrival === 'instant') return startDelayMs;
  if ('spreadMs' in arrival) return startDelayMs + (index * arrival.spreadMs) / requests;
  return startDelayMs + arrival.ramp.spreadMs * Math.sqrt(index / requests);
}
```

In `src/domain/workload.ts` add `holdFinalRate?: boolean` to `ArrivalSettings`, change `rateAt` for a held ramp to return `p.endRate` once `time >= settings.duration`, and replace the ramp branch of `nextArrivalTime`:

```ts
  if (p.kind === "ramp") {
    const slope = (p.endRate - settings.traffic) / settings.duration;
    if (settings.holdFinalRate && after >= settings.duration) return after + hazard / p.endRate;
    const rate = rateAt(settings, after);
    const remaining = settings.duration - after;
    const mass = rate * remaining + 0.5 * slope * remaining * remaining;
    if (hazard > mass) {
      if (!settings.holdFinalRate) return Infinity;
      return settings.duration + (hazard - mass) / p.endRate;
    }
    if (slope === 0) return after + hazard / rate;
    return (
      after +
      (2 * hazard) /
        (rate + Math.sqrt(Math.max(0, rate * rate + 2 * slope * hazard)))
    );
  }
```

and in `rateAt`:

```ts
  if (p?.kind === "ramp") {
    if (settings.holdFinalRate && time >= settings.duration) return p.endRate;
    return settings.traffic + ((p.endRate - settings.traffic) * t) / settings.duration;
  }
```

(Note `t` is clamped to `duration`, so the existing branch already returns `endRate` at the clamp; the extra check only documents the hold and keeps `time` unclamped.)

- [ ] **Step 4: Run to verify they pass**

Run: `rtk npx vitest run src/domain/bulk-arrivals.test.ts src/domain/workload.test.ts src/simulation/open/oracles.test.ts`
Expected: PASS (oracles unchanged: `holdFinalRate` defaults off).

- [ ] **Step 5: Commit**

```bash
git add src/domain/bulk-arrivals.ts src/domain/bulk-arrivals.test.ts src/domain/workload.ts src/domain/workload.test.ts
git commit -m "Bulk arrival times and a ramp that can hold its end rate

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Model and validation (emission, start delay, no completion)

**Files:**
- Modify: `src/domain/studio/model.ts` (Workload at ~1137, WorkloadProfile at ~1126, remove Completion block at ~1230-1282 and `Scenario.completion` at ~1444)
- Modify: `src/domain/studio/validate.ts` (workload validation ~3784-3815, `validateWorkloadProfile` ~2666, completion validation ~3992, scenario key list)
- Modify: `src/domain/studio/manifest.ts` (~158, ~179, ~291, ~298, ~506, ~536)
- Modify: `src/domain/versioning/merge-descriptor.ts` (~542, ~638), `src/domain/versioning/eligibility.ts`
- Test: `src/domain/studio/validate.test.ts`, delete `src/domain/studio/completion-policy.test.ts`

**Interfaces:**
- Produces (exact):

```ts
export type WorkloadProfile =
  | { readonly kind: 'steady' }
  | { readonly kind: 'burst'; readonly peakRate: number; readonly startMs: number; readonly endMs: number }
  | { readonly kind: 'ramp'; readonly endRate: number; readonly rampMs: number };

export type BulkEmission = {
  readonly mode: 'bulk';
  readonly requests: number;
  readonly arrival: 'instant' | { readonly spreadMs: number } | { readonly ramp: { readonly spreadMs: number } };
};
export type StreamEmission = {
  readonly mode: 'stream';
  readonly ratePerSecond: number;
  readonly profile: WorkloadProfile;
};
export type Emission = BulkEmission | StreamEmission;

export type Workload = {
  readonly id: Id;
  readonly entry: Endpoint;
  readonly enabled: boolean;
  readonly startDelayMs: number;
  readonly emission: Emission;
  readonly timeoutMs: number;
  readonly classes: readonly RequestClass[];
};
```

- `Scenario.completion` and `COMPLETION_KINDS`, `CompletionKind`, `CompletionPolicy` and its five policy types are deleted.
- Workload validation limits: `requests` integer 1 to 1_000_000; `spreadMs` 1 to 3_600_000; `ratePerSecond` 0 to 10_000 (as the old `rate`); `startDelayMs` 0 to 3_600_000; `rampMs` 1 to 3_600_000.

- [ ] **Step 1: Write the failing tests** (append to `validate.test.ts`, using the existing document-building helper in that file for a valid S-style document; show the new cases)

```ts
describe('workload emission (D56)', () => {
  const withWorkload = (patch: Record<string, unknown>) => {
    const doc = structuredClone(validTimedDocument()); // the helper this file already uses for a valid timed scenario
    const w = doc.scenarios[0].workloads[0] as Record<string, unknown>;
    Object.assign(w, patch);
    return doc;
  };

  it('accepts a bulk and a stream emission', () => {
    expect(validateDocument(withWorkload({ emission: { mode: 'bulk', requests: 100, arrival: { spreadMs: 5000 } } })).ok).toBe(true);
    expect(validateDocument(withWorkload({ emission: { mode: 'stream', ratePerSecond: 50, profile: { kind: 'steady' } } })).ok).toBe(true);
  });

  it('rejects a scenario that still carries completion', () => {
    const doc = structuredClone(validTimedDocument());
    (doc.scenarios[0] as Record<string, unknown>).completion = { kind: 'horizon', horizonMs: 5000 };
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain('completion');
  });

  it('rejects the old rate/profile workload fields', () => {
    const doc = withWorkload({ rate: 100, profile: { kind: 'steady' } });
    expect(validateDocument(doc).ok).toBe(false);
  });

  it.each([
    [{ mode: 'bulk', requests: 0, arrival: 'instant' }],
    [{ mode: 'bulk', requests: 1.5, arrival: 'instant' }],
    [{ mode: 'bulk', requests: 10, arrival: { spreadMs: 0 } }],
    [{ mode: 'stream', ratePerSecond: -1, profile: { kind: 'steady' } }],
    [{ mode: 'stream', ratePerSecond: 5, profile: { kind: 'ramp', endRate: 10 } }],
  ])('rejects bad emission %j', (emission) => {
    expect(validateDocument(withWorkload({ emission })).ok).toBe(false);
  });

  it('rejects a negative start delay', () => {
    expect(validateDocument(withWorkload({ startDelayMs: -1 })).ok).toBe(false);
  });
});
```

(Use the real helper names from the file: read the top of `validate.test.ts` first and substitute `validTimedDocument` / `validateDocument` with what exists; the assertions above are the contract.)

- [ ] **Step 2: Run to verify they fail**

Run: `rtk npx vitest run src/domain/studio/validate.test.ts`
Expected: FAIL (old shape still accepted).

- [ ] **Step 3: Implement**
  1. `model.ts`: replace the `WorkloadProfile`/`Workload` definitions with the types above; delete the Completion section and `completion` from `Scenario` and its doc comment (`Scenario={...,completion,...}`).
  2. `validate.ts`: in the workload validator change the allowed keys to `['id','entry','enabled','startDelayMs','emission','timeoutMs','classes']`; add `validateEmission(value, path, entityId, issues)` that checks `mode`, then for bulk `requests` (integer 1..1e6) and `arrival` (`'instant'` or an object with exactly `spreadMs` or `ramp.spreadMs`, each 1..3.6e6), and for stream `ratePerSecond` (0..10000) and `validateWorkloadProfile` (ramp now requires `rampMs` 1..3.6e6). Remove the `rate`, `intervalMs` checks. Remove the scenario `completion` key from the allowed scenario keys and delete `validateCompletion` (~3992) and its call; an unknown `completion` key then fails the existing unknown-key check, which gives the typed message.
  3. `manifest.ts`: update `WORKLOAD_KEYS` to the new list, remove `completion` from the scenario keys list (~298), `ManifestScenario` (~179) and the copy (~536); copy `startDelayMs`/`emission` in the workload mapping (~506).
  4. `merge-descriptor.ts`: replace the workload descriptor entries `rate`, `profile`, `intervalMs` with `startDelayMs: { type: 'scalar' }` and `emission: { type: 'record' }` (match the descriptor vocabulary used beside it), delete `completion: COMPLETION_POLICY_DESCRIPTOR` and the descriptor constant. `eligibility.ts`: remove the one `completion` reference.
  5. Delete `src/domain/studio/completion-policy.test.ts`.

- [ ] **Step 4: Run to verify they pass**

Run: `rtk npx vitest run src/domain/studio/validate.test.ts` then `rtk npx tsc -b 2>&1 | head -60`
Expected: validate tests PASS; `tsc` lists errors only in files covered by later tasks (runner, readiness, adapter, features, tests). Record the list in `ACTION_LOG.md` scratch notes; do not fix them here.

- [ ] **Step 5: Commit**

```bash
git add -A src/domain
git commit -m "Workload emission (bulk or stream) and start delay replace rate, profile and scenario completion

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(The tree does not typecheck until Task 7; this stage's commits are ordered so each later task reduces the error list. Say so in the commit body if `tsc` fails.)

---

### Task 3: Kernel arrivals (bulk, stream, start delay) and optional message TTL

**Files:**
- Modify: `src/domain/execution.ts` (`WorkloadDefinition` ~112, `ExecutionEdge.messageTtlMs` ~126, validators ~355-396)
- Modify: `src/simulation/open/kernel.ts` (`scheduleNextArrival` ~842-880, initial scheduling, `maxRootArrivals`/`arrivalHorizon`, `publishMessage` ~1977-2060)
- Modify: `src/domain/studio/runner/resource-adapter.ts` (workload mapping ~372-396, options ~184-199, scenario read ~502-512, edge mapping `messageTtlOf`)
- Modify: `src/domain/studio/port-settings.ts` (~47)
- Test: `src/simulation/open/arrivals.test.ts` (create), `src/simulation/open/messages.test.ts`

**Interfaces:**
- Consumes: `bulkArrivalMs`, `BulkArrival` (Task 1); `Emission`, `Workload` (Task 2).
- Produces:

```ts
// execution.ts
export type WorkloadSchedule =
  | { readonly kind: 'bulk'; readonly requests: number; readonly arrival: BulkArrival; readonly startDelayMs: number }
  | { readonly kind: 'stream'; readonly startDelayMs: number; readonly rampSeconds?: number };
// WorkloadDefinition gains: schedule: WorkloadSchedule   (rate stays as the stream's base rate, in /s)
// WorkloadDefinition loses: intervalMs
// ExecutionEdge.messageTtlMs: number | null    (null = no expiry)
```

- Kernel: `OpenSimulation` loses `arrivalHorizon` and `maxRootArrivals` options. `stopArrivals()` and `isIdle()` stay. New `pendingArrivalCount(): number` (bulk arrivals still to come plus a live stream counts as 1).

- [ ] **Step 1: Write the failing tests**

```ts
// src/simulation/open/arrivals.test.ts
import { describe, expect, it } from 'vitest';
// Use the same kernel-building helper that kernel.test.ts uses for a single-node graph; import it here.
import { buildSingleNodeGraph, runKernel } from './test-helpers'; // if the helpers live inline in kernel.test.ts, move them to test-helpers.ts first (no behavior change)

describe('bulk arrivals', () => {
  it('sends exactly N requests and then is idle once they settle', () => {
    const { facts, sim } = runKernel(buildSingleNodeGraph({ schedule: { kind: 'bulk', requests: 25, arrival: { spreadMs: 1000 }, startDelayMs: 0 } }), { untilIdle: true });
    expect(sim.snapshot().roots.generated).toBe(25);
    expect(facts.filter((f) => f.kind === 'unit_settled' && f.category === 'root')).toHaveLength(25);
    expect(sim.isIdle()).toBe(true);
  });

  it('honors the start delay for the first arrival', () => {
    const { facts } = runKernel(buildSingleNodeGraph({ schedule: { kind: 'bulk', requests: 3, arrival: 'instant', startDelayMs: 400 } }), { untilIdle: true });
    const firstAdmit = facts.find((f) => f.kind === 'admitted')!;
    expect(firstAdmit.time).toBeCloseTo(0.4, 9);
  });
});

describe('stream arrivals', () => {
  it('keeps arriving until stopArrivals, then goes idle', () => {
    const { sim } = runKernel(buildSingleNodeGraph({ schedule: { kind: 'stream', startDelayMs: 0 }, rate: 50 }), { untilTimeSeconds: 2 });
    const before = sim.snapshot().roots.generated;
    expect(before).toBeGreaterThan(50);
    sim.stopArrivals();
    sim.runUntilIdle();
    expect(sim.snapshot().roots.generated).toBe(before);
    expect(sim.isIdle()).toBe(true);
  });
});

describe('message TTL', () => {
  it('a message with no TTL never expires and stays unsettled', () => {
    // graph: workload -> broker (no consumer), edge messageTtlMs null
    const { sim } = runKernel(buildBrokerNoConsumerGraph({ messageTtlMs: null }), { untilQuiet: true });
    expect(sim.snapshot().messages.expired).toBe(0);
    expect(sim.unsettled().length).toBeGreaterThan(0);
  });
});
```

(Add `unsettled()` in Task 5; this last test is written now and stays `it.todo` until then: write it as `it.todo('a message with no TTL never expires and stays unsettled')` in this task and convert it in Task 5.)

- [ ] **Step 2: Run to verify they fail**

Run: `rtk npx vitest run src/simulation/open/arrivals.test.ts`
Expected: FAIL (`schedule` unknown).

- [ ] **Step 3: Implement**
  1. `kernel.ts` `scheduleNextArrival(wl, afterTime)`: delete the `intervalMs` branch and the `arrivalHorizon`/`scheduledArrivals`/`maxRootArrivals` checks. New body:

```ts
  protected scheduleNextArrival(wl: WorkloadDefinition, afterTime: number): void {
    if (this.disabledWorkloads.has(wl.id) || this.arrivalsStopped) return;
    const ordinal = this.workloadNextOrdinal.get(wl.id)!;
    const schedule = wl.schedule;
    let arrTime: number;
    if (schedule.kind === 'bulk') {
      if (ordinal >= schedule.requests) return;
      arrTime = bulkArrivalMs(ordinal, schedule.requests, schedule.arrival, schedule.startDelayMs) / 1000;
    } else {
      const rng = this.workloadRngs.get(wl.id)!;
      const u = Math.max(1e-12, Math.min(1 - 1e-12, rng()));
      const hazard = -Math.log(1 - u);
      arrTime = nextArrivalTime(
        {
          traffic: wl.rate,
          duration: schedule.rampSeconds ?? Number.POSITIVE_INFINITY,
          profile: wl.profile,
          holdFinalRate: true,
        },
        Math.max(afterTime, schedule.startDelayMs / 1000),
        hazard,
      );
    }
    if (!Number.isFinite(arrTime)) return;
    this.workloadNextOrdinal.set(wl.id, ordinal + 1);
    this.pendingArrivals++;
    this.scheduleEvent(arrTime, 2, () => {
      this.pendingArrivals--;
      if (this.disabledWorkloads.has(wl.id) || this.arrivalsStopped) return;
      this.handleArrival(wl, ordinal, arrTime);
      this.scheduleNextArrival(wl, arrTime);
    });
  }
```

  (A stream whose burst/steady profile gets `duration = Infinity` works with the existing loop: its final boundary has infinite mass, so it returns inside it.)
  2. Remove the constructor options `arrivalHorizon` and `maxRootArrivals` and the `scheduledArrivals` field; delete uses.
  3. `publishMessage`: `const edgeDeadline = edge.messageTtlMs === null ? Infinity : born + edge.messageTtlMs / 1000;` The expiry event `this.scheduleEvent(deadline, 0, ...)` is scheduled only when `Number.isFinite(deadline)`; apply the same guard anywhere a message deadline is scheduled. `lineageDeadline` stays `Math.min(...)` (Infinity-safe).
  4. `execution.ts`: add `WorkloadSchedule`, replace `intervalMs`, make `messageTtlMs: number | null` and relax `isNum(e.messageTtlMs,1,3600000)` to accept null.
  5. `resource-adapter.ts`: map each studio workload:

```ts
    schedule:
      w.emission.mode === 'bulk'
        ? { kind: 'bulk', requests: w.emission.requests, arrival: w.emission.arrival, startDelayMs: w.startDelayMs }
        : { kind: 'stream', startDelayMs: w.startDelayMs,
            ...(w.emission.profile.kind === 'ramp' ? { rampSeconds: w.emission.profile.rampMs / 1000 } : {}) },
    rate: w.emission.mode === 'stream' ? w.emission.ratePerSecond : 0,
    profile: w.emission.mode === 'stream' ? toKernelProfile(w.emission.profile) : { kind: 'steady' },
```

  with `toKernelProfile` doing the existing ms to s conversion for burst and `{ kind: 'ramp', endRate }` for ramp. Delete `arrivalHorizonMs`, `maxRootArrivals`, `durationMs` completion plumbing; keep `OPEN_RUN_CEILING_MS` renamed `RUN_CEILING_MS` and used as the adapter's default `durationMs`.
  6. `port-settings.ts`: `messageTtlOf` returns `targetSettings(...).messageTtlMs ?? null` and delete `DEFAULT_MESSAGE_TTL_MS` (grep for other users; the inspector field `portFields.ts` shows an empty value as "No expiry").

- [ ] **Step 4: Run to verify they pass**

Run: `rtk npx vitest run src/simulation/open src/domain/studio/runner/resource-adapter.test.ts`
Expected: arrival tests PASS; other kernel tests that used `rate`/`intervalMs`/`arrivalHorizon` are migrated in this step to `schedule` (mechanical: `intervalMs: n` becomes a bulk with `arrival: { spreadMs: n * requests }`; a horizon-driven rate test becomes a stream stopped with `sim.stopArrivals()` at the old horizon, then `runUntilIdle()`); statistical oracles keep their assertions with streams stopped at the old horizon and may need the expected counts re-derived: re-derive from the formula, never loosen a tolerance.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "Kernel: bulk and stream arrivals with a start delay, message TTL optional

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: CycleTracker (facts to cycles)

**Files:**
- Create: `src/domain/studio/runner/cycles.ts`
- Create: `src/domain/studio/runner/cycles.test.ts`
- Modify: `src/domain/studio/runner/types.ts` (add `Cycle`, `CycleOutcome`, `CycleSummary`; add `cycles: CycleSummary` to `RunSummary`)

**Interfaces:**
- Consumes: `SimLifecycleFact` from `src/simulation/open/kernel.ts` (fields used: `kind`, `time` seconds, `unitIdentity`, `category`, `outcome`, `parentIdentity`).
- Produces (exact):

```ts
export type CycleOutcome = 'ok' | 'expired' | 'rejected' | 'timed-out' | 'failed' | 'lost' | 'stuck';
export type Cycle = {
  readonly id: string;                       // root unit identity: `${workloadId}-${ordinal}`
  readonly workloadId: string;
  readonly startedAtMs: number;
  readonly responseAtMs: number | null;      // root unit settled (the response reached the source)
  readonly completedAtMs: number | null;     // last descendant settled; null while open
  readonly outcome: CycleOutcome | null;     // null while open
  readonly counts: Readonly<Record<CycleOutcome, number>>;  // over the root and its descendant messages
};
export type CycleSummary = {
  readonly total: number;
  readonly open: number;
  readonly byOutcome: Readonly<Record<CycleOutcome, number>>;
  readonly responseLatencyMs: { readonly mean: number; readonly max: number } | null;
  readonly completionLatencyMs: { readonly mean: number; readonly max: number } | null;
};
export class CycleTracker {
  record(fact: SimLifecycleFact): void;
  markStuck(unitIdentities: readonly string[], atMs: number): void;   // quiescence: settle leftovers as stuck
  cycles(): readonly Cycle[];
  openCycleIds(): readonly string[];
  summary(): CycleSummary;
}
```

Outcome mapping (kernel `Outcome` to `CycleOutcome`): succeeded to ok, rejected to rejected, failed to failed, expired to timed-out for a root and to expired for a message. Worst outcome rank, low to high: `ok < expired < rejected < timed-out < failed < lost < stuck`. (`lost` is assigned only by the adapter when a leg is lost; the kernel reports a lost leg's unit as `expired`, so the tracker never produces `lost` in this stage; keep the type for stage 3.)

Root identity of a message: `unitIdentity.split(':')[0]` (message identities are `${parentIdentity}:${path}:${edgeId}:${subscription}`; the root identity has no colon, because it is `${workloadId}-${ordinal}` and workload ids are UUIDs without colons; assert this in the test).

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/studio/runner/cycles.test.ts
import { describe, expect, it } from 'vitest';
import { CycleTracker } from './cycles';
import type { SimLifecycleFact } from '../../../simulation/open/kernel';

const f = (p: Partial<SimLifecycleFact> & Pick<SimLifecycleFact, 'kind' | 'time' | 'unitIdentity'>): SimLifecycleFact =>
  ({ nodeId: 'n', attempt: 0, path: 'n', category: 'root', ...p }) as SimLifecycleFact;

describe('CycleTracker', () => {
  it('a plain request is complete when its response arrives', () => {
    const t = new CycleTracker();
    t.record(f({ kind: 'admitted', time: 1, unitIdentity: 'w-0' }));
    t.record(f({ kind: 'unit_settled', time: 1.25, unitIdentity: 'w-0', outcome: 'succeeded' }));
    expect(t.cycles()).toEqual([
      expect.objectContaining({ id: 'w-0', startedAtMs: 1000, responseAtMs: 1250, completedAtMs: 1250, outcome: 'ok' }),
    ]);
  });

  it('completion waits for descendant messages after the response', () => {
    const t = new CycleTracker();
    t.record(f({ kind: 'admitted', time: 0, unitIdentity: 'w-0' }));
    t.record(f({ kind: 'message_created', time: 0.1, unitIdentity: 'w-0:p:e1:', category: 'message', parentIdentity: 'w-0' }));
    t.record(f({ kind: 'unit_settled', time: 0.2, unitIdentity: 'w-0', outcome: 'succeeded' }));
    expect(t.cycles()[0]).toMatchObject({ responseAtMs: 200, completedAtMs: null, outcome: null });
    expect(t.openCycleIds()).toEqual(['w-0']);
    t.record(f({ kind: 'unit_settled', time: 3, unitIdentity: 'w-0:p:e1:', category: 'message', outcome: 'succeeded' }));
    expect(t.cycles()[0]).toMatchObject({ responseAtMs: 200, completedAtMs: 3000, outcome: 'ok' });
  });

  it('a failed descendant makes the cycle failed; counts cover every unit', () => {
    const t = new CycleTracker();
    t.record(f({ kind: 'admitted', time: 0, unitIdentity: 'w-1' }));
    t.record(f({ kind: 'message_created', time: 0.1, unitIdentity: 'w-1:p:e1:', category: 'message', parentIdentity: 'w-1' }));
    t.record(f({ kind: 'unit_settled', time: 0.2, unitIdentity: 'w-1', outcome: 'succeeded' }));
    t.record(f({ kind: 'unit_settled', time: 0.5, unitIdentity: 'w-1:p:e1:', category: 'message', outcome: 'failed' }));
    expect(t.cycles()[0].outcome).toBe('failed');
    expect(t.cycles()[0].counts).toMatchObject({ ok: 1, failed: 1 });
  });

  it('a root that times out is timed-out; a rejected root is rejected', () => {
    const t = new CycleTracker();
    t.record(f({ kind: 'admitted', time: 0, unitIdentity: 'w-2' }));
    t.record(f({ kind: 'unit_settled', time: 1, unitIdentity: 'w-2', outcome: 'expired' }));
    t.record(f({ kind: 'rejected', time: 0, unitIdentity: 'w-3' }));
    t.record(f({ kind: 'unit_settled', time: 0, unitIdentity: 'w-3', outcome: 'rejected' }));
    const byId = Object.fromEntries(t.cycles().map((c) => [c.id, c.outcome]));
    expect(byId).toEqual({ 'w-2': 'timed-out', 'w-3': 'rejected' });
  });

  it('markStuck settles open units as stuck and completes their cycle', () => {
    const t = new CycleTracker();
    t.record(f({ kind: 'admitted', time: 0, unitIdentity: 'w-4' }));
    t.record(f({ kind: 'message_created', time: 0.1, unitIdentity: 'w-4:p:e1:', category: 'message', parentIdentity: 'w-4' }));
    t.record(f({ kind: 'unit_settled', time: 0.2, unitIdentity: 'w-4', outcome: 'succeeded' }));
    t.markStuck(['w-4:p:e1:'], 9000);
    expect(t.cycles()[0]).toMatchObject({ outcome: 'stuck', completedAtMs: 9000 });
  });

  it('summarizes counts and latencies', () => {
    const t = new CycleTracker();
    for (const [i, end] of [[0, 1], [1, 3]] as const) {
      t.record(f({ kind: 'admitted', time: 0, unitIdentity: `w-${i}` }));
      t.record(f({ kind: 'unit_settled', time: end, unitIdentity: `w-${i}`, outcome: 'succeeded' }));
    }
    const s = t.summary();
    expect(s).toMatchObject({ total: 2, open: 0, byOutcome: expect.objectContaining({ ok: 2 }) });
    expect(s.completionLatencyMs).toEqual({ mean: 2000, max: 3000 });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `rtk npx vitest run src/domain/studio/runner/cycles.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `cycles.ts`

```ts
import type { SimLifecycleFact } from '../../../simulation/open/kernel';
import type { Cycle, CycleOutcome, CycleSummary } from './types';

const RANK: Readonly<Record<CycleOutcome, number>> = {
  ok: 0, expired: 1, rejected: 2, 'timed-out': 3, failed: 4, lost: 5, stuck: 6,
};
const OUTCOMES = Object.keys(RANK) as CycleOutcome[];
const emptyCounts = (): Record<CycleOutcome, number> => Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<CycleOutcome, number>;

type Mutable = {
  id: string; workloadId: string; startedAtMs: number; responseAtMs: number | null;
  completedAtMs: number | null; outcome: CycleOutcome | null;
  counts: Record<CycleOutcome, number>; open: Set<string>; worst: CycleOutcome | null; rootSettled: boolean;
};

const rootOf = (identity: string): string => identity.split(':')[0];
const ms = (seconds: number): number => Math.round(seconds * 1000);

function mapOutcome(category: 'root' | 'message', outcome: string): CycleOutcome {
  if (outcome === 'succeeded') return 'ok';
  if (outcome === 'rejected') return 'rejected';
  if (outcome === 'failed') return 'failed';
  return category === 'root' ? 'timed-out' : 'expired';
}

export class CycleTracker {
  private readonly byId = new Map<string, Mutable>();

  record(fact: SimLifecycleFact): void {
    if (fact.kind === 'admitted' && fact.category === 'root') this.open(fact.unitIdentity, fact.time);
    else if (fact.kind === 'rejected' && fact.category === 'root') this.open(fact.unitIdentity, fact.time);
    else if (fact.kind === 'message_created') {
      const c = this.byId.get(rootOf(fact.unitIdentity));
      if (c) c.open.add(fact.unitIdentity);
    } else if (fact.kind === 'unit_settled' && fact.outcome !== undefined) {
      const c = this.byId.get(rootOf(fact.unitIdentity));
      if (!c) return;
      const outcome = mapOutcome(fact.category ?? 'root', fact.outcome);
      this.settle(c, fact.unitIdentity, outcome, ms(fact.time), fact.category === 'message');
    }
  }

  markStuck(unitIdentities: readonly string[], atMs: number): void {
    for (const identity of unitIdentities) {
      const c = this.byId.get(rootOf(identity));
      if (c) this.settle(c, identity, 'stuck', atMs, identity.includes(':'));
    }
  }

  cycles(): readonly Cycle[] {
    return [...this.byId.values()].map(({ open: _open, worst: _worst, rootSettled: _r, ...c }) => c);
  }

  openCycleIds(): readonly string[] {
    return [...this.byId.values()].filter((c) => c.outcome === null).map((c) => c.id);
  }

  summary(): CycleSummary {
    const byOutcome = emptyCounts();
    const resp: number[] = [];
    const done: number[] = [];
    let open = 0;
    for (const c of this.byId.values()) {
      if (c.outcome === null) { open++; continue; }
      byOutcome[c.outcome]++;
      done.push(c.completedAtMs! - c.startedAtMs);
      if (c.responseAtMs !== null) resp.push(c.responseAtMs - c.startedAtMs);
    }
    const stat = (xs: number[]) => (xs.length === 0 ? null : { mean: xs.reduce((a, b) => a + b, 0) / xs.length, max: Math.max(...xs) });
    return { total: this.byId.size, open, byOutcome, responseLatencyMs: stat(resp), completionLatencyMs: stat(done) };
  }

  private open(id: string, time: number): void {
    if (this.byId.has(id)) return;
    this.byId.set(id, {
      id, workloadId: id.slice(0, id.lastIndexOf('-')), startedAtMs: ms(time), responseAtMs: null,
      completedAtMs: null, outcome: null, counts: emptyCounts(), open: new Set([id]), worst: null, rootSettled: false,
    });
  }

  private settle(c: Mutable, identity: string, outcome: CycleOutcome, atMs: number, isMessage: boolean): void {
    if (!c.open.delete(identity)) return;
    c.counts[outcome]++;
    if (c.worst === null || RANK[outcome] > RANK[c.worst]) c.worst = outcome;
    if (!isMessage) { c.rootSettled = true; c.responseAtMs = atMs; }
    if (c.open.size === 0 && c.rootSettled) { c.completedAtMs = atMs; c.outcome = c.worst; }
  }
}
```

(`SimLifecycleFact` must expose `category` and `parentIdentity` on those kinds; they are optional fields already used by the runner; if `category` is absent on `unit_settled` in the type, widen the type in the kernel in this step.)

In `types.ts` add `CycleOutcome`, `Cycle`, `CycleSummary` as written above and `readonly cycles: CycleSummary;` to `RunSummary`.

- [ ] **Step 4: Run to verify they pass**

Run: `rtk npx vitest run src/domain/studio/runner/cycles.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/studio/runner/cycles.ts src/domain/studio/runner/cycles.test.ts src/domain/studio/runner/types.ts
git commit -m "CycleTracker: cycles complete when every descendant has settled

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Runner end rules, Stop, stuck detection, cycles in the summary

**Files:**
- Modify: `src/domain/studio/runner/scenario-runner.ts` (setup ~630-660, stop handling ~1690-1700, completion block ~1700-1790, `run()` ~2293, `getResult` ~2330, `drainDeadlineMs` ~1467)
- Modify: `src/simulation/open/kernel.ts` (`unsettled()` and a live-unit set)
- Modify: `src/domain/studio/runner/resource-adapter.ts` (`unsettled()`, `cycleTracker`, trace hook feeding it)
- Test: `src/domain/studio/runner/run-end.test.ts` (create; replaces `completion-kinds.test.ts`, delete that file)

**Interfaces:**
- Consumes: `CycleTracker` (Task 4), kernel schedule (Task 3).
- Produces:
  - `ScenarioRunnerOptions.stopAtMs?: number`: request Stop when the simulated clock reaches this time (headless equivalent of the Stop button; used by tests and by stage 4's automation).
  - `OpenSimulation.unsettled(): readonly { identity: string; category: 'root' | 'message'; holderNodeId: string; phase: OpPhase }[]`
  - `ResourceAdapter.unsettled()` and `ResourceAdapter.cycles(): CycleTracker`.
  - `RunSummary.cycles: CycleSummary`.
  - Run end rules (timed mode):
    1. Run ends `completed` when no stream workload is enabled and enabled-by-input excluded, all arrivals and inputs have been delivered, the kernel is idle, and nothing is in flight.
    2. With an active stream, only Stop ends it: after Stop (button or `stopAtMs`) arrivals stop and in-flight work drains; `completed` once drained.
    3. If after the drain the kernel has no events left but units are unsettled, they settle as `stuck`; status `incomplete`, reason `"<n> unit(s) never settled: <holders>"`.
    4. Drain keeps the existing `STOP_DRAIN_MS` guard (60 s simulated) and the 24 h `RUN_CEILING_MS` guard: both end the run `incomplete` with the existing reasons.
    5. A bulk stopped before it has emitted every request reports `reason: "Stopped after sending M of N requests"` with status `completed`.

- [ ] **Step 1: Write the failing tests** (build graphs through the planners per LESSONS; reuse the `build()` helper from the deleted `completion-kinds.test.ts`, adjusting it to the new workload shape)

```ts
// src/domain/studio/runner/run-end.test.ts
import { describe, expect, it } from 'vitest';
import { runScenario } from './scenario-runner';
import { checkReadiness } from '../readiness';
import { buildService, withEmission } from './test-support/graphs'; // extracted from completion-kinds.test.ts `build`

const run = async (doc: ReturnType<typeof buildService>, opts: Parameters<typeof runScenario>[3] = {}) => {
  const id = doc.scenarios[0].id;
  expect(checkReadiness(doc, id).ready).toBe(true);
  return runScenario(doc, id, 'run-1', opts);
};

describe('run end (D56)', () => {
  it('a bulk run completes by itself when every cycle has settled', async () => {
    const r = await run(withEmission(buildService(), { mode: 'bulk', requests: 40, arrival: { spreadMs: 2000 } }));
    expect(r.status).toBe('completed');
    expect(r.summary.cycles).toMatchObject({ total: 40, open: 0 });
    expect(r.summary.cycles.byOutcome.ok + r.summary.cycles.byOutcome.failed + r.summary.cycles.byOutcome.rejected + r.summary.cycles.byOutcome['timed-out']).toBe(40);
  });

  it('a stream never ends by itself: it stops only at Stop, then drains', async () => {
    const doc = withEmission(buildService(), { mode: 'stream', ratePerSecond: 20, profile: { kind: 'steady' } });
    const stopped = await run(doc, { stopAtMs: 3000 });
    expect(stopped.status).toBe('completed');
    expect(stopped.summary.rootCounts.generated).toBeGreaterThan(30);
    expect(stopped.summary.cycles.open).toBe(0);
    const budgeted = await run(doc, { maxSteps: 200 });
    expect(budgeted.status).not.toBe('completed');
  });

  it('is deterministic for the same seed', async () => {
    const doc = withEmission(buildService(), { mode: 'bulk', requests: 30, arrival: 'instant' });
    const a = await run(doc);
    const b = await run(doc);
    expect(b.summary.cycles).toEqual(a.summary.cycles);
  });

  it('Stop before a bulk finished emitting reports sent M of N', async () => {
    const r = await run(withEmission(buildService(), { mode: 'bulk', requests: 100, arrival: { spreadMs: 10000 } }), { stopAtMs: 1000 });
    expect(r.status).toBe('completed');
    expect(r.reason).toMatch(/^Stopped after sending \d+ of 100 requests$/);
  });

  it('reports a response before the cycle completes when a side effect outlives it', async () => {
    const r = await run(withEmission(buildServiceWithSlowConsumer(), { mode: 'bulk', requests: 5, arrival: 'instant' }));
    const slow = r.cycles!.every((c) => c.completedAtMs! > c.responseAtMs!);
    expect(slow).toBe(true);
  });

  it('unconsumed messages without a TTL settle as stuck and end the run incomplete', async () => {
    const r = await run(withEmission(buildServiceWithDeadBroker({ messageTtlMs: null }), { mode: 'bulk', requests: 3, arrival: 'instant' }));
    expect(r.status).toBe('incomplete');
    expect(r.summary.cycles.byOutcome.stuck).toBe(3);
    expect(r.reason).toMatch(/3 units never settled/);
  });

  it('the same graph with a TTL expires the messages and completes', async () => {
    const r = await run(withEmission(buildServiceWithDeadBroker({ messageTtlMs: 500 }), { mode: 'bulk', requests: 3, arrival: 'instant' }));
    expect(r.status).toBe('completed');
    expect(r.summary.cycles.byOutcome.expired).toBe(3);
  });
});
```

`ScenarioRunResult` gains `cycles: readonly Cycle[]` (full list, used by stage 2/4; large runs are bounded by the trace cap policy there, here it is the plain list). `test-support/graphs.ts` exports `buildService()` (one entry → service resource), `buildServiceWithSlowConsumer()` (entry → service that publishes to a broker whose consumer takes 3 s), `buildServiceWithDeadBroker(opts)` (entry → service publishing to a broker with no consumer) and `withEmission(doc, emission)`; they use `placeEntry`/`planConnection` as the existing `completion-kinds.test.ts` does.

- [ ] **Step 2: Run to verify they fail**

Run: `rtk npx vitest run src/domain/studio/runner/run-end.test.ts`
Expected: FAIL (runner still reads `completion`).

- [ ] **Step 3: Implement**
  1. Kernel: add `private readonly liveUnits = new Set<Unit>()`, add on unit creation (both `handleArrival` branches and message creation), delete in `finishUnit`. Add:

```ts
  unsettled(): readonly { identity: string; category: 'root' | 'message'; holderNodeId: string; phase: OpPhase }[] {
    return [...this.liveUnits].map((u) => ({
      identity: u.identity, category: u.category,
      holderNodeId: u.rootOp?.nodeId ?? '', phase: u.rootOp?.phase ?? 'transit',
    }));
  }
```

  2. Adapter: create `this.cycleTracker = new CycleTracker()` and in the trace hook (where `recordFlow` is called) call `this.cycleTracker.record(fact)` for every fact. Expose `unsettled()`, `cycles()`.
  3. Runner, setup: delete the completion reading block (~630-650). The adapter is built with the scenario workloads only.
  4. Runner, `step()`: replace the completion/drain block with the end rules. Core logic:

```ts
    const hasStream = this.scenario.workloads.some(
      (w) => w.enabled && w.emission.mode === 'stream' && !this.disabledByInput(w),
    );
    if (this.options.stopAtMs !== undefined && !this.stopRequested && this.currentTimeMs >= this.options.stopAtMs) {
      this.requestStop();
    }
    // ... existing stop handling (arrivals stop, external inputs dropped, drain deadline set) ...
    const arrivalsDone = this.stoppedAtMs !== null || (!hasStream && (this.adapter?.pendingArrivalCount() ?? 0) === 0);
    const drained =
      arrivalsDone &&
      this.timedQueue.length === 0 &&
      !(this.adapter && !this.adapter.isIdle()) === true &&
      this.totalRootCounts().inFlight === 0 &&
      this.messageCounts.inFlight === 0 &&
      this.openFrames.size === 0;
    if (drained) return this.finishTimed('completed', null);

    const kernelNext = this.adapter?.peekNext();
    const globalNext = this.timedQueue[0];
    if (!kernelNext && !globalNext && arrivalsDone) {
      const stuck = this.adapter?.unsettled() ?? [];
      if (stuck.length > 0) {
        this.adapter!.cycles().markStuck(stuck.map((u) => u.identity), this.currentTimeMs);
        return this.finishTimed('incomplete', this.describeStuck(stuck));
      }
      return this.finishTimed('completed', null);
    }
    if (this.stoppedAtMs !== null && this.currentTimeMs >= this.stopDrainDeadlineMs!) {
      return this.finishTimed('incomplete', 'Stopped, but work was still in flight after the drain time');
    }
    if (this.currentTimeMs >= RUN_CEILING_MS) {
      return this.finishTimed('incomplete', 'The run reached its 24 hour simulated limit');
    }
```

  with `describeStuck` producing `"<n> unit(s) never settled: <count> in <element label>, ..."` (group by `holderNodeId`, label from the document element; `units` singular/plural handled: for n=3 the test expects `3 units never settled`). After a Stop on a bulk, when `stoppedAtMs !== null` and `sentSoFar < N` set the reason `Stopped after sending M of N requests` where N sums enabled bulk workloads' `requests`.
  5. `getResult()`: `elapsedMs = this.currentTimeMs` for timed mode (delete the drain/horizon branches); add `cycles: this.adapter?.cycles().summary() ?? emptyCycleSummary()` to `summary` and `cycles: this.adapter?.cycles().cycles() ?? []` to the result.
  6. Delete `drainDeadlineMs()`, the `OPEN_RUN_CEILING_MS` import (renamed in Task 3), and every `completion` reference. Delete `src/domain/studio/runner/completion-kinds.test.ts` after moving its `build` helper to `test-support/graphs.ts`.

- [ ] **Step 4: Run to verify they pass**

Run: `rtk npx vitest run src/domain/studio/runner/run-end.test.ts src/domain/studio/runner/cycles.test.ts src/simulation/open`
Expected: PASS. Convert the Task 3 `it.todo` message-TTL test to a real test using `buildBrokerNoConsumerGraph` and `sim.unsettled()`.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "Runner: end by cycles, Stop drains, unsettled work settles as stuck

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Readiness rules

**Files:**
- Modify: `src/domain/studio/readiness.ts` (~96 issue codes, ~776-790 burst check, ~829-880 completion checks)
- Test: `src/domain/studio/readiness.test.ts`

**Interfaces:**
- Produces issue codes replacing `completion-mode-mismatch`: `workload-bulk-size`, `workload-spread`, `workload-rate`, `workload-start-delay`, `stream-in-logical`. (`readiness.test.ts` asserts codes by string; migrate its 22 `completion` references.)

Rules:
- Logical scenarios must have no workloads (they have inputs); a workload in a logical scenario gives `stream-in-logical`... name it `workload-in-logical` instead if clearer to the reader of the code; use `workload-in-logical` and keep the list above consistent.
- Timed scenarios still need at least one enabled workload or a finite input (existing rule; keep).
- A burst profile's `endMs` must exceed `startMs` (replaces the old comparison against the arrival window, which no longer exists).

- [ ] **Step 1: Write failing tests** for: a bulk of 0 gives `workload-bulk-size`; a negative spread gives `workload-spread`; a stream rate of 0 on an enabled workload gives `workload-rate`; a timed scenario with a valid bulk is ready; the old `completion-mode-mismatch` code no longer exists (`expect(ISSUE_CODES).not.toContain('completion-mode-mismatch')` if the codes are exported; otherwise assert on `checkReadiness` output).
- [ ] **Step 2: Run to verify fail:** `rtk npx vitest run src/domain/studio/readiness.test.ts` (FAIL).
- [ ] **Step 3: Implement** the checks in `readiness.ts`, deleting the completion/horizon/drain checks and the `arrivalWindowMs` burst check; migrate `readiness.test.ts` fixtures from `completion: {...}` to the new workloads (logical fixtures simply drop `completion`).
- [ ] **Step 4: Run:** `rtk npx vitest run src/domain/studio` Expected: PASS.
- [ ] **Step 5: Commit** `git add -A src/domain/studio && git commit -m "Readiness: workload emission rules replace completion rules" (with the trailer).

---

### Task 7: Fixtures, remaining tests and compile fixes

**Files:**
- Modify: `specs/revamp/fixtures/s01.json` to `s06.json`, `combined.json` (every timed scenario: remove `completion`; each workload `rate`/`profile`/`intervalMs` becomes `startDelayMs: 0` plus `emission`)
- Modify tests that reference completion (list from `grep -rln completion src tests`): `reference-architectures.test.ts`, `call-policies.test.ts`, `endpoint-behavior.test.ts`, `faults.test.ts`, `refinement.test.ts`, `resource-adapter.test.ts`, `scenario-runner.test.ts`, `evidence.test.ts` (the `completion: 'completed'` field there is `TerminalStatus`, keep), `closure.test.ts`, `refinementRouting.test.ts`, `s06-example.test.ts`, `kernel-faults.test.ts`, `brokers.test.ts`, `messages.test.ts`, `persistence/studio/e2e.test.ts`, `history/controller.test.ts`, `view-models.test.ts`, `addProbePlan.test.ts`, `deletePlan.test.ts`
- Modify: `scripts/` or tools that read the fixtures (grep `fixtures/s0`)

Migration rule (apply mechanically, then re-derive any assertion that changes):
- `completion: { kind: 'quiescent' }` on a logical scenario: delete the property.
- Old `horizon H` with rate R: stream `{ mode: 'stream', ratePerSecond: R, profile }` and `stopAtMs: H` in the run options. In-flight work now drains instead of being cut at H, so counts of settled requests rise; update expected numbers from the new run only after checking the delta equals the in-flight tail (explain each in the commit body if it is not trivially so).
- Old `drain arrivalHorizon A, deadline D` with rate R: bulk `requests = round(R * A / 1000)`, `arrival: { spreadMs: A }`. Arrival timing is now even rather than Poisson, so statistical assertions on arrivals are re-derived; never loosen a tolerance to make a test pass.
- Old `count N`: bulk `requests: N`, `arrival: 'instant'` unless the test is about spread.
- Old `open`: stream plus `stopAtMs`.

- [ ] **Step 1:** Convert the fixtures and write a one-off check test `src/domain/studio/fixtures.test.ts` (or extend the existing fixtures test) asserting each fixture validates, passes `checkReadiness`, and has no `completion` key.
- [ ] **Step 2:** Run `rtk npx tsc -b 2>&1 | head -80` and fix every error file by file with the migration rule; re-run until clean.
- [ ] **Step 3:** Run `rtk npm test` and migrate failures one file at a time (read the failing assertion, decide whether the new number is the correct consequence of the new model, then update). The reference-architecture tests (31) and the S06 example check are the important ones: each must still pass its *intent* (for example "queue builds under overload").
- [ ] **Step 4:** Run `rtk npm test` Expected: all green. Record the final count.
- [ ] **Step 5: Commit** `git add -A && git commit -m "Fixtures and tests moved to bulk and stream sources"` (with the trailer).

---

### Task 8: Minimal editor, protocol and switcher adaptation (keeps the app running)

**Files:**
- Modify: `src/features/scenarios/draftScenario.ts`, `draft.ts`, `types.ts`, `ScenarioEditor.tsx`, `TrafficSection.tsx`, `AssertionsSection.tsx`, `ScenarioSwitcher.tsx`, `NewScenarioDialog.tsx`
- Modify: `src/features/runs/protocol.ts` (~420-422), `view-models.ts`, `src/features/workspace/Workspace.tsx` (~1110)
- Test: `src/features/scenarios/draft.test.ts`, `scenario-switcher.test.ts`, `authoring-completeness.test.ts`, `src/features/runs/pacing.test.ts`, `protocol.test.ts`; Playwright specs that touch Completion (`tests/studio-run-pace.spec.ts`, `tests/studio-scenarios.spec.ts`)

Requirements (stage 4 will redesign the editor; this task only needs the new model to be authorable):
- `DraftWorkload` gains `startDelayMs: number | null` and `emission` drafts: mode select (Bulk / Stream); bulk: `requests`, arrival select (All at once / Spread over / Ramp over) with `spreadMs`; stream: `ratePerSecond` and the existing profile control (ramp gets `rampMs`). Unset values keep the existing "blocked until chosen" authoring behavior (the draft rule "invents nothing" stays).
- `ScenarioEditor.tsx`: delete the Completion block (kind select, horizon, count, deadline fields, lines ~138-250) and `draft.completion`; `draft.ts` readiness-to-storable conversion no longer needs completion.
- `ScenarioSwitcherEntry.completion` is replaced by `emission: 'bulk' | 'stream' | 'mixed' | 'none'` (derived in `Workspace.tsx` ~1110 from the workloads) and the switcher's subtitle shows it.
- `protocol.ts`: `scenarioMode !== 'timed' ? 0 : hasActiveStream(scenario) ? Math.max(requestedSpeed, OPEN_RUN_MIN_SPEED) : requestedSpeed`.
- `view-models.ts`: replace the `horizon`/`drain` reads with the cycle summary: show "N cycles, K ok" in the run summary line.

- [ ] **Step 1:** Update `draft.test.ts` first: delete the "timed completion" tests, add tests that (a) a fresh timed draft is blocked until an emission mode and its required values are chosen, (b) choosing bulk with `requests` and `arrival` unblocks it, (c) a stream needs a rate, (d) the storable scenario contains no `completion`. Run `rtk npx vitest run src/features/scenarios` (FAIL).
- [ ] **Step 2:** Implement the draft model and editor changes; run the same tests (PASS).
- [ ] **Step 3:** Fix `tsc` (`rtk npx tsc -b`) until clean, then `rtk npm test`.
- [ ] **Step 4:** Update the Playwright specs: replace Completion-field interactions with the new emission controls (test ids `workload-mode`, `bulk-requests`, `bulk-arrival`, `bulk-spread`, `stream-rate`), keep the `studio.runSpeed` storage state in `playwright.config.ts`. A stream run in e2e ends through the Stop button: add a helper `stopRun(page)` and assert the run finalizes.
- [ ] **Step 5: Commit** `git add -A && git commit -m "Scenario editor authors bulk and stream sources; completion removed from the UI"` (with the trailer).

---

### Task 9: Docs, verification, handoff

**Files:**
- Modify: `specs/revamp/decisions.md` (add D56; mark the completion and pace parts of D55 superseded), `specs/revamp/configuration-reference.md` (replace the completion section with emission and cycles), `specs/revamp/contracts/model-and-runner.md` §6 (Workload, Completion), `HANDOFF.md` (current state, open debt: stage 2 to 4 pending), `ACTION_LOG.md`
- Test: whole suite

- [ ] **Step 1:** Write D56 (bulk and stream sources, cycles complete when every descendant has settled, stuck and expired, no completion policy, no compatibility) and update the three spec files.
- [ ] **Step 2:** Run the full checks:

```bash
rtk npx tsc -b
rtk npm test
rtk npm run build
```

Expected: tsc clean, tests green, Workspace chunk under 500 kB.
- [ ] **Step 3:** Production browser suite on an isolated port (LESSONS): write a throwaway config with its own port, `reuseExistingServer: false`, 2 workers, no retries, serving the fresh `dist` via `vite preview`; run it and record passed/skipped counts. Fix regressions; never claim a pass that was skipped.
- [ ] **Step 4:** Probe in the browser (preview tools): create a timed scenario, set a bulk of 200 spread over 5 s, run it, confirm the run completes and the Results panel shows cycles; set a stream, run it, confirm it keeps running and Stop ends it.
- [ ] **Step 5:** Append the `ACTION_LOG.md` entry (outcome, files, verification numbers, limitations: packets still use the stage-0 live-packet view; no timeline yet; stuck/expired shown in results only). Add a `Lesson:` line if anything surprised. Commit with the trailer.

---

## Self-review against the spec (stage 1 scope)

- 3.1 Sources: Tasks 1 to 3. 3.2 Scenario: Task 2. 3.3 Cycle: Task 4. 3.4 Settling and stuck: Tasks 3 and 5. 3.5 Run lifecycle (all sources start together with delays, run end rules, Stop, bulk "sent M of N"): Task 5.
- Not in this plan by design: worker lookahead, history, checkpoints (stage 2); flow/stage rendering (stage 3); timeline and controls and the final editor (stage 4); run-pace removal (stage 2).
- Spec section 8 item 2 (outcome ranking): resolved here against the kernel outcomes (`lost` reserved for stage 3). Item 3 (which elements get a TTL): the existing message in-port `messageTtlMs` becomes optional; no new element field.
- Type names used across tasks: `BulkArrival`, `bulkArrivalMs`, `Emission`, `WorkloadSchedule`, `CycleTracker`, `Cycle`, `CycleOutcome`, `CycleSummary`, `unsettled()`, `stopAtMs`, `RUN_CEILING_MS`; each is defined in the task that produces it.
