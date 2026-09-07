import {
  validateGraph,
  workerCount,
  type Graph,
  type ModelNode,
} from "../domain/model";
import type { Metrics, Sample, JobMetrics } from "../domain/metrics";
import { nextArrivalTime, rateAt } from "../domain/workload";
import { Heap, randomGenerator } from "./primitives";
import { LatencyStats } from "./latency";
interface Job {
  id: number;
  born: number;
  done: boolean;
  attempt: number;
  retrying: boolean;
}
interface Event {
  time: number;
  seq: number;
  kind: "arrival" | "timeout" | "ack" | "complete" | "retry";
  job?: Job;
  worker?: number;
}
export class JobSimulation {
  private heap = new Heap<Event>();
  private sequence = 0;
  private time = 0;
  private nextSample = 1;
  private history: Sample[] = [];
  private latencies = new LatencyStats();
  private rng: () => number;
  private queue: Job[] = [];
  private pool: { active?: Job; started: number }[];
  private queueNode: ModelNode;
  private workerNode: ModelNode;
  private generated = 0;
  private succeeded = 0;
  private dropped = 0;
  private timedOut = 0;
  private completedAttempts = 0;
  private occupiedTime = 0;
  private dispatched = 0;
  private enqueueAttempts = 0;
  private jobs: JobMetrics = {
    accepted: 0,
    acknowledged: 0,
    failed: 0,
    attempts: 0,
    retries: 0,
    retrying: 0,
    retryRejected: 0,
  };
  constructor(private graph: Graph) {
    const errors = validateGraph(graph);
    if (errors.length) throw new Error(errors.join(" "));
    this.queueNode = graph.nodes.find((n) => n.kind === "queue")!;
    this.workerNode = graph.nodes.find((n) => n.kind === "worker")!;
    this.pool = Array.from({ length: workerCount(this.workerNode) }, () => ({
      started: 0,
    }));
    this.rng = randomGenerator(graph.settings.seed);
    this.nextArrival();
  }
  private schedule(event: Omit<Event, "seq">) {
    this.heap.push({ ...event, seq: this.sequence++ });
  }
  private nextArrival() {
    const time = nextArrivalTime(
      this.graph.settings,
      this.time,
      -Math.log(1 - this.rng()),
    );
    if (time <= this.graph.settings.duration)
      this.schedule({ kind: "arrival", time });
  }
  private start(job: Job, worker: number) {
    this.pool[worker] = { active: job, started: this.time };
    job.attempt++;
    this.jobs.attempts++;
    this.dispatched++;
    this.schedule({
      kind: "complete",
      time: this.time + 1 / this.workerNode.capacity,
      job,
      worker,
    });
  }
  private enqueue(job: Job): boolean {
    this.enqueueAttempts++;
    this.queue = this.queue.filter((j) => !j.done);
    const free = this.pool.findIndex((w) => !w.active);
    if (free !== -1) this.start(job, free);
    else if (this.queue.length < this.queueNode.queueLimit)
      this.queue.push(job);
    else return false;
    return true;
  }
  private event(event: Event) {
    const job = event.job;
    if (event.kind === "arrival") {
      const created: Job = {
        id: ++this.generated,
        born: this.time,
        done: false,
        attempt: 0,
        retrying: false,
      };
      if (this.enqueue(created)) {
        this.jobs.accepted++;
        this.schedule({ kind: "ack", time: this.time + 0.008, job: created });
        this.schedule({
          kind: "timeout",
          time: this.time + this.graph.settings.timeoutMs / 1000,
          job: created,
        });
      } else {
        this.dropped++;
        created.done = true;
      }
      this.nextArrival();
    } else if (event.kind === "ack") {
      // Producer acknowledgment records admission, independently of job outcome.
      this.jobs.acknowledged++;
    } else if (event.kind === "timeout" && job && !job.done) {
      job.done = true;
      this.timedOut++;
      if (job.retrying) {
        job.retrying = false;
        this.jobs.retrying--;
      }
    } else if (event.kind === "retry" && job && !job.done) {
      job.retrying = false;
      this.jobs.retrying--;
      if (!this.enqueue(job)) {
        job.done = true;
        this.jobs.failed++;
        this.jobs.retryRejected++;
      }
    } else if (event.kind === "complete" && job) {
      const worker = this.pool[event.worker!];
      this.occupiedTime += this.time - worker.started;
      worker.active = undefined;
      this.completedAttempts++;
      if (!job.done) {
        const failed =
          randomGenerator(
            (this.graph.settings.seed ^
              Math.imul(job.id, 2654435761) ^
              Math.imul(job.attempt, 2246822519)) >>>
              0,
          )() <
          (this.workerNode.failureRate ?? 0) / 100;
        if (!failed) {
          job.done = true;
          this.succeeded++;
          this.latencies.push((this.time - job.born) * 1000);
        } else if (job.attempt <= (this.workerNode.maxRetries ?? 2)) {
          job.retrying = true;
          this.jobs.retries++;
          this.jobs.retrying++;
          this.schedule({
            kind: "retry",
            time: this.time + (this.workerNode.retryDelayMs ?? 100) / 1000,
            job,
          });
        } else {
          job.done = true;
          this.jobs.failed++;
        }
      }
      let next = this.queue.shift();
      while (next?.done) next = this.queue.shift();
      if (next) this.start(next, event.worker!);
    }
  }
  advance(target: number): Metrics {
    target = Math.min(
      Math.max(target, this.time),
      this.graph.settings.duration,
    );
    while (this.heap.values.length && this.heap.values[0].time <= target) {
      const next = this.heap.values[0];
      while (this.nextSample <= next.time && this.nextSample <= target)
        this.record(this.nextSample++);
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
      queue: this.queue.filter((j) => !j.done).length,
      completed: this.succeeded,
      generated: this.generated,
      arrivalRate: rateAt(this.graph.settings, time),
      latency: this.latencies.recentMean(),
    });
  }
  snapshot(): Metrics {
    const activeWorkers = this.pool.filter((w) => w.active).length;
    const utilization = this.time
      ? Math.min(
          1,
          (this.occupiedTime +
            this.pool.reduce(
              (sum, w) => sum + (w.active ? this.time - w.started : 0),
              0,
            )) /
            (this.time * this.pool.length),
        )
      : 0;
    return {
      time: this.time,
      generated: this.generated,
      succeeded: this.succeeded,
      dropped: this.dropped,
      timedOut: this.timedOut,
      inFlight:
        this.generated -
        this.succeeded -
        this.dropped -
        this.timedOut -
        this.jobs.failed,
      throughput: this.time ? this.succeeded / this.time : 0,
      arrivalRate: rateAt(this.graph.settings, this.time),
      ...this.latencies.snapshot(),
      jobs: { ...this.jobs },
      cacheHits: 0,
      databaseLookups: 0,
      nodes: {
        [this.queueNode.id]: {
          arrived: this.enqueueAttempts,
          completed: this.dispatched,
          rejected: this.dropped + this.jobs.retryRejected,
          queued: this.queue.filter((j) => !j.done).length,
          busy: false,
          activeWorkers: 0,
          utilization: 0,
        },
        [this.workerNode.id]: {
          arrived: this.jobs.attempts,
          completed: this.completedAttempts,
          rejected: this.jobs.failed - this.jobs.retryRejected,
          queued: 0,
          busy: activeWorkers > 0,
          activeWorkers,
          utilization,
        },
      },
      history: [...this.history],
      finished: this.time >= this.graph.settings.duration,
    };
  }
}
