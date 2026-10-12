# @canvas-one/playback

Headless timeframe contracts and bounded seek, advance and range operations extracted from the existing recording playback. Import from `@canvas-one/playback`; no timers, UI, recording storage or simulation dependencies are loaded.

The caller supplies available time, retained start and optional final end. A live recording can advance its available edge independently. Invalid range input returns `undefined` (retain the current selection), while an empty range returns `null`.

`PlaybackProvenance` distinguishes authored/example communication animations from recorded playback. These operations do not calculate measured system metrics.

`@canvas-one/playback/timeline` supplies pure pan, zoom, range and pointer-to-time geometry. Hosts translate their own pointer events into these numeric inputs. `@canvas-one/playback/traffic` owns renderer-neutral traffic activity contracts; a host supplies recorded or authored values and chooses its own visual interface.

System-design recording stores, cycle indexes, retained flashes, measured traffic queries and cycle density layout live in `@canvas-one/simulation-system-design/playback`. The execution controller belongs to that package; the app owns controls and composes its injected clock/worker lifecycle.
# Generic track controller

`PlaybackController<Frame>` owns play/pause, finite positive speed (up to 64×),
seek, selection ranges, looping, subscriptions and teardown. `TrackSource<Frame>`
provides explicit authored/example/recorded provenance, a millisecond retention
window and frame reads. Frames must be structured-cloneable plain data; snapshots
are deeply frozen. A missing frame stays `null`; the controller invents no metrics.
Combined tracks use the intersection of retained frontiers. Live playback waits
at that frontier and resumes when track subscriptions report more available data.

Hosts supply a monotonic clock; no browser timer is imported. Manual ticks work:

```ts
let elapsedMs = 0;
const playback = new PlaybackController({
  clock: { now: () => elapsedMs },
  tracks: [{
    id: 'illustrative-flow',
    provenance: { kind: 'example', description: 'Authored communication animation' },
    getWindow: () => ({ retainedStartMs: 0, frontierMs: 1000, durationMs: 1000, live: false, seekable: true }),
    read: (timeMs: number) => ({ progress: timeMs / 1000 }),
  }],
});
playback.play();
elapsedMs = 250;
playback.tick(); // sample progress 0.25, with example provenance
playback.dispose();
```

A host may instead provide `clock.subscribeTick(listener)` returning a cleanup
function. Controller disposal also removes track subscriptions. The optional
system-design `createRecordingTrackSource` adapts recording reads to this contract
without replacing the existing app recording clock.
