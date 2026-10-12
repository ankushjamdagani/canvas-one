declare const structuredClone: <T>(value: T) => T;

/** Detached, recursively frozen authored data. Standard structuredClone is host supplied. */
export function immutableSnapshot<T>(value: T): T {
  const clone = structuredClone(value);
  const pending: unknown[] = [clone];
  const visited = new Set<object>();
  while (pending.length) {
    const item = pending.pop();
    if (typeof item !== 'object' || item === null || visited.has(item)) continue;
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new TypeError('Authored snapshots require plain JSON objects and arrays');
    }
    visited.add(item);
    pending.push(...Object.values(item));
    Object.freeze(item);
  }
  return clone;
}
