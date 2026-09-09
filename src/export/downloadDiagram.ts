import type { Project } from "../domain/model";
import { pngDimensions, renderDiagramSvg } from "./diagramSvg";

export type DiagramExportFormat = "svg" | "png";

function safeFilename(name: string) {
  const stem = name.normalize("NFKD").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 72).replace(/-+$/g, "");
  return stem || "architecture-diagram";
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not render the diagram image."));
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode the PNG image.")), "image/png");
  });
}

async function saveBlob(blob: Blob, filename: string, urls: Set<string>) {
  const url = URL.createObjectURL(blob);
  urls.add(url);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  try {
    document.body.append(anchor);
    anchor.click();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  } finally {
    anchor.remove();
  }
}

export async function downloadDiagram(project: Project, format: DiagramExportFormat) {
  const urls = new Set<string>();
  try {
    const { svg, width, height } = renderDiagramSvg(project);
    const filename = `${safeFilename(project.name)}.${format}`;
    if (format === "svg") {
      await saveBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), filename, urls);
      return;
    }
    const size = pngDimensions(width, height);
    const rasterSvg = svg.replace(/^<svg\b([^>]*)>/, (_root, attributes: string) =>
      `<svg${attributes.replace(/\swidth="[^"]*"/, ` width="${size.width}"`).replace(/\sheight="[^"]*"/, ` height="${size.height}"`)}>`);
    const sourceUrl = URL.createObjectURL(new Blob([rasterSvg], { type: "image/svg+xml;charset=utf-8" }));
    urls.add(sourceUrl);
    const image = await loadImage(sourceUrl);
    const canvas = document.createElement("canvas");
    try {
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create the PNG drawing surface.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(image, 0, 0, size.width, size.height);
      await saveBlob(await canvasBlob(canvas), filename, urls);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
  }
}
