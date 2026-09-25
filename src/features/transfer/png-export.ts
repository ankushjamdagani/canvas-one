/**
 * PNG Diagram Exporter (RV-10a).
 *
 * Implements specifications from:
 * - specs/revamp/contracts/parts-and-export.md ("JSON, images and files")
 * - specs/revamp/requirements.md (R10: Entry and transfer)
 *
 * Rules:
 * - Pure function signature taking injected canvas factory so it is 100% testable in Node/vitest
 * - Bounded max dimensions: <= 8,192 px per side and <= 16 million total pixels
 * - Prefer 2x scale when within bounds
 * - Object URLs always revoked in finally
 */

import { parseSvgDimensions } from './svg-export';
import type { CanvasFactory, PngDimensions, RenderPngOptions } from './types';

/**
 * Computes PNG dimensions bounded to at most 8,192 px per side and 16,000,000 total pixels.
 * Uses preferredScale (default 2) clamped to the ceilings.
 */
export function pngDimensions(
  width: number,
  height: number,
  preferredScale = 2,
): PngDimensions {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The diagram has invalid image dimensions.');
  }

  const scale = Math.min(
    preferredScale,
    8192 / width,
    8192 / height,
    Math.sqrt(16_000_000 / (width * height)),
  );

  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scale,
  };
}

/**
 * Renders an SVG string to a PNG Blob.
 * In the browser, uses OffscreenCanvas (or HTMLCanvasElement) and Image.
 * Supports injected canvasFactory and imageLoader for testability outside the browser.
 */
export async function renderDiagramPng(
  svg: string,
  scale = 2,
  options?: RenderPngOptions,
): Promise<Blob & { width: number; height: number }> {
  const { width: origWidth, height: origHeight } = parseSvgDimensions(svg);
  const dims = pngDimensions(origWidth, origHeight, scale);

  // 1. Injected Canvas Factory path (test or custom environment)
  if (options?.canvasFactory) {
    const canvas = options.canvasFactory(dims.width, dims.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not create the 2D drawing context.');
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, dims.width, dims.height);

    if (options.imageLoader) {
      const img = await options.imageLoader(svg);
      ctx.drawImage(img, 0, 0, dims.width, dims.height);
    }

    let blob: Blob | null = null;
    if (typeof canvas.convertToBlob === 'function') {
      blob = await canvas.convertToBlob({ type: 'image/png' });
    } else {
      blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/png');
      });
    }

    if (!blob) {
      throw new Error('Could not encode the PNG image.');
    }

    return Object.assign(blob, { width: dims.width, height: dims.height });
  }

  // 2. Browser environment path
  if (typeof URL === 'undefined' || typeof Image === 'undefined') {
    throw new Error(
      'renderDiagramPng requires a browser environment or an injected canvasFactory option.',
    );
  }

  // Scale SVG dimensions in the SVG markup root attributes
  const rasterSvg = svg.replace(/^<svg\b([^>]*)>/, (_root, attributes: string) => {
    const withoutWH = attributes
      .replace(/\swidth="[^"]*"/, '')
      .replace(/\sheight="[^"]*"/, '');
    return `<svg width="${dims.width}" height="${dims.height}"${withoutWH}>`;
  });

  const svgBlob = new Blob([rasterSvg], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not render the diagram image.'));
      img.src = objectUrl;
    });

    let pngBlob: Blob;

    if (typeof OffscreenCanvas !== 'undefined') {
      const offscreen = new OffscreenCanvas(dims.width, dims.height);
      const ctx = offscreen.getContext('2d');
      if (!ctx) throw new Error('Could not create the PNG drawing surface.');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, dims.width, dims.height);
      ctx.drawImage(image, 0, 0, dims.width, dims.height);
      pngBlob = await offscreen.convertToBlob({ type: 'image/png' });
    } else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const canvas = document.createElement('canvas');
      canvas.width = dims.width;
      canvas.height = dims.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not create the PNG drawing surface.');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, dims.width, dims.height);
      ctx.drawImage(image, 0, 0, dims.width, dims.height);
      const b = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!b) throw new Error('Could not encode the PNG image.');
      pngBlob = b;
      canvas.width = 0;
      canvas.height = 0;
    } else {
      throw new Error('No canvas implementation available.');
    }

    return Object.assign(pngBlob, { width: dims.width, height: dims.height });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
