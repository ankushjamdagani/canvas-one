import { describe, expect, it } from "vitest";
import { architectureDiagram, makeNode, newProject } from "../domain/model";
import { renderDiagramSvg, pngDimensions } from "./diagramSvg";

function project() {
  const value = newProject("Example");
  value.graph = architectureDiagram();
  return value;
}

describe("standalone diagram rendering", () => {
  it("renders the entire graph independently of viewport without mutating data", () => {
    const p = project();
    p.graph.nodes[0].position = { x: -700, y: -240 };
    p.graph.nodes[2].position = { x: 2500, y: 1800 };
    const before = structuredClone(p);
    const first = renderDiagramSvg(p);
    expect(first.width).toBeGreaterThan(3200);
    expect(first.height).toBeGreaterThan(2000);
    for (const node of p.graph.nodes) expect(first.svg).toContain(node.name);
    expect(p).toEqual(before);
    p.viewport = { x: 500, y: 100, zoom: 0.3 };
    expect(renderDiagramSvg(p)).toEqual(first);
    expect(first.svg).not.toMatch(/foreignObject|<script|<image|http[s]?:\/\/(?!www.w3.org)/);
  });

  it("escapes hostile XML and keeps full notes while bounding visible copy", () => {
    const p = project();
    p.name = 'A <script>alert("x")</script> & B';
    p.graph.nodes[0].name = '<image href="https://evil.test"/>';
    p.graph.nodes[0].description = "Long notes " + "W".repeat(220);
    const custom = makeNode("custom", 1000, 0);
    custom.customType = 'Vector & <index>';
    p.graph.nodes.push(custom);
    const { svg } = renderDiagramSvg(p);
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain('<image href=');
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("Vector &amp; &lt;index&gt;");
    expect(svg).toContain(p.graph.nodes[0].description);
    expect(svg).toContain("…");
    p.name = "bad\u0000\ud800name";
    expect(renderDiagramSvg(p).svg).not.toMatch(/[\u0000\ud800]/);
  });

  it("projects collapsed boundaries and suppresses internal connections", () => {
    const p = project();
    p.graph.edges[0].label = "Internal only";
    p.graph.edges[1].label = "Boundary link";
    p.subsystems = [{ id: "group", name: "Frontend", nodeIds: p.graph.nodes.slice(0, 2).map((n) => n.id), collapsed: true }];
    const collapsed = renderDiagramSvg(p).svg;
    expect(collapsed).toContain("Frontend");
    expect(collapsed).toContain("Boundary link");
    expect(collapsed).not.toContain("Internal only");
    expect(collapsed).not.toContain(">Client<");
    expect(collapsed).toContain("Architecture boundary");
    p.subsystems[0].collapsed = false;
    const expanded = renderDiagramSvg(p).svg;
    expect(expanded).toContain("Internal only");
    expect(expanded).toContain(">Client<");
  });

  it("includes self-loops, backward routes, long labels and communication styles in its bounds", () => {
    const p = project();
    const [a, b] = p.graph.nodes;
    p.graph.edges = [
      { id: "loop", source: a.id, target: a.id, label: "Self loop", communication: "async" },
      { id: "back", source: b.id, target: a.id, label: "L".repeat(60), protocol: "P".repeat(30), communication: "data" },
    ];
    const result = renderDiagramSvg(p);
    expect(result.svg).toContain("Self loop");
    expect(result.svg).toContain('stroke-dasharray="7 5"');
    expect(result.svg).toContain('stroke-dasharray="2 4"');
    expect(result.svg.match(/marker-end=/g)).toHaveLength(2);
    expect(result.svg).not.toMatch(/NaN|Infinity/);
    const view = result.svg.match(/viewBox="([^"]+)"/)![1].split(" ").map(Number);
    for (const match of result.svg.matchAll(/[ML](-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)) {
      const x = Number(match[1]), y = Number(match[2]);
      // Marker points have their own coordinate system.
      if (x >= 0 && x <= 8 && y >= 0 && y <= 8) continue;
      expect(x).toBeGreaterThanOrEqual(view[0]);
      expect(x).toBeLessThanOrEqual(view[0] + view[2]);
      expect(y).toBeGreaterThanOrEqual(view[1]);
      expect(y).toBeLessThanOrEqual(view[1] + view[3]);
    }
  });

  it("rejects empty, non-diagram, invalid and unreasonable coordinate ranges", () => {
    expect(() => renderDiagramSvg(newProject())).toThrow("Architecture diagram");
    const p = project();
    p.graph.nodes = []; p.graph.edges = [];
    expect(() => renderDiagramSvg(p)).toThrow("Add a component");
    p.graph = architectureDiagram();
    p.graph.nodes[0].position.x = NaN;
    expect(() => renderDiagramSvg(p)).toThrow("valid canvas position");
    p.graph.nodes[0].position.x = 200_000;
    expect(() => renderDiagramSvg(p)).toThrow("closer together");
    p.graph.nodes[0].position.x = 1e10;
    expect(() => renderDiagramSvg(p)).toThrow("canvas origin");
  });

  it("renders escaped notes, attachment labels, collapsed notes and note-only diagrams", () => {
    const p = project();
    const node = p.graph.nodes[0];
    p.graph.notes = [{
      id: "note-1",
      kind: "decision",
      title: 'Use <cache> & edge',
      body: "Body <details> & " + "bounded ".repeat(40),
      position: { x: -420, y: -260 },
      collapsed: false,
      attachment: { kind: "node", id: node.id },
    }];
    const expanded = renderDiagramSvg(p);
    expect(expanded.svg).toContain('fill="#fff3df"');
    expect(expanded.svg).toContain('width="240" height="200"');
    expect(expanded.svg).toContain("Decision");
    expect(expanded.svg).toContain("&lt;cache&gt; &amp; edge");
    expect(expanded.svg).toContain("Body &lt;details&gt; &amp;");
    expect(expanded.svg).toContain(node.name);
    expect(expanded.svg).toContain("Decision — Use &lt;cache&gt; &amp; edge");
    p.graph.notes[0].collapsed = true;
    const collapsed = renderDiagramSvg(p);
    expect(collapsed.svg).toContain('width="240" height="80"');
    expect(collapsed.svg).not.toMatch(/<text[^>]*>Body &lt;details&gt;/);

    p.graph.nodes = [];
    p.graph.edges = [];
    p.graph.notes[0].attachment = { kind: "edge", id: "missing-edge" };
    const noteOnly = renderDiagramSvg(p);
    expect(noteOnly.width).toBeGreaterThan(240);
    expect(noteOnly.height).toBeGreaterThan(80);
    expect(noteOnly.svg).toContain("Linked item unavailable");
  });
});

it("caps raster memory and each side while preferring two-times size", () => {
  expect(pngDimensions(400, 200)).toEqual({ width: 800, height: 400 });
  for (const [width, height] of [[100_000, 100], [100_000, 100_000], [9000, 5000], [100, 100_000]]) {
    const size = pngDimensions(width, height);
    expect(size.width).toBeLessThanOrEqual(8192);
    expect(size.height).toBeLessThanOrEqual(8192);
    expect(size.width * size.height).toBeLessThanOrEqual(16_000_000);
    if (width >= height) expect(Math.abs(size.height - size.width * height / width)).toBeLessThanOrEqual(1);
    else expect(Math.abs(size.width - size.height * width / height)).toBeLessThanOrEqual(1);
  }
  expect(() => pngDimensions(0, 500)).toThrow();
  expect(() => pngDimensions(Infinity, 500)).toThrow();
});
