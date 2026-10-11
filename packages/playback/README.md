# @canvas-one/playback

Headless timeframe contracts and bounded seek, advance and range operations extracted from the existing recording playback. Import from `@canvas-one/playback`; no timers, UI, recording storage or simulation dependencies are loaded.

The caller supplies available time, retained start and optional final end. A live recording can advance its available edge independently. Invalid range input returns `undefined` (retain the current selection), while an empty range returns `null`.

`PlaybackProvenance` distinguishes authored/example communication animations from recorded playback. These operations do not calculate measured system metrics. Recording indexes and simulation controls remain in the app until the simulation extraction phase.
