export type ComponentKind =
  "traffic" | "client" | "mobile" | "device" | "dns" | "cdn" | "firewall" | "gateway" |
  "balancer" | "service" | "function" | "container" | "worker" | "scheduler" | "database" |
  "nosql" | "cache" | "objectstore" | "search" | "warehouse" | "queue" | "stream" |
  "pubsub" | "email" | "monitoring" | "analytics" | "secrets" | "thirdparty" | "custom";

export const VALID_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>([
  'traffic', 'client', 'mobile', 'device', 'dns', 'cdn', 'firewall', 'gateway',
  'balancer', 'service', 'function', 'container', 'worker', 'scheduler',
  'database', 'nosql', 'cache', 'objectstore', 'search', 'warehouse', 'queue',
  'stream', 'pubsub', 'email', 'monitoring', 'analytics', 'secrets', 'thirdparty', 'custom',
]);
