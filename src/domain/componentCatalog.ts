import type { ComponentKind } from "./model";

export type ComponentCategory = "Clients" | "Edge" | "Compute" | "Data" | "Messaging" | "Operations";

export interface ComponentDefinition {
  kind: ComponentKind;
  label: string;
  category: ComponentCategory;
  description: string;
}

export const componentCatalog: ComponentDefinition[] = [
  { kind: "traffic", label: "Traffic source", category: "Clients", description: "Users or systems initiating requests." },
  { kind: "client", label: "Web client", category: "Clients", description: "A browser-based application or consumer." },
  { kind: "mobile", label: "Mobile app", category: "Clients", description: "A native mobile application." },
  { kind: "device", label: "IoT device", category: "Clients", description: "A connected device producing or consuming data." },
  { kind: "dns", label: "DNS", category: "Edge", description: "Resolves names and directs clients to an endpoint." },
  { kind: "cdn", label: "CDN", category: "Edge", description: "Caches and serves content near users." },
  { kind: "firewall", label: "Firewall / WAF", category: "Edge", description: "Filters unwanted or unsafe traffic." },
  { kind: "gateway", label: "API gateway", category: "Edge", description: "Provides a controlled entry point for APIs." },
  { kind: "balancer", label: "Load balancer", category: "Edge", description: "Distributes traffic across service instances." },
  { kind: "service", label: "Service", category: "Compute", description: "Runs application or domain logic." },
  { kind: "function", label: "Serverless function", category: "Compute", description: "Runs event-driven code on demand." },
  { kind: "container", label: "Container cluster", category: "Compute", description: "Schedules and operates containerized workloads." },
  { kind: "worker", label: "Worker", category: "Compute", description: "Processes asynchronous work." },
  { kind: "scheduler", label: "Scheduler", category: "Compute", description: "Starts work on a schedule or policy." },
  { kind: "database", label: "SQL database", category: "Data", description: "Stores relational, transactional data." },
  { kind: "nosql", label: "NoSQL database", category: "Data", description: "Stores flexible or partitioned records." },
  { kind: "cache", label: "Cache", category: "Data", description: "Keeps frequently used data close to compute." },
  { kind: "objectstore", label: "Object storage", category: "Data", description: "Stores blobs, media, backups, and archives." },
  { kind: "search", label: "Search index", category: "Data", description: "Indexes data for fast retrieval and discovery." },
  { kind: "warehouse", label: "Data warehouse", category: "Data", description: "Supports analytical queries over historical data." },
  { kind: "queue", label: "Message queue", category: "Messaging", description: "Buffers work between producers and consumers." },
  { kind: "stream", label: "Event stream", category: "Messaging", description: "Carries ordered event records to consumers." },
  { kind: "pubsub", label: "Pub/sub topic", category: "Messaging", description: "Fans messages out to multiple subscribers." },
  { kind: "email", label: "Notification service", category: "Messaging", description: "Delivers email, SMS, or push notifications." },
  { kind: "monitoring", label: "Monitoring", category: "Operations", description: "Collects metrics, logs, traces, and alerts." },
  { kind: "analytics", label: "Analytics", category: "Operations", description: "Processes product or business events for insight." },
  { kind: "secrets", label: "Secrets manager", category: "Operations", description: "Protects credentials and encryption material." },
  { kind: "thirdparty", label: "External system", category: "Operations", description: "Represents a dependency outside your boundary." },
];

export const componentDefinition = (kind: ComponentKind) =>
  componentCatalog.find((item) => item.kind === kind)!;

export const componentCategories = [...new Set(componentCatalog.map((item) => item.category))];
