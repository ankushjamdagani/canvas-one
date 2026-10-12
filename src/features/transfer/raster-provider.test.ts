import { describe, expect, it } from 'vitest';
import { renderDiagramPng } from '@canvas-one/whiteboard/browser/raster';
import { pngDimensions } from '@canvas-one/whiteboard/export/raster';

describe('host rasterization capability', () => {
  it('passes bounded geometry to a host provider without constructing DOM surfaces', async () => {
    let observed: unknown;
    const result = await renderDiagramPng('<svg width="9000" height="9000"></svg>', 2, {
      rasterizer: async (svg, dimensions) => {
        observed = { svg, dimensions };
        return new Blob(['host-rendered'], { type: 'image/png' });
      },
    });
    const dimensions = pngDimensions(9000, 9000, 2);
    expect(observed).toEqual({ svg: '<svg width="9000" height="9000"></svg>', dimensions });
    expect(result.width * result.height).toBeLessThanOrEqual(16_000_000);
    expect(await result.text()).toBe('host-rendered');
  });
});
