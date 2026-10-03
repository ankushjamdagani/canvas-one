/**
 * Exposed endpoints (D53): the connection types a project offers to projects that link to it.
 * Project-level data (like description and team), not part of any document or branch.
 */

import { isProtocolOf, type ConnectableChannel, type Protocol } from './protocols';

export type ProjectExposure = {
  readonly channel: ConnectableChannel;
  readonly protocol: Protocol;
};

/** The most exposures one project can list: every protocol once. */
export const PROJECT_EXPOSURES_MAX = 32;

export function sameExposure(a: ProjectExposure, b: ProjectExposure): boolean {
  return a.channel === b.channel && a.protocol === b.protocol;
}

/** Whether `value` is a well-formed exposure list: closed protocol sets, no duplicates. */
export function isExposureList(value: unknown): value is readonly ProjectExposure[] {
  if (!Array.isArray(value) || value.length > PROJECT_EXPOSURES_MAX) return false;
  const seen = new Set<string>();
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) return false;
    const keys = Object.keys(item);
    if (keys.length !== 2 || !keys.includes('channel') || !keys.includes('protocol')) return false;
    const { channel, protocol } = item as { channel: unknown; protocol: unknown };
    if (channel !== 'call' && channel !== 'message' && channel !== 'data') return false;
    if (!isProtocolOf(channel, protocol)) return false;
    const key = `${channel}:${protocol}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
