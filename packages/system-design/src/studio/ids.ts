import type { Id } from './model.js';

/** Canonical lowercase UUID: versions 1–5 and RFC variant [89ab]. */
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isValidUuid(val: unknown): val is Id {
  return typeof val === 'string' && UUID_REGEX.test(val);
}
