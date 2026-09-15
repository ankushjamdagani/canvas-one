import type { Graph, ModelNode } from "./model";
import type { Metrics } from "./metrics";
import type { BehaviorConfig } from "./execution";
import type { OpenMetrics } from "../simulation/open/kernel";

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isSafeNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

export function validateOpenResult(graph: Graph, metrics: Metrics): string[] {
  if (!metrics || !isObj(metrics)) {
    return ["Only completed results with valid observed metrics can be saved."];
  }
  if (metrics.finished !== true) {
    return ["Only completed results with valid observed metrics can be saved."];
  }
  if (metrics.jobs !== undefined) {
    return ["Saved result metrics contain unexpected job fields."];
  }
  const em = metrics.execution as OpenMetrics | undefined;
  if (!em || !isObj(em)) {
    return ["Open-system results require execution metrics."];
  }
  if (em.finished !== true || (em as unknown as { incomplete?: boolean }).incomplete !== undefined) {
    return ["Only completed results with valid observed metrics can be saved."];
  }
  if (!Number.isFinite(em.time) || !Number.isFinite(metrics.time) || Math.abs(em.time - metrics.time) > 1e-8 || Math.abs(em.time - graph.settings.duration) > 1e-8) {
    return ["Execution time does not match experiment duration."];
  }

  // Validate FlowCounts for roots and messages
  for (const [name, flow] of [["roots", em.roots], ["messages", em.messages]] as const) {
    if (!flow || !isObj(flow)) return [`Execution ${name} metrics are invalid.`];
    const { generated, succeeded, rejected, failed, expired, inFlight, throughput, meanLatency, p95Latency } = flow;
    if (
      !isSafeNonNegInt(generated) ||
      !isSafeNonNegInt(succeeded) ||
      !isSafeNonNegInt(rejected) ||
      !isSafeNonNegInt(failed) ||
      !isSafeNonNegInt(expired) ||
      !isSafeNonNegInt(inFlight)
    ) {
      return [`Execution ${name} flow counts must be non-negative integers.`];
    }
    if (generated !== succeeded + rejected + failed + expired + inFlight) {
      return [`Execution ${name} flow conservation violated.`];
    }
    const expectedTps = em.time > 0 ? succeeded / em.time : 0;
    if (!Number.isFinite(throughput) || Math.abs(throughput - expectedTps) > 1e-6) {
      return [`Execution ${name} throughput does not reconcile with completions.`];
    }
    if (!Number.isFinite(meanLatency) || meanLatency < 0 || !Number.isFinite(p95Latency) || p95Latency < 0) {
      return [`Execution ${name} latency metrics are invalid.`];
    }
    if (succeeded === 0 && (meanLatency !== 0 || p95Latency !== 0)) {
      return [`Execution ${name} latency must be zero when there are no completions.`];
    }
  }

  const outerValues = [metrics.time, metrics.arrivalRate, metrics.throughput, metrics.meanLatency, metrics.p95Latency];
  if (outerValues.some(value => !Number.isFinite(value) || value < 0) ||
      metrics.meanLatency !== em.roots.meanLatency || metrics.p95Latency !== em.roots.p95Latency)
    return ["Outer latency and rate measurements are invalid."];

  // Outer metrics reconciliation with detailed roots and components
  if (metrics.generated !== em.roots.generated ||
      metrics.succeeded !== em.roots.succeeded ||
      metrics.dropped !== em.roots.rejected ||
      metrics.timedOut !== em.roots.expired ||
      metrics.inFlight !== em.roots.inFlight) {
    return ["Saved result request counts do not reconcile."];
  }
  if (Math.abs(metrics.throughput - em.roots.throughput) > 1e-6) {
    return ["Saved result throughput does not reconcile."];
  }

  // Exact graph ID checks for nodes and edges
  if (!em.nodes || !isObj(em.nodes) || Array.isArray(em.nodes)) {
    return ["Saved component measurements are invalid."];
  }
  if (!em.edges || !isObj(em.edges) || Array.isArray(em.edges)) {
    return ["Saved connection measurements are invalid."];
  }

  const graphNodeIds = new Set(graph.nodes.map(n => n.id));
  const graphEdgeIds = new Set(graph.edges.map(e => e.id));
  const emNodeKeys = Object.keys(em.nodes);
  const emEdgeKeys = Object.keys(em.edges);

  if (emNodeKeys.length !== graphNodeIds.size || emNodeKeys.some(id => !graphNodeIds.has(id))) {
    return ["Saved component IDs do not match the experiment graph."];
  }
  if (emEdgeKeys.length !== graphEdgeIds.size || emEdgeKeys.some(id => !graphEdgeIds.has(id))) {
    return ["Saved connection IDs do not match the experiment graph."];
  }

  // Check outer metrics.nodes contains graph nodes
  if (!metrics.nodes || !isObj(metrics.nodes) || Array.isArray(metrics.nodes)) {
    return ["Saved component measurements are invalid."];
  }

  if (Object.keys(metrics.nodes).length !== graphNodeIds.size ||
      !metrics.edges || !isObj(metrics.edges) || Object.keys(metrics.edges).length !== graphEdgeIds.size ||
      Object.keys(metrics.edges).some(id => !graphEdgeIds.has(id)))
    return ["Outer component or connection IDs do not match the graph."];
  let totalCacheHits = 0;
  let totalCacheMisses = 0;
  let totalCacheWrites = 0;
  let totalCacheEntries = 0;
  let totalCacheEvictions = 0;
  let totalCacheExpirations = 0;
  let totalStorageLookups = 0;

  // Node verification
  for (const node of graph.nodes) {
    const rawNm = em.nodes[node.id];
    if (!rawNm || !isObj(rawNm)) return ["Saved component measurements are invalid."];
    const nm = rawNm as Record<string, unknown>;

    const countFields = [
      "arrived", "admitted", "completed", "rejected", "failed", "expired",
      "cancelled", "queued", "processing", "waiting", "activeWorkers",
      "attempts", "retries", "retrying", "reserved", "cleanupProcessing"
    ] as const;

    for (const f of countFields) {
      if (!isSafeNonNegInt(nm[f])) {
        return [`Node ${node.id} measurement ${f} must be a non-negative integer.`];
      }
    }

    const arrived = nm.arrived as number;
    const admitted = nm.admitted as number;
    const completed = nm.completed as number;
    const rejected = nm.rejected as number;
    const failed = nm.failed as number;
    const expired = nm.expired as number;
    const cancelled = nm.cancelled as number;
    const queued = nm.queued as number;
    const processing = nm.processing as number;
    const waiting = nm.waiting as number;
    const activeWorkers = nm.activeWorkers as number;
    const attempts = nm.attempts as number;
    const retries = nm.retries as number;
    const retrying = nm.retrying as number;
    const reserved = nm.reserved as number;
    const cleanupProcessing = nm.cleanupProcessing as number;

    if (admitted !== arrived - rejected) {
      return [`Node ${node.id} admitted count does not match arrived minus rejected.`];
    }
    if (cleanupProcessing > processing) {
      return [`Node ${node.id} cleanup processing cannot exceed active processing.`];
    }
    const partitioned = completed + rejected + failed + expired + cancelled + queued + processing - cleanupProcessing + waiting + retrying + reserved;
    if (arrived !== partitioned) {
      return [`Node ${node.id} logical partition does not reconcile with arrived count.`];
    }
    if (retries > attempts) {
      return [`Node ${node.id} retries cannot exceed attempts.`];
    }

    const behavior: BehaviorConfig = node.behavior ?? {
      type: "processor",
      capacity: node.capacity,
      concurrency: node.workers ?? 1,
      queueLimit: node.queueLimit,
      failureRate: node.failureRate ?? 0,
      maxRetries: node.maxRetries ?? 0,
      retryDelayMs: node.retryDelayMs ?? 0,
    };

    if (behavior.type === "source") {
      if (queued !== 0 || processing !== 0 || attempts !== 0 || reserved !== 0 || activeWorkers !== 0) {
        return [`Source node ${node.id} must have zero queued, processing, attempts, reserved, and active workers.`];
      }
    } else if (behavior.type === "broker") {
      if (processing !== 0 || attempts !== 0 || reserved !== 0 || activeWorkers !== 0) {
        return [`Broker node ${node.id} must have zero processing, attempts, reserved, and active workers.`];
      }
    } else {
      if (activeWorkers !== processing + reserved + waiting) {
        return [`Node ${node.id} active workers must equal processing plus reserved plus waiting.`];
      }
      if (activeWorkers > behavior.concurrency) {
        return [`Node ${node.id} active workers exceed concurrency limit.`];
      }
    }

    if (!Number.isFinite(nm.utilization) || (nm.utilization as number) < -1e-8 || (nm.utilization as number) > 1 + 1e-8) {
      return [`Node ${node.id} utilization must be between 0 and 1.`];
    }
    if (!Number.isFinite(nm.occupancy) || (nm.occupancy as number) < -1e-8 || (nm.occupancy as number) > 1 + 1e-8) {
      return [`Node ${node.id} occupancy must be between 0 and 1.`];
    }

    // Queue limits
    if (behavior.type === "broker") {
      const consumers = graph.edges.filter(e => e.source === node.id).length;
      const maxQ = behavior.delivery === "broadcast" ? behavior.queueLimit * Math.max(1, consumers) : behavior.queueLimit;
      if (queued > maxQ) {
        return [`Broker ${node.id} queue exceeds limit.`];
      }
    } else if (behavior.type !== "source") {
      if (queued > behavior.queueLimit) {
        return [`Node ${node.id} queue exceeds queueLimit.`];
      }
    }

    // Cache specific metrics
    if (behavior.type === "cache") {
      const c = nm.cache as Record<string, unknown> | undefined;
      if (!c || !isObj(c)) {
        return [`Cache node ${node.id} requires cache metrics.`];
      }
      for (const f of ["hits", "misses", "writes", "entries", "evictions", "expirations"] as const) {
        if (!isSafeNonNegInt(c[f])) {
          return [`Cache node ${node.id} metric ${f} must be a non-negative integer.`];
        }
      }
      const hits = c.hits as number;
      const misses = c.misses as number;
      const writes = c.writes as number;
      const entries = c.entries as number;
      const evictions = c.evictions as number;
      const expirations = c.expirations as number;

      if (entries > behavior.entries) {
        return [`Cache node ${node.id} entries exceed configured entries limit.`];
      }
      if (hits + misses + writes > admitted) {
        return [`Cache node ${node.id} operations cannot exceed admitted requests.`];
      }
      if (behavior.mode === "fixed") {
        if (entries !== 0 || evictions !== 0 || expirations !== 0) {
          return [`Fixed cache node ${node.id} must have 0 entries, evictions, and expirations.`];
        }
      }
      totalCacheHits += hits;
      totalCacheMisses += misses;
      totalCacheWrites += writes;
      totalCacheEntries += entries;
      totalCacheEvictions += evictions;
      totalCacheExpirations += expirations;
    } else {
      if (nm.cache !== undefined) {
        return [`Non-cache node ${node.id} cannot contain cache metrics.`];
      }
    }

    // Storage lookup tracking
    if (behavior.type === "storage") {
      totalStorageLookups += arrived;
    }

    // Broker specific fields (flat on node metrics in current runtime)
    if (behavior.type === "broker") {
      for (const f of ["buffered", "delivered", "inFlight"] as const) {
        if (!isSafeNonNegInt(nm[f])) {
          return [`Broker node ${node.id} metric ${f} must be a non-negative integer.`];
        }
      }
      const buffered = nm.buffered as number;
      const delivered = nm.delivered as number;
      const binFlight = nm.inFlight as number;
      if (buffered !== queued) {
        return [`Broker node ${node.id} buffered must equal queued.`];
      }
      if (binFlight !== waiting) {
        return [`Broker node ${node.id} inFlight must equal waiting.`];
      }
      if (delivered > admitted) {
        return [`Broker node ${node.id} delivered cannot exceed admitted.`];
      }
      if (completed > delivered) {
        return [`Broker node ${node.id} completed cannot exceed delivered.`];
      }
    }

    // Outer node projection check
    const outerNode = metrics.nodes[node.id];
    if (!outerNode || !isObj(outerNode) || !Number.isFinite(outerNode.utilization)) {
      return [`Component ${node.id} is missing from outer metrics.`];
    }
    if (outerNode.arrived !== arrived ||
        outerNode.completed !== completed ||
        outerNode.rejected !== rejected ||
        outerNode.queued !== queued ||
        outerNode.busy !== (activeWorkers > 0) ||
        outerNode.activeWorkers !== activeWorkers ||
        Math.abs(outerNode.utilization - (nm.utilization as number)) > 1e-6) {
      return [`Component ${node.id} outer metrics do not match execution measurements.`];
    }
  }

  // Outer cache and storage aggregates
  if (metrics.cacheHits !== totalCacheHits ||
      metrics.cacheMisses !== totalCacheMisses ||
      metrics.cacheEntries !== totalCacheEntries ||
      metrics.cacheEvictions !== totalCacheEvictions ||
      metrics.cacheExpirations !== totalCacheExpirations) {
    return ["Aggregate cache measurements do not match node cache metrics."];
  }
  if (metrics.databaseLookups !== totalStorageLookups) {
    return ["Aggregate storage lookups do not match storage arrival metrics."];
  }

  // Edge measurements
  for (const edge of graph.edges) {
    const rawEm = em.edges[edge.id];
    if (!rawEm || !isObj(rawEm)) return ["Saved connection measurements are invalid."];
    const edgeM = rawEm as Record<string, unknown>;

    for (const f of ["sent", "admitted", "rejected", "responses"] as const) {
      if (!isSafeNonNegInt(edgeM[f])) {
        return [`Edge ${edge.id} metric ${f} must be a non-negative integer.`];
      }
    }
    const sent = edgeM.sent as number;
    if (metrics.edges?.[edge.id] !== sent) return ["Outer connection measurements do not match execution."];
    const eAdmitted = edgeM.admitted as number;
    const eRejected = edgeM.rejected as number;
    const responses = edgeM.responses as number;

    if (eAdmitted + eRejected > sent) {
      return [`Edge ${edge.id} admitted + rejected cannot exceed sent.`];
    }
    if (responses > sent) {
      return [`Edge ${edge.id} responses cannot exceed sent.`];
    }
  }

  // Time-series history verification
  const expectedSamples = Math.floor(em.time);
  if (!Array.isArray(em.history) || em.history.length !== expectedSamples) {
    return ["Saved detailed time-series samples are invalid."];
  }
  if (!Array.isArray(metrics.history) || metrics.history.length !== expectedSamples) {
    return ["Saved time-series samples are invalid."];
  }

  let prevGen = 0;
  let prevComp = 0;
  for (let i = 0; i < expectedSamples; i++) {
    const sample = em.history[i];
    if (!sample || !isObj(sample)) return ["Saved detailed time-series samples are invalid."];
    if (sample.time !== i + 1) return ["Saved detailed time-series samples are invalid."];

    const vals = ["queue", "completed", "generated", "latency"] as const;
    for (const v of vals) {
      if (!Number.isFinite(sample[v]) || (sample[v] as number) < 0) {
        return ["Saved detailed time-series samples are invalid."];
      }
    }
    if (![sample.queue, sample.completed, sample.generated].every(isSafeNonNegInt))
      return ["Detailed history counts must be non-negative integers."];
    if ((sample.completed as number) > (sample.generated as number) || (sample.generated as number) > em.roots.generated) {
      return ["Saved detailed time-series sample counts are inconsistent."];
    }
    if ((sample.generated as number) < prevGen || (sample.completed as number) < prevComp) {
      return ["Detailed time-series cumulative counters must be monotonic."];
    }
    prevGen = sample.generated as number;
    prevComp = sample.completed as number;

    // Compare with outer history sample
    const outerSample = metrics.history[i];
    if (!outerSample || !isObj(outerSample)) return ["Saved time-series samples are invalid."];
    if (outerSample.time !== sample.time ||
        outerSample.queue !== sample.queue ||
        outerSample.completed !== sample.completed ||
        outerSample.generated !== sample.generated ||
        outerSample.latency !== sample.latency ||
        !Number.isFinite(outerSample.arrivalRate) ||
        outerSample.arrivalRate < 0) {
      return ["Outer history sample does not reconcile with detailed history."];
    }
  }

  return [];
}
