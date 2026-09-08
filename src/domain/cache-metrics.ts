import type { Metrics } from "./metrics";

export function observedCacheHitRate(
  metrics: Pick<Metrics, "cacheHits" | "cacheMisses"> | null | undefined
): number | null {
  if (!metrics) {
    return null;
  }

  const totalDecisions = metrics.cacheHits + metrics.cacheMisses;
  if (totalDecisions === 0) {
    return null;
  }

  return (100 * metrics.cacheHits) / totalDecisions;
}
