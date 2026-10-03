import { describe, it, expect } from 'vitest';
import {
  computeDropTarget,
  computeResizedSideWidth,
  computeResizedFloatRect,
  computeStackSplit,
  clampSideWidth,
  clampFloatRect,
  MIN_SIDE_WIDTH,
  MAX_SIDE_WIDTH,
  MIN_FLOAT_WIDTH,
  MIN_FLOAT_HEIGHT,
  STACK_MIN_EXPANDED_HEIGHT,
} from './geometry';

describe('Panel Geometry Helpers', () => {
  describe('computeDropTarget', () => {
    const viewportWidth = 1440;
    const sideWidths = { left: 320, right: 320 };

    it('returns "left" when pointer is within the left docking drop zone', () => {
      expect(computeDropTarget(50, viewportWidth, sideWidths)).toBe('left');
      expect(computeDropTarget(200, viewportWidth, sideWidths)).toBe('left');
      expect(computeDropTarget(320, viewportWidth, sideWidths)).toBe('left');
    });

    it('returns "right" when pointer is within the right docking drop zone', () => {
      expect(computeDropTarget(1400, viewportWidth, sideWidths)).toBe('right');
      expect(computeDropTarget(1200, viewportWidth, sideWidths)).toBe('right');
      expect(computeDropTarget(1440 - 320, viewportWidth, sideWidths)).toBe('right');
    });

    it('returns null when pointer is in the middle / canvas zone', () => {
      expect(computeDropTarget(600, viewportWidth, sideWidths)).toBe(null);
      expect(computeDropTarget(720, viewportWidth, sideWidths)).toBe(null);
      expect(computeDropTarget(800, viewportWidth, sideWidths)).toBe(null);
    });

    it('respects custom drop threshold if provided', () => {
      expect(computeDropTarget(150, viewportWidth, sideWidths, 100)).toBe(null);
      expect(computeDropTarget(90, viewportWidth, sideWidths, 100)).toBe('left');
    });

    it('returns null for non-finite or invalid viewport', () => {
      expect(computeDropTarget(NaN, viewportWidth, sideWidths)).toBe(null);
      expect(computeDropTarget(100, 0, sideWidths)).toBe(null);
    });
  });

  describe('computeResizedSideWidth & clamps', () => {
    it('increases left side width on positive deltaX', () => {
      const resized = computeResizedSideWidth('left', 320, 50);
      expect(resized).toBe(370);
    });

    it('decreases left side width on negative deltaX', () => {
      const resized = computeResizedSideWidth('left', 320, -30);
      expect(resized).toBe(290);
    });

    it('increases right side width on negative deltaX (dragging leftwards)', () => {
      const resized = computeResizedSideWidth('right', 320, -50);
      expect(resized).toBe(370);
    });

    it('decreases right side width on positive deltaX (dragging rightwards)', () => {
      const resized = computeResizedSideWidth('right', 320, 30);
      expect(resized).toBe(290);
    });

    it('clamps side width between MIN_SIDE_WIDTH (280) and MAX_SIDE_WIDTH (440)', () => {
      expect(computeResizedSideWidth('left', 320, 200)).toBe(MAX_SIDE_WIDTH);
      expect(computeResizedSideWidth('left', 320, -100)).toBe(MIN_SIDE_WIDTH);
      expect(clampSideWidth(100)).toBe(MIN_SIDE_WIDTH);
      expect(clampSideWidth(600)).toBe(MAX_SIDE_WIDTH);
    });
  });

  describe('computeResizedFloatRect & clamps', () => {
    const viewport = { width: 1440, height: 900 };
    const baseRect = { x: 500, y: 200, width: 360, height: 480 };

    it('resizes floating rectangle with deltaX and deltaY', () => {
      const resized = computeResizedFloatRect(baseRect, 40, 50, viewport);
      expect(resized.width).toBe(400);
      expect(resized.height).toBe(530);
      expect(resized.x).toBe(500);
      expect(resized.y).toBe(200);
    });

    it('clamps minimum floating dimensions to MIN_FLOAT_WIDTH (280) and MIN_FLOAT_HEIGHT (240)', () => {
      const resized = computeResizedFloatRect(baseRect, -200, -300, viewport);
      expect(resized.width).toBe(MIN_FLOAT_WIDTH);
      expect(resized.height).toBe(MIN_FLOAT_HEIGHT);
    });

    it('clamps floating rect within viewport bounds', () => {
      const outOfBounds = { x: 1400, y: 850, width: 360, height: 480 };
      const clamped = clampFloatRect(outOfBounds, viewport);
      expect(clamped.x + clamped.width).toBeLessThanOrEqual(viewport.width - 16);
      expect(clamped.y + clamped.height).toBeLessThanOrEqual(viewport.height - 16);
      expect(clamped.y).toBeGreaterThanOrEqual(54); // TOPBAR_HEIGHT_DESKTOP
    });
  });

  describe('computeStackSplit', () => {
    const totalHeight = 800;

    it('computes proportional split within bounds', () => {
      const split = computeStackSplit(400, 100, totalHeight);
      expect(split).toBe(500 / 800);
    });

    it('clamps to ensure both panels have at least STACK_MIN_EXPANDED_HEIGHT (200px)', () => {
      // Trying to make top panel 100px (< 200px)
      const clampedBottom = computeStackSplit(400, -350, totalHeight);
      expect(clampedBottom * totalHeight).toBe(STACK_MIN_EXPANDED_HEIGHT);

      // Trying to make bottom panel 100px (top panel 700px > 600px max)
      const clampedTop = computeStackSplit(400, 350, totalHeight);
      expect((1 - clampedTop) * totalHeight).toBe(STACK_MIN_EXPANDED_HEIGHT);
    });
  });
});
