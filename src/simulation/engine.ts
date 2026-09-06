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
class Heap {
  values: Event[] = [];
  before(a: Event, b: Event) {
    return a.time < b.time || (a.time === b.time && a.seq < b.seq);
  }
  push(e: Event) {
    const a = this.values;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.before(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop() {
    const a = this.values,
      first = a[0],
      last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= a.length) break;
        if (c + 1 < a.length && this.before(a[c + 1], a[c])) c++;
        if (!this.before(a[c], a[i])) break;
        [a[c], a[i]] = [a[i], a[c]];
        i = c;
      }
    }
    return first;
  }
}
export function randomGenerator(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// A separate per-request draw keeps arrivals identical when the topology changes.
function cacheDraw(seed: number, id: number) {
  return randomGenerator((seed ^ Math.imul(id, 2654435761)) >>> 0)();
}
export class Simulation {
  private heap = new Heap();
  private seq = 0;
  private rng: () => number;
  private stages: Stage[];
  private time = 0;
  private generated = 0;
  private succeeded = 0;
  private dropped = 0;
  private timedOut = 0;
  private hits = 0;
  private latencies: number[] = [];
  private sortedLatencies: number[] = [];
  private meanLatency = 0;
  private history: Sample[] = [];
  private nextSample = 1;
  constructor(private graph: Graph) {
    const errors = validateGraph(graph);
    if (errors.length) throw new Error(errors.join(" "));
    this.rng = randomGenerator(graph.settings.seed);
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
  private event(event: Event) {
    const request = event.request;
    if (event.kind === "arrival") {
      const req = { id: ++this.generated, born: this.time, done: false };
      this.schedule({
        time: this.time + this.graph.settings.timeoutMs / 1000,
        kind: "timeout",
        request: req,
      });
      this.enter(req, 0);
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
        if (
          stage.node.kind === "cache" &&
          cacheDraw(this.graph.settings.seed, request.id) <
            stage.node.hitRate / 100
        ) {
          this.hits++;
          this.enter(request, this.stages.length);
        } else this.enter(request, i + 1);
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
      latency: this.latencies.length
        ? this.latencies.slice(-500).reduce((a, b) => a + b, 0) /
          Math.min(500, this.latencies.length)
        : 0,
    });
  }
  snapshot(): Metrics {
    // Preserve exact percentile and floating-point summation semantics while
    // sorting only the responses completed since the previous snapshot.
    if (this.sortedLatencies.length !== this.latencies.length) {
      const added = this.latencies
        .slice(this.sortedLatencies.length)
        .sort((a, b) => a - b);
      const prior = this.sortedLatencies;
      const merged = new Array<number>(prior.length + added.length);
      let i = 0,
        j = 0,
        total = 0;
      for (let k = 0; k < merged.length; k++) {
        const value =
          j === added.length || (i < prior.length && prior[i] <= added[j])
            ? prior[i++]
            : added[j++];
        merged[k] = value;
        total += value;
      }
      this.sortedLatencies = merged;
      this.meanLatency = total / merged.length;
    }
    const sorted = this.sortedLatencies;
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
    return {
      time: this.time,
      generated: this.generated,
      arrivalRate: rateAt(this.graph.settings, this.time),
      succeeded: this.succeeded,
      dropped: this.dropped,
      timedOut: this.timedOut,
      inFlight: this.generated - this.succeeded - this.dropped - this.timedOut,
      throughput: this.time ? this.succeeded / this.time : 0,
      meanLatency: this.meanLatency,
      p95Latency: sorted.length
        ? sorted[Math.ceil(sorted.length * 0.95) - 1]
        : 0,
      cacheHits: this.hits,
      databaseLookups: this.stages.find((s) => s.node.kind === "database")!
        .arrived,
      nodes,
      history: [...this.history],
      finished: this.time >= this.graph.settings.duration,
    };
  }
}
