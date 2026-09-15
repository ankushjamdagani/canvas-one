import type { Graph, ModelNode, ModelEdge } from "./model";
import { clone } from "./model";
import { architectureTemplates } from "./architectureTemplates";
import { experiments } from "./experiments";
import { createRunnableCopy, makeOpenNode } from "./openGraph";
import { defaultWorkload, defaultBehavior } from "./behaviorDefaults";
import type { ExecutionEdge, ExecutionGraph, ExecutionNode, WorkloadDefinition } from "./execution";

type ExampleGraph = Omit<Graph, "nodes" | "edges" | "workloads"> & { executionVersion: "open-system/1"; nodes: (ModelNode & ExecutionNode)[]; edges: (ModelEdge & ExecutionEdge)[]; workloads: WorkloadDefinition[] };

export interface OpenExample {
  id: string;
  title: string;
  purpose: string;
  kind: "starter" | "tutorial";
  steps: string[];
  create: () => Graph;
}

function assignUniqueIds(graph: ExampleGraph): void {
  const idMap = new Map<string, string>();
  for (const node of graph.nodes) {
    const oldId = node.id;
    const newId = crypto.randomUUID();
    idMap.set(oldId, newId);
    node.id = newId;
  }
  for (const edge of graph.edges) {
    edge.id = crypto.randomUUID();
    edge.source = idMap.get(edge.source) ?? edge.source;
    edge.target = idMap.get(edge.target) ?? edge.target;
  }
  for (const wl of graph.workloads) {
    wl.id = crypto.randomUUID();
    wl.entryNodeId = idMap.get(wl.entryNodeId) ?? wl.entryNodeId;
    for (const c of wl.classes) {
      c.id = crypto.randomUUID();
    }
  }
}

function resolveNeedsReviewAndEdges(graph: ExecutionGraph): void {
  const nodeMap = new Map<string, ExecutionNode>();
  for (const n of graph.nodes) {
    nodeMap.set(n.id, n);
  }
  for (const e of graph.edges) {
    delete e.needsReview;
    const src = nodeMap.get(e.source);
    const tgt = nodeMap.get(e.target);
    const isBroker = src?.behavior.type === "broker" || tgt?.behavior.type === "broker";
    if (isBroker) {
      e.transport = "message";
    }
  }
}

function makeRealtimeChatGraph(): Graph {
  const tmpl = architectureTemplates.find((t) => t.id === "realtime-chat")!;
  const legacyGraph = tmpl.create();
  const copy = createRunnableCopy({
    id: crypto.randomUUID(),
    name: tmpl.title,
    graph: legacyGraph,
    checkpoints: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: Date.now(),
  });
  const graph = copy.graph as ExampleGraph;
  delete graph.scenario;
  delete graph.guideId;

  const client = graph.nodes.find((n) => n.name === "Chat client")!;
  const gateway = graph.nodes.find((n) => n.name === "API gateway")!;
  const service = graph.nodes.find((n) => n.name === "Chat service")!;
  const database = graph.nodes.find((n) => n.name === "Message database")!;
  const topic = graph.nodes.find((n) => n.name === "Message topic")!;
  const worker = graph.nodes.find((n) => n.name === "Notification worker")!;
  const notification = graph.nodes.find((n) => n.name === "Notification service")!;

  // Producer source workload
  client.behavior = defaultBehavior("client");
  const wl = defaultWorkload(client.id);
  wl.rate = 100;
  wl.classes[0].operation = "write";
  graph.workloads = [wl];

  // Router gateway
  gateway.behavior = { ...gateway.behavior, type: "router", strategy: "round-robin" };

  // Broker topic
  topic.behavior = defaultBehavior("pubsub");

  // Set descriptions
  topic.description = "Broker queue delivering messages to downstream workers without durability or partitioning guarantees.";

  resolveNeedsReviewAndEdges(graph);

  // Configure explicit transports
  const eClientGateway = graph.edges.find((e) => e.source === client.id && e.target === gateway.id);
  if (eClientGateway) eClientGateway.transport = "call";
  const eGatewayService = graph.edges.find((e) => e.source === gateway.id && e.target === service.id);
  if (eGatewayService) eGatewayService.transport = "call";
  const eServiceDb = graph.edges.find((e) => e.source === service.id && e.target === database.id);
  if (eServiceDb) eServiceDb.transport = "call";
  const eServiceTopic = graph.edges.find((e) => e.source === service.id && e.target === topic.id);
  if (eServiceTopic) eServiceTopic.transport = "message";
  const eTopicWorker = graph.edges.find((e) => e.source === topic.id && e.target === worker.id);
  if (eTopicWorker) eTopicWorker.transport = "message";
  const eWorkerNotification = graph.edges.find((e) => e.source === worker.id && e.target === notification.id);
  if (eWorkerNotification) eWorkerNotification.transport = "call";

  assignUniqueIds(graph);
  return graph;
}

function makeEcommerceCheckoutGraph(): Graph {
  const tmpl = architectureTemplates.find((t) => t.id === "ecommerce-checkout")!;
  const legacyGraph = tmpl.create();
  const copy = createRunnableCopy({
    id: crypto.randomUUID(),
    name: tmpl.title,
    graph: legacyGraph,
    checkpoints: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: Date.now(),
  });
  const graph = copy.graph as ExampleGraph;
  delete graph.scenario;
  delete graph.guideId;

  const client = graph.nodes.find((n) => n.name === "Storefront")!;
  const gateway = graph.nodes.find((n) => n.name === "API gateway")!;
  const checkout = graph.nodes.find((n) => n.name === "Checkout service")!;
  const cache = graph.nodes.find((n) => n.name === "Product cache")!;
  const database = graph.nodes.find((n) => n.name === "Product database")!;
  const payment = graph.nodes.find((n) => n.name === "Payment provider")!;
  const queue = graph.nodes.find((n) => n.name === "Order queue")!;
  const worker = graph.nodes.find((n) => n.name === "Fulfillment worker")!;

  client.behavior = defaultBehavior("client");
  const wl = defaultWorkload(client.id);
  wl.rate = 100;
  wl.classes[0].operation = "read";
  graph.workloads = [wl];

  gateway.behavior = { ...gateway.behavior, type: "router", strategy: "round-robin" };
  queue.behavior = { ...queue.behavior, type: "broker", delivery: "competing" };
  queue.description = "Order broker queue distributing fulfillment jobs to workers without ordering or persistence guarantees.";

  checkout.description =
    "Coordinates illustrative checkout with parallel product lookup, payment authorization, and order enqueue. No transactions, atomicity, or happens-before ordering are guaranteed.";

  resolveNeedsReviewAndEdges(graph);

  const eClientGateway = graph.edges.find((e) => e.source === client.id && e.target === gateway.id);
  if (eClientGateway) eClientGateway.transport = "call";
  const eGatewayCheckout = graph.edges.find((e) => e.source === gateway.id && e.target === checkout.id);
  if (eGatewayCheckout) eGatewayCheckout.transport = "call";
  const eCheckoutCache = graph.edges.find((e) => e.source === checkout.id && e.target === cache.id);
  if (eCheckoutCache) eCheckoutCache.transport = "call";
  const eCacheDb = graph.edges.find((e) => e.source === cache.id && e.target === database.id);
  if (eCacheDb) eCacheDb.transport = "call";
  const eCheckoutPayment = graph.edges.find((e) => e.source === checkout.id && e.target === payment.id);
  if (eCheckoutPayment) eCheckoutPayment.transport = "call";
  const eCheckoutQueue = graph.edges.find((e) => e.source === checkout.id && e.target === queue.id);
  if (eCheckoutQueue) eCheckoutQueue.transport = "message";
  const eQueueWorker = graph.edges.find((e) => e.source === queue.id && e.target === worker.id);
  if (eQueueWorker) eQueueWorker.transport = "message";

  assignUniqueIds(graph);
  return graph;
}

function makeEventProcessingGraph(): Graph {
  const tmpl = architectureTemplates.find((t) => t.id === "event-processing")!;
  const legacyGraph = tmpl.create();
  const copy = createRunnableCopy({
    id: crypto.randomUUID(),
    name: tmpl.title,
    graph: legacyGraph,
    checkpoints: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: Date.now(),
  });
  const graph = copy.graph as ExampleGraph;
  delete graph.scenario;
  delete graph.guideId;

  const producer = graph.nodes.find((n) => n.name === "Event producer")!;
  const stream = graph.nodes.find((n) => n.name === "Event stream")!;
  const worker = graph.nodes.find((n) => n.name === "Stream processor")!;
  const archive = graph.nodes.find((n) => n.name === "Event archive")!;
  const warehouse = graph.nodes.find((n) => n.name === "Data warehouse")!;
  const analytics = graph.nodes.find((n) => n.name === "Analytics")!;

  producer.behavior = defaultBehavior("device");
  const wl = defaultWorkload(producer.id);
  wl.rate = 100;
  wl.classes[0].operation = "write";
  graph.workloads = [wl];

  stream.behavior = { ...stream.behavior, type: "broker", delivery: "competing" };
  stream.description = "Competing broker queue delivering ingested events without partition keys or persistence durability.";

  resolveNeedsReviewAndEdges(graph);

  const eProdStream = graph.edges.find((e) => e.source === producer.id && e.target === stream.id);
  if (eProdStream) eProdStream.transport = "message";
  const eStreamWorker = graph.edges.find((e) => e.source === stream.id && e.target === worker.id);
  if (eStreamWorker) eStreamWorker.transport = "message";
  const eWorkerArchive = graph.edges.find((e) => e.source === worker.id && e.target === archive.id);
  if (eWorkerArchive) eWorkerArchive.transport = "call";
  const eWorkerWarehouse = graph.edges.find((e) => e.source === worker.id && e.target === warehouse.id);
  if (eWorkerWarehouse) eWorkerWarehouse.transport = "call";
  const eWarehouseAnalytics = graph.edges.find((e) => e.source === warehouse.id && e.target === analytics.id);
  if (eWarehouseAnalytics) eWarehouseAnalytics.transport = "call";

  assignUniqueIds(graph);
  return graph;
}

function makeTutorialGraph(expId: string, customizer?: (g: ExampleGraph) => void): Graph {
  const exp = experiments.find((e) => e.id === expId)!;
  const legacyGraph = exp.build();
  const copy = createRunnableCopy({
    id: crypto.randomUUID(),
    name: exp.title,
    graph: legacyGraph,
    checkpoints: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: Date.now(),
  });
  const graph = copy.graph as ExampleGraph;
  delete graph.scenario;
  graph.guideId = expId;

  resolveNeedsReviewAndEdges(graph);

  if (customizer) {
    customizer(graph);
  }

  assignUniqueIds(graph);
  return graph;
}

function makeColdCachePopularityGraph(): Graph {
  return makeTutorialGraph("cold-cache-popularity", (graph) => {
    const traffic = graph.nodes.find((n) => n.kind === "traffic")!;
    const cache = graph.nodes.find((n) => n.kind === "cache")!;
    cache.behavior = {
      ...cache.behavior,
      type: "cache",
      mode: "lru",
      entries: 20,
      ttlMs: 10000,
      hitRate: 0,
    };
    if (graph.workloads.length > 0) {
      graph.workloads[0].entryNodeId = traffic.id;
      graph.workloads[0].rate = 700;
      graph.workloads[0].classes[0].keyDistribution = {
        kind: "hot",
        catalogSize: 1000,
        hotSubset: 10,
        hotShare: 80,
      };
    }
  });
}

function makeHorizontalScalingGraph(): Graph {
  return makeTutorialGraph("horizontal-scaling", (graph) => {
    // Legacy balancedLookup(1) has traffic -> balancer -> service -> database.
    // Scale service instances: add duplicate service + explicit wire from balancer and database
    const balancer = graph.nodes.find((n) => n.kind === "balancer")!;
    const svc1 = graph.nodes.find((n) => n.kind === "service")!;
    const db = graph.nodes.find((n) => n.kind === "database")!;

    svc1.behavior.capacity = 200;
    svc1.behavior.concurrency = 1;
    svc1.behavior.queueLimit = 500;

    // Add a second service instance explicitly wired
    const svc2: ModelNode & ExecutionNode = {
      ...makeOpenNode("service", svc1.position.x, svc1.position.y + 120),
      kind: "service",
      name: "Redirect service 2",
      position: { x: svc1.position.x, y: svc1.position.y + 120 },
      behavior: clone(svc1.behavior),
    };
    graph.nodes.push(svc2);

    const edgeFromBalancer: ExecutionEdge = {
      id: crypto.randomUUID(),
      source: balancer.id,
      target: svc2.id,
      transport: "call",
      latencyMs: 0,
      returnLatencyMs: 0,
      ackDelayMs: 8,
      messageTtlMs: 2000,
      weight: 1,
    };
    const edgeToDb: ExecutionEdge = {
      id: crypto.randomUUID(),
      source: svc2.id,
      target: db.id,
      transport: "call",
      latencyMs: 0,
      returnLatencyMs: 8,
      ackDelayMs: 8,
      messageTtlMs: 2000,
      weight: 1,
    };
    graph.edges.push(edgeFromBalancer, edgeToDb);
  });
}

function makeCachePressureGraph(): Graph {
  return makeTutorialGraph("cache-pressure", (graph) => {
    // Preconfigure cache in path with fixed hitRate 0 for baseline; tutorial asks user to raise hitRate to 80%
    const traffic = graph.nodes.find((n) => n.kind === "traffic")!;
    const svc = graph.nodes.find((n) => n.kind === "service")!;
    const db = graph.nodes.find((n) => n.kind === "database")!;

    const cacheNode: ModelNode & ExecutionNode = {
      ...makeOpenNode("cache", db.position.x, svc.position.y),
      kind: "cache",
      name: "Query cache",
      position: { x: (svc.position.x + db.position.x) / 2, y: svc.position.y },
      behavior: {
        capacity: 5000,
        concurrency: 1,
        queueLimit: 500,
        failureRate: 0,
        maxRetries: 0,
        retryDelayMs: 100,
        type: "cache",
        mode: "fixed",
        hitRate: 0,
        entries: 100,
        ttlMs: 10000,
      },
    };
    graph.nodes.push(cacheNode);

    // Rewire svc -> cache -> db
    graph.edges = graph.edges.filter((e) => !(e.source === svc.id && e.target === db.id));
    graph.edges.push(
      {
        id: crypto.randomUUID(),
        source: svc.id,
        target: cacheNode.id,
        transport: "call",
        latencyMs: 0,
        returnLatencyMs: 0,
        ackDelayMs: 8,
        messageTtlMs: 2000,
        weight: 1,
      },
      {
        id: crypto.randomUUID(),
        source: cacheNode.id,
        target: db.id,
        transport: "call",
        latencyMs: 0,
        returnLatencyMs: 8,
        ackDelayMs: 8,
        messageTtlMs: 2000,
        weight: 1,
      },
    );
  });
}

function makeWorkerScalingGraph(): Graph {
  return makeTutorialGraph("worker-scaling", (graph) => {
    const svc = graph.nodes.find((n) => n.kind === "service")!;
    svc.behavior.capacity = 200;
    svc.behavior.concurrency = 1;
    const db = graph.nodes.find((n) => n.kind === "database")!;
    db.behavior.capacity = 1000;
    if (db.behavior.type === "storage") {
      db.behavior.writeCapacity = 1000;
    }
  });
}

function makeBurstJobsGraph(): Graph {
  return makeTutorialGraph("burst-jobs", (graph) => {
    const worker = graph.nodes.find((n) => n.kind === "worker")!;
    worker.behavior.capacity = 100;
    worker.behavior.concurrency = 2;
  });
}

function makeRetryBudgetGraph(): Graph {
  return makeTutorialGraph("retry-budget", (graph) => {
    const worker = graph.nodes.find((n) => n.kind === "worker")!;
    worker.behavior.failureRate = 50;
    worker.behavior.maxRetries = 0;
    worker.behavior.retryDelayMs = 100;
  });
}

export const openExamples: OpenExample[] = [
  {
    id: "realtime-chat",
    title: "Real-time chat",
    purpose: "Trace message submission, persistence, fan-out, and notification delivery.",
    kind: "starter",
    steps: [
      "Select Chat client to inspect the 100 writes/s source workload dispatching via the API gateway router.",
      "Follow the write path: Chat service writes synchronously to Message database and sends asynchronous messages to Message topic.",
      "Inspect the Message topic broker queue dispatching background messages to Notification worker and push notifications.",
    ],
    create: makeRealtimeChatGraph,
  },
  {
    id: "ecommerce-checkout",
    title: "Ecommerce checkout",
    purpose: "Separate catalog reads, payment authorization, and queued fulfillment.",
    kind: "starter",
    steps: [
      "Select Storefront to review the 100 reads/s checkout entry workload flowing through the API gateway.",
      "Select Checkout service in Behavior settings to inspect parallel product cache reads, payment provider authorization, and order queuing.",
      "Inspect Order queue and Fulfillment worker for asynchronous background order processing decoupled from checkout latency.",
    ],
    create: makeEcommerceCheckoutGraph,
  },
  {
    id: "event-processing",
    title: "Event processing",
    purpose: "Follow ingestion through processing, archival, warehousing, and analysis.",
    kind: "starter",
    steps: [
      "Select Event producer to examine the 100 writes/s stream ingestion workload.",
      "Select Event stream broker queue to inspect delivery to the Stream processor worker without ordering or partition guarantees.",
      "Observe Stream processor parallel fan-out to Event archive and Data warehouse for downstream analytics queries.",
    ],
    create: makeEventProcessingGraph,
  },
  {
    id: "cold-cache-popularity",
    title: "Warm a finite cache",
    purpose: "How do hot links and a cold finite cache change database pressure?",
    kind: "tutorial",
    steps: [
      "Run the simulation with the 700 req/s hot-link workload (80% traffic across top 10 keys) and a cold 20-entry LRU cache.",
      "Select Finite LRU cache and open Behavior settings to inspect hits, misses, evictions, and database arrivals.",
      "Increase entries to 100 or raise TTL in Behavior settings, replay, and compare reduced database load.",
    ],
    create: makeColdCachePopularityGraph,
  },
  {
    id: "horizontal-scaling",
    title: "Scale service instances",
    purpose: "When does adding instances move the bottleneck to the shared database?",
    kind: "tutorial",
    steps: [
      "Run the simulation with the load balancer routing traffic across service instances.",
      "Select each Service node and inspect Behavior settings: note that processing component slots held across calls mean total throughput is bounded by downstream service and database capacity.",
      "Select Database in Behavior settings, duplicate a service, connect it from the balancer and to the database, then replay. Compare the shared database pressure before and after increasing its capacity.",
    ],
    create: makeHorizontalScalingGraph,
  },
  {
    id: "cache-pressure",
    title: "Relieve database pressure",
    purpose: "Can a cache reduce database demand without changing incoming traffic?",
    kind: "tutorial",
    steps: [
      "Run the 700 req/s baseline with Query cache configured at 0% hit rate, observing heavy database arrivals and queuing.",
      "Select Query cache, open Behavior settings, and increase Hit rate from 0% to 80%.",
      "Replay the simulation to verify database arrivals drop dramatically while overall throughput and response latency improve.",
    ],
    create: makeCachePressureGraph,
  },
  {
    id: "worker-scaling",
    title: "Scale a worker pool",
    purpose: "How does concurrency change throughput without shortening each request?",
    kind: "tutorial",
    steps: [
      "Run the baseline with Redirect service concurrency set to 1 worker at 200 capacity and inspect queuing under 700 req/s traffic.",
      "Select Redirect service, open Behavior settings, and increase Concurrency from 1 to 4.",
      "Replay the simulation to observe higher throughput and reduced queue waiting time without changing individual operation latency.",
    ],
    create: makeWorkerScalingGraph,
  },
  {
    id: "burst-jobs",
    title: "Absorb a job burst",
    purpose: "Does queue capacity absorb a burst, or merely postpone failure?",
    kind: "tutorial",
    steps: [
      "Run the burst workload (100 → 700 → 100 jobs/s) and monitor peak queue backlog alongside expired jobs.",
      "Observe that root producer acknowledgements confirm message admission, while separate asynchronous Messages track actual completion or deadline expiry.",
      "Select Job worker, open Behavior settings, and increase Concurrency from 2 to 4 to drain the burst before message TTL expiry.",
    ],
    create: makeBurstJobsGraph,
  },
  {
    id: "retry-budget",
    title: "Understand retry cost",
    purpose: "How much extra work buys a higher job completion rate?",
    kind: "tutorial",
    steps: [
      "Run the simulation with Job worker configured at 50% failure rate and 0 retries, observing dropped background jobs.",
      "Select Job worker, open Behavior settings, and increase Max retries from 0 to 2 with a 100ms retry delay.",
      "Replay and observe the trade-off: higher completed job counts require increased attempt volume and longer overall completion latency.",
    ],
    create: makeRetryBudgetGraph,
  },
];

export function openExample(id: string): OpenExample | undefined {
  return openExamples.find((ex) => ex.id === id);
}
