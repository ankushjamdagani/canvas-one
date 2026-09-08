import { makeNode, type ComponentKind, type Graph, type ModelEdge, type ModelNode } from "./model";

export type ArchitectureTemplateId = "realtime-chat" | "ecommerce-checkout" | "event-processing";

export interface ArchitectureTemplate {
  id: ArchitectureTemplateId;
  title: string;
  purpose: string;
  create: () => Graph;
}

type NodeSpec = [key: string, kind: ComponentKind, name: string, x: number, y: number, description: string];
type EdgeSpec = [source: string, target: string, label: string, protocol: string, communication: NonNullable<ModelEdge["communication"]>];

function diagram(nodes: NodeSpec[], edges: EdgeSpec[]): Graph {
  const byKey = new Map<string, ModelNode>();
  const modelNodes = nodes.map(([key, kind, name, x, y, description]) => {
    const node = makeNode(kind, x, y);
    node.name = name;
    node.description = description;
    byKey.set(key, node);
    return node;
  });
  return {
    scenario: "diagram",
    nodes: modelNodes,
    edges: edges.map(([source, target, label, protocol, communication]) => ({
      id: crypto.randomUUID(),
      source: byKey.get(source)!.id,
      target: byKey.get(target)!.id,
      label,
      protocol,
      communication,
    })),
    settings: { traffic: 100, seed: 42, duration: 30, timeoutMs: 2000 },
  };
}

export const architectureTemplates: ArchitectureTemplate[] = [
  {
    id: "realtime-chat",
    title: "Real-time chat",
    purpose: "Trace message submission, persistence, fan-out, and notification delivery.",
    create: () => diagram(
      [
        ["client", "client", "Chat client", 40, 200, "Sends messages and receives real-time updates."],
        ["gateway", "gateway", "API gateway", 330, 200, "Authenticates clients and routes chat traffic."],
        ["service", "service", "Chat service", 620, 200, "Coordinates message writes and real-time delivery."],
        ["database", "nosql", "Message database", 910, 60, "Stores conversations and message history."],
        ["topic", "pubsub", "Message topic", 910, 320, "Fans committed messages out to asynchronous consumers."],
        ["worker", "worker", "Notification worker", 1200, 320, "Builds notification requests outside the message write path."],
        ["notification", "email", "Notification service", 1490, 320, "Delivers push notifications to offline recipients."],
      ],
      [
        ["client", "gateway", "Submit", "WebSocket", "sync"],
        ["gateway", "service", "Route", "WebSocket", "sync"],
        ["service", "database", "Persist", "Database", "data"],
        ["service", "topic", "Publish", "Pub/sub", "async"],
        ["topic", "worker", "Dispatch", "Pub/sub", "async"],
        ["worker", "notification", "Notify", "HTTPS", "async"],
      ],
    ),
  },
  {
    id: "ecommerce-checkout",
    title: "Ecommerce checkout",
    purpose: "Separate catalog reads, payment authorization, and queued fulfillment.",
    create: () => diagram(
      [
        ["client", "client", "Storefront", 40, 220, "Collects the cart and starts checkout."],
        ["gateway", "gateway", "API gateway", 330, 220, "Authenticates and routes checkout requests."],
        ["checkout", "service", "Checkout service", 620, 220, "Coordinates this illustrative checkout flow; real transaction and consistency machinery is omitted."],
        ["cache", "cache", "Product cache", 910, 40, "Serves frequently requested product details."],
        ["database", "database", "Product database", 1200, 40, "Stores product and inventory records; consistency behavior is not modeled."],
        ["payment", "thirdparty", "Payment provider", 910, 220, "Authorizes payment through an external dependency."],
        ["queue", "queue", "Order queue", 910, 400, "Decouples accepted orders from fulfillment work."],
        ["worker", "worker", "Fulfillment worker", 1200, 400, "Starts downstream fulfillment for queued orders."],
      ],
      [
        ["client", "gateway", "Checkout", "HTTPS", "sync"],
        ["gateway", "checkout", "Route", "HTTPS", "sync"],
        ["checkout", "cache", "Product read", "Cache", "data"],
        ["cache", "database", "Miss", "SQL", "data"],
        ["checkout", "payment", "Authorize", "HTTPS", "sync"],
        ["checkout", "queue", "Enqueue", "AMQP", "async"],
        ["queue", "worker", "Fulfill", "AMQP", "async"],
      ],
    ),
  },
  {
    id: "event-processing",
    title: "Event processing",
    purpose: "Follow ingestion through processing, archival, warehousing, and analysis.",
    create: () => diagram(
      [
        ["producer", "device", "Event producer", 40, 220, "Produces an illustrative stream of device events."],
        ["stream", "stream", "Event stream", 330, 220, "Retains ordered events for downstream processing."],
        ["worker", "worker", "Stream processor", 620, 220, "Transforms events; partitioning and delivery guarantees are intentionally unspecified."],
        ["archive", "objectstore", "Event archive", 910, 70, "Stores immutable raw or processed event files."],
        ["warehouse", "warehouse", "Data warehouse", 910, 360, "Organizes processed events for analytical queries."],
        ["analytics", "analytics", "Analytics", 1200, 360, "Queries curated event data for dashboards and investigation."],
      ],
      [
        ["producer", "stream", "Ingest", "Stream", "async"],
        ["stream", "worker", "Process", "Consumer", "async"],
        ["worker", "archive", "Archive", "Object", "data"],
        ["worker", "warehouse", "Load facts", "Batch", "data"],
        ["warehouse", "analytics", "Query", "SQL", "data"],
      ],
    ),
  },
];

export const architectureTemplate = (id: string) =>
  architectureTemplates.find((template) => template.id === id);
