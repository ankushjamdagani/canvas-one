import { Simulation } from "./engine";
import type { Graph } from "../domain/model";
let simulation: Simulation | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
function pause() {
  clearInterval(timer);
  timer = undefined;
}
self.onmessage = (
  e: MessageEvent<{ type: "reset" | "run" | "pause"; graph?: Graph }>,
) => {
  try {
    if (e.data.type === "pause") {
      pause();
      return;
    }
    if (e.data.type === "reset") {
      pause();
      simulation = new Simulation(e.data.graph!);
      self.postMessage({ type: "metrics", metrics: simulation.snapshot() });
      return;
    }
    if (timer || !simulation) return;
    timer = setInterval(() => {
      const metrics = simulation!.advance(simulation!.snapshot().time + 0.5);
      self.postMessage({ type: "metrics", metrics });
      if (metrics.finished) pause();
    }, 125);
  } catch (error) {
    pause();
    self.postMessage({ type: "error", message: String(error) });
  }
};
