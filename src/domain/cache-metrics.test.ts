import { describe, it, expect } from "vitest";
import { observedCacheHitRate } from "./cache-metrics";

describe("observedCacheHitRate", () => {
  describe("absent or zero cache decisions", () => {
    it("returns null when metrics is null", () => {
      expect(observedCacheHitRate(null)).toBeNull();
    });

    it("returns null when metrics is undefined", () => {
      expect(observedCacheHitRate(undefined)).toBeNull();
    });

    it("returns null when cacheHits and cacheMisses are both 0", () => {
      expect(observedCacheHitRate({ cacheHits: 0, cacheMisses: 0 })).toBeNull();
    });
  });

  describe("hits only", () => {
    it("returns 100 for a single hit and zero misses", () => {
      expect(observedCacheHitRate({ cacheHits: 1, cacheMisses: 0 })).toBe(100);
    });

    it("returns 100 for multiple hits and zero misses", () => {
      expect(observedCacheHitRate({ cacheHits: 100, cacheMisses: 0 })).toBe(100);
    });
  });

  describe("misses only", () => {
    it("returns 0 for zero hits and a single miss", () => {
      expect(observedCacheHitRate({ cacheHits: 0, cacheMisses: 1 })).toBe(0);
    });

    it("returns 0 for zero hits and multiple misses", () => {
      expect(observedCacheHitRate({ cacheHits: 0, cacheMisses: 50 })).toBe(0);
    });
  });

  describe("mixed", () => {
    it("returns 50 when hits equal misses", () => {
      expect(observedCacheHitRate({ cacheHits: 1, cacheMisses: 1 })).toBe(50);
    });

    it("returns 75 when hits are 3 and misses are 1", () => {
      expect(observedCacheHitRate({ cacheHits: 3, cacheMisses: 1 })).toBe(75);
    });

    it("calculates rate using decision denominator without arrival count dependency", () => {
      expect(observedCacheHitRate({ cacheHits: 18, cacheMisses: 2 })).toBe(90);
    });
  });

  describe("fractional percentage", () => {
    it("returns exact unrounded fractional percentage for 1 hit and 2 misses", () => {
      const rate = observedCacheHitRate({ cacheHits: 1, cacheMisses: 2 });
      expect(rate).toBe(100 / 3);
      expect(rate).toBeCloseTo(33.333333, 5);
    });

    it("returns exact terminating decimal percentage without truncation", () => {
      expect(observedCacheHitRate({ cacheHits: 1, cacheMisses: 7 })).toBe(12.5);
    });

    it("does not round to integer or fixed decimal places", () => {
      const rate = observedCacheHitRate({ cacheHits: 2, cacheMisses: 5 });
      expect(rate).toBe(200 / 7);
      expect(rate).not.toBe(29);
      expect(rate).not.toBe(28.57);
    });
  });
});
