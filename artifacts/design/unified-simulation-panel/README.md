# Unified simulation and playback panel

Design proposal only; application source and simulation behavior are unchanged.

The interactive canvas preview switches between ready, live, paused with range, and completed states. Four persistent specimens show all states together, followed by a narrow-screen specimen and behavior annotations. Sample history is illustrative. Tools use the actual application Button, NativeSelect, Switch, Slider, Tooltip, Lucide icons, font files, and CSS tokens.

## View and rebuild

From the repository root:

```sh
npm run dev -- --config artifacts/design/unified-simulation-panel/vite.config.mjs --host 127.0.0.1 --port 5188 --strictPort
npx vite build --config artifacts/design/unified-simulation-panel/vite.config.mjs
node artifacts/design/unified-simulation-panel/verify.mjs
```

Open http://127.0.0.1:5188/ for the interactive prototype. The exported `preview/` directory can be served by any static HTTP server. Its HTML uses local scripts, CSS, and fonts and needs no external network requests.

Verification covers all four states at 1440, 1024, 736, 390, and 320 px, stable recording-panel height, touch targets and detail-height cap at 320×640, playback range end, loop, clear, reset, Go Live, Stop/drain, and keyboard range edits. Browser verification requires permission to launch Chromium in this environment. Application unit, production browser, and Storybook suites are outside scope because no app or foundation source was edited.

## Behavior contract

- Ready: Run is primary; Stop, Reset, and recording expansion are disabled. No empty timeline or transport.
- Recording: primary Play/Pause inspects history; simulation execution continues when playback pauses. Clay Stop ends emission and drains. Reset and scenario changes are disabled while the run is active.
- Stream: Go Live clears selection and loop, seeks the recorded edge, and follows incoming history. The command shows Live while already following.
- Range: editing either handle pauses and seeks to its start. Playback stops exactly at its end and reports Range ended, or loops to its start. Clear Selection restores whole-recording playback. Seeking remains unrestricted.
- Completed: Play replays the recording. Run starts a fresh simulation; Reset clears history without starting a run.
- Draining: status occupies the same fixed slot; Run, Stop, and Reset are disabled. Playback remains available.
- Responsive: above 760 px, setup/execution/status and transport/time occupy separate rows. Below 760 px, setup takes a row and time wraps under transport. Below 400 px, range controls wrap and timeline ticks reduce to endpoints. Touch details scroll within a viewport-aware cap; the host app should budget at least 240 px of canvas and use the chevron to collapse details.

The preview does not execute the simulation kernel, calculate results, persist recordings, or implement real cycle stepping. Previous/next demonstrate cycle navigation using illustrative intervals.

## Main timeline and cycle rows

There is one overview timeline. Its activity-density bars are derived from the 144 deterministic sample cycles intersecting each time interval, including background work after response. Failures occupy a separate thin track within that same time domain.

Zoom in/out and Fit recording are tools beside the main timeline. Trackpad pinch (Ctrl/Meta wheel) and native two-touch pinch zoom around the gesture midpoint directly on it. Hand mode, Shift-drag, and horizontal trackpad scrolling pan the visible domain. Seek mode clicks/drags the playhead. Zoom and pan never alter the playback range or seek playback. Range handles are shown when both endpoints are visible; Fit restores access when they are outside the viewport.

Inspect cycles always displays recordings in the main timeline's current domain. All cycles/Failures and a node selector filter the view. More than 40 visible cycles are grouped into up to 12 time buckets, with cycle/response/failure counts, average response latency, and hover summaries. Clicking a group expands its individual cycles in place without changing zoom, playback, or the selected range. Smaller sets show individual cycles directly.

Range selection, its timestamps, Clear Selection, and Loop are grouped with Play/Pause, stepping, and speed above the main timeline. The playback cluster wraps within the same area on narrow screens.

Hover/focus opens a foundation HoverCard popover with response latency, total work time, visual sync/async bars, and background failure status. It does not alter row geometry, playback, or selection. Clicking anywhere on a cycle row selects it and expands its flow inline; clicking again collapses it while retaining selection. The chevron, Enter/Space, and touch tap perform the same action. Escape collapses the detail.

Expanded rows show request/response and separate receipt-email and analytics branches on a cycle-relative axis. C-0843 returns HTTP 200 in 640 ms; all work settles at 1,820 ms, including a failed analytics export. Background failure preserves the successful response. Selecting any event seeks playback and shows its communication/outcome/latency; adjacent canvas endpoints are highlighted where represented.

Verification includes single main timeline, main-timeline native touch/trackpad pinch, pan/Fit, shared cycle scale, unchanged playback range and playhead during gestures, full-row selection/inline expansion, hover popover without reflow, keyboard/touch activation, and narrow-screen/canvas-height constraints. Physical trackpad testing was not performed.

Preview images: `single-timeline.png` for the corrected panel, `cycle-hover-summary.png` for the hover popover, and `sync-async-detail.png` for selected flow detail.

Latest toolbar: scenario and Run/Stop form one control, with Reset alongside. Playback is right-aligned on desktop: previous cycle, slower, Play/Pause, Stop playback, faster, next cycle, Loop. Speed is a readout with icon adjustment. The chevron reveals cycle details; the main timeline remains visible. Drag empty timeline space to select a range, drag the playhead to scrub, and adjust range handles with endpoint timestamps. Hand pans; pinch zooms. On mobile the transport uses two rows of 44 px controls, and cycle details scroll within a canvas-preserving height cap.
