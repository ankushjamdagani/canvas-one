import { baseline, backgroundJobs, isJobGraph, type Graph } from "./model";
import type { Metrics } from "./metrics";
export interface Experiment {
  id: string;
  title: string;
  question: string;
  steps: string[];
  build: () => Graph;
}
export const experiments: Experiment[] = [
  {
    id: "cache-pressure",
    title: "Relieve database pressure",
    question:
      "Can a cache reduce database demand without changing incoming traffic?",
    steps: [
      "Run and save the 700 req/s baseline.",
      "Add a cache and replay with the same seed.",
      "Compare saved p95 latency, failures and database arrivals.",
    ],
    build: () => {
      const g = baseline();
      g.settings.traffic = 700;
      return g;
    },
  },
  {
    id: "worker-scaling",
    title: "Scale a worker pool",
    question:
      "How does concurrency change throughput without shortening each request?",
    steps: [
      "Run and save the one-worker baseline.",
      "Expand Redirect service; change Workers from 1 to 4 and Apply.",
      "Replay and compare. Group service and database to inspect the same model as a subsystem.",
    ],
    build: () => {
      const g = baseline();
      g.settings.traffic = 700;
      g.nodes[1].capacity = 200;
      g.nodes[1].workers = 1;
      g.nodes[2].capacity = 1000;
      return g;
    },
  },
  {
    id: "burst-jobs",
    title: "Absorb a job burst",
    question: "Does queue capacity absorb a burst, or merely postpone failure?",
    steps: [
      "Run the 100 → 700 → 100 jobs/s burst; inspect peak queue and expired jobs.",
      "Save the result, then expand Job worker and raise Workers from 2 to 4.",
      "Replay and compare completion and deadlines. Group the queue and worker to see their aggregate backlog.",
    ],
    build: () => {
      const g = backgroundJobs();
      g.settings.duration = 20;
      g.settings.profile = { kind: "burst", peakRate: 700, start: 5, end: 10 };
      return g;
    },
  },
  {
    id: "retry-budget",
    title: "Understand retry cost",
    question: "How much extra work buys a higher job completion rate?",
    steps: [
      "Run and save with 50% failure per attempt and no retries.",
      "Expand Job worker; change Max retries from 0 to 2 and Apply.",
      "Replay and compare attempts, permanent failures and successful-job latency. Producer acknowledgements are not completion.",
    ],
    build: () => {
      const g = backgroundJobs();
      Object.assign(g.nodes[2], {
        failureRate: 50,
        maxRetries: 0,
        retryDelayMs: 100,
      });
      return g;
    },
  },
];
export function observations(graph: Graph, metrics: Metrics | null): string[] {
  if (!metrics?.time)
    return [
      "Run this model to collect observations. Configured capacities are illustrative.",
    ];
  const queued = Object.values(metrics.nodes).reduce(
    (sum, node) => sum + node.queued,
    0,
  );
  const peak = Math.max(
    queued,
    0,
    ...metrics.history.map((sample) => sample.queue),
  );
  const findings = [
    `${queued.toLocaleString()} waiting now; sampled peak ${peak.toLocaleString()}.`,
    `${metrics.succeeded.toLocaleString()} completed; ${metrics.inFlight.toLocaleString()} still in flight at ${metrics.time.toFixed(1)}s.`,
  ];
  if (isJobGraph(graph) && metrics.jobs) {
    findings.push(
      `${metrics.jobs.acknowledged.toLocaleString()} producer acknowledgements confirm admission, not completion.`,
    );
    findings.push(
      `${metrics.jobs.attempts.toLocaleString()} attempts; ${metrics.jobs.retries.toLocaleString()} retries scheduled; ${metrics.jobs.failed.toLocaleString()} permanent failures; ${metrics.timedOut.toLocaleString()} expired.`,
    );
  } else {
    const pressured = graph.nodes.filter(
      (node) => (metrics.nodes[node.id]?.utilization ?? 0) > 0.95,
    );
    findings.push(
      pressured.length
        ? `${pressured.map((node) => node.name).join(", ")} averaged over 95% utilization. Inspect waiting and rejection there.`
        : "No component averaged over 95% utilization in this observation window.",
    );
  }
  return findings;
}
