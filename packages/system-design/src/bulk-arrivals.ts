/** How a bulk of N requests spreads over time. */
export type BulkArrival =
  | 'instant'
  | { readonly spreadMs: number }
  | { readonly ramp: { readonly spreadMs: number } };

/**
 * Arrival time (ms from run start) of the `index`-th (0-based) request of a bulk of `requests`.
 * `instant` sends all at the delay; `spreadMs` spaces them evenly (rate N / spread);
 * `ramp` makes the arrival rate rise linearly from 0, so the cumulative count is N * (t / spread)^2.
 */
export function bulkArrivalMs(index: number, requests: number, arrival: BulkArrival, startDelayMs: number): number {
  if (arrival === 'instant') return startDelayMs;
  if ('spreadMs' in arrival) return startDelayMs + (index * arrival.spreadMs) / requests;
  return startDelayMs + arrival.ramp.spreadMs * Math.sqrt(index / requests);
}
