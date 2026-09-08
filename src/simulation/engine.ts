import { LatencyStats } from "./latency";
import { Heap, randomGenerator } from "./primitives";
import { JobSimulation } from "./jobs";
import { isJobGraph } from "../domain/model";
import { KeyedCache } from "./keyed-cache";
import { urlKey } from "./url-popularity";
export { randomGenerator } from "./primitives";
import { nextArrivalTime, rateAt } from "../domain/workload";
import {
  validateGraph,
  workerCount,
  type Graph,
  type ModelNode,
} from "../domain/model";
import type { Metrics, Sample } from "../domain/metrics";
export type { Metrics, NodeMetrics, Sample } from "../domain/metrics";
interface Request {
  id: number;
  born: number;
  done: boolean;
  urlKey?: number;
}
interface Event {
  time: number;
  seq: number;
  kind: "arrival" | "complete" | "timeout" | "response";
  request?: Request;
  stage?: number;
  worker?: number;
}
interface Stage {
  node: ModelNode;
  queue: Request[];
  workers: { active?: Request; started: number }[];
  arrived: number;
  completed: number;
  rejected: number;
  busyTime: number;
}
// A separate per-request draw keeps arrivals identical when the topology changes.
function cacheDraw(seed: number, id: number) {
  return randomGenerator((seed ^ Math.imul(id, 2654435761)) >>> 0)();
}
class LookupSimulation {
  private heap = new Heap<Event>();
  private seq = 0;
  private rng: () => number;
  private stages: Stage[];
  private edgeCounts: Record<string, number> = {};
  private time = 0;
  private generated = 0;
  private succeeded = 0;
  private dropped = 0;
  private timedOut = 0;
  private hits = 0;
  private latencies = new LatencyStats();
  private cache?: KeyedCache;
  private cacheMisses = 0;
  private history: Sample[] = [];
  private nextSample = 1;
  constructor(private graph: Graph) {
    const errors = validateGraph(graph);
    if (errors.length) throw new Error(errors.join(" "));
    this.rng = randomGenerator(graph.settings.seed);
    const cacheNode = graph.nodes.find((n) => n.kind === "cache");
    if (cacheNode?.cacheMode === "lru") this.cache = new KeyedCache(cacheNode.cacheEntries ?? 100, (cacheNode.cacheTtlMs ?? 10000) / 1000);
    this.stages = ["service", "cache", "database"].flatMap((kind) =>
      graph.nodes
        .filter((n) => n.kind === kind)
        .map((node) => ({
          node,
          queue: [],
          arrived: 0,
          completed: 0,
          rejected: 0,
          busyTime: 0,
          workers: Array.from({ length: workerCount(node) }, () => ({
            started: 0,
          })),
        })),
    );
    this.edgeCounts = Object.fromEntries(graph.edges.map((e) => [e.id, 0]));
    this.scheduleArrival();
  }
  private schedule(event: Omit<Event, "seq">) {
    this.heap.push({ ...event, seq: this.seq++ });
  }
  private scheduleArrival() {
    const time = nextArrivalTime(
      this.graph.settings,
      this.time,
      -Math.log(1 - this.rng()),
    );
    if (time <= this.graph.settings.duration)
      this.schedule({ time, kind: "arrival" });
  }
  private start(request: Request, stageIndex: number, workerIndex: number) {
    const stage = this.stages[stageIndex];
    const worker = stage.workers[workerIndex];
    worker.active = request;
    worker.started = this.time;
    this.schedule({
      time: this.time + 1 / stage.node.capacity,
      kind: "complete",
      request,
      stage: stageIndex,
      worker: workerIndex,
    });
  }
  private enter(request: Request, stageIndex: number) {
    if (request.done) return;
    if (stageIndex === this.stages.length) {
      this.schedule({ time: this.time + 0.008, kind: "response", request });
      return;
    }
    const stage = this.stages[stageIndex];
    stage.arrived++;
    stage.queue = stage.queue.filter((r) => !r.done);
    const free = stage.workers.findIndex((worker) => !worker.active);
    if (free !== -1) this.start(request, stageIndex, free);
    else if (stage.queue.length < stage.node.queueLimit)
      stage.queue.push(request);
    else {
      stage.rejected++;
      this.dropped++;
      request.done = true;
    }
  }
  private forward(request: Request, source: string) {
    const connection = this.graph.edges.find((e) => e.source === source);
    if (!connection) { this.enter(request, this.stages.length); return; }
    this.edgeCounts[connection.id]++;
    this.enter(request, this.stages.findIndex((s) => s.node.id === connection.target));
  }
  private event(event: Event) {
    const request = event.request;
    if (event.kind === "arrival") {
      const req = { id: ++this.generated, born: this.time, done: false, urlKey: urlKey(this.graph.settings.seed, this.generated, this.graph.nodes.find((n) => n.kind === "traffic")!) };
      this.schedule({
        time: this.time + this.graph.settings.timeoutMs / 1000,
        kind: "timeout",
        request: req,
      });
      const services = this.stages.filter((s) => s.node.kind === "service");
      const balancer = this.graph.nodes.find((n) => n.kind === "balancer");
      if (balancer) {
        const destination = services[(req.id - 1) % services.length];
        const incoming = this.graph.edges.find((e) => e.target === balancer.id)!;
        const outgoing = this.graph.edges.find((e) => e.source === balancer.id && e.target === destination.node.id)!;
        this.edgeCounts[incoming.id]++;
        this.edgeCounts[outgoing.id]++;
        this.enter(req, this.stages.indexOf(destination));
      } else this.forward(req, this.graph.nodes.find((n) => n.kind === "traffic")!.id);
      this.scheduleArrival();
    } else if (event.kind === "timeout" && request && !request.done) {
      request.done = true;
      this.timedOut++;
    } else if (event.kind === "response" && request && !request.done) {
      request.done = true;
      this.succeeded++;
      this.latencies.push((this.time - request.born) * 1000);
    } else if (event.kind === "complete" && request) {
      const i = event.stage!,
        stage = this.stages[i];
      const worker = stage.workers[event.worker!];
      stage.busyTime += this.time - worker.started;
      worker.active = undefined;
      stage.completed++;
      if (!request.done) {
        if (stage.node.kind === "database" && this.cache && request.urlKey !== undefined)
          this.cache.put(request.urlKey, this.time);
        if (
          stage.node.kind === "cache" &&
          (this.cache ? this.cache.get(request.urlKey!, this.time) : cacheDraw(this.graph.settings.seed, request.id) < stage.node.hitRate / 100)
        ) {
          this.hits++;
          this.enter(request, this.stages.length);
        } else {
          if (stage.node.kind === "cache") this.cacheMisses++;
          this.forward(request, stage.node.id);
        }
      }
      let next = stage.queue.shift();
      while (next?.done) next = stage.queue.shift();
      if (next) this.start(next, i, event.worker!);
    }
  }
  advance(target: number): Metrics {
    target = Math.min(
      Math.max(target, this.time),
      this.graph.settings.duration,
    );
    while (this.heap.values.length && this.heap.values[0].time <= target) {
      const next = this.heap.values[0];
      while (this.nextSample <= next.time && this.nextSample <= target) {
        this.record(this.nextSample++);
      }
      const event = this.heap.pop();
      this.time = event.time;
      this.event(event);
    }
    while (this.nextSample <= target) this.record(this.nextSample++);
    this.time = target;
    return this.snapshot();
  }
  private record(time: number) {
    this.history.push({
      time,
      queue: this.stages.reduce(
        (n, s) => n + s.queue.filter((r) => !r.done).length,
        0,
      ),
      completed: this.succeeded,
      generated: this.generated,
      arrivalRate: rateAt(this.graph.settings, time),
      latency: this.latencies.recentMean(),
    });
  }
  snapshot(): Metrics {
    const nodes = Object.fromEntries(
      this.stages.map((s) => [
        s.node.id,
        {
          arrived: s.arrived,
          completed: s.completed,
          rejected: s.rejected,
          queued: s.queue.filter((r) => !r.done).length,
          busy: s.workers.some((worker) => !!worker.active),
          activeWorkers: s.workers.filter((worker) => !!worker.active).length,
          utilization: this.time
            ? Math.min(
                1,
                (s.busyTime +
                  s.workers.reduce(
                    (total, worker) =>
                      total + (worker.active ? this.time - worker.started : 0),
                    0,
                  )) /
                  (this.time * s.workers.length),
              )
            : 0,
        },
      ]),
    );
    const balancer = this.graph.nodes.find((n) => n.kind === "balancer");
    if (balancer) nodes[balancer.id] = {
      arrived: this.generated, completed: this.generated, rejected: 0,
      queued: 0, busy: false, activeWorkers: 0, utilization: 0,
    };
    const cacheSnapshot = this.cache?.snapshot(this.time);
    return {
      edges: { ...this.edgeCounts },
      time: this.time,
      generated: this.generated,
      arrivalRate: rateAt(this.graph.settings, this.time),
      succeeded: this.succeeded,
      dropped: this.dropped,
      timedOut: this.timedOut,
      inFlight: this.generated - this.succeeded - this.dropped - this.timedOut,
      throughput: this.time ? this.succeeded / this.time : 0,
      ...this.latencies.snapshot(),
      cacheHits: this.hits,
      cacheMisses: this.cacheMisses,
      cacheEvictions: cacheSnapshot?.evictions ?? 0,
      cacheExpirations: cacheSnapshot?.expirations ?? 0,
      cacheEntries: cacheSnapshot?.entries ?? 0,
      databaseLookups: this.stages.find((s) => s.node.kind === "database")!
        .arrived,
      nodes,
      history: [...this.history],
      finished: this.time >= this.graph.settings.duration,
    };
  }
}

export class Simulation {
  private model: LookupSimulation | JobSimulation;
  constructor(graph: Graph) {
    this.model = isJobGraph(graph)
      ? new JobSimulation(graph)
      : new LookupSimulation(graph);
  }
  advance(target: number): Metrics {
    return this.model.advance(target);
  }
  snapshot(): Metrics {
    return this.model.snapshot();
  }
}
