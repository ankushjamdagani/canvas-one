/**
 * Exposed endpoints (D53): the connection types a project offers to projects that link to it.
 * Project-level data (like description and team), not part of any document or branch.
 */

import { DELIVERY_GUARANTEES, MESSAGE_ORDERINGS, type DeliveryGuarantee, type MessageOrdering } from './model';
import { isProtocolOf, PORT_PATH_MAX_LENGTH, type ConnectableChannel, type Protocol } from './protocols';

/**
 * The declared part of an in-port's settings (what a callee promises, never what the runner
 * simulates). It is what a project publishes to the projects that link it.
 */
export type ExposedContract = {
  readonly expectedP95Ms?: number;
  readonly availabilityPct?: number;
  readonly idempotent?: boolean;
  readonly delivery?: DeliveryGuarantee;
  readonly ordering?: MessageOrdering;
  readonly throughputPerSec?: number;
  readonly maxStalenessMs?: number;
};

/** A connection type a project accepts: channel, protocol, endpoint path or name ('' for none) and its declared contract. */
export type ProjectExposure = {
  readonly channel: ConnectableChannel;
  readonly protocol: Protocol;
  readonly path: string;
  readonly contract?: ExposedContract;
};

const CONTRACT_KEYS: Readonly<Record<ConnectableChannel, readonly string[]>> = {
  call: ['expectedP95Ms', 'availabilityPct', 'idempotent'],
  message: ['delivery', 'ordering'],
  data: ['throughputPerSec', 'maxStalenessMs'],
};

/** The declared settings of an in-port, ready to publish; undefined when it declares nothing. */
export function declaredContractOf(channel: ConnectableChannel, settings: unknown): ExposedContract | undefined {
  if (typeof settings !== 'object' || settings === null) return undefined;
  const picked: Record<string, unknown> = {};
  for (const key of CONTRACT_KEYS[channel]) {
    const value = (settings as Record<string, unknown>)[key];
    if (value !== undefined) picked[key] = value;
  }
  return Object.keys(picked).length > 0 ? (picked as ExposedContract) : undefined;
}

function isContract(channel: ConnectableChannel, value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length === 0) return false;
  const finite = (v: unknown, min: number, max: number, integer = false) =>
    typeof v === 'number' && Number.isFinite(v) && v > min && v <= max && (!integer || Number.isInteger(v));
  return entries.every(([key, v]) => {
    if (!CONTRACT_KEYS[channel].includes(key)) return false;
    switch (key) {
      case 'expectedP95Ms': return finite(v, 0, 600000);
      case 'availabilityPct': return finite(v, 0, 100);
      case 'idempotent': return typeof v === 'boolean';
      case 'delivery': return (DELIVERY_GUARANTEES as readonly unknown[]).includes(v);
      case 'ordering': return (MESSAGE_ORDERINGS as readonly unknown[]).includes(v);
      case 'throughputPerSec': return finite(v, 0, 1e9);
      case 'maxStalenessMs': return finite(v, 0, 31_536_000_000);
      default: return false;
    }
  });
}

/** The most exposures one project can list: every protocol once. */
export const PROJECT_EXPOSURES_MAX = 32;

export function sameExposure(a: ProjectExposure, b: ProjectExposure): boolean {
  return a.channel === b.channel && a.protocol === b.protocol && a.path === b.path;
}

/** Whether `value` is a well-formed exposure list: closed protocol sets, bounded paths, no duplicates. */
export function isExposureList(value: unknown): value is readonly ProjectExposure[] {
  if (!Array.isArray(value) || value.length > PROJECT_EXPOSURES_MAX) return false;
  const seen = new Set<string>();
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) return false;
    const keys = Object.keys(item);
    const allowedKeys = ['channel', 'protocol', 'path', 'contract'];
    if (!keys.includes('channel') || !keys.includes('protocol') || !keys.includes('path') || keys.some((k) => !allowedKeys.includes(k))) return false;
    const { channel, protocol, path, contract } = item as { channel: unknown; protocol: unknown; path: unknown; contract?: unknown };
    if (typeof path !== 'string' || path !== path.trim() || Array.from(path).length > PORT_PATH_MAX_LENGTH) return false;
    if (channel !== 'call' && channel !== 'message' && channel !== 'data') return false;
    if (!isProtocolOf(channel, protocol)) return false;
    if (contract !== undefined && !isContract(channel, contract)) return false;
    const key = `${channel}:${protocol}:${path}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
