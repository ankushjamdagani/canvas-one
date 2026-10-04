# Cycles, live recording and timeline playback

Date: 2026-10-04. Status: design, awaiting review. Supersedes the traffic-animation and run-pace parts of D55 (completion kinds, run speed, sampled packets).

## 1. Purpose

Replace "run for a duration or count, paced in real time, with sampled packets" with:

- a **cycle** as the unit of work and completion,
- a **live recording** that the worker produces and the UI plays back at its own pace,
- a **timeline** with video-style controls,
- a **traffic view** whose states map to where a request actually is.

Time stays in the model (latency, queues, timeouts, rate limits, faults). It is no longer a run setting: nothing in the scenario says "run for 60 s".

## 2. Decisions (from the design dialogue)

| # | Decision |
| :-- | :-- |
| 1 | Time stays in the model, but is not a run setting. |
| 2 | A source is **bulk** (N requests) or **stream** (rate R, no end). |
| 3 | The worker computes ahead; playback consumes the recording while it is being produced. |
| 4 | An endless stream keeps a throttled lookahead and a sliding history window; cumulative results come from running summaries. |
| 5 | A cycle completes when everything the request caused has settled, including async side effects. |
| 6 | Unsettled work: optional per-queue TTL (settles as `expired`); otherwise quiescence detection settles leftovers as `stuck`. |
| 7 | Timeline: time axis with cycles drawn as bands. |
| 8 | Connections show individual packets up to a threshold, then a labelled aggregate view. |
| 9 | Connections show transit only; nodes show waiting and processing. |
| 10 | Stop ends the run (drain, then finalize); Pause freezes the playhead and the lookahead. |
| 11 | Results are as of the playhead. |
| 12 | All sources start together, each with an optional start delay. |
| 13 | No backward compatibility: old scenarios are rejected, built-in examples rewritten, old stored runs dropped. |

## 3. Domain model

### 3.1 Sources

`Workload` keeps `entry`, `enabled`, `timeoutMs`, `classes`. The rate and profile fields are replaced:

```
Workload = {
  id, entry, enabled, timeoutMs, classes,
  startDelayMs: number,                 // >= 0, default 0
  emission:
    | { mode: 'bulk',   requests: number, arrival: 'instant' | { spreadMs: number } | { ramp: { spreadMs: number } } }
    | { mode: 'stream', ratePerSecond: number, profile: WorkloadProfile }   // steady | burst | ramp as today
}
```

- Bulk: `requests` is an integer >= 1. `instant` sends all at `startDelayMs`. `spreadMs` spaces them evenly; `ramp` increases the rate across `spreadMs`.
- Stream: emits until Stop. The existing steady/burst/ramp profile shapes the rate.
- "200 per second for 30 s" is entered as a bulk with `requests = 6000`, `arrival = { spreadMs: 30000 }`. The editor may present a rate x duration helper that derives `requests`; the stored value is `requests` and `spreadMs`.
- `intervalMs` is dropped (it is always null).

### 3.2 Scenario

- Remove `completion` (`CompletionPolicy` and its five kinds).
- Keep `budgets` as the memory/safety limits of the worker (see 4.5). They are not user-facing run length.
- Faults keep `downAtMs` / `upAtMs`, measured from run start.

### 3.3 Cycle

A cycle is one source emission and everything it causes: the response leg and every descendant (retries, fan-out, published events, consumer work).

For a bulk source with N requests there are N cycles in the run, each tracked individually. Aggregates (per source and overall) report "N ok, M failed". The user's phrase "all of them need completion for a cycle to complete" is satisfied at the **bulk level**: the bulk completes when all N cycles have settled. Both are surfaced: per-cycle bands on the timeline, and a bulk summary band.

Cycle record:

```
Cycle = {
  id, sourceId, workloadId, class,
  startedAtMs,
  responseAtMs | null,          // response reached the source; null for one-way
  completedAtMs,                // last descendant settled
  outcome: ok | failed | rejected | timed-out | lost | expired | stuck,
  counts: { ok, failed, rejected, timedOut, lost, expired, stuck },   // over units in the cycle
  stuckItems?: { elementId, kind, count }[]
}
```

- `outcome` is the worst outcome among the cycle's units, ordered: ok < expired < rejected < timed-out < failed < lost < stuck (to be fixed in the plan against the kernel's existing outcome ranking; use that ranking if it already exists).
- A one-way message cycle has no response; it completes when the message is consumed.
- Response latency = `responseAtMs - startedAtMs`. Cycle completion latency = `completedAtMs - startedAtMs`. Both are reported; they differ when side effects outlive the response.

### 3.4 Settling and stuck work

Every unit reaches a terminal outcome. Order of detection:

1. **TTL (optional, per queue):** an item older than the queue's TTL settles as `expired`. New optional field on queue-like elements (to be located in the catalog during planning).
2. **Quiescence:** when the kernel has no event that could still occur, every unsettled unit settles as `stuck`, with the holder named ("3 messages in `orders-queue`, no consumer").
3. In an active stream, quiescence does not occur while sources emit. Backlogs show as growing queue depth. After Stop, drain proceeds until quiescence, then leftovers settle as `stuck`.

### 3.5 Run lifecycle

- All enabled sources start together at t = 0, each offset by its `startDelayMs`.
- A bulk source completes when all its cycles have completed.
- The run ends when every bulk source has completed, everything has settled, and no stream source is active.
- If any stream source is active, the run continues until the user presses Stop.
- **Stop:** all stream sources stop emitting. Bulk sources are not cut short unless they are still emitting: remaining unemitted requests are not sent, and the bulk reports `sent M of N`. In-flight work drains to completion or `stuck`. The recording is then finalized.
- Run states: `computing` (worker producing), `draining` (after Stop), `finished`, `failed`.
- The existing readiness gate (`checkReadiness`) still runs before a run.

## 4. Runtime

### 4.1 Worker

The worker steps the runner in a loop and streams the recording to the main thread. It no longer paces by wall clock. Instead it is throttled by the playhead (4.2). Seeded determinism is unchanged: the same scenario and seed produce the same recording.

Remove `speed`, `paceWallMs`, `paceSimMs`, `OPEN_RUN_MIN_SPEED`, and `RunController.setSpeed` / `getSpeed`. Remove the `studio.runSpeed` localStorage override; tests run with a playback speed that completes quickly or read the final recording directly.

### 4.2 Lookahead and history

- The main thread reports the playhead position (simulated ms) to the worker when it changes meaningfully, and on play/pause/seek.
- The worker computes until `simulatedMs >= playhead + LOOKAHEAD_MS`, then idles until the playhead advances.
- Defaults (all assumptions, tunable constants): `LOOKAHEAD_MS = 30_000`, `HISTORY_MS = 120_000`.
- **Bulk runs** that are bounded keep the full recording (subject to the event budget in 4.5).
- **Streams** keep the retained window `[playhead - HISTORY_MS, computed edge]`. Older events are discarded. The seeker's left bound moves with the window.
- **Pause** stops the playhead, so the worker idles after reaching the lookahead.
- **Stop** lifts the lookahead throttle so the drain runs to completion at full speed.

### 4.3 Checkpoints and results as of the playhead

- The worker emits a running-summary checkpoint every `CHECKPOINT_MS` of simulated time (default 5_000): cumulative counts and latency histograms, per-element utilization and queue depth, cycle outcome counts, and open-cycle state.
- Results at playhead `t` = the nearest checkpoint at or before `t`, plus events in `[checkpoint, t]` applied by the UI.
- Checkpoints older than the retained window are folded into a single baseline summary, so cumulative results stay correct for the whole run while raw events age out.
- The Results panel reads this model for all numbers; there is no separate "latest" view.

### 4.4 Protocol

- The existing `batch` updates carry trace events. They gain the flow records and cycle records (cycles are emitted at start and updated at response and completion).
- New worker-bound message: `playhead { runId, simulatedMs, playing }`. New updates: `checkpoint`, `window` (retained bounds), and `buffer` (worker state: `computing | idle-at-lookahead | draining | done`).
- Flow records stay live data (not in the exported trace) unless the plan decides to persist the finalized recording; see section 8.

### 4.5 Budgets

`budgets` stay as safety limits on the worker (event count, memory estimate for the retained window). If a limit is reached the run stops computing and reports `buffer full` honestly; it does not fabricate completion. A stream normally stays well within them because history is windowed.

### 4.6 Main-thread store

A `PlaybackStore` (new) holds the recording window, checkpoints, cycles and the playhead. It exposes `stateAt(t)` which returns, for any `t` in the window: unit positions on connections, per-node queue and active counts, cycle bands, and results. Canvas, timeline and Results all read from it. The store is the only place that interprets the recording.

## 5. Traffic states on the canvas

### 5.1 Unit states

For one request (and each of its descendants):

| State | Where it is shown |
| :-- | :-- |
| Sent | brief pulse at the source end of the connection |
| In transit (outbound) | packet moving along the connection toward the target |
| Arrived | brief tick at the target end |
| Queued | node: queue-depth bar |
| Processing | node: active ring with count |
| Forwarded | next connection starts a new outbound packet |
| In transit (returning) | packet moving back along the connection, visibly reversed |
| Settled | outcome flash at the source: ok, failed, rejected, timed-out, lost (packet fades out mid-line), expired, stuck |

### 5.2 Density

- Up to `PACKET_THRESHOLD = 6` units in transit on a connection: each is its own packet, none hidden.
- Above it: the connection switches to a labelled aggregate: count badge (for example "412 in flight"), a flow animation whose density follows load, and a split showing outbound versus returning.
- Clicking a connection opens a list of its units at the playhead.
- Nodes always show aggregates (queue depth, active count).

### 5.3 Rendering

Packet position is derived from `stateAt(playhead)`: for a unit leg `[sentAt, arriveAt]`, progress = `(t - sentAt) / (arriveAt - sentAt)`. No per-stage minimum display times and no sampling, since the playback clock owns pacing. Reduced-motion users get static markers with the same information.

The existing `livePackets.tsx` stage queue is removed. `TrafficEdge` keeps its path and heading logic and consumes `stateAt`.

Lifecycle cues use a 240 ms simulated-time window returned by `stateAt`: pause freezes them and seeking reconstructs them. Identical cues aggregate with exact counts, using the newest constituent's age. Normal motion expands/fades the send pulse; reduced motion keeps static symbols with the same counts. Decorations do not change node dimensions or port hit areas.

Outbound arrivals require a recorded admission or local queue/processing/settlement fact at the recorded arrival time; a planned leg endpoint alone is insufficient. Return arrivals and call outcomes use the recorded response leg's projected endpoint. Messages show recorded settlement at their source. Completed cycles show their recorded outcome above the captured workload entry node, including timeout/stuck. Known outbound loss appears mid-line without an arrival. A lost return with no recorded response leg cannot produce a return cue; no arrival or outcome is invented.

## 6. Timeline and playback UI

### 6.1 Track

- Time axis from the window's left bound to the computed edge (streams) or the whole recording (bulk).
- **Cycle bands:** each cycle is a band from `startedAtMs` to `completedAtMs`, coloured by outcome, with a mark at `responseAtMs`. For a bulk run with many cycles, a bulk band shows stacked in-flight counts and a density strip rather than N distinct bands (switch at a cycle-count threshold, default 200 visible bands).
- Fault windows and stuck regions are drawn as markers.
- The computed edge is indicated; the region beyond it is empty. The playhead cannot pass it.

### 6.2 Controls

| Control | Behavior |
| :-- | :-- |
| Play / Pause | moves or freezes the playhead; Pause also pauses lookahead |
| Seeker | scrub within the retained window |
| Speed | x0.25, x0.5, x1, x2, x4, x8, x16 of real time (assumed range) |
| Step | previous / next cycle |
| Loop | replays a finished bulk run from the start |
| Go live | jumps the playhead to the computed edge (streams) |
| Stop | ends emission, drains, finalizes the recording |
| Restart | begins a fresh run of the same scenario |

- Pressing Run starts playback automatically at x1.
- If the playhead catches the computed edge (computation slower than playback), playback waits and shows a "computing" state; it does not skip.
- After Stop, the recording stays scrubbable. Streams keep only the retained window.

### 6.3 Scenario editor

Remove: completion kind, requests count, horizon, run-speed, and any "n times" fields. Add per-source: mode, bulk requests and arrival shape, stream rate and profile, start delay. Run settings that remain: seed, budgets (advanced), faults, assumptions.

## 7. Testing

- **Kernel/runner unit tests:** cycle assembly (single, fan-out, async side effects), response vs completion latency, bulk completion, stream Stop and drain, TTL expiry, quiescence stuck detection with named holders, start delays, determinism for the same seed.
- **Playback store unit tests:** `stateAt` positions for legs, lost legs, returning legs; density switch at the threshold; checkpoint reconstruction equals a full replay; window eviction keeps cumulative results correct.
- **Protocol tests:** lookahead throttle (worker idles at the lookahead, resumes when the playhead advances), Stop lifts the throttle, `buffer full` honesty.
- **Playwright:** timeline renders bands; play, pause, seek, speed; seeking back changes Results; a stream runs until Stop; a bulk of N completes and reports `N ok`; packets and aggregates render and reduce-motion works; the scenario editor has no completion, pace, or speed fields; keyboard operation of the controls.
- Verification per CLAUDE.md: `npx tsc -b`, `npm test`, `npm run build` (Workspace chunk under 500 kB), isolated production Playwright.

## 8. Open items for the plan

These do not change the design, but the plan must resolve them:

1. Persisting a finalized bulk recording (for replay after reload) versus recomputing from the seed on open. Default assumption: recompute from the seed; nothing new is persisted beyond the scenario and the run summary.
2. Exact cycle outcome ranking, aligned with the kernel's `TransportOutcome`.
3. Which catalog elements get the optional queue TTL.
4. Worker/UI messaging rate for playhead updates, so the throttle does not flood the channel.
5. How `stateAt` stays within a frame budget for 100k+ events (indexing by connection and time).

## 9. Scope and sequencing

This is large and should be planned as separable stages, each shippable on its own:

1. **Domain and kernel:** workload emission model, cycle records, TTL, quiescence stuck, removal of `completion` and pace. Rewrite examples; reject old scenarios.
2. **Recording and worker:** throttle, checkpoints, window, protocol, `PlaybackStore`.
3. **Canvas traffic:** `stateAt`-driven packets, density switch, node queue and active displays.
4. **Timeline and controls:** track, bands, controls, results as of the playhead; scenario editor changes.

## 10. Not in scope

The floating connection bar, sequences of cycles, interactive manual triggering, and any compatibility layer for old scenarios or runs.
