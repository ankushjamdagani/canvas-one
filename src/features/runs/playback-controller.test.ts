/**
 * D57: RunController plays the worker's recording: a playhead clock, with flow, trace events and the final
 * result released as the playhead passes them.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document, Emission } from '../../domain/studio/model';
import type { StudioRepository } from '../../persistence/studio/types';
import { InProcessTransport } from './inProcessTransport';
import { RunController, type PlaybackClock } from './RunController';
import { WorkerProtocolHandler, type HostMessage } from './protocol';

const s06 = JSON.parse(readFileSync(join(process.cwd(), 'specs/revamp/fixtures/s06.json'), 'utf8')) as Document;

function docWith(emission: Emission): Document {
  return {
    ...s06,
    scenarios: s06.scenarios.map((s, i) => (i === 0 ? { ...s, workloads: s.workloads.map((w) => ({ ...w, emission })) } : s)),
  };
}

/** A clock the test moves by hand. */
function manualClock() {
  let now = 0;
  let seq = 0;
  const tasks: { at: number; run: () => void; id: number }[] = [];
  const clock: PlaybackClock = {
    now: () => now,
    schedule: (run, ms) => {
      const id = ++seq;
      tasks.push({ at: now + ms, run, id });
      return id;
    },
    cancel: (handle) => {
      const i = tasks.findIndex((t) => t.id === handle);
      if (i >= 0) tasks.splice(i, 1);
    },
  };
  /** Moves real time forward in 16 ms steps, running what is due and letting the worker compute in between. */
  const advance = async (ms: number) => {
    for (let t = 0; t < ms; t += 16) {
      now += 16;
      for (const task of tasks.filter((x) => x.at <= now)) {
        tasks.splice(tasks.indexOf(task), 1);
        task.run();
      }
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  return { clock, advance };
}

function setup(emission: Emission, speed: number) {
  const { clock, advance } = manualClock();
  const saved: unknown[] = [];
  const repository = {
    saveRun: async (...args: unknown[]) => {
      saved.push(args);
      return { status: 'applied' };
    },
  } as unknown as StudioRepository;
  const handler = new WorkerProtocolHandler((m: HostMessage) => queueMicrotask(() => transportListeners.forEach((l) => l(m))), { stepBatchSize: 500 });
  const transportListeners = new Set<(m: HostMessage) => void>();
  const transport = new InProcessTransport(handler);
  // The transport above delivers to its own listeners only when built without a handler; wire ours.
  const originalOn = transport.onMessage.bind(transport);
  transport.onMessage = (listener) => {
    transportListeners.add(listener);
    const off = originalOn(listener);
    return () => {
      transportListeners.delete(listener);
      off();
    };
  };
  const controller = new RunController({ repository, transport, mintId: () => crypto.randomUUID(), clock });
  controller.setPlaybackSpeed(speed);
  const doc = docWith(emission);
  const params = { projectId: 'p', branchId: 'b', snapshotId: 'snap', document: doc, scenarioId: doc.scenarios[0].id };
  /** Moves the manual clock on until `what` holds, giving up after `maxMs` of real time. */
  const until = async (what: () => boolean, maxMs = 20000) => {
    const deadline = Date.now() + maxMs;
    while (!what() && Date.now() < deadline) await advance(16);
  };
  return { controller, params, advance, until, saved };
}

describe('playback pacing (D57)', () => {
  it('plays and loops a selected interval without saving again, then clears it', async () => {
    const { controller, params, until, advance, saved } = setup({ mode: 'bulk', requests: 3, arrival: { spreadMs: 2000 } }, 16);
    void controller.run(params);
    await until(() => controller.getState().phase === 'done');
    const store = controller.getPlayback()!;
    controller.setPlaybackRange({ startMs: 200, endMs: 600 });
    expect(store.playheadMs).toBe(200);
    expect(store.playing).toBe(false);
    controller.resume(); await advance(64);
    expect(store.playheadMs).toBe(600);
    expect(store.playing).toBe(false);
    expect(store.atEnd()).toBe(false);
    expect(saved).toHaveLength(1);
    controller.seek(1000); controller.setLoop(true); controller.resume();
    expect(store.playheadMs).toBe(200);
    await advance(64);
    expect(store.playheadMs).toBeGreaterThanOrEqual(200);
    expect(store.playheadMs).toBeLessThan(600);
    expect(store.playing).toBe(true);
    controller.setLoop(false); controller.setPlaybackRange(null);
    expect(store.selection).toBeNull();
    controller.resume(); await until(() => !store.playing);
    expect(store.atEnd()).toBe(true);
    expect(saved).toHaveLength(1);
    controller.reset();
  }, 30000);

  it('pauses an unfinished run at a selected end without releasing the whole result', async () => {
    const { controller, params, until, advance, saved } = setup({ mode: 'bulk', requests: 3, arrival: { spreadMs: 8000 } }, 1);
    void controller.run(params);
    await until(() => (controller.getPlayback()?.computedMs ?? 0) > 1000);
    const store = controller.getPlayback()!;
    controller.setPlaybackRange({ startMs: 100, endMs: 500 });
    controller.resume(); await advance(640);
    expect(store.playheadMs).toBe(500);
    expect(store.playing).toBe(false);
    expect(controller.getState().phase).toBe('paused');
    expect(controller.getState().current?.terminal).toBeNull();
    expect(saved).toHaveLength(0);
    controller.setPlaybackSpeed(16); controller.setPlaybackRange(null); controller.resume();
    await until(() => controller.getState().phase === 'done');
    expect(saved).toHaveLength(1);
    controller.reset();
  }, 30000);

  it('finalizes once when a selection ends at the whole-run end and loops from its start', async () => {
    const { controller, params, until, advance, saved } = setup({ mode: 'bulk', requests: 3, arrival: { spreadMs: 3000 } }, 1);
    void controller.run(params);
    await until(() => controller.getPlayback()?.ended === true);
    const store = controller.getPlayback()!;
    controller.setPlaybackRange({ startMs: 500, endMs: store.endMs! });
    controller.setPlaybackSpeed(16); controller.setLoop(true); controller.resume();
    await until(() => controller.getState().phase === 'done');
    await advance(32);
    expect(saved).toHaveLength(1);
    expect(store.playing).toBe(true);
    expect(store.playheadMs).toBeGreaterThanOrEqual(500);
    expect(store.playheadMs).toBeLessThan(store.endMs!);
    controller.reset();
  }, 30000);
  it('rejects unsupported speeds without changing the current speed', () => {
    const { controller } = setup({ mode: 'bulk', requests: 1, arrival: { spreadMs: 0 } }, 1);
    for (const speed of [0, Infinity, NaN, 3, -1]) expect(() => controller.setPlaybackSpeed(speed)).toThrow(RangeError);
    expect(controller.getPlaybackSpeed()).toBe(1);
    controller.reset();
  });

  it('Run all completes timed scenarios with a frozen clock and no interactive recording', async () => {
    const { controller, params, saved } = setup({ mode: 'bulk', requests: 3, arrival: { spreadMs: 2000 } }, 0.25);
    const first = params.document.scenarios[0];
    let encoded = JSON.stringify(first);
    const ids = [...encoded.matchAll(/"id":"([^"]+)"/g)].map((match) => match[1]);
    for (const id of ids) encoded = encoded.replaceAll(id, crypto.randomUUID());
    const second = JSON.parse(encoded) as typeof first;
    const document = { ...params.document, scenarios: [first, second] };
    await controller.runAll({ ...params, document, scenarioIds: [first.id, second.id] });
    const deadline = Date.now() + 5000;
    while (saved.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(saved).toHaveLength(2);
    expect(controller.getPlayback()).toBeNull();
    expect(controller.getState().phase).toBe('done');
    controller.reset();
  }, 10000);

  it('seeks, steps, replays and loops a finished recording without saving twice', async () => {
    const { controller, params, until, advance, saved } = setup({ mode: 'bulk', requests: 3, arrival: { spreadMs: 2000 } }, 16);
    void controller.run(params);
    await until(() => controller.getState().phase === 'done');
    const store = controller.getPlayback()!;
    expect(saved).toHaveLength(1);
    controller.seek(-100);
    expect(store.playheadMs).toBe(store.windowStartMs);
    expect(store.playing).toBe(false);
    controller.stepCycle(1);
    expect(store.playheadMs).toBeGreaterThan(0);
    controller.stepCycle(-1);
    expect(store.playheadMs).toBe(0);
    controller.seek(Infinity);
    expect(store.playheadMs).toBe(store.computedMs);
    controller.resume();
    expect(store.playheadMs).toBe(0);
    await advance(32);
    controller.pause();
    const frozen = store.playheadMs;
    await advance(64);
    expect(store.playheadMs).toBe(frozen);
    controller.setLoop(true);
    controller.seek(store.computedMs - 1);
    controller.resume();
    await advance(32);
    expect(store.playheadMs).toBeLessThan(store.computedMs);
    expect(store.playing).toBe(true);
    expect(saved).toHaveLength(1);
    controller.setLoop(false);
    await until(() => !store.playing);
    expect(saved).toHaveLength(1);
    controller.reset();
  }, 30000);

  it('Stop resumes a paused stream and drains it; Go Live resumes at the edge', async () => {
    const { controller, params, until, advance, saved } = setup({ mode: 'stream', ratePerSecond: 2, profile: { kind: 'steady' } }, 16);
    void controller.run(params);
    await until(() => (controller.getPlayback()?.computedMs ?? 0) > 1000);
    controller.seek(0);
    const store = controller.getPlayback()!;
    expect(store.playing).toBe(false);
    controller.setPlaybackRange({ startMs: 0, endMs: 500 });
    controller.setLoop(true); controller.resume(); await advance(64);
    expect(store.playing).toBe(true);
    expect(store.playheadMs).toBeLessThan(500);
    expect(saved).toHaveLength(0);
    controller.setLoop(false);
    controller.goLive();
    expect(store.selection).toBeNull();
    expect(store.playheadMs).toBe(store.computedMs);
    expect(store.playing).toBe(true);
    await advance(32);
    controller.pause();
    controller.setPlaybackRange({ startMs: 0, endMs: 500 });
    controller.stop();
    expect(store.selection).toBeNull();
    expect(store.playing).toBe(true);
    expect(controller.getState().stopping).toBe(true);
    await until(() => controller.getState().phase === 'done');
    expect(controller.getState().current?.terminal?.status).toBe('completed');
    expect(saved).toHaveLength(1);
    controller.seek(store.windowStartMs);
    controller.goLive();
    expect(store.playheadMs).toBe(store.computedMs);
    expect(store.playing).toBe(false);
    controller.reset();
  }, 30000);

  it('holds the result until the playhead reaches the end of the run', async () => {
    const { controller, params, until, advance } = setup({ mode: 'bulk', requests: 100, arrival: { spreadMs: 2000 } }, 16);
    void controller.run(params);
    await until(() => controller.getPlayback()?.ended === true, 5000);
    const store = controller.getPlayback()!;
    expect(store.ended).toBe(true);
    // The worker has finished, but the playhead has not got there yet.
    if (!store.atEnd()) {
      expect(controller.getState().phase).toBe('running');
      expect(controller.getState().current?.terminal).toBeNull();
    }
    await until(() => controller.getState().phase === 'done', 10000);
    expect(controller.getState().current?.terminal?.status).toBe('completed');
    expect(store.atEnd()).toBe(true);
    await advance(32);
  }, 30000);

  it('speed 16 finishes without an instant-playback mode', async () => {
    const { controller, params, until } = setup({ mode: 'bulk', requests: 100, arrival: { spreadMs: 2000 } }, 16);
    const finished = controller.run(params);
    await until(() => controller.getState().phase === 'done', 10000);
    expect((await finished)?.status).toBe('completed');
  }, 30000);

  it('pause freezes the playhead; resume continues it', async () => {
    const { controller, params, until, advance } = setup({ mode: 'bulk', requests: 200, arrival: { spreadMs: 8000 } }, 16);
    void controller.run(params);
    await until(() => (controller.getPlayback()?.playheadMs ?? 0) > 500, 5000);
    controller.pause();
    const frozen = controller.getPlayback()!.playheadMs;
    await advance(320);
    expect(controller.getPlayback()!.playheadMs).toBe(frozen);
    controller.resume();
    await advance(320);
    expect(controller.getPlayback()!.playheadMs).toBeGreaterThan(frozen);
    controller.reset();
  }, 30000);

  it('reads canvas state at the playhead and releases trace events only as it passes them', async () => {
    const { controller, params, until } = setup({ mode: 'bulk', requests: 50, arrival: { spreadMs: 4000 } }, 8);
    void controller.run(params);
    await until(() => (controller.getPlayback()?.playheadMs ?? 0) > 800, 5000);
    const playhead = controller.getPlayback()!.playheadMs;
    const state = controller.getPlayback()!.stateAt(playhead);
    expect(state.atMs).toBe(playhead);
    expect(controller.getPlayback()!.flowBetween(-1, playhead).length).toBeGreaterThan(0);
    expect(state.legs.every((leg) => leg.progress >= 0 && leg.progress <= 1)).toBe(true);
    const events = controller.getState().events;
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.atMs === null || e.atMs <= playhead)).toBe(true);
    // The worker already knows more than it has shown.
    expect(controller.getPlayback()!.computedMs).toBeGreaterThan(playhead);
    controller.reset();
  }, 30000);

  it('a stream computes only about a lookahead ahead of a playhead that has not moved', async () => {
    const { controller, params, until } = setup({ mode: 'stream', ratePerSecond: 100, profile: { kind: 'steady' } }, 1);
    void controller.run(params);
    await until(() => (controller.getPlayback()?.computedMs ?? 0) >= 28_000, 20000);
    const computed = controller.getPlayback()!.computedMs;
    expect(computed).toBeGreaterThanOrEqual(28_000);
    expect(computed).toBeLessThan(36_000);
    expect(controller.getState().phase).toBe('running');
    controller.reset();
  }, 30000);

  it('reset drops the recording', async () => {
    const { controller, params, until } = setup({ mode: 'bulk', requests: 20, arrival: { spreadMs: 8000 } }, 1);
    void controller.run(params);
    await until(() => controller.getPlayback() !== null, 2000);
    controller.reset();
    expect(controller.getPlayback()).toBeNull();
    expect(controller.getState().phase).toBe('idle');
  });
});
