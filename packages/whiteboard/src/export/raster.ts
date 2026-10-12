export type PngDimensions = { readonly width: number; readonly height: number; readonly scale: number };
export function parseSvgDimensions(svg: string): { width: number; height: number } {
  const widthMatch = svg.match(/\bwidth="([0-9.]+)"/);
  const heightMatch = svg.match(/\bheight="([0-9.]+)"/);
  if (widthMatch && heightMatch) {
    return {
      width: Math.round(parseFloat(widthMatch[1])),
      height: Math.round(parseFloat(heightMatch[1])),
    };
  }
  const viewBoxMatch = svg.match(/\bviewBox="[0-9.-]+\s+[0-9.-]+\s+([0-9.]+)\s+([0-9.]+)"/);
  if (viewBoxMatch) {
    return {
      width: Math.round(parseFloat(viewBoxMatch[1])),
      height: Math.round(parseFloat(viewBoxMatch[2])),
    };
  }
  throw new Error('Could not parse dimensions from SVG string');
}

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
