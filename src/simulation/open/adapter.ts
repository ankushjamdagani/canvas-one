import type { ExecutionGraph } from "../../domain/execution";
import type { Graph } from "../../domain/model";
import type { Metrics, NodeMetrics, Sample } from "../../domain/metrics";
import { OpenSimulation, type OpenMetrics } from "./kernel";
import { rateAt } from "../../domain/workload";

export class OpenSimulationAdapter {
  private sim: OpenSimulation;

  constructor(private graph: Graph & ExecutionGraph) {
    this.graph = structuredClone(graph);
    this.sim = new OpenSimulation(graph);
  }

  advance(seconds: number): Metrics {
    return this.adapt(this.sim.advance(seconds));
  }

  snapshot(): Metrics {
    return this.adapt(this.sim.snapshot());
  }

  private arrivalRate(time: number): number {
    return this.graph.workloads.filter(w => w.enabled).reduce((sum, w) => sum +
      (w.intervalMs ? 1000 / w.intervalMs : rateAt({ ...this.graph.settings,
        traffic: w.rate, timeoutMs: w.timeoutMs, profile: w.profile }, time)), 0);
  }

  private adapt(openMetrics: OpenMetrics): Metrics {
    const time = openMetrics.time;

    // Nodes mapping
    const nodes: Record<string, NodeMetrics> = Object.create(null);
    for (const [id, r] of Object.entries(openMetrics.nodes)) {
      nodes[id] = {
        arrived: r.arrived,
        completed: r.completed,
        rejected: r.rejected,
        queued: r.queued,
        busy: r.activeWorkers > 0,
        activeWorkers: r.activeWorkers,
        utilization: r.utilization,
      };
    }

    // Edges mapping
    const edges: Record<string, number> = Object.create(null);
    for (const [id, em] of Object.entries(openMetrics.edges)) {
      edges[id] = em.sent;
    }

    // Aggregate cache counters across all nodes with cache metrics
    let cacheHits = 0;
    let cacheMisses = 0;
    let cacheEvictions = 0;
    let cacheExpirations = 0;
    let cacheEntries = 0;
    for (const node of this.graph.nodes) {
      if (node.behavior?.type === "cache") {
        const cm = openMetrics.nodes[node.id]?.cache;
        if (cm) {
          cacheHits += cm.hits;
          cacheMisses += cm.misses;
          cacheEvictions += cm.evictions;
          cacheExpirations += cm.expirations;
          cacheEntries += cm.entries;
        }
      }
    }

    // Sum database lookups (arrived across all storage nodes)
    let databaseLookups = 0;
    for (const node of this.graph.nodes) {
      if (node.behavior?.type === "storage") {
        databaseLookups += openMetrics.nodes[node.id]?.arrived ?? 0;
      }
    }

    // Compute aggregate arrivalRate across enabled workloads
    const currentArrivalRate = this.arrivalRate(time);

    const history: Sample[] = openMetrics.history.map((h) => ({
      time: h.time,
      queue: h.queue,
      completed: h.completed,
      generated: h.generated,
      arrivalRate: this.arrivalRate(h.time),
      latency: h.latency,
    }));

    return {
      edges,
      execution: openMetrics,
      time,
      generated: openMetrics.roots.generated,
      arrivalRate: currentArrivalRate,
      succeeded: openMetrics.roots.succeeded,
      dropped: openMetrics.roots.rejected,
      timedOut: openMetrics.roots.expired,
      inFlight: openMetrics.roots.inFlight,
      throughput: openMetrics.roots.throughput,
      meanLatency: openMetrics.roots.meanLatency,
      p95Latency: openMetrics.roots.p95Latency,
      cacheHits,
      cacheMisses,
      cacheEvictions,
      cacheExpirations,
      cacheEntries,
      databaseLookups,
      nodes,
      history,
      finished: openMetrics.finished,
    };
  }
}
