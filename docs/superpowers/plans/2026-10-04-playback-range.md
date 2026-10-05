# Playback range selection

Select a start/end interval within the retained recording. Play stops at its end; Loop repeats it. Seeking remains available across the recording. Canvas and Results continue to show the actual playhead, not filtered range totals.

1. Add an optional in-memory range to PlaybackStore and controller playback boundaries. Pause when selection changes, replay from its start, preserve terminal/save behavior, and clamp after eviction. Go live and Stop clear the range. Unit-test range bounds, exact stopping, looping, unfinished runs and save-once replay.
2. Extend the foundation Slider with distinct accessible thumb labels/value text; add a range story. Add a selection tool, highlighted interval and start/end handles to the existing timeline. Preserve full-recording behavior and responsive canvas space.
3. Verify keyboard selection, range playback/loop/clear and narrow viewports in production browsers. Run TypeScript, units, production build (<500 kB), Storybook and the isolated full production suite. Independently review source, update log/HANDOFF/spec/decision and commit. Preserve unrelated design-proposal docs.

No simulation, persisted recording, per-range results or cycle/request filtering.

Completed 2026-10-05. Store/controller range boundaries, eviction, unfinished-run pause, live/finished loops and save-once terminal behavior are covered by unit tests. Distinct foundation slider handles and the timeline interval passed keyboard and 320 px touch browser checks. TypeScript, 1,789 unit tests (10 skipped), production build (Workspace 473.88 kB), Storybook and isolated production browser suite (122 passed, 4 dev-only skipped) passed. Independent source review passed; see D61 and ACTION_LOG.
