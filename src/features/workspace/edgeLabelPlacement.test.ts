import { describe, expect, it } from 'vitest';
import { chipOverlapsAnyNode, estimateLabelChipRect, rectsIntersect } from './edgeLabelPlacement';

describe('rectsIntersect', () => {
  it('detects overlapping rectangles', () => {
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBe(
      true,
    );
  });

  it('detects non-overlapping rectangles', () => {
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 10, height: 10 })).toBe(
      false,
    );
  });

  it('touching edges (no area overlap) do not count as intersecting', () => {
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(
      false,
    );
  });
});

describe('estimateLabelChipRect', () => {
  it('centers the chip horizontally on the point and lifts it fully above the line', () => {
    const rect = estimateLabelChipRect(100, 100, 'mock request', 1, 6);
    // Horizontally centered on labelX.
    expect(rect.x + rect.width / 2).toBeCloseTo(100, 5);
    // Bottom edge is 6px above labelY at zoom 1.
    expect(rect.y + rect.height).toBeCloseTo(94, 5);
  });

  it('grows the flow-space rect as zoom decreases (same screen size, more flow units)', () => {
    const atZoom1 = estimateLabelChipRect(0, 0, 'abc', 1);
    const atHalfZoom = estimateLabelChipRect(0, 0, 'abc', 0.5);
    expect(atHalfZoom.width).toBeGreaterThan(atZoom1.width);
    expect(atHalfZoom.height).toBeGreaterThan(atZoom1.height);
  });

  it('treats a non-positive zoom as 1 (never divides by zero or inflates infinitely)', () => {
    const rect = estimateLabelChipRect(0, 0, 'abc', 0);
    expect(Number.isFinite(rect.width)).toBe(true);
    expect(Number.isFinite(rect.height)).toBe(true);
  });

  it('longer labels produce a wider chip', () => {
    const short = estimateLabelChipRect(0, 0, 'a', 1);
    const long = estimateLabelChipRect(0, 0, 'a much longer label text', 1);
    expect(long.width).toBeGreaterThan(short.width);
  });
});

describe('chipOverlapsAnyNode', () => {
  const chip = { x: 0, y: 0, width: 10, height: 10 };

  it('is false with no nodes', () => {
    expect(chipOverlapsAnyNode(chip, [])).toBe(false);
  });

  it('is true when any node rect intersects', () => {
    const nodes = [
      { x: 100, y: 100, width: 10, height: 10 },
      { x: 5, y: 5, width: 20, height: 20 },
    ];
    expect(chipOverlapsAnyNode(chip, nodes)).toBe(true);
  });

  it('is false when no node rect intersects', () => {
    const nodes = [
      { x: 100, y: 100, width: 10, height: 10 },
      { x: -100, y: -100, width: 10, height: 10 },
    ];
    expect(chipOverlapsAnyNode(chip, nodes)).toBe(false);
  });
});
