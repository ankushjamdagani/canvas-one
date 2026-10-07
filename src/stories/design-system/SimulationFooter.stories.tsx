import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useMemo, useState } from "react";
import {
  PlaybackPanel,
  type PlaybackPanelController,
} from "@/features/runs/PlaybackPanel";
import { PlaybackStore } from "@/features/runs/playback";
import type {
  Cycle,
  FlowRecord,
  ElementMetric,
} from "@/domain/studio/runner/types";
import type { RunControllerState } from "@/features/runs/RunController";

const labels = {
  gateway: "Gateway",
  checkout: "Checkout API",
  payments: "Payments",
  orders: "Orders DB",
};
function recordedFixture() {
  const playback = new PlaybackStore({
    connectionTargets: new Map(),
    historyMs: null,
  });
  const cycles: Cycle[] = Array.from({ length: 72 }, (_, index) => {
    const failed = index >= 44 && index <= 49 && index % 2 === 0;
    const startedAtMs = index * 90;
    const latency = failed ? 1000 : 140 + (index % 5) * 9;
    return {
      id: `illustrative-cycle-${index + 1}`,
      workloadId: "checkout",
      startedAtMs,
      responseAtMs: startedAtMs + latency - 10,
      completedAtMs: startedAtMs + latency,
      outcome: failed ? "failed" : "ok",
      counts: {
        ok: failed ? 0 : 1,
        failed: failed ? 1 : 0,
        expired: 0,
        rejected: 0,
        "timed-out": 0,
        lost: 0,
        stuck: 0,
      },
    };
  });
  const flow: FlowRecord[] = cycles.flatMap((cycle) =>
    Object.keys(labels).flatMap((elementId, index) => {
      const atMs = cycle.startedAtMs + index * 8;
      const endsAtMs = cycle.completedAtMs! - (3 - index) * 8;
      const base = {
        key: `${cycle.id}-${elementId}`,
        cycleId: cycle.id,
        unitId: cycle.id,
        category: "root" as const,
        elementId,
        connectionId: null,
        arriveAtMs: null,
      };
      return [
        { ...base, phase: "processing" as const, atMs, outcome: null },
        {
          ...base,
          phase: "settled" as const,
          atMs: endsAtMs,
          outcome:
            cycle.outcome === "ok"
              ? ("succeeded" as const)
              : ("failed" as const),
        },
      ];
    }),
  );
  playback.ingestFlow(flow);
  playback.ingestCycles(cycles);
  playback.setComputedEdge(7000);
  playback.setEnded(7000);
  playback.seek(5310);
  const metric = (
    elementId: string,
    key: ElementMetric["key"],
    value: number,
    unit: ElementMetric["unit"],
  ): ElementMetric => ({
    elementId,
    scope: "element",
    key,
    value,
    unit,
    available: true,
    reason: null,
    windowStartMs: 0,
    windowEndMs: 5310,
  });
  const counts = {
    generated: 72,
    succeeded: 69,
    failed: 3,
    rejected: 0,
    expired: 0,
    inFlight: 0,
  };
  playback.ingestCheckpoint({
    atMs: 0,
    rootCounts: counts,
    messageCounts: { ...counts, generated: 0, succeeded: 0, failed: 0 },
    cycles: {
      total: 72,
      open: 0,
      byOutcome: {
        ok: 69,
        failed: 3,
        expired: 0,
        rejected: 0,
        "timed-out": 0,
        lost: 0,
        stuck: 0,
      },
      responseLatencyMs: null,
      completionLatencyMs: null,
    },
    elementMetrics: Object.keys(labels).flatMap((id, index) => [
      metric(id, "failed", id === "payments" ? 3 : 0, "count"),
      metric(id, "meanLatencyMs", 10 + index * 20, "ms"),
      metric(id, "p95LatencyMs", 15 + index * 30, "ms"),
      metric(id, "utilization", 0.3 + index * 0.1, "ratio"),
    ]),
  });
  return playback;
}

/** An explicit illustrative public-controller fixture, never production measurements. */
function fixtureController(initialReady: boolean) {
  let store: PlaybackStore | null = initialReady ? null : recordedFixture();
  let speed = 1,
    loop = false;
  let state: RunControllerState = {
    phase: initialReady ? "idle" : "done",
    queue: [],
    current: initialReady
      ? null
      : {
          scenarioId: "steady",
          runId: "fixture-run",
          terminal: null,
          saveStatus: "saved",
          measured: true,
        },
    issues: [],
    events: [],
    stopping: false,
  };
  const subscribers = new Set<(state: RunControllerState) => void>();
  const notify = () => subscribers.forEach((listener) => listener(state));
  const controller: PlaybackPanelController = {
    getPlayback: () => store,
    getState: () => state,
    subscribe: (listener) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    getPlaybackSpeed: () => speed,
    setPlaybackSpeed: (value) => {
      speed = value;
      if (store) store.speed = value;
      notify();
    },
    seek: (time) => {
      store?.seek(time);
      if (store) store.playing = false;
      notify();
    },
    setPlaybackRange: (range) => {
      store?.setSelection(range);
      if (range) store?.seek(range.startMs);
      notify();
    },
    getLoop: () => loop,
    setLoop: (value) => {
      loop = value;
      notify();
    },
    goLive: () => {
      if (store) {
        store.setSelection(null);
        store.seek(store.computedMs);
        store.following = true;
      }
      notify();
    },
    pause: () => {
      if (store) store.playing = false;
      notify();
    },
    resume: () => {
      if (store) {
        if (store.atEnd()) store.seek(store.selection?.startMs ?? 0);
        store.playing = true;
      }
      notify();
    },
    stop: () => {
      if (store) store.playing = false;
      state = { ...state, phase: "done" };
      notify();
    },
    finishAndSaveRecording: async () => true,
  };
  return {
    controller,
    reset: () => {
      store = null;
      state = { ...state, phase: "idle", current: null };
      notify();
    },
    run: () => {
      store = recordedFixture();
      state = {
        ...state,
        phase: "done",
        current: {
          scenarioId: "steady",
          runId: `fixture-run-${Date.now()}`,
          terminal: null,
          saveStatus: "saved",
          measured: true,
        },
      };
      notify();
    },
    tick: () => {
      if (store?.playing) {
        store.advance(40);
        if (store.atEnd()) {
          if (loop) store.seek(store.selection?.startMs ?? 0);
          else store.playing = false;
        }
        notify();
      }
    },
  };
}
function Specimen({
  mobile = false,
  expanded = false,
  ready = false,
}: {
  mobile?: boolean;
  expanded?: boolean;
  ready?: boolean;
}) {
  const fixture = useMemo(() => fixtureController(ready), [ready]);
  const [, redraw] = useState(0);
  const [scenario, setScenario] = useState("steady");
  useEffect(
    () => fixture.controller.subscribe(() => redraw((value) => value + 1)),
    [fixture],
  );
  useEffect(() => {
    const timer = setInterval(fixture.tick, 40);
    return () => clearInterval(timer);
  }, [fixture]);
  const state = fixture.controller.getState();
  return (
    <div className="overflow-x-auto p-4 font-sans">
      <p className="mb-4 text-xs text-secondary-text">
        Illustrative recorded telemetry fixture · native production footer and
        inspection. Handled count is unavailable.
      </p>
      <div
        style={{
          width: mobile ? 390 : 1280,
          height: expanded ? (mobile ? 592 : 552) : mobile ? 152 : 52,
        }}
        className="border-x border-border"
      >
        <PlaybackPanel
          controller={fixture.controller}
          mobile={mobile}
          resultsOpenRequest={expanded ? 1 : 0}
          scenarios={[
            {
              id: "steady",
              label: "Steady traffic",
              mode: "timed",
              status: { kind: "not-run" },
            },
            {
              id: "burst",
              label: "Burst",
              mode: "timed",
              status: { kind: "not-run" },
            },
          ]}
          selectedScenarioId={scenario}
          onScenarioSelect={setScenario}
          onRunScenario={fixture.run}
          onRestart={fixture.run}
          onReset={fixture.reset}
          scenarioName="Steady traffic"
          scenarioMode="timed"
          runPhase={state.phase}
          runId={state.current?.runId ?? null}
          terminal={null}
          elementLabels={labels}
          assertionLabels={{}}
          saveStatus={state.current?.saveStatus ?? "unsaved"}
        />
      </div>
    </div>
  );
}
const meta = {
  title: "Design System/Simulation footer",
  component: Specimen,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Specimen>;
export default meta;
type Story = StoryObj<typeof meta>;
export const DesktopCompact: Story = {};
export const DesktopExpanded: Story = { args: { expanded: true } };
export const MobileCompact: Story = { args: { mobile: true } };
export const MobileExpanded: Story = { args: { mobile: true, expanded: true } };
export const Ready: Story = { args: { ready: true } };
export const Guide: Story = { args: { expanded: true } };
