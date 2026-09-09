import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../domain/model";

vi.mock("./diagramSvg", () => ({
  renderDiagramSvg: () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"/>', width: 120, height: 80 }),
  pngDimensions: () => ({ width: 240, height: 160 }),
}));

import { downloadDiagram } from "./downloadDiagram";

const project = { name: " A risky / diagram?! ", graph: { nodes: [{}] } } as unknown as Project;

describe("diagram download adapter", () => {
  const revoked: string[] = [];
  const objectBlobs: Blob[] = [];
  const anchors: Array<{ download: string; removed: boolean }> = [];
  let canvas: { width: number; height: number; getContext: ReturnType<typeof vi.fn>; toBlob: (callback: BlobCallback) => void };
  let clickError: Error | null;
  let imageFails: boolean, nullContext: boolean, nullBlob: boolean;

  beforeEach(() => {
    project.name = " A risky / diagram?! ";
    clickError = null;
    imageFails = false;
    nullContext = false;
    nullBlob = false;
    revoked.length = 0;
    objectBlobs.length = 0;
    anchors.length = 0;
    let count = 0;
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn((blob: Blob) => { objectBlobs.push(blob); return `blob:test-${++count}`; }),
      revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
    });
    vi.stubGlobal("Image", class {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_value: string) { queueMicrotask(() => imageFails ? this.onerror?.() : this.onload?.()); }
    });
    canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => nullContext ? null : ({ fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() })),
      toBlob: (callback) => callback(nullBlob ? null : new Blob(["png"], { type: "image/png" })),
    };
    vi.stubGlobal("document", {
      body: { append: vi.fn() },
      createElement: vi.fn((tag: string) => {
        if (tag === "canvas") return canvas;
        const anchor = {
          href: "", download: "", hidden: false, removed: false,
          click: () => { if (clickError) throw clickError; },
          remove() { this.removed = true; },
        };
        anchors.push(anchor);
        return anchor;
      }),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("downloads a sanitized SVG filename and revokes its URL", async () => {
    await downloadDiagram(project, "svg");
    expect(anchors[0]).toMatchObject({ download: "a-risky-diagram.svg", removed: true });
    expect(revoked).toEqual(["blob:test-1"]);
  });

  it("uses a safe fallback when the project name has no filename characters", async () => {
    project.name = " 🎨 / ? ";
    await downloadDiagram(project, "svg");
    expect(anchors[0].download).toBe("architecture-diagram.svg");
  });

  it("releases SVG and PNG URLs and clears the temporary canvas", async () => {
    await downloadDiagram(project, "png");
    expect(anchors[0]).toMatchObject({ download: "a-risky-diagram.png", removed: true });
    expect(canvas.getContext).toHaveBeenCalledOnce();
    expect(canvas).toMatchObject({ width: 0, height: 0 });
    expect(await objectBlobs[0].text()).toContain('width="240" height="160"');
    expect(await objectBlobs[0].text()).toContain('viewBox=');
    expect(revoked).toEqual(["blob:test-1", "blob:test-2"]);
  });

  it("removes the anchor and revokes its URL when download dispatch fails", async () => {
    clickError = new Error("blocked");
    await expect(downloadDiagram(project, "svg")).rejects.toThrow("blocked");
    expect(anchors[0].removed).toBe(true);
    expect(revoked).toEqual(["blob:test-1"]);
  });

  it.each([
    ["image decoding", () => { imageFails = true; }, "Could not render the diagram image."],
    ["canvas context", () => { nullContext = true; }, "Could not create the PNG drawing surface."],
    ["PNG encoding", () => { nullBlob = true; }, "Could not encode the PNG image."],
  ])("cleans temporary resources after %s failure", async (_case, setup, message) => {
    setup();
    await expect(downloadDiagram(project, "png")).rejects.toThrow(message);
    expect(revoked).toEqual(["blob:test-1"]);
    expect(canvas).toMatchObject({ width: 0, height: 0 });
  });
});
