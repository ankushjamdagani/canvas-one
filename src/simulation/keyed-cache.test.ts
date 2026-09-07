import { describe, expect, it } from "vitest";
import { KeyedCache } from "./keyed-cache";

describe("finite URL cache", () => {
  it("starts cold and evicts the least recently used live entry", () => {
    const cache = new KeyedCache(2, 10);
    expect(cache.get(1, 0)).toBe(false);
    cache.put(1, 0);
    cache.put(2, 1);
    expect(cache.get(1, 2)).toBe(true);
    cache.put(3, 3);
    expect(cache.get(2, 3)).toBe(false);
    expect(cache.get(1, 3)).toBe(true);
    expect(cache.get(3, 3)).toBe(true);
    expect(cache.snapshot(3)).toEqual({ entries: 2, evictions: 1, expirations: 0 });
  });

  it("hits update recency without extending TTL, including the exact boundary", () => {
    const cache = new KeyedCache(2, 5);
    cache.put(1, 0);
    cache.put(2, 1);
    expect(cache.get(1, 4.999)).toBe(true);
    expect(cache.get(1, 5)).toBe(false);
    expect(cache.get(2, 5)).toBe(true);
    expect(cache.snapshot(6)).toEqual({ entries: 0, evictions: 0, expirations: 2 });
  });

  it("expires every stale entry before capacity eviction regardless of recency", () => {
    const cache = new KeyedCache(2, 5);
    cache.put(1, 0);
    cache.put(2, 1);
    cache.get(1, 4);
    cache.put(3, 5);
    expect(cache.get(2, 5)).toBe(true);
    expect(cache.snapshot(5)).toEqual({ entries: 2, evictions: 0, expirations: 1 });
  });

  it("an overlapping fill refreshes TTL without eviction or a stale expiry", () => {
    const cache = new KeyedCache(2, 5);
    cache.put(1, 0);
    cache.put(2, 1);
    cache.put(1, 2);
    expect(cache.get(1, 5)).toBe(true);
    expect(cache.get(2, 6)).toBe(false);
    expect(cache.get(1, 6)).toBe(true);
    expect(cache.get(1, 7)).toBe(false);
    expect(cache.snapshot(7)).toEqual({ entries: 0, evictions: 0, expirations: 2 });
  });

  it("supports a single-entry cache and equal-time fills", () => {
    const cache = new KeyedCache(1, 1);
    cache.put(0, 0);
    cache.put(0, 0);
    cache.put(1, 0);
    expect(cache.get(0, 0)).toBe(false);
    expect(cache.get(1, 0)).toBe(true);
    expect(cache.snapshot(1)).toEqual({ entries: 0, evictions: 1, expirations: 1 });
  });

  it("sampling changes neither cache decisions nor final accounting", () => {
    const sparse = new KeyedCache(2, 2), sampled = new KeyedCache(2, 2);
    for (const cache of [sparse, sampled]) {
      cache.put(1, 0);
      cache.put(2, 0.5);
    }
    sampled.snapshot(2.1);
    for (const cache of [sparse, sampled]) cache.put(3, 2.2);
    expect(sampled.get(2, 2.3)).toBe(sparse.get(2, 2.3));
    expect(sampled.snapshot(5)).toEqual(sparse.snapshot(5));
  });

  it("rejects invalid capacities and durations", () => {
    for (const capacity of [0, -1, 1.5, Infinity, NaN])
      expect(() => new KeyedCache(capacity, 5)).toThrow();
    for (const ttl of [0, -1, Infinity, NaN])
      expect(() => new KeyedCache(2, ttl)).toThrow();
  });
});
