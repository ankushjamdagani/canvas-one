/**
 * Catalog Captions and Defaults Formatter (RV-06a).
 *
 * Implements specifications from:
 * - specs/revamp/contracts/catalog.md (§5 Library display mapping, Resolution 6, Resolution 10)
 */

import type { CatalogEntry } from './catalog';

/**
 * Builds the library list/grid row caption from hand-written entry tags
 * joined by " · " (catalog.md §5 & Resolution 6).
 */
export function libraryCaption(entry: CatalogEntry): string {
  return entry.tags.join(' · ');
}

/**
 * Builds the 12C hover/focus detail and bottom bar DEFAULTS line
 * (catalog.md §5: "DEFAULTS · {flattened key value list from defaultConfig}").
 */
export function defaultsLine(entry: CatalogEntry): string {
  if (!entry.defaultConfig) {
    return 'DEFAULTS · none';
  }

  const cfg = entry.defaultConfig;
  const parts: string[] = [];

  switch (cfg.type) {
    case 'storage':
      parts.push(`capacity ${cfg.capacity}/s`);
      parts.push(`writeCapacity ${cfg.writeCapacity}/s`);
      parts.push(`queueLimit ${cfg.queueLimit}`);
      break;
    case 'router':
      parts.push(`strategy ${cfg.strategy}`);
      parts.push(`capacity ${cfg.capacity}/s`);
      parts.push(`queueLimit ${cfg.queueLimit}`);
      break;
    case 'cache':
      parts.push(`mode ${cfg.mode}`);
      parts.push(`hitRate ${cfg.hitRate}%`);
      parts.push(`entries ${cfg.entries}`);
      parts.push(`ttl ${cfg.ttlMs}ms`);
      parts.push(`capacity ${cfg.capacity}/s`);
      break;
    case 'broker':
      parts.push(`delivery ${cfg.delivery}`);
      parts.push(`capacity ${cfg.capacity}/s`);
      parts.push(`queueLimit ${cfg.queueLimit}`);
      break;
    case 'processor':
    case 'source':
    default:
      parts.push(`capacity ${cfg.capacity}/s`);
      parts.push(`concurrency ${cfg.concurrency}`);
      parts.push(`queueLimit ${cfg.queueLimit}`);
      if (typeof cfg.maxRetries === 'number' && cfg.maxRetries > 0) {
        parts.push(`maxRetries ${cfg.maxRetries}`);
      }
      break;
  }

  return `DEFAULTS · ${parts.join(', ')}`;
}
