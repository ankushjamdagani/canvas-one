import { describe, expect, it, vi } from 'vitest';
import { PlaybackController, type TrackSource, type TrackWindow } from '@canvas-one/playback';
import { createRecordingTrackSource, PlaybackStore } from '@canvas-one/simulation-system-design/playback';

function setup(window: TrackWindow = {retainedStartMs: 0, frontierMs: 1000, durationMs: 1000, live: false, seekable: true}) {
  let time = 0; let update = () => {}; let pulse = () => {};
  const releaseTrack = vi.fn(); const releaseClock = vi.fn();
  const track: TrackSource<{atMs: number}> = {id: 'motion', provenance: {kind: 'authored', description: 'Point motion'},
    getWindow: () => window, read: atMs => ({atMs}), subscribe: listener => {update = listener; return releaseTrack;}};
  const controller = new PlaybackController({tracks: [track], clock: {now: () => time,
    subscribeTick: listener => {pulse = listener; return releaseClock;}}});
  return {controller, releaseTrack, releaseClock, at: (value: number) => {time = value;}, pulse: () => pulse(),
    update: (value: TrackWindow) => {window = value; update();}};
}

describe('generic playback', () => {
  it('adapts recording reads without replacing the store playhead or synthesizing metrics', () => {
    const store = new PlaybackStore({connectionTargets: new Map(), historyMs: null});
    store.setComputedEdge(100); store.setEnded(100);
    const track = createRecordingTrackSource({recordingId: 'saved-run', store});
    const controller = new PlaybackController({tracks: [track], clock: {now: () => 0}});
    controller.seek(50);
    expect(store.playheadMs).toBe(0);
    expect(controller.getSnapshot().tracks[0]).toMatchObject({provenance: {kind: 'recorded', recordingId: 'saved-run'}, frame: {atMs: 50, checkpoint: null, nodes: []}});
    expect(track.read(101)).toBeNull(); expect(track.read(NaN)).toBeNull(); controller.dispose();
  });
  it('catches up to the pause instant and supports clocks that notify while registering', () => {
    let time = 0; const subscribe = vi.fn((listener: () => void) => {time = 50; listener(); return () => {};});
    const track: TrackSource<number> = {id: 'sync', provenance: {kind: 'example', description: 'Authored values'}, read: at => at,
      getWindow: () => ({retainedStartMs: 0, frontierMs: 1000, durationMs: 1000, live: false, seekable: true})};
    const controller = new PlaybackController({tracks: [track], clock: {now: () => time, subscribeTick: subscribe}});
    controller.play(); expect(subscribe).toHaveBeenCalledOnce(); expect(controller.getSnapshot().positionMs).toBe(50);
    time = 80; controller.pause(); expect(controller.getSnapshot()).toMatchObject({phase: 'paused', positionMs: 80}); controller.dispose();
  });
  it('keeps loop overshoot and speed changes deterministic with immutable authored frames', () => {
    const host = setup(); const initial = host.controller.getSnapshot();
    expect(host.controller.getSnapshot()).toBe(initial);
    expect(Object.isFrozen(initial.tracks[0].frame)).toBe(true);
    expect(initial.tracks[0].provenance.kind).toBe('authored');
    host.controller.setRange({startMs: 100, endMs: 300}); host.controller.setLoop(true); host.controller.play();
    host.at(1050); host.pulse(); expect(host.controller.getSnapshot().positionMs).toBe(150);
    host.controller.setSpeed(2); host.at(1100); host.pulse(); expect(host.controller.getSnapshot().positionMs).toBe(250);
    host.at(1125); host.pulse(); expect(host.controller.getSnapshot().positionMs).toBe(100);
    host.controller.dispose();
  });
  it('stops at ranges and rejects invalid commands without manufacturing time', () => {
    const host = setup(); host.controller.setRange({startMs: 200, endMs: 400}); host.controller.play();
    host.at(9000); host.pulse(); expect(host.controller.getSnapshot()).toMatchObject({phase: 'paused', positionMs: 400});
    host.controller.seek(-100); expect(host.controller.getSnapshot().positionMs).toBe(200);
    expect(host.controller.setRange({startMs: 0, endMs: 2000}).status).toBe('invalid');
    expect(host.controller.setSpeed(Infinity).status).toBe('invalid');
    expect(host.controller.tick(-1).status).toBe('invalid'); host.controller.dispose();
  });
  it('waits at live frontiers then resumes and clamps evicted history', () => {
    const host = setup({retainedStartMs: 0, frontierMs: 100, durationMs: null, live: true, seekable: true});
    host.controller.play(); host.at(500); host.pulse(); expect(host.controller.getSnapshot()).toMatchObject({phase: 'waiting', positionMs: 100});
    host.at(800); host.update({retainedStartMs: 50, frontierMs: 250, durationMs: null, live: true, seekable: true});
    expect(host.controller.getSnapshot().phase).toBe('playing'); host.at(850); host.pulse();
    expect(host.controller.getSnapshot().positionMs).toBe(150);
    host.update({retainedStartMs: 200, frontierMs: 250, durationMs: 250, live: false, seekable: true});
    expect(host.controller.getSnapshot().positionMs).toBe(200);
    host.at(1000); host.pulse(); expect(host.controller.getSnapshot()).toMatchObject({phase: 'paused', positionMs: 250});
    host.controller.dispose();
  });
  it('replays an explicit completed range on a still-live track', () => {
    const host = setup({retainedStartMs: 0, frontierMs: 500, durationMs: null, live: true, seekable: true});
    host.controller.setRange({startMs: 100, endMs: 200}); host.controller.play();
    host.at(300); host.pulse(); expect(host.controller.getSnapshot()).toMatchObject({phase: 'paused', positionMs: 200});
    host.controller.play(); expect(host.controller.getSnapshot()).toMatchObject({phase: 'playing', positionMs: 100});
    host.controller.dispose();
  });
  it('cleans tracks, clock and observers once and fences late notifications', () => {
    const host = setup(); const observe = vi.fn(); host.controller.subscribe(observe); host.controller.play();
    const calls = observe.mock.calls.length; host.controller.dispose(); host.controller.dispose(); host.at(100); host.pulse();
    host.update({retainedStartMs: 0, frontierMs: 500, durationMs: 500, live: false, seekable: true});
    expect(observe).toHaveBeenCalledTimes(calls); expect(host.releaseTrack).toHaveBeenCalledOnce();
    expect(host.releaseClock).toHaveBeenCalledOnce(); expect(host.controller.seek(10).status).toBe('disposed');
  });
  it('does not read a released clock or revive disposed playback from late ticks', () => {
    const now = vi.fn(() => 0);
    const track: TrackSource<number> = {id: 'closed-clock', provenance: {kind: 'example', description: 'Values'}, read: at => at,
      getWindow: () => ({retainedStartMs: 0, frontierMs: 100, durationMs: 100, live: false, seekable: true})};
    const controller = new PlaybackController({tracks: [track], clock: {now}});
    controller.dispose(); now.mockImplementation(() => {throw new Error('Clock disposed');});
    expect(controller.tick().status).toBe('disposed'); expect(controller.getSnapshot().phase).toBe('disposed');
  });
  it('intersects track retention windows and honors nonseekable sources', () => {
    const base: TrackSource<number> = {id: 'first', provenance: {kind: 'example', description: 'Illustrative'}, read: at => at,
      getWindow: () => ({retainedStartMs: 100, frontierMs: 400, durationMs: 400, live: false, seekable: true})};
    const second: TrackSource<number> = {...base, id: 'second', getWindow: () => ({retainedStartMs: 200, frontierMs: 300, durationMs: 300, live: false, seekable: false})};
    const controller = new PlaybackController({tracks: [base, second], clock: {now: () => 0}});
    expect(controller.getSnapshot().available).toEqual({startMs: 200, endMs: 300});
    expect(controller.seek(250).status).toBe('unavailable'); controller.dispose();
  });
});
