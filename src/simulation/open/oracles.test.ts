import { describe, expect, it } from "vitest";
import type {
  BehaviorConfig,
  ComponentKind,
  ExecutionEdge,
  ExecutionGraph,
  ExecutionNode,
  RequestClass,
  WorkloadDefinition,
} from "../../domain/execution";
import {
  OpenSimulation,
  type KernelFaultConfig,
  type OpenMetrics,
  type SimLifecycleFact,
} from "./kernel";

/**
 * Statistical realism oracles for the current open-system kernel.
 *
 * Every stochastic assertion uses six independent kernel seeds. For a scalar
 * estimate we use a two-sided 99% batch-means interval: mean +/- t(5,.995) SE,
 * where t(5,.995) = 4.032. Proportion/rate tests additionally include their
 * analytical binomial/Poisson sampling error. This makes the tolerance follow
 * from sample size instead of being an unexplained fixed epsilon.
 */

const SEEDS = [11, 29, 47, 71, 101, 149] as const;
const T_99_DF_5 = 4.032;

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const standardError = (values: readonly number[]): number => {
  const center = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - center) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance / values.length);
};

const batch99 = (values: readonly number[]): number =>
  T_99_DF_5 * standardError(values);

const expectWithin = (
  observed: number,
  expected: number,
  tolerance: number,
): void => {
  expect(Math.abs(observed - expected)).toBeLessThanOrEqual(tolerance);
};

const reportOracle = (
  oracle: string,
  expected: string,
  observed: string,
): void => {
  if (process.env.ORACLE_REPORT === "1") {
    console.info(
      `[oracle] ${oracle} | expected ${expected} | observed ${observed}`,
    );
  }
};

const baseResource = {
  capacity: 10_000,
  concurrency: 16,
  queueLimit: 10_000,
  failureRate: 0,
  maxRetries: 0,
  retryDelayMs: 0,
};

const sourceBehavior = (): BehaviorConfig => ({
  ...baseResource,
  type: "source",
});
const processorBehavior = (
  overrides: Partial<typeof baseResource> = {},
): BehaviorConfig => ({
  ...baseResource,
  ...overrides,
  type: "processor",
});
const routerBehavior = (
  strategy: "round-robin" | "weighted" | "conditional",
  overrides: Partial<typeof baseResource> = {},
): BehaviorConfig => ({
  ...baseResource,
  ...overrides,
  type: "router",
  strategy,
});
const cacheBehavior = (
  mode: "fixed" | "lru",
  options: { hitRate: number; entries: number; ttlMs: number },
): BehaviorConfig => ({ ...baseResource, type: "cache", mode, ...options });
const brokerBehavior = (
  delivery: "competing" | "broadcast",
): BehaviorConfig => ({
  ...baseResource,
  type: "broker",
  delivery,
});

const node = (
  id: string,
  kind: ComponentKind,
  behavior: BehaviorConfig,
): ExecutionNode => ({
  id,
  kind,
  name: id,
  position: { x: 0, y: 0 },
  behavior,
});

const edge = (
  id: string,
  source: string,
  target: string,
  overrides: Partial<ExecutionEdge> = {},
): ExecutionEdge => ({
  id,
  source,
  target,
  transport: "call",
  latencyMs: 0,
  returnLatencyMs: 0,
  ackDelayMs: 0,
  messageTtlMs: 300_000,
  weight: 1,
  ...overrides,
});

const requestClass = (
  id = "class-stable",
  overrides: Partial<RequestClass> = {},
): RequestClass => ({
  id,
  name: id,
  weight: 1,
  operation: "read",
  tags: [],
  keyDistribution: {
    kind: "uniform",
    catalogSize: 1_000,
    hotSubset: 10,
    hotShare: 80,
  },
  ...overrides,
});

const workload = (
  entryNodeId: string,
  rate: number,
  overrides: Partial<WorkloadDefinition> = {},
): WorkloadDefinition => ({
  id: "workload-stable",
  entryNodeId,
  enabled: true,
  rate,
  profile: { kind: "steady" },
  timeoutMs: 300_000,
  classes: [requestClass()],
  ...overrides,
});

const graph = (
  nodes: ExecutionNode[],
  edges: ExecutionEdge[],
  workloads: WorkloadDefinition[],
  seed: number,
  duration: number,
): ExecutionGraph => ({
  executionVersion: "open-system/1",
  nodes,
  edges,
  workloads,
  settings: { seed, duration },
});

const run = (
  nodes: ExecutionNode[],
  edges: ExecutionEdge[],
  workloads: WorkloadDefinition[],
  seed: number,
  duration: number,
): OpenMetrics =>
  new OpenSimulation(graph(nodes, edges, workloads, seed, duration)).advance(
    duration,
  );

const erlangC = (servers: number, rho: number): number => {
  const offered = servers * rho;
  let finiteSum = 0;
  let factorial = 1;
  for (let n = 0; n < servers; n++) {
    if (n > 0) factorial *= n;
    finiteSum += offered ** n / factorial;
  }
  factorial *= servers;
  const tail = offered ** servers / (factorial * (1 - rho));
  return tail / (finiteSum + tail);
};

const cosmetatosMdCWait = (
  servers: number,
  serviceSeconds: number,
  rho: number,
): number => {
  const mmcWait =
    (erlangC(servers, rho) * serviceSeconds) / (servers * (1 - rho));
  const correction =
    ((1 - rho) * (servers - 1) * (Math.sqrt(4 + 5 * servers) - 2)) /
    (16 * servers * rho);
  return 0.5 * (1 + correction) * mmcWait;
};

describe("open-system analytical oracles", () => {
  it("obeys Little's law for a stable M/D/1 resource", () => {
    const duration = 240;
    const rate = 8;
    const nodes = [
      node("source", "traffic", sourceBehavior()),
      node(
        "resource",
        "service",
        processorBehavior({ capacity: 10, concurrency: 1 }),
      ),
    ];
    const edges = [edge("source-resource", "source", "resource")];
    const samples = SEEDS.map((seed) =>
      run(nodes, edges, [workload("source", rate)], seed, duration),
    );

    const littlePairs = samples.map((metrics) => {
      // The kernel exposes a true time integral for in-service work through
      // utilization. It does not expose a queue integral, so Lq is the mean of
      // its one-second queue-history samples. With one resource, history.queue
      // is exactly this FIFO's sampled size. The <=1 s quadrature uncertainty
      // contributes at most lambda*1s/duration to the run-average L estimate.
      const meanQueued = mean(metrics.history.map((sample) => sample.queue));
      const meanInService = metrics.nodes.resource.utilization;
      const observedL = meanQueued + meanInService;
      const lambdaW =
        (metrics.roots.throughput * metrics.roots.meanLatency) / 1_000;
      return { observedL, lambdaW };
    });
    const residuals = littlePairs.map(
      ({ observedL, lambdaW }) => observedL - lambdaW,
    );
    const quadratureAllowance = rate / duration;

    expectWithin(mean(residuals), 0, batch99(residuals) + quadratureAllowance);
    reportOracle(
      "Little",
      `lambda*W=${mean(littlePairs.map((pair) => pair.lambdaW)).toFixed(4)}`,
      `L=${mean(littlePairs.map((pair) => pair.observedL)).toFixed(4)}`,
    );
  });

  it("matches min(lambda, c*mu), then rejects excess load after the finite queue fills", () => {
    const duration = 240;
    const capacityPerServer = 5;
    const servers = 2;
    const serviceCapacity = capacityPerServer * servers;
    const nodes = [
      node(
        "resource",
        "service",
        processorBehavior({
          capacity: capacityPerServer,
          concurrency: servers,
          queueLimit: 30,
        }),
      ),
    ];

    const stableThroughputs = SEEDS.map(
      (seed) =>
        run(nodes, [], [workload("resource", 6)], seed, duration).roots
          .throughput,
    );
    const stablePoisson99 =
      T_99_DF_5 * Math.sqrt(6 / (duration * SEEDS.length));
    expectWithin(
      mean(stableThroughputs),
      Math.min(6, serviceCapacity),
      batch99(stableThroughputs) + stablePoisson99,
    );

    const saturated = SEEDS.map((seed) =>
      run(nodes, [], [workload("resource", 15)], seed, duration),
    );
    const saturatedThroughputs = saturated.map(
      (metrics) => metrics.roots.throughput,
    );
    const rejectionRates = saturated.map(
      (metrics) => metrics.roots.rejected / duration,
    );
    // Poisson thinning gives SE sqrt(rate/(T*n)). Queue fill retains at most
    // queueLimit jobs, so queueLimit/T is an explicit finite-horizon bias bound.
    const throughput99 =
      T_99_DF_5 * Math.sqrt(serviceCapacity / (duration * SEEDS.length));
    const rejection99 =
      T_99_DF_5 * Math.sqrt((15 - serviceCapacity) / (duration * SEEDS.length));
    const fillBias = 30 / duration;
    expectWithin(
      mean(saturatedThroughputs),
      serviceCapacity,
      batch99(saturatedThroughputs) + throughput99,
    );
    expectWithin(
      mean(rejectionRates),
      15 - serviceCapacity,
      batch99(rejectionRates) + rejection99 + fillBias,
    );
    reportOracle(
      "Throughput",
      "stable=6.0000 saturated=10.0000 reject=5.0000 /s",
      `stable=${mean(stableThroughputs).toFixed(4)} saturated=${mean(saturatedThroughputs).toFixed(4)} reject=${mean(rejectionRates).toFixed(4)} /s`,
    );
  });

  describe("M/D/c waiting time", () => {
    const duration = 240;
    const serviceRate = 20;
    const serviceSeconds = 1 / serviceRate;

    for (const rho of [0.5, 0.8, 0.95]) {
      it(`matches exact M/D/1 mean queue wait at rho=${rho}`, () => {
        const expected = (rho * serviceSeconds) / (2 * (1 - rho));
        const waits = SEEDS.map((seed) => {
          const metrics = run(
            [
              node(
                "resource",
                "service",
                processorBehavior({ capacity: serviceRate, concurrency: 1 }),
              ),
            ],
            [],
            [workload("resource", rho * serviceRate)],
            seed,
            duration,
          );
          return metrics.roots.meanLatency / 1_000 - serviceSeconds;
        });
        expectWithin(mean(waits), expected, batch99(waits));
        reportOracle(
          `M/D/1 rho=${rho}`,
          `${expected.toFixed(5)}s`,
          `${mean(waits).toFixed(5)}s`,
        );
      });

      it(`matches the Cosmetatos M/D/2 approximation at rho=${rho}`, () => {
        const servers = 2;
        const expected = cosmetatosMdCWait(servers, serviceSeconds, rho);
        const waits = SEEDS.map((seed) => {
          const metrics = run(
            [
              node(
                "resource",
                "service",
                processorBehavior({
                  capacity: serviceRate,
                  concurrency: servers,
                }),
              ),
            ],
            [],
            [workload("resource", rho * servers * serviceRate)],
            seed,
            duration,
          );
          return metrics.roots.meanLatency / 1_000 - serviceSeconds;
        });
        // Cosmetatos (INFOR 13, 1975, DOI 10.1080/03155986.1975.11731618)
        // reported relative error below 1% for most tested practical cases up
        // to 100 servers. We reserve a conservative 5% approximation envelope,
        // then add the independently derived 99% batch-means sampling interval.
        expectWithin(mean(waits), expected, batch99(waits) + 0.05 * expected);
        reportOracle(
          `M/D/2 rho=${rho}`,
          `${expected.toFixed(5)}s`,
          `${mean(waits).toFixed(5)}s`,
        );
      });
    }
  });

  it("matches geometric retry amplification and terminal-failure probability", () => {
    const p = 0.3;
    const retries = 2;
    const duration = 120;
    const rate = 40;
    const expectedAttempts = 1 + p + p ** 2;
    const expectedFailureShare = p ** (retries + 1);
    const samples = SEEDS.map((seed) =>
      run(
        [
          node(
            "resource",
            "service",
            processorBehavior({
              capacity: 500,
              concurrency: 16,
              failureRate: p * 100,
              maxRetries: retries,
            }),
          ),
        ],
        [],
        [workload("resource", rate)],
        seed,
        duration,
      ),
    );
    const attemptsPerSettled = samples.map((metrics) => {
      const settled = metrics.roots.succeeded + metrics.roots.failed;
      return metrics.nodes.resource.attempts / settled;
    });
    const failureShares = samples.map(
      (metrics) =>
        metrics.roots.failed / (metrics.roots.succeeded + metrics.roots.failed),
    );
    const totalSettled = samples.reduce(
      (sum, metrics) => sum + metrics.roots.succeeded + metrics.roots.failed,
      0,
    );
    const attemptSecondMoment = Array.from(
      { length: retries + 1 },
      (_, index) => {
        const attempts = index + 1;
        const probability = index < retries ? p ** index * (1 - p) : p ** index;
        return attempts ** 2 * probability;
      },
    ).reduce((sum, value) => sum + value, 0);
    const attemptVariance = attemptSecondMoment - expectedAttempts ** 2;
    const attemptSampling99 =
      T_99_DF_5 * Math.sqrt(attemptVariance / totalSettled);
    const failureBinomial99 =
      T_99_DF_5 *
      Math.sqrt(
        (expectedFailureShare * (1 - expectedFailureShare)) / totalSettled,
      );

    // A truncated geometric attempt count has the second moment computed above;
    // its 99% sampling term is added to the independent batch-means interval.
    expectWithin(
      mean(attemptsPerSettled),
      expectedAttempts,
      batch99(attemptsPerSettled) + attemptSampling99,
    );
    expectWithin(
      mean(failureShares),
      expectedFailureShare,
      batch99(failureShares) + failureBinomial99,
    );
    reportOracle(
      "Retry",
      `attempts=${expectedAttempts.toFixed(4)} failures=${expectedFailureShare.toFixed(4)}`,
      `attempts=${mean(attemptsPerSettled).toFixed(4)} failures=${mean(failureShares).toFixed(4)}`,
    );
  });

  it("expires exactly the requests whose deadline is below deterministic service time", () => {
    const serviceMs = 100;
    const duration = 30;
    const resource = node(
      "resource",
      "service",
      processorBehavior({
        capacity: 1_000 / serviceMs,
        concurrency: 1,
        queueLimit: 0,
      }),
    );
    const expiryShares = SEEDS.map((seed) => {
      const metrics = run(
        [resource],
        [],
        [workload("resource", 5, { intervalMs: 200, timeoutMs: 50 })],
        seed,
        duration,
      );
      return (
        metrics.roots.expired /
        (metrics.roots.generated - metrics.roots.inFlight)
      );
    });
    const successShares = SEEDS.map((seed) => {
      const metrics = run(
        [resource],
        [],
        [workload("resource", 5, { intervalMs: 200, timeoutMs: 150 })],
        seed,
        duration,
      );
      return (
        metrics.roots.succeeded /
        (metrics.roots.generated - metrics.roots.inFlight)
      );
    });

    // Arrivals are 200 ms apart, so queueing is exactly zero. The closed-form
    // shares are therefore 1{timeout < S}: no statistical epsilon is needed.
    expect(mean(expiryShares)).toBe(1);
    expect(mean(successShares)).toBe(1);
    reportOracle(
      "Deadlines",
      "short-timeout expired=1.0000 long-timeout succeeded=1.0000",
      `short-timeout expired=${mean(expiryShares).toFixed(4)} long-timeout succeeded=${mean(successShares).toFixed(4)}`,
    );
  });

  it("matches fixed-cache origin load and gives skewed LRU keys a higher hit rate", () => {
    const duration = 120;
    const rate = 40;
    const hitRate = 0.7;
    const makeCacheNodes = (behavior: BehaviorConfig): ExecutionNode[] => [
      node("source", "traffic", sourceBehavior()),
      node("cache", "cache", behavior),
      node("origin", "database", processorBehavior()),
    ];
    const edges = [
      edge("source-cache", "source", "cache"),
      edge("cache-origin", "cache", "origin"),
    ];
    const fixed = SEEDS.map((seed) =>
      run(
        makeCacheNodes(
          cacheBehavior("fixed", {
            hitRate: hitRate * 100,
            entries: 20,
            ttlMs: 3_600_000,
          }),
        ),
        edges,
        [workload("source", rate)],
        seed,
        duration,
      ),
    );
    const originShares = fixed.map(
      (metrics) => metrics.nodes.origin.arrived / metrics.roots.generated,
    );
    const totalFixed = fixed.reduce(
      (sum, metrics) => sum + metrics.roots.generated,
      0,
    );
    const binomial99 =
      T_99_DF_5 * Math.sqrt((hitRate * (1 - hitRate)) / totalFixed);
    expectWithin(
      mean(originShares),
      1 - hitRate,
      batch99(originShares) + binomial99,
    );

    const lruHitRates = (kind: "uniform" | "hot"): number[] =>
      SEEDS.map((seed) => {
        const metrics = run(
          makeCacheNodes(
            cacheBehavior("lru", { hitRate: 0, entries: 20, ttlMs: 3_600_000 }),
          ),
          edges,
          [
            workload("source", rate, {
              classes: [
                requestClass("cache-class", {
                  keyDistribution: {
                    kind,
                    catalogSize: 200,
                    hotSubset: 10,
                    hotShare: 90,
                  },
                }),
              ],
            }),
          ],
          seed,
          duration,
        );
        const cache = metrics.nodes.cache.cache;
        if (!cache) throw new Error("cache metrics missing");
        return cache.hits / (cache.hits + cache.misses);
      });
    const uniform = lruHitRates("uniform");
    const hot = lruHitRates("hot");
    const improvements = hot.map((value, index) => value - uniform[index]);
    // A one-sided 99% paired batch interval must remain above zero.
    expect(
      mean(improvements) - T_99_DF_5 * standardError(improvements),
    ).toBeGreaterThan(0);
    reportOracle(
      "Cache",
      "origin share=0.3000; hot LRU > uniform LRU",
      `origin share=${mean(originShares).toFixed(4)}; hot=${mean(hot).toFixed(4)} uniform=${mean(uniform).toFixed(4)}`,
    );
  });

  it("routes round-robin equally and weighted routes in the configured proportion", () => {
    const duration = 90;
    const rate = 50;
    const makeNodes = (behavior: BehaviorConfig): ExecutionNode[] => [
      node("source", "traffic", sourceBehavior()),
      node("router", "balancer", behavior),
      node("one", "service", processorBehavior()),
      node("two", "service", processorBehavior()),
    ];
    const routeEdges = (weightOne = 1, weightTwo = 1): ExecutionEdge[] => [
      edge("source-router", "source", "router"),
      edge("route-one", "router", "one", { weight: weightOne }),
      edge("route-two", "router", "two", { weight: weightTwo }),
    ];

    for (const seed of SEEDS) {
      const metrics = run(
        makeNodes(routerBehavior("round-robin")),
        routeEdges(),
        [workload("source", rate)],
        seed,
        duration,
      );
      expect(
        Math.abs(
          metrics.edges["route-one"].sent - metrics.edges["route-two"].sent,
        ),
      ).toBeLessThanOrEqual(1);
    }

    const weightedShares = SEEDS.map((seed) => {
      const metrics = run(
        makeNodes(routerBehavior("weighted")),
        routeEdges(1, 3),
        [workload("source", rate)],
        seed,
        duration,
      );
      return (
        metrics.edges["route-one"].sent /
        (metrics.edges["route-one"].sent + metrics.edges["route-two"].sent)
      );
    });
    const totalWeighted = rate * duration * SEEDS.length;
    const weightedBinomial99 =
      T_99_DF_5 * Math.sqrt((0.25 * 0.75) / totalWeighted);
    expectWithin(
      mean(weightedShares),
      0.25,
      batch99(weightedShares) + weightedBinomial99,
    );
    reportOracle(
      "Routing",
      "round-robin imbalance<=1; weight 1:3 share=0.2500",
      `round-robin imbalance<=1; weighted share=${mean(weightedShares).toFixed(4)}`,
    );
  });

  it("routes conditional classes to their exact configured branches", () => {
    for (const seed of SEEDS) {
      const facts: SimLifecycleFact[] = [];
      const nodes = [
        node("source", "traffic", sourceBehavior()),
        node("router", "balancer", routerBehavior("conditional")),
        node("gold-target", "service", processorBehavior()),
        node("silver-target", "service", processorBehavior()),
      ];
      const edges = [
        edge("source-router", "source", "router"),
        edge("gold-route", "router", "gold-target", {
          condition: { field: "class", value: "gold" },
        }),
        edge("silver-route", "router", "silver-target", { fallback: true }),
      ];
      const workloads = [
        workload("source", 20, {
          id: "gold-workload",
          classes: [requestClass("gold", { name: "gold" })],
        }),
        workload("source", 30, {
          id: "silver-workload",
          classes: [requestClass("silver", { name: "silver" })],
        }),
      ];
      const sim = new OpenSimulation(graph(nodes, edges, workloads, seed, 60), {
        traceHook: (fact) => facts.push(fact),
      });
      sim.advance(60);
      const selections = facts.filter(
        (fact) => fact.kind === "route_selected" && fact.nodeId === "router",
      );
      expect(selections.length).toBeGreaterThan(0);
      expect(
        selections.every(
          (fact) =>
            (fact.unitIdentity.startsWith("gold-workload-") &&
              fact.edgeId === "gold-route") ||
            (fact.unitIdentity.startsWith("silver-workload-") &&
              fact.edgeId === "silver-route"),
        ),
      ).toBe(true);
    }
    reportOracle(
      "Conditional routing",
      "class-exact=1.0000",
      "class-exact=1.0000",
    );
  });

  it("splits competing broker work and multiplies broadcast downstream load by N", () => {
    const consumers = 3;
    const duration = 60;
    const rate = 30;
    const makeBrokerGraph = (
      delivery: "competing" | "broadcast",
      seed: number,
    ): ExecutionGraph => {
      const nodes = [
        node("source", "traffic", sourceBehavior()),
        node(
          "broker",
          delivery === "broadcast" ? "pubsub" : "queue",
          brokerBehavior(delivery),
        ),
        ...Array.from({ length: consumers }, (_, index) =>
          node(`worker-${index}`, "worker", processorBehavior()),
        ),
      ];
      const edges = [
        edge("source-broker", "source", "broker", { transport: "message" }),
        ...Array.from({ length: consumers }, (_, index) =>
          edge(`delivery-${index}`, "broker", `worker-${index}`, {
            transport: "message",
          }),
        ),
      ];
      return graph(nodes, edges, [workload("source", rate)], seed, duration);
    };

    const competingTotals: number[] = [];
    const broadcastTotals: number[] = [];
    for (const seed of SEEDS) {
      const competing = new OpenSimulation(
        makeBrokerGraph("competing", seed),
      ).advance(duration);
      const broadcast = new OpenSimulation(
        makeBrokerGraph("broadcast", seed),
      ).advance(duration);
      const competingLoads = Array.from(
        { length: consumers },
        (_, index) => competing.nodes[`worker-${index}`].arrived,
      );
      const broadcastLoads = Array.from(
        { length: consumers },
        (_, index) => broadcast.nodes[`worker-${index}`].arrived,
      );
      competingTotals.push(competingLoads.reduce((sum, load) => sum + load, 0));
      broadcastTotals.push(broadcastLoads.reduce((sum, load) => sum + load, 0));
      expect(
        Math.max(...competingLoads) - Math.min(...competingLoads),
      ).toBeLessThanOrEqual(1);
      expect(
        broadcastLoads.every(
          (load) => load === competing.edges["source-broker"].sent,
        ),
      ).toBe(true);
      expect(broadcastLoads.reduce((sum, load) => sum + load, 0)).toBe(
        consumers * competingLoads.reduce((sum, load) => sum + load, 0),
      );
    }
    reportOracle(
      "Brokers",
      `competing equal; broadcast/competing=${consumers.toFixed(4)}`,
      `competing imbalance<=1; broadcast/competing=${(mean(broadcastTotals) / mean(competingTotals)).toFixed(4)}`,
    );
  });

  it("limits fault errors to detection delay and resumes round-robin after recovery", () => {
    const duration = 50;
    const rate = 40;
    const downAt = 15;
    const upAt = 30;
    const detectionDelay = 2;
    const recoveryDelay = 2;
    const nodes = [
      node("source", "traffic", sourceBehavior()),
      node("router", "balancer", routerBehavior("round-robin")),
      node("healthy", "service", processorBehavior()),
      node("faulted", "service", processorBehavior()),
    ];
    const edges = [
      edge("source-router", "source", "router"),
      edge("healthy-route", "router", "healthy"),
      edge("faulted-route", "router", "faulted"),
    ];
    const fault: KernelFaultConfig = {
      id: "fault-stable",
      hostId: "host-faulted",
      downAtMs: downAt * 1_000,
      upAtMs: upAt * 1_000,
      detectionDelayMs: detectionDelay * 1_000,
      recoveryDetectionDelayMs: recoveryDelay * 1_000,
      activePolicy: "fail",
      queuedPolicy: "reject",
      routeReset: "first-healthy",
    };
    const transitionFailures: number[] = [];

    for (const seed of SEEDS) {
      const facts: SimLifecycleFact[] = [];
      const sim = new OpenSimulation(
        graph(nodes, edges, [workload("source", rate)], seed, duration),
        {
          traceHook: (fact) => facts.push(fact),
          hostPlacement: { faulted: "host-faulted", healthy: "host-healthy" },
          faults: [fault],
        },
      );
      sim.advance(duration);
      const rootSettles = facts.filter(
        (fact) => fact.kind === "unit_settled" && fact.category === "root",
      );
      transitionFailures.push(
        rootSettles.filter(
          (fact) =>
            fact.outcome === "failed" &&
            fact.time >= downAt &&
            fact.time < downAt + detectionDelay,
        ).length,
      );
      expect(
        rootSettles.filter(
          (fact) =>
            fact.outcome !== "succeeded" &&
            fact.time >= downAt + detectionDelay &&
            fact.time < upAt,
        ).length,
      ).toBe(0);

      const routeFacts = facts.filter(
        (fact) => fact.kind === "route_selected" && fact.nodeId === "router",
      );
      expect(
        routeFacts.filter(
          (fact) =>
            fact.time >= downAt + detectionDelay &&
            fact.time < upAt &&
            fact.edgeId === "faulted-route",
        ).length,
      ).toBe(0);
      const afterRecovery = routeFacts.filter(
        (fact) => fact.time >= upAt + recoveryDelay,
      );
      const recoveredRoutes = afterRecovery.filter(
        (fact) => fact.edgeId === "faulted-route",
      ).length;
      expect(
        Math.abs(recoveredRoutes - afterRecovery.length / 2),
      ).toBeLessThanOrEqual(1);
    }

    // RR sends half of total lambda to the failing host until detection, so
    // failures are Poisson(lambda*d/2). The 99% tolerance is the batch interval
    // plus 4.032*sqrt(expected/n), derived from Poisson variance.
    const expected = (rate * detectionDelay) / 2;
    const poisson99 = T_99_DF_5 * Math.sqrt(expected / SEEDS.length);
    expectWithin(
      mean(transitionFailures),
      expected,
      batch99(transitionFailures) + poisson99,
    );
    reportOracle(
      "Faults",
      `detection-window failures=${expected.toFixed(4)}; healthy-only then RR resumes`,
      `failures=${mean(transitionFailures).toFixed(4)}; healthy-only then RR resumes`,
    );
  });

  it("adds 2*k*l call latency over k synchronous hops", () => {
    const duration = 30;
    const rate = 10;
    const hops = 4;
    const oneWayMs = 7;
    const nodes = [
      node("source", "traffic", sourceBehavior()),
      ...Array.from({ length: hops }, (_, index) =>
        node(
          `service-${index}`,
          "service",
          processorBehavior({ capacity: 10_000 }),
        ),
      ),
    ];
    const makeEdges = (latencyMs: number): ExecutionEdge[] =>
      Array.from({ length: hops }, (_, index) =>
        edge(
          `hop-${index}`,
          index === 0 ? "source" : `service-${index - 1}`,
          `service-${index}`,
          { latencyMs, returnLatencyMs: latencyMs },
        ),
      );
    const increments = SEEDS.map((seed) => {
      const zero = run(
        nodes,
        makeEdges(0),
        [workload("source", rate)],
        seed,
        duration,
      );
      const delayed = run(
        nodes,
        makeEdges(oneWayMs),
        [workload("source", rate)],
        seed,
        duration,
      );
      return delayed.roots.meanLatency - zero.roots.meanLatency;
    });
    const expected = 2 * hops * oneWayMs;
    // Both runs use identical arrivals and deterministic service. Paired
    // subtraction removes seed variance, leaving only floating-point rounding.
    expectWithin(mean(increments), expected, Number.EPSILON * expected * 1_000);
    reportOracle(
      "Call-chain latency",
      `${expected.toFixed(4)}ms`,
      `${mean(increments).toFixed(4)}ms`,
    );
  });
});
