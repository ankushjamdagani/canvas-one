/**
 * Standard Component Catalog (RV-06a).
 *
 * Implements specifications from:
 * - specs/revamp/contracts/catalog.md (All sections, approved resolutions 1–12)
 * - specs/revamp/decisions.md (D35, D42)
 * - specs/revamp/contracts/model-and-runner.md (§1–§5)
 */

import { VALID_KINDS, type ComponentKind } from '../../domain/execution';
import type { BehaviorKind, VisualKind } from '../../domain/studio/model';

// ============================================================================
// Types
// ============================================================================

export type CatalogGroup =
  | 'Clients'
  | 'Edge'
  | 'Compute'
  | 'Messaging'
  | 'Data'
  | 'Operations'
  | 'State Machine'
  | 'Data Pipeline'
  | 'Host'
  | 'Other';

export type CatalogPort = {
  readonly label: string;
  readonly direction: 'in' | 'out';
  readonly channel: 'call' | 'message' | 'data' | 'event';
  readonly schemaRef: 'generic-request' | 'generic-response' | 'none';
  readonly responseSchemaRef: 'generic-response' | null;
};

export type CatalogEntry = {
  readonly entryId: string;
  readonly label: string;
  readonly group: CatalogGroup;
  readonly category: CatalogGroup; // alias for group per catalog.md §1
  readonly visualKind: VisualKind;
  readonly behaviorKind: BehaviorKind | 'none';
  readonly ports: readonly CatalogPort[];
  readonly defaultConfig: Record<string, unknown> | null;
  readonly models: string;
  readonly doesNotModel: string;
  readonly tags: readonly string[];
  readonly caption: {
    readonly line1: string;
    readonly line2template: string;
  };
};

// ============================================================================
// D35 + D42 Stripe Colors
// ============================================================================

export const GROUP_STRIPE_COLORS: Record<CatalogGroup, string | null> = {
  Clients: '#4F6D8F',
  Edge: '#2B7A83',
  Compute: '#56773A',
  Messaging: '#8A6A1F',
  Data: '#8A4F6E',
  Operations: '#5F646B',
  'State Machine': '#5A5B8C',
  'Data Pipeline': '#7A5C3E',
  Host: '#3A3F3C',
  Other: null,
};

export const STRIPE_COLORS = {
  ...GROUP_STRIPE_COLORS,
  clients: '#4F6D8F',
  edge: '#2B7A83',
  compute: '#56773A',
  messaging: '#8A6A1F',
  data: '#8A4F6E',
  operations: '#5F646B',
  'state-machine': '#5A5B8C',
  'data-pipeline': '#7A5C3E',
  host: '#3A3F3C',
  other: null,
} as const;

export function groupOf(entry: CatalogEntry): CatalogGroup {
  return entry.group;
}

// ============================================================================
// Shared Default Configurations
// ============================================================================

const BASE_RESOURCE_DEFAULTS = {
  capacity: 2000, // assumption (catalog.md)
  concurrency: 1, // assumption (catalog.md)
  queueLimit: 500, // assumption (catalog.md)
  failureRate: 0, // assumption (catalog.md)
  maxRetries: 0, // assumption (catalog.md)
  retryDelayMs: 100, // assumption (catalog.md)
} as const;

const PROCESSOR_CONFIG = {
  ...BASE_RESOURCE_DEFAULTS,
  type: 'processor' as const,
};

const CACHE_CONFIG = {
  capacity: 5000, // assumption (catalog.md)
  concurrency: 1, // assumption (catalog.md)
  queueLimit: 500, // assumption (catalog.md)
  failureRate: 0, // assumption (catalog.md)
  maxRetries: 0, // assumption (catalog.md)
  retryDelayMs: 100, // assumption (catalog.md)
  type: 'cache' as const,
  mode: 'fixed' as const,
  hitRate: 80, // assumption (catalog.md)
  entries: 100, // assumption (catalog.md)
  ttlMs: 10000, // assumption (catalog.md)
};

const ROUTER_CONFIG = {
  ...BASE_RESOURCE_DEFAULTS,
  type: 'router' as const,
  strategy: 'round-robin' as const,
};

const STORAGE_DATABASE_CONFIG = {
  capacity: 500, // assumption (catalog.md)
  concurrency: 1, // assumption (catalog.md)
  queueLimit: 500, // assumption (catalog.md)
  failureRate: 0, // assumption (catalog.md)
  maxRetries: 0, // assumption (catalog.md)
  retryDelayMs: 100, // assumption (catalog.md)
  type: 'storage' as const,
  writeCapacity: 500, // assumption (catalog.md)
};

const STORAGE_DEFAULT_CONFIG = {
  capacity: 2000, // assumption (catalog.md)
  concurrency: 1, // assumption (catalog.md)
  queueLimit: 500, // assumption (catalog.md)
  failureRate: 0, // assumption (catalog.md)
  maxRetries: 0, // assumption (catalog.md)
  retryDelayMs: 100, // assumption (catalog.md)
  type: 'storage' as const,
  writeCapacity: 2000, // assumption (catalog.md)
};

const BROKER_COMPETING_CONFIG = {
  ...BASE_RESOURCE_DEFAULTS,
  type: 'broker' as const,
  delivery: 'competing' as const,
};

const BROKER_BROADCAST_CONFIG = {
  ...BASE_RESOURCE_DEFAULTS,
  type: 'broker' as const,
  delivery: 'broadcast' as const,
};

const WORKER_CONFIG = {
  capacity: 100, // assumption (catalog.md)
  concurrency: 2, // assumption (catalog.md)
  queueLimit: 0, // assumption (catalog.md)
  failureRate: 0, // assumption (catalog.md)
  maxRetries: 2, // assumption (catalog.md)
  retryDelayMs: 100, // assumption (catalog.md)
  type: 'processor' as const,
};

// ============================================================================
// Shared Ports
// ============================================================================

const CALL_IN_OUT_PORTS: readonly CatalogPort[] = [
  {
    label: 'in',
    direction: 'in',
    channel: 'call',
    schemaRef: 'generic-request',
    responseSchemaRef: 'generic-response',
  },
  {
    label: 'out',
    direction: 'out',
    channel: 'call',
    schemaRef: 'generic-request',
    responseSchemaRef: 'generic-response',
  },
];

const CALL_IN_PORT: readonly CatalogPort[] = [
  {
    label: 'in',
    direction: 'in',
    channel: 'call',
    schemaRef: 'generic-request',
    responseSchemaRef: 'generic-response',
  },
];

const CALL_OUT_PORT: readonly CatalogPort[] = [
  {
    label: 'out',
    direction: 'out',
    channel: 'call',
    schemaRef: 'generic-request',
    responseSchemaRef: 'generic-response',
  },
];

const MESSAGE_BROKER_PORTS: readonly CatalogPort[] = [
  {
    label: 'in',
    direction: 'in',
    channel: 'message',
    schemaRef: 'generic-request',
    responseSchemaRef: null,
  },
  {
    label: 'out',
    direction: 'out',
    channel: 'message',
    schemaRef: 'generic-request',
    responseSchemaRef: null,
  },
];

const MESSAGE_IN_PORT: readonly CatalogPort[] = [
  {
    label: 'in',
    direction: 'in',
    channel: 'message',
    schemaRef: 'generic-request',
    responseSchemaRef: null,
  },
];

const DATA_IN_PORT: readonly CatalogPort[] = [
  {
    label: 'in',
    direction: 'in',
    channel: 'data',
    schemaRef: 'generic-request',
    responseSchemaRef: null,
  },
];

// ============================================================================
// Catalog Entries List
// ============================================================================

export const CATALOG_ENTRIES: readonly CatalogEntry[] = Object.freeze([
  // --------------------------------------------------------------------------
  // Clients (D42 resolution 12: diagram labels only — unmodeled, "Not simulated")
  // --------------------------------------------------------------------------
  {
    entryId: 'traffic',
    label: 'Traffic Source',
    group: 'Clients',
    category: 'Clients',
    visualKind: 'traffic',
    behaviorKind: 'unmodeled',
    ports: CALL_OUT_PORT,
    defaultConfig: null,
    models: 'An external arrival source issuing calls at a configured rate via a scenario workload',
    doesNotModel: 'Real client devices, geography, think time',
    tags: ['not simulated'],
    caption: { line1: 'Traffic Source', line2template: 'Not simulated' },
  },
  {
    entryId: 'client',
    label: 'Client',
    group: 'Clients',
    category: 'Clients',
    visualKind: 'client',
    behaviorKind: 'unmodeled',
    ports: CALL_OUT_PORT,
    defaultConfig: null,
    models: 'A generic upstream caller placeholder',
    doesNotModel: 'Any UI, rendering, user behavior',
    tags: ['not simulated'],
    caption: { line1: 'Client', line2template: 'Not simulated' },
  },
  {
    entryId: 'mobile',
    label: 'Mobile Client',
    group: 'Clients',
    category: 'Clients',
    visualKind: 'mobile',
    behaviorKind: 'unmodeled',
    ports: CALL_OUT_PORT,
    defaultConfig: null,
    models: 'Same as client, labelled for a mobile origin',
    doesNotModel: 'Device constraints, offline behavior, native APIs',
    tags: ['not simulated'],
    caption: { line1: 'Mobile Client', line2template: 'Not simulated' },
  },
  {
    entryId: 'device',
    label: 'IoT Device',
    group: 'Clients',
    category: 'Clients',
    visualKind: 'device',
    behaviorKind: 'unmodeled',
    ports: CALL_OUT_PORT,
    defaultConfig: null,
    models: 'Same as client, labelled for an IoT/device origin',
    doesNotModel: 'Hardware, firmware, connectivity loss',
    tags: ['not simulated'],
    caption: { line1: 'IoT Device', line2template: 'Not simulated' },
  },

  // --------------------------------------------------------------------------
  // Edge
  // --------------------------------------------------------------------------
  {
    entryId: 'dns',
    label: 'DNS',
    group: 'Edge',
    category: 'Edge',
    visualKind: 'dns',
    behaviorKind: 'resource',
    ports: CALL_IN_OUT_PORTS,
    defaultConfig: CACHE_CONFIG,
    models: 'A name-resolution hop modeled as a cache (hit/miss, ttl) in front of one origin',
    doesNotModel: 'Real DNS propagation, anycast, record types',
    tags: ['cache', 'fixed'],
    caption: { line1: 'DNS', line2template: 'cache · 80% hit' },
  },
  {
    entryId: 'cdn',
    label: 'CDN',
    group: 'Edge',
    category: 'Edge',
    visualKind: 'cdn',
    behaviorKind: 'resource',
    ports: CALL_IN_OUT_PORTS,
    defaultConfig: CACHE_CONFIG,
    models: 'An edge cache in front of one origin',
    doesNotModel: 'Geographic PoPs, real cache invalidation protocols',
    tags: ['cache', 'fixed'],
    caption: { line1: 'CDN', line2template: 'cache · 80% hit' },
  },
  {
    entryId: 'firewall',
    label: 'Firewall',
    group: 'Edge',
    category: 'Edge',
    visualKind: 'firewall',
    behaviorKind: 'resource',
    ports: CALL_IN_OUT_PORTS,
    defaultConfig: ROUTER_CONFIG,
    models: 'A pass-through hop that can be given routing/failure config',
    doesNotModel: 'Real rule evaluation, packet inspection',
    tags: ['router', 'round-robin'],
    caption: { line1: 'Firewall', line2template: 'router · round-robin' },
  },
  {
    entryId: 'gateway',
    label: 'API Gateway',
    group: 'Edge',
    category: 'Edge',
    visualKind: 'gateway',
    behaviorKind: 'resource',
    ports: CALL_IN_OUT_PORTS,
    defaultConfig: ROUTER_CONFIG,
    models: 'An API gateway routing to one or more backends',
    doesNotModel: 'Auth, rate limiting, protocol translation',
    tags: ['router', 'round-robin'],
    caption: { line1: 'API Gateway', line2template: 'router · round-robin' },
  },
  {
    entryId: 'balancer',
    label: 'Load Balancer',
    group: 'Edge',
    category: 'Edge',
    visualKind: 'balancer',
    behaviorKind: 'resource',
    ports: CALL_IN_OUT_PORTS,
    defaultConfig: ROUTER_CONFIG,
    models: 'A load balancer distributing across backends (round-robin/weighted/conditional)',
    doesNotModel: 'Health-check protocols, L4 vs L7 specifics',
    tags: ['router', 'round-robin'],
    caption: { line1: 'Load Balancer', line2template: 'router · round-robin' },
  },
  {
    // D42 resolution 2: thirdparty -> Edge (teal stripe)
    entryId: 'thirdparty',
    label: 'Third-Party Service',
    group: 'Edge',
    category: 'Edge',
    visualKind: 'thirdparty',
    behaviorKind: 'unmodeled',
    ports: CALL_IN_PORT,
    defaultConfig: null,
    models: 'A named external dependency boundary — pairs with a Boundary fixture to script canned responses',
    doesNotModel: 'Any real external behavior; nothing runs without an authored boundary',
    tags: ['external', 'boundary'],
    caption: { line1: 'Third-Party Service', line2template: 'Not simulated' },
  },

  // --------------------------------------------------------------------------
  // Compute
  // --------------------------------------------------------------------------
  {
    entryId: 'service',
    label: 'Service',
    group: 'Compute',
    category: 'Compute',
    visualKind: 'service',
    behaviorKind: 'resource',
    ports: CALL_IN_OUT_PORTS,
    defaultConfig: PROCESSOR_CONFIG,
    models: 'A synchronous request handler with capacity/concurrency/failure/retry',
    doesNotModel: 'Business logic, language runtime, real code paths',
    tags: ['processor', 'retries'],
    caption: { line1: 'Service', line2template: 'processor · 2 000 /s cap' },
  },
  {
    entryId: 'function',
    label: 'Function',
    group: 'Compute',
    category: 'Compute',
    visualKind: 'function',
    behaviorKind: 'resource',
    ports: CALL_IN_OUT_PORTS,
    defaultConfig: PROCESSOR_CONFIG,
    models: 'An invoked unit of compute, same accounting as service',
    doesNotModel: 'Cold starts, packaging, real FaaS billing',
    tags: ['processor', 'retries'],
    caption: { line1: 'Function', line2template: 'processor · 2 000 /s cap' },
  },
  {
    entryId: 'container',
    label: 'Container',
    group: 'Compute',
    category: 'Compute',
    visualKind: 'container',
    behaviorKind: 'resource',
    ports: CALL_IN_OUT_PORTS,
    defaultConfig: PROCESSOR_CONFIG,
    models: 'Same as service, labelled for a containerized unit',
    doesNotModel: 'Orchestration, scheduling, resource limits',
    tags: ['processor', 'retries'],
    caption: { line1: 'Container', line2template: 'processor · 2 000 /s cap' },
  },
  {
    entryId: 'worker',
    label: 'Worker',
    group: 'Compute',
    category: 'Compute',
    visualKind: 'worker',
    behaviorKind: 'resource',
    ports: CALL_IN_PORT, // terminal, no out port by default (§2/§4)
    defaultConfig: WORKER_CONFIG,
    models: 'A background/queue-consuming processor that returns its response via bridge settlement rather than an outbound edge',
    doesNotModel: 'Job frameworks, real concurrency primitives',
    tags: ['processor', 'retries'],
    caption: { line1: 'Worker', line2template: 'processor · 100 /s cap' },
  },
  {
    // D42 resolution 12: scheduler diagram label only — unmodeled, "Not simulated"
    entryId: 'scheduler',
    label: 'Scheduler',
    group: 'Compute',
    category: 'Compute',
    visualKind: 'scheduler',
    behaviorKind: 'unmodeled',
    ports: CALL_OUT_PORT,
    defaultConfig: null,
    models: 'A timed/periodic arrival source, same accounting as traffic',
    doesNotModel: 'Cron semantics, timezones, drift',
    tags: ['not simulated'],
    caption: { line1: 'Scheduler', line2template: 'Not simulated' },
  },

  // --------------------------------------------------------------------------
  // Data
  // --------------------------------------------------------------------------
  {
    entryId: 'database',
    label: 'Relational Database',
    group: 'Data',
    category: 'Data',
    visualKind: 'database',
    behaviorKind: 'resource',
    ports: CALL_IN_PORT,
    defaultConfig: STORAGE_DATABASE_CONFIG,
    models: 'A relational-style store with read capacity and write capacity',
    doesNotModel: 'Schemas, transactions, query planning, indexes',
    tags: ['storage', 'read-write'],
    caption: { line1: 'Relational Database', line2template: 'storage · 500 /s cap' },
  },
  {
    entryId: 'nosql',
    label: 'NoSQL Database',
    group: 'Data',
    category: 'Data',
    visualKind: 'nosql',
    behaviorKind: 'resource',
    ports: CALL_IN_PORT,
    defaultConfig: STORAGE_DEFAULT_CONFIG,
    models: 'Same accounting as database, different label',
    doesNotModel: 'Consistency models, partitioning, real query APIs',
    tags: ['storage', 'read-write'],
    caption: { line1: 'NoSQL Database', line2template: 'storage · 2 000 /s cap' },
  },
  {
    entryId: 'cache',
    label: 'Cache Store',
    group: 'Data',
    category: 'Data',
    visualKind: 'cache',
    behaviorKind: 'resource',
    ports: CALL_IN_OUT_PORTS,
    defaultConfig: CACHE_CONFIG,
    models: 'An in-memory or intermediate cache modeled with hit/miss and ttl',
    doesNotModel: 'Eviction protocols beyond mode, replication, distributed caching',
    tags: ['cache', 'fixed'],
    caption: { line1: 'Cache Store', line2template: 'cache · 80% hit' },
  },
  {
    entryId: 'objectstore',
    label: 'Object Store',
    group: 'Data',
    category: 'Data',
    visualKind: 'objectstore',
    behaviorKind: 'resource',
    ports: CALL_IN_PORT,
    defaultConfig: STORAGE_DEFAULT_CONFIG,
    models: 'Same storage accounting',
    doesNotModel: 'Real object APIs, multipart upload, storage classes',
    tags: ['storage', 'read-write'],
    caption: { line1: 'Object Store', line2template: 'storage · 2 000 /s cap' },
  },
  {
    entryId: 'search',
    label: 'Search Engine',
    group: 'Data',
    category: 'Data',
    visualKind: 'search',
    behaviorKind: 'resource',
    ports: CALL_IN_PORT,
    defaultConfig: STORAGE_DEFAULT_CONFIG,
    models: 'Same storage accounting',
    doesNotModel: 'Indexing, relevance ranking, query DSL',
    tags: ['storage', 'read-write'],
    caption: { line1: 'Search Engine', line2template: 'storage · 2 000 /s cap' },
  },
  {
    entryId: 'warehouse',
    label: 'Data Warehouse',
    group: 'Data',
    category: 'Data',
    visualKind: 'warehouse',
    behaviorKind: 'resource',
    ports: CALL_IN_PORT,
    defaultConfig: STORAGE_DEFAULT_CONFIG,
    models: 'Same storage accounting',
    doesNotModel: 'Query engines, partitioned storage, ETL',
    tags: ['storage', 'read-write'],
    caption: { line1: 'Data Warehouse', line2template: 'storage · 2 000 /s cap' },
  },

  // --------------------------------------------------------------------------
  // Messaging
  // --------------------------------------------------------------------------
  {
    entryId: 'queue',
    label: 'Message Queue',
    group: 'Messaging',
    category: 'Messaging',
    visualKind: 'queue',
    behaviorKind: 'resource',
    ports: MESSAGE_BROKER_PORTS,
    defaultConfig: BROKER_COMPETING_CONFIG,
    models: 'A point-to-point broker: each message goes to one consumer route',
    doesNotModel: 'Real broker protocols (SQS/RabbitMQ specifics), exactly-once semantics',
    tags: ['broker', 'competing'],
    caption: { line1: 'Message Queue', line2template: 'broker · competing' },
  },
  {
    entryId: 'stream',
    label: 'Event Stream',
    group: 'Messaging',
    category: 'Messaging',
    visualKind: 'stream',
    behaviorKind: 'resource',
    ports: MESSAGE_BROKER_PORTS,
    defaultConfig: BROKER_COMPETING_CONFIG,
    models: 'Same broker accounting, labelled for a stream/log',
    doesNotModel: 'Partitioning, offsets, replay, ordering guarantees beyond FIFO',
    tags: ['broker', 'competing'],
    caption: { line1: 'Event Stream', line2template: 'broker · competing' },
  },
  {
    entryId: 'pubsub',
    label: 'Pub/Sub Topic',
    group: 'Messaging',
    category: 'Messaging',
    visualKind: 'pubsub',
    behaviorKind: 'resource',
    ports: MESSAGE_BROKER_PORTS,
    defaultConfig: BROKER_BROADCAST_CONFIG,
    models: 'A fan-out broker: every consumer route gets its own message root (D36)',
    doesNotModel: 'Real pub/sub protocol guarantees, subscription filters',
    tags: ['broker', 'broadcast'],
    caption: { line1: 'Pub/Sub Topic', line2template: 'broker · broadcast' },
  },
  {
    // D42 resolution 7: email unmodeled "Not simulated"
    entryId: 'email',
    label: 'Email Delivery',
    group: 'Messaging',
    category: 'Messaging',
    visualKind: 'email',
    behaviorKind: 'unmodeled',
    ports: MESSAGE_IN_PORT,
    defaultConfig: null,
    models: 'A named external notification sink',
    doesNotModel: 'Any delivery, deliverability, templating',
    tags: ['not simulated'],
    caption: { line1: 'Email Delivery', line2template: 'Not simulated' },
  },

  // --------------------------------------------------------------------------
  // Operations
  // --------------------------------------------------------------------------
  {
    // D42 resolution 7: monitoring unmodeled "Not simulated"
    entryId: 'monitoring',
    label: 'Monitoring Sink',
    group: 'Operations',
    category: 'Operations',
    visualKind: 'monitoring',
    behaviorKind: 'unmodeled',
    ports: DATA_IN_PORT,
    defaultConfig: null,
    models: 'A labelled observability sink for diagramming',
    doesNotModel: 'Metrics collection, alerting, dashboards (D16: no engine change for a visual)',
    tags: ['not simulated'],
    caption: { line1: 'Monitoring Sink', line2template: 'Not simulated' },
  },
  {
    // D42 resolution 7: analytics unmodeled "Not simulated"
    entryId: 'analytics',
    label: 'Analytics Ingestion',
    group: 'Operations',
    category: 'Operations',
    visualKind: 'analytics',
    behaviorKind: 'unmodeled',
    ports: DATA_IN_PORT,
    defaultConfig: null,
    models: 'A labelled analytics sink for diagramming',
    doesNotModel: 'Any aggregation, reporting',
    tags: ['not simulated'],
    caption: { line1: 'Analytics Ingestion', line2template: 'Not simulated' },
  },
  {
    // D42 resolution 7: secrets unmodeled "Not simulated"
    entryId: 'secrets',
    label: 'Secrets Manager',
    group: 'Operations',
    category: 'Operations',
    visualKind: 'secrets',
    behaviorKind: 'unmodeled',
    ports: CALL_IN_PORT,
    defaultConfig: null,
    models: 'A labelled secrets-manager placeholder',
    doesNotModel: 'Any security behavior, rotation, access control',
    tags: ['not simulated'],
    caption: { line1: 'Secrets Manager', line2template: 'Not simulated' },
  },

  // --------------------------------------------------------------------------
  // Dedicated D42 Groups: State Machine, Data Pipeline, Host
  // --------------------------------------------------------------------------
  {
    // D42 resolution 1: own indigo stripe group
    entryId: 'state-machine',
    label: 'State Machine',
    group: 'State Machine',
    category: 'State Machine',
    visualKind: 'state-machine',
    behaviorKind: 'machine',
    ports: [
      {
        label: 'event',
        direction: 'in',
        channel: 'event',
        schemaRef: 'generic-request',
        responseSchemaRef: null,
      },
    ],
    defaultConfig: null,
    models: 'Explicit state + event + guard + effect logic (S01 pattern)',
    doesNotModel: 'Nothing hidden — behavior is 100% authored, no default states shipped',
    tags: ['state machine'],
    caption: { line1: 'State Machine', line2template: 'state machine · 0 states' },
  },
  {
    // D42 resolution 1: own umber stripe group
    entryId: 'data-pipeline',
    label: 'Data Pipeline',
    group: 'Data Pipeline',
    category: 'Data Pipeline',
    visualKind: 'data-pipeline',
    behaviorKind: 'pipeline',
    ports: [
      {
        label: 'in',
        direction: 'in',
        channel: 'data',
        schemaRef: 'generic-request',
        responseSchemaRef: null,
      },
      {
        label: 'out',
        direction: 'out',
        channel: 'data',
        schemaRef: 'generic-request',
        responseSchemaRef: null,
      },
      {
        label: 'error',
        direction: 'out',
        channel: 'data',
        schemaRef: 'generic-request',
        responseSchemaRef: null,
      },
    ],
    defaultConfig: null,
    models: 'An ordered validate/transform/aggregate row pipeline (S03 pattern)',
    doesNotModel: 'Joins, loops, arbitrary code, streaming windows',
    tags: ['data pipeline'],
    caption: { line1: 'Data Pipeline', line2template: 'data pipeline · 0 steps' },
  },
  {
    // D42 resolution 1: own charcoal stripe group
    entryId: 'host',
    label: 'Host Infrastructure',
    group: 'Host',
    category: 'Host',
    visualKind: 'host',
    behaviorKind: 'host',
    ports: [],
    defaultConfig: null,
    models: 'A deployment target that deployed-on relations attach resources to, and that scenario faults can take down',
    doesNotModel: 'Real infrastructure provisioning, networking, capacity of the host itself',
    tags: ['host'],
    caption: { line1: 'Host Infrastructure', line2template: 'host' },
  },

  // --------------------------------------------------------------------------
  // Other (D42 resolution 2: custom -> no stripe, library group "Other")
  // --------------------------------------------------------------------------
  {
    entryId: 'custom',
    label: 'Custom Node',
    group: 'Other',
    category: 'Other',
    visualKind: 'custom',
    behaviorKind: 'unmodeled',
    ports: [],
    defaultConfig: null,
    models: 'A free-form placeholder the author must fully configure or leave diagram-only',
    doesNotModel: 'Everything, until the author adds ports/behavior via the inspector',
    tags: ['custom'],
    caption: { line1: 'Custom Node', line2template: 'Not simulated' },
  },
]);

// Fast lookup maps
const ENTRY_BY_ID = new Map<string, CatalogEntry>(
  CATALOG_ENTRIES.map((e) => [e.entryId, e]),
);

const ENTRY_BY_KIND = new Map<VisualKind, CatalogEntry>(
  CATALOG_ENTRIES.map((e) => [e.visualKind, e]),
);

export function getEntry(entryId: string): CatalogEntry | undefined {
  return ENTRY_BY_ID.get(entryId) ?? ENTRY_BY_KIND.get(entryId as VisualKind);
}
