# Unified simulation and playback integration

Status: implemented and verified. Unanswered product questions use the execution assumptions below. Accepted visual reference: `artifacts/design/unified-simulation-panel/`. Its fabricated scenarios/events and fixed grouping thresholds are demonstration data, not production contracts.

Acceptance: 1,803 unit tests passed, 11 opt-in tests skipped; production and Storybook builds passed; final isolated production Chromium suite passed 126 tests with 4 dev-only skips and no retries. Accessibility audit completed every desktop/phone journey with no axe violations. Ready/live/completed/range/cycle/mobile/narrow-container screenshots were inspected; independent source review accepted the integration. Large-recording inspection profiles passed at approximately 2M flow records / 72,732 distinct cycles; inherited cold reconstruction and compaction costs remain unchanged.

## Current functionality to preserve

Terminology corrected by the user: **simulation inspector** means the existing bottom Results inspection surface (`ResultsRegion`), including General metrics, checks, event log and Components. The right-side node/connection **configuration inspector** is a separate authoring surface. It is not being integrated into simulation inspection. Earlier answers about opening the “relevant inspector” refer to simulation event details, not automatically opening configuration editing; the earlier connection/sender/receiver and dirty-draft event-switch questions are withdrawn.

| Surface | Current behavior and source | Integration requirement |
| --- | --- | --- |
| Scenario control | `src/features/scenarios/ScenarioSwitcher.tsx`, Workspace lines 860–1157: scenario status/mode, selected scenario preference by project/branch, readiness reasons, New/Edit/Rename/Delete, Run all, commit readiness summary | Move the existing control into the unified bottom bar; preserve its menu and command callbacks. Do not substitute the prototype's native select or remove scenario management. |
| Execution | `src/features/runs/RunController.ts`: compile/start, active-run pause/resume, Stop ends emission and drains, Reset cancels/clears display while preserving saved runs, terminal save/retry, Run all queue | Keep one controller and the existing worker. Joined Run becomes simulation Stop while execution is active, including when playback is paused. Preparing/saving/draining have truthful disabled states. |
| Playback | `PlaybackPanel.tsx`, `playback.ts`, `RunController.ts`: retained recording, cycle steps, speeds ×0.25–×16, stream Go live, selected range, exact range end, loop, seek, eviction | Reuse the existing boundaries/accounting. Distinguish playback Stop from simulation Stop. Zoom is presentation state, independent of playhead and selected playback range. |
| Results inspection | `ResultsRegion.tsx`: compact summary, General metrics, checks, event log, Components metrics, trace truncation notice, save/retry, earlier-version notice | Preserve every capability and unavailable-value reason. Existing historical metrics/events remain at the playhead; checks and whole-run-only totals remain final-only. New range statistics require explicit interval/cohort definitions and actual telemetry. |
| Configuration inspector | `InspectorPanel.tsx`, Workspace draft/guard handling, `inspector/measured.ts`: configuration fields, Apply/Cancel, validation/stale/missing targets, guarded navigation, latest saved scenario-run measurements | Keep editing/guard semantics and last-run provenance. Do not silently change these values to playhead measurements. Preserve dock/float/stack/resize at desktop, dock at intermediate widths, sheet below 768 px. |
| Canvas inspection | `usePlaybackTraffic.tsx`, `TrafficEdge.tsx`: playhead-derived packets, node occupancy, lifecycle flashes, selected edge Units in transit | Continue reading the same playback store. Cycle-event highlighting must not accidentally change authoring selection or discard a dirty draft. |

Important existing differences from the prototype:

- Pause and seek currently send worker pause; interactive worker computation is constrained by a playhead lookahead allowance. Background capture while paused is an architecture change, not a toolbar refactor.
- Stream history currently retains 120 simulated seconds behind the playhead, with incremental eviction/checkpoint baselines. Moving capture independently would require an explicit retention policy and handling pinned historical inspection.
- Interactive recording is in memory. Saved runs retain summary/trace, not the full flow recording needed to reproduce playback after reopening.
- `Cycle` records start, response arrival, full completion, outcome and descendant counts. `FlowRecord` records communication/local phases but has no explicit public cycle/parent/branch/attempt metadata. Its key encodes unit/path; production UI must not rely on ad-hoc parsing of opaque keys.
- Host fault windows and actual request failures are different facts. Keep authored/captured outage intervals distinct from recorded failure-event markers.

## Execution assumptions (2026-10-05)

Execution started at the user's request, with lighter-model implementation and test agents. Preserve coupled worker/playback pause and current active Reset cancellation. Transport Stop pauses and seeks to range/history start; simulation Stop drains. Range membership uses overlapping lifetimes; range activity uses half-open [start,end) event instants, while selected-cycle inspection shows its retained lifetime. These defaults were presented for correction during execution.

Selected-cycle inspection has Overview, Components and Event log tabs in the right pane. Range summary is that pane's default. A separate Run results view within the same bottom surface preserves simulation metrics, component metrics, checks, event log, persistence status and earlier-version notices. It retains existing playhead/final provenance; it does not reuse whole-run metrics as cycle measurements.

## Proposed experience

One bottom surface within the canvas workspace, replacing the top-header run controls and separate playback toolbar. Authoring shows the compact scenario/Run/Reset row. A recording reveals the main timeline. Status changes do not resize these rows. Explicit detail expansion may change height within a bounded budget.

Desktop bar: existing scenario menu + joined Run/Stop, Reset, fixed-width status; playback on the right in the accepted order: previous cycle, slower, Play/Pause/Resume, playback Stop, faster, next cycle, Loop. Retain Go live for streams and a compact speed readout. Tools use foundation Button/Tooltip and Lucide; Loop uses pressed/toggle semantics. Keep simulation Stop's drain treatment distinct from playback Stop and Reset. Disabled controls explain their actual reason.

Timeline header: Activity density; Seek/Pan/Zoom in/Zoom out/Fit tools and current/recorded time. Clear range appears when selected. Exactly one time axis: drag empty timeline to select or replace a range, including inside the current highlight; drag the playhead to seek; drag handles to edit endpoints, with endpoint timestamps on the timeline. Selection edits pause/seek to start. Single click seeks. Pinch and trackpad zoom anchor around the gesture; pan changes only the visible window. Keyboard alternatives cover seeking, endpoint editing, zoom, pan and fit.

Full-width centered disclosure stays above its detail content in a stable slot: “Inspect Request Cycles,” with the expand/collapse icon. The whole row is clickable. Selecting a timeline area opens the bottom inspection panel. Hover summaries stay in popovers. Cycle rows are selectable; selecting one reveals its inspection in the right pane, replacing the earlier inline cycle-detail expansion. Group expansion reveals member rows in the left pane without placing cycle inspection there. No zoom-required placeholder. Group only locally crowded intervals, with actual summary counts and an expand action; sparse intervals retain individual rows. Determine grouping from visible interval, rendered width and row budget rather than copying the prototype's 12/40 cutoffs. Virtualize or page dense expansions so a spike cannot create tens of thousands of DOM rows.

Confirmed revised expanded area: a two-pane simulation inspector. **Left:** cycles belonging to the selected time range, including locally crowded groups and filters. **Right:** general statistics about that range by default; selecting a cycle replaces those statistics with all inspection details for that cycle. Communication/event details, sync/async branches, outcomes and timings all stay in the right pane. A “Range summary” back action clears cycle inspection and restores range statistics without losing the range, filters or left-list scroll position. Selecting a new range resets cycle/event selection and shows its summary. Main-timeline zoom changes the visible window, not membership of the selected range.

This supersedes the earlier top-level Request cycles / General metrics / Components tab layout. Preserve existing General metrics, Components, checks/event log and Results notices/actions as accessible views within simulation inspection, with explicit scope labels (range, cycle, playhead or whole run). Whole-run checks/save status must not be presented as range checks. Run results is first and default when opening inspection; selecting a timeline range opens Request cycles. Results/provenance and the key cycle summary live inside Run results, without a duplicated external footer. Without a range, the cycle list uses the retained recording; no new range aggregation is inferred from that fallback.

Metric presentation: totals are cumulative through the playhead; queued, active, in-flight and cache-entry counts are instantaneous at it. Throughput and utilization are averages from simulation start; latency means/percentiles summarize the successful observation cohort. A live frontier is still a playhead scope, not a final run. Whole-run checks and execution totals are available only at the completed recording end. Selected-cycle views cover its full retained lifetime and can extend beyond the playhead; selected-range statistics count interval events and explicitly name latency cohorts.

Timeline refinement: timestamps share one horizontal legend row below the track, with collision spacing preserving full values. Desktop tools overlay the top right on hover or keyboard focus; touch tools stay visible in a horizontally scrollable row outside the chart's gesture area. Resizing can collapse the timeline completely; its divider remains above the inspection disclosure and restores the track without changing the playhead or range.

Range statistics are now explicitly in scope. Define interval membership and boundary semantics before implementation. Proposed measurements include starts/responses/completions/failures during the interval, cycles active at its boundaries, peak concurrency and available measured latency distributions with a clearly named cohort. Do not subtract cumulative means, percentiles, maxima or gauges to manufacture interval metrics. Compute from indexed recorded events/deltas where possible; show unavailable/incomplete where retained telemetry cannot support a metric. Final run assertions remain whole-run only. Selected-cycle lifetime statistics are different from interval activity statistics and must be labelled accordingly.

Cycle detail: sync response path and asynchronous descendant branches, aligned to the main timeline's visible window. Show response latency separately from all-work completion. Async work can begin before the response; classify by causal channel/parentage, never by “after response” timing. Preserve independent response and descendant outcomes: an async failure must not imply the response failed. Do not show HTTP codes, payloads or other details absent from telemetry. Open/stuck/late-reopened cycles and incomplete retained history require explicit states.

Selecting a recorded event pauses/seeks to its exact observed time, highlights its actual nodes/connection, and opens recorded communication/failure facts within the right pane's cycle inspection. Event Back returns to that cycle's overview; Range summary returns to range statistics. The left cycle list, filters and scroll position remain intact. Highlight state is ephemeral and separate from authoring selection. It does not open or replace the right-side configuration inspector, change its selected target, or trigger its dirty-draft navigation guard. Existing deliberate canvas selection/editing continues to use that guard. Out-of-view endpoints should offer navigation to their canvas view rather than inventing placements.

Narrow layouts use actual available canvas width (including docked panels), not just viewport width. Keep selector/Run/Reset/status together; wrap transport in predictable 44 px touch-target rows. Timeline remains full width. Confirmed mobile simulation details use a bounded sheet with an explicit close/back action and restored focus; coordinate with existing configuration Inspector/Library/History overlays so only one sheet occupies that area. Event selection reveals details in the simulation sheet rather than switching to configuration editing. Preserve cycle/tab/scroll context. Long press/focus/tap provides the hover-summary information on touch. Verify selection versus one-finger pan and two-finger pinch without accidental seeks.

## Decisions requiring answers

1. Confirmed correction: integrate and preserve the simulation Results inspector. The right-side node/connection configuration inspector remains separate and unchanged; preserve coexistence and Units in transit.
2. Does playback Pause/seek keep live computation running, or retain current coupled pause? Independent capture requires changes to worker lookahead, retention, terminal delivery and memory budgets.
3. Is Reset available during active execution (current cancellation behavior), or only after draining (prototype behavior)? Saved runs stay intact either way.
4. Does transport Stop pause and return to range/retained-recording start, while simulation Stop drains? This is the proposed distinction.
5. Confirmed revision: left pane lists range cycles; right pane shows range statistics or selected-cycle inspection. This replaces the earlier top-level tab arrangement; existing Results capabilities remain accessible with clear provenance.
6. Confirmed: all cycle/event inspection is in the right pane of the bottom simulation inspector. It must not automatically open the configuration inspector. Prior configuration-target/guard questions are withdrawn.
7. Confirmed: preserve current in-memory replay scope; no saved recording replay after reopening.
8. Confirmed: bounded details sheet on mobile, coordinated with the existing inspector sheet.

Follow-up decisions if independent capture is chosen: how much simulated history is retained, whether inspection may pin a selected range beyond the rolling window, what happens when that range expires, and what pace advances capture while playback speed changes. Avoid unbounded retention or a stream running as fast as the worker can compute.

Range decisions pending: include any cycle overlapping the selected interval, or only cycles started within it; summarize interval activity, or full recorded lifetimes of the selected cycle cohort. Do not treat these alternatives as equivalent.

## Implementation sequence

### 1. Lock behavior and regression inventory

Resolve the questions above and update this plan with decisions. Record an availability matrix for ready, preparing, live, playback paused, draining, saving, completed, range ended, failed/cancelled/incomplete, missing scenario, readiness failure, dirty draft and stale results. Include logical runs and Run all: preserve their results and execution controls without inventing timed playback. Decide scenario-menu behavior when a different scenario is selected while a recording belongs to the current run; visibly identify recording provenance and prevent accidental run replacement.

Read and update the relevant command/run/model/storage contracts and decision ledger to reflect the approved layout/behavior. Capture current production desktop/phone and keyboard baseline, including configuration guard and Results inspection.

### 2. Establish a single control/view model

Extract a typed unified panel model and availability selectors in `src/features/runs/`; keep RunController authoritative. Separate execution lifecycle, playback playing/position, save status, visible timeline window, range, cycle selection and inspection focus. Derive labels without overloading a single “paused” state. Use an observable playback snapshot/version so toolbar, canvas and Results stay consistent; avoid adding another polling loop per detail row.

Add slower/faster commands around the existing speed list and explicit playback-stop behavior if confirmed. Preserve exact-end loops, new-run cleanup, Go live/Stop range clearing, eviction clamps, save-once and retry behavior. If independent capture is chosen, implement/test controller + worker scheduling/retention changes here before connecting the new UI. Finalization must not wait forever for a paused historical playhead, and replay must never trigger another save.

### 3. Add truthful indexed cycle inspection

Audit available lifecycle facts and establish explicit ephemeral cycle/unit/parent/branch/attempt identities where current FlowRecord lacks them. Extend adapter/protocol telemetry minimally if necessary; do not alter kernel scheduling/accounting/random draws. Build bounded query indexes for cycles/events by selected interval, visible window, node, outcome and selected cycle. Add interval/cohort statistics queries under the agreed boundary rules; preserve provenance and incomplete-history flags. Handle streamed revisions and same-millisecond batches, retries, router retries, broker redelivery, broadcast branches, absent/lost responses, stuck work, reopened cycles and eviction.

Expose measured sync response and causal async branches, group summaries and completeness flags. Reuse `stateAt`, `resultsAt`, cycle revisions and recorded endpoints rather than reconstructing a parallel simulation. Validate sample S06 plus message/retry/broadcast architectures. Profile indexing/eviction before UI integration; existing large-history compaction/cold-read limits remain explicit.

### 4. Build the unified foundation-based surface

Refactor ScenarioSwitcher to preserve its management menu while supporting the new Run/Stop treatment and external Reset. Add `SimulationPanel` with transport, timeline and preserved Results content. Extract Results content from its existing footer shell as needed; preserve notices, General/Components behavior and save retry. Lazy-load detail UI using the repo's `lazyComponent` helper; maintain chunks below 500 kB.

Build the bounded desktop left-list/right-inspection split. Range selection opens it with range summary; cycle selection replaces only the right pane; event selection stays within that pane. Preserve list state across inspection navigation. On mobile, keep the confirmed bounded sheet and use list → cycle detail navigation with Back restoring the list, plus an accessible Range summary view; do not squeeze two panes side by side.

Replace PlaybackTimeline's stacked sliders with one zoomable timeline and accessible overlaid playhead/range handles. Reuse foundation Slider where appropriate; make foundation changes and Storybook stories first if shared primitives need new semantics. Range overlays pass pointer input through except at handles. Keep zoom/window changes independent of playback and range. Add local crowding/group layout, virtualized rows, hover summaries and selected expansion from the real indexes.

### 5. Integrate workspace, inspection and responsive layout

Remove duplicate top-bar execution actions while preserving command registry/menu access. Mount one bottom panel without bypassing Results visibility/focus commands. Wire ephemeral event highlights into canvas presentation without modifying authored model/view metadata. Preserve the configuration inspector, guarded drafts, measured-last-run provenance, scenario editor and panel-host preferences.

Implement responsive height/width budgets with the panel host and mobile overlay coordinator. Keep canvas usable with Library/History/Inspector open, short laptop heights, 320 px screens, touch targets and screen zoom. Do not resize rows as timestamps/status change. Restore keyboard focus when closing a popover/detail/sheet; honor reduced-motion flashes.

### 6. Acceptance and cleanup

Unit coverage: controller availability/speed/stop/range semantics; exact boundaries, loop, Go live, new runs, eviction, terminal/save once; cycle association/branch correctness, revisions and group counts; interval membership and statistics for cycles crossing either/both boundaries, same-time events and incomplete/evicted history; no invalid percentile/mean subtraction; lookup budgets. Port superseded UI tests before removing old controls.

Production browser coverage: all accepted states plus preparing/draining/saving/error; timeline replacement range inside selection, draggable playhead/endpoints, click seek, keyboard and native touch pinch/pan; previous/next distinct concurrent starts; group expansion/filtering, hover/focus summaries and sync/async outcomes; event detail/highlight leaves a dirty right-side configuration draft, its target and fields intact without a navigation prompt; deliberate authoring actions retain Apply/Discard/Stay guards; last-run measurements; simulation metrics/checks/event log, save retry, Run all/logical runs, scenario management, project/branch navigation and stale-result labels.

Verify desktop with docked/floating inspector, intermediate width, 390/320 px phones and short viewports. Profile the existing 72k-cycle fixture for warm playback/query/render cost and memory retention; dense expansion must stay bounded. Run TypeScript, units, production build, Storybook, and full production Playwright on an isolated port with two workers/no retries. Follow LESSONS: an axe-clean run also needs keyboard focus and 320 px reflow/native-touch checks. Obtain independent final source review, update ACTION_LOG/HANDOFF/contracts, and report remaining measured limitations.

## Scope boundaries

Preserve kernel goldens, FIFO/retry/latency accounting, model/view separation, current portable v9 validation and the retired database boundary. Range statistics are authorized; derive them only from supported measurements under explicit interval/cohort definitions. Do not add persisted ranges or durable replay. The design prototype remains a visual/interaction reference; production data and existing command/inspection contracts control implementation.
