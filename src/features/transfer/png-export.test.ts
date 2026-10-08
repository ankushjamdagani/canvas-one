/**
 * Tests for PNG Diagram Exporter.
 *
 * Verification:
 * - PNG rendering using an injected fake canvas (testable without real browser / GPU)
 * - Dimension bounds (<= 8,192 px per side and <= 16,000,000 pixels)
 * - Preferred scale clamping
 */

import { describe, expect, it } from 'vitest';
import { pngDimensions, renderDiagramPng } from './png-export';
import type { CanvasFactory } from './types';

describe('PNG Diagram Export (pngDimensions & renderDiagramPng)', () => {
  it('calculates 2x scale for typical diagram dimensions', () => {
    const dim = pngDimensions(800, 600, 2);
    expect(dim.width).toBe(1600);
    expect(dim.height).toBe(1200);
    expect(dim.scale).toBe(2);
  });

  it('clamps dimensions to 8,192 px max per side', () => {
    // 6000 x 4000 at 2x would be 12000 x 8000, exceeding 8192 width
    const dim = pngDimensions(6000, 4000, 2);
    expect(dim.width).toBeLessThanOrEqual(8192);
    expect(dim.height).toBeLessThanOrEqual(8192);
    expect(dim.width * dim.height).toBeLessThanOrEqual(16_000_000);
  });

  it('clamps total pixels to 16 million pixels max', () => {
    // 4000 x 4000 at 2x would be 8000 x 8000 = 64,000,000 pixels
    const dim = pngDimensions(4000, 4000, 2);
    expect(dim.width * dim.height).toBeLessThanOrEqual(16_000_000);
    expect(dim.width).toBe(4000);
    expect(dim.height).toBe(4000);
  });

  it('rejects invalid or non-positive dimensions', () => {
    expect(() => pngDimensions(0, 100)).toThrow('invalid image dimensions');
    expect(() => pngDimensions(100, -5)).toThrow('invalid image dimensions');
    expect(() => pngDimensions(Infinity, 100)).toThrow('invalid image dimensions');
  });

  it('renders PNG with an injected fake canvas', async () => {
    let contextCreated = false;
    let fillRectCalled = false;
    let canvasWidth = 0;
    let canvasHeight = 0;

    const fakeCanvasFactory: CanvasFactory = (width, height) => {
      canvasWidth = width;
      canvasHeight = height;
      return {
        width,
        height,
        getContext: (type) => {
          if (type === '2d') {
            contextCreated = true;
            return {
              fillStyle: '',
              fillRect: () => {
                fillRectCalled = true;
              },
              drawImage: () => {},
            };
          }
          return null;
        },
        toBlob: (callback, type) => {
          // Provide a dummy PNG blob
          const dummyData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
          const blob = new Blob([dummyData], { type: type || 'image/png' });
          callback(blob);
        },
      };
    };

    const dummySvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">' +
      '<rect width="400" height="300" fill="#ffffff"/>' +
      '</svg>';

    const pngBlob = await renderDiagramPng(dummySvg, 2, {
      canvasFactory: fakeCanvasFactory,
    });

    expect(contextCreated).toBe(true);
    expect(fillRectCalled).toBe(true);
    expect(canvasWidth).toBe(800);
    expect(canvasHeight).toBe(600);
    expect(pngBlob).toBeInstanceOf(Blob);
    expect(pngBlob.type).toBe('image/png');
    expect(pngBlob.width).toBe(800);
    expect(pngBlob.height).toBe(600);
  });
});
