import { useEffect, useRef, useState } from "react";
import { validateGraph, type Graph } from "../domain/model";
import type { Metrics } from "./engine";
export interface RunResult {
  metrics: Metrics;
  graph: Graph;
}
export function useSimulation(graph: Graph) {
  const worker = useRef<Worker | null>(null),
    latest = useRef<RunResult | null>(null),
    currentGraph = useRef(graph);
  const [metrics, setMetrics] = useState<Metrics | null>(null),
    [running, setRunning] = useState(false),
    [previous, setPrevious] = useState<RunResult | null>(null),
    [error, setError] = useState("");
  const signature = JSON.stringify({
    ...graph,
    nodes: graph.nodes.map(({ position: _position, name: _name, ...n }) => n),
  });
  currentGraph.current = graph;
  useEffect(() => {
    const w = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = (e) => {
      if (e.data.type === "error") {
        setError(e.data.message);
        setRunning(false);
      } else {
        setMetrics(e.data.metrics);
        latest.current = {
          metrics: e.data.metrics,
          graph: structuredClone(currentGraph.current),
        };
        if (e.data.metrics.finished) setRunning(false);
      }
    };
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, []);
  useEffect(() => {
    if (latest.current?.metrics.finished) setPrevious(latest.current);
    latest.current = null;
    setMetrics(null);
    setRunning(false);
    setError("");
    worker.current?.postMessage({ type: "pause" });
    if (!validateGraph(graph).length)
      worker.current?.postMessage({ type: "reset", graph });
  }, [signature]); // Presentation changes never replace or restart the model.
  const reset = () => {
    if (latest.current?.metrics.finished) setPrevious(latest.current);
    setRunning(false);
    worker.current?.postMessage({ type: "reset", graph });
  };
  const toggle = () => {
    if (running) worker.current?.postMessage({ type: "pause" });
    else {
      if (metrics?.finished)
        worker.current?.postMessage({ type: "reset", graph });
      worker.current?.postMessage({ type: "run" });
    }
    setRunning(!running);
  };
  return { metrics, running, previous, error, reset, toggle };
}
