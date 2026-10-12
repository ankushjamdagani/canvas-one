/** Standard structured cloning is available in browser workers and Node; no DOM API is required. */
export {};
declare global {
  function structuredClone<T>(value: T): T;
  function queueMicrotask(callback: () => void): void;
  function setTimeout(callback: () => void, delay?: number): unknown;
  const crypto: { randomUUID(): string };
  class AbortController { readonly signal: { readonly aborted: boolean; readonly reason?: unknown }; abort(reason?: unknown): void }
}
