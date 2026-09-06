import { useEffect, useRef, useState } from "react";
import { validateGraph, clone, type Graph } from "../domain/model";
import type { Metrics } from "../domain/metrics";
import type { RunResult } from "../domain/results";
export type { RunResult } from "../domain/results";

export function useSimulation(graph: Graph, projectId = "") {
  const worker = useRef<Worker | null>(null),
    active = useRef<{ id: string; graph: Graph } | null>(null),
    latest = useRef<RunResult | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null),
    [running, setRunning] = useState(false),
    [previous, setPrevious] = useState<RunResult | null>(null),
    [result, setResult] = useState<RunResult | null>(null),
    [error, setError] = useState("");
  const lastProject = useRef(projectId);
  const signature = JSON.stringify({
    ...graph,
    nodes: graph.nodes.map(
      ({ position: _position, name: _name, ...node }) => node,
    ),
  });
  const reset = () => {
    if (latest.current?.metrics.finished) setPrevious(latest.current);
    latest.current = null;
    setMetrics(null);
    setResult(null);
    setRunning(false);
    setError("");
    if (active.current)
      worker.current?.postMessage({ type: "pause", runId: active.current.id });
    active.current = null;
    if (validateGraph(graph).length) return;
    const run = { id: crypto.randomUUID(), graph: clone(graph) };
    active.current = run;
    worker.current?.postMessage({
      type: "reset",
      runId: run.id,
      graph: run.graph,
    });
  };
  useEffect(() => {
    const w = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = (event) => {
      const run = active.current;
      if (!run || event.data.runId !== run.id) return;
      if (event.data.type === "error") {
        setError(event.data.message);
        setRunning(false);
        return;
      }
      const observed: RunResult = { ...run, metrics: event.data.metrics };
      latest.current = observed;
      setMetrics(observed.metrics);
      if (observed.metrics.finished) {
        setRunning(false);
        setResult(observed);
      }
    };
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, []);
  useEffect(() => {
    reset();
    if (lastProject.current !== projectId) {
      setPrevious(null);
      lastProject.current = projectId;
    }
  }, [signature, projectId]);
  const toggle = () => {
    if (running) {
      worker.current?.postMessage({ type: "pause", runId: active.current?.id });
      setRunning(false);
      return;
    }
    if (metrics?.finished) reset();
    if (!active.current) return;
    worker.current?.postMessage({ type: "run", runId: active.current.id });
    setRunning(true);
  };
  return { metrics, running, previous, result, error, reset, toggle };
}
