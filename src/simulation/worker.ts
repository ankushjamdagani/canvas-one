import { Simulation } from "./engine";
import type { Graph } from "../domain/model";
let simulation: Simulation | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let runId = "";
let time = 0;
function pause() {
  clearInterval(timer);
  timer = undefined;
}
self.onmessage = (
  event: MessageEvent<{
    type: "reset" | "run" | "pause";
    runId: string;
    graph?: Graph;
  }>,
) => {
  const data = event.data;
  try {
    if (data.type === "reset") {
      pause();
      runId = data.runId;
      time = 0;
      simulation = new Simulation(data.graph!);
      self.postMessage({
        type: "metrics",
        runId,
        metrics: simulation.snapshot(),
      });
      return;
    }
    if (data.runId !== runId) return;
    if (data.type === "pause") {
      pause();
      return;
    }
    if (timer || !simulation) return;
    timer = setInterval(() => {
      const metrics = simulation!.advance(time + 0.5);
      time = metrics.time;
      self.postMessage({ type: "metrics", runId, metrics });
      if (metrics.finished || metrics.execution?.incomplete) {
        pause();
      }
    }, 125);
  } catch (error) {
    pause();
    self.postMessage({
      type: "error",
      runId: data.runId,
      message: String(error),
    });
  }
};
