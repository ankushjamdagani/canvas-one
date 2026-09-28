/**
 * Shared display copy for resource configuration.
 *
 * The inspector and Library use the same field and option labels so catalog
 * summaries never expose implementation keys such as `queueLimit` or `maxRetries`.
 */

export const RESOURCE_CONFIG_COPY = {
  capacity: { label: 'Capacity per slot', unit: '/s' },
  concurrency: { label: 'Concurrency' },
  queueLimit: { label: 'Queue limit' },
  failureRate: { label: 'Failure rate', unit: '%' },
  maxRetries: { label: 'Max retries' },
  retryDelayMs: { label: 'Retry delay', unit: 'ms' },
  writeCapacity: { label: 'Write capacity', unit: '/s' },
  strategy: {
    label: 'Strategy',
    options: {
      'round-robin': 'Round robin',
      weighted: 'Weighted',
      conditional: 'Conditional',
    },
  },
  mode: {
    label: 'Mode',
    options: {
      fixed: 'Fixed',
      lru: 'LRU',
    },
  },
  hitRate: { label: 'Hit rate', unit: '%' },
  entries: { label: 'Entries' },
  ttlMs: { label: 'TTL', unit: 'ms' },
  delivery: {
    label: 'Delivery',
    options: {
      competing: 'Competing',
      broadcast: 'Broadcast',
    },
  },
} as const;
