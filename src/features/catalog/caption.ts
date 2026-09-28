/**
 * Catalog Captions and Defaults Formatter (RV-06a).
 *
 * Implements specifications from:
 * - specs/revamp/contracts/catalog.md (§5 Library display mapping, Resolution 6, Resolution 10)
 */

import type { CatalogEntry } from './catalog';
import { RESOURCE_CONFIG_COPY } from './resourceConfigCopy';

function value(label: string, raw: unknown, unit = ''): string {
  return `${label} ${String(raw)}${unit}`;
}

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
      parts.push(value(RESOURCE_CONFIG_COPY.capacity.label, cfg.capacity, RESOURCE_CONFIG_COPY.capacity.unit));
      parts.push(value(RESOURCE_CONFIG_COPY.writeCapacity.label, cfg.writeCapacity, RESOURCE_CONFIG_COPY.writeCapacity.unit));
      parts.push(value(RESOURCE_CONFIG_COPY.queueLimit.label, cfg.queueLimit));
      break;
    case 'router':
      parts.push(value(
        RESOURCE_CONFIG_COPY.strategy.label,
        RESOURCE_CONFIG_COPY.strategy.options[cfg.strategy as keyof typeof RESOURCE_CONFIG_COPY.strategy.options],
      ));
      parts.push(value(RESOURCE_CONFIG_COPY.capacity.label, cfg.capacity, RESOURCE_CONFIG_COPY.capacity.unit));
      parts.push(value(RESOURCE_CONFIG_COPY.queueLimit.label, cfg.queueLimit));
      break;
    case 'cache':
      parts.push(value(
        RESOURCE_CONFIG_COPY.mode.label,
        RESOURCE_CONFIG_COPY.mode.options[cfg.mode as keyof typeof RESOURCE_CONFIG_COPY.mode.options],
      ));
      parts.push(value(RESOURCE_CONFIG_COPY.hitRate.label, cfg.hitRate, RESOURCE_CONFIG_COPY.hitRate.unit));
      parts.push(value(RESOURCE_CONFIG_COPY.entries.label, cfg.entries));
      parts.push(value(RESOURCE_CONFIG_COPY.ttlMs.label, cfg.ttlMs, RESOURCE_CONFIG_COPY.ttlMs.unit));
      parts.push(value(RESOURCE_CONFIG_COPY.capacity.label, cfg.capacity, RESOURCE_CONFIG_COPY.capacity.unit));
      break;
    case 'broker':
      parts.push(value(
        RESOURCE_CONFIG_COPY.delivery.label,
        RESOURCE_CONFIG_COPY.delivery.options[cfg.delivery as keyof typeof RESOURCE_CONFIG_COPY.delivery.options],
      ));
      parts.push(value(RESOURCE_CONFIG_COPY.capacity.label, cfg.capacity, RESOURCE_CONFIG_COPY.capacity.unit));
      parts.push(value(RESOURCE_CONFIG_COPY.queueLimit.label, cfg.queueLimit));
      break;
    case 'processor':
    case 'source':
    default:
      parts.push(value(RESOURCE_CONFIG_COPY.capacity.label, cfg.capacity, RESOURCE_CONFIG_COPY.capacity.unit));
      parts.push(value(RESOURCE_CONFIG_COPY.concurrency.label, cfg.concurrency));
      parts.push(value(RESOURCE_CONFIG_COPY.queueLimit.label, cfg.queueLimit));
      if (typeof cfg.maxRetries === 'number' && cfg.maxRetries > 0) {
        parts.push(value(RESOURCE_CONFIG_COPY.maxRetries.label, cfg.maxRetries));
      }
      break;
  }

  return `DEFAULTS · ${parts.join(', ')}`;
}
