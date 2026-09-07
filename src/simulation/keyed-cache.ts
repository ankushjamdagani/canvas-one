export interface KeyedCacheSnapshot {
  entries: number;
  evictions: number;
  expirations: number;
}

/** One run's finite cache. All calls use nondecreasing simulated seconds.
 * Both maps are bounded by capacity: hits change recency, fills change expiry.
 * A fixed TTL keeps the expiry map ordered without stale heap entries.
 */
export class KeyedCache {
  private recency = new Map<number, number>();
  private expiry = new Map<number, number>();
  private evictions = 0;
  private expirations = 0;

  constructor(
    private maxEntries: number,
    private ttlSeconds: number,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1)
      throw new Error("Cache entry limit must be a positive whole number.");
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0)
      throw new Error("Cache TTL must be a positive finite duration.");
  }

  private expire(now: number) {
    for (const [key, expiresAt] of this.expiry) {
      if (expiresAt > now) break;
      this.expiry.delete(key);
      this.recency.delete(key);
      this.expirations++;
    }
  }

  get(key: number, now: number): boolean {
    this.expire(now);
    const expiresAt = this.recency.get(key);
    if (expiresAt === undefined) return false;
    this.recency.delete(key);
    this.recency.set(key, expiresAt);
    return true;
  }

  put(key: number, now: number): void {
    this.expire(now);
    // An overlapping miss may finish after an earlier fill for the same key.
    this.recency.delete(key);
    this.expiry.delete(key);
    if (this.recency.size === this.maxEntries) {
      const oldest = this.recency.keys().next().value!;
      this.recency.delete(oldest);
      this.expiry.delete(oldest);
      this.evictions++;
    }
    const expiresAt = now + this.ttlSeconds;
    this.recency.set(key, expiresAt);
    this.expiry.set(key, expiresAt);
  }

  snapshot(now: number): KeyedCacheSnapshot {
    this.expire(now);
    return {
      entries: this.recency.size,
      evictions: this.evictions,
      expirations: this.expirations,
    };
  }
}
