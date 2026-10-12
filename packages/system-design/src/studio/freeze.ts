/**
 * Recursively freezes an object graph in place and returns it. Cycle-safe, and skips
 * subtrees that are already frozen.
 */
export function deepFreeze<T>(obj: T, seen = new WeakSet<object>()): T {
  if (obj === null || typeof obj !== 'object' || Object.isFrozen(obj) || seen.has(obj)) {
    return obj;
  }
  seen.add(obj);
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && typeof val === 'object') {
      deepFreeze(val, seen);
    }
  }
  return obj;
}
