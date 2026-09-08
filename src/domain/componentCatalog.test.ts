import { describe, expect, it } from "vitest";
import { architectureDiagram, makeNode, validateGraph } from "./model";
import { componentCatalog } from "./componentCatalog";

describe("architecture component catalog", () => {
  it("offers a broad unique palette across system layers", () => {
    expect(componentCatalog.length).toBeGreaterThanOrEqual(25);
    expect(new Set(componentCatalog.map((item) => item.kind)).size).toBe(componentCatalog.length);
    expect(new Set(componentCatalog.map((item) => item.category)).size).toBeGreaterThanOrEqual(6);
  });

  it("keeps free-form diagrams structurally valid without making them executable", () => {
    const graph = architectureDiagram();
    const storage = makeNode("objectstore", 980, 170);
    storage.description = "Durable media and export files";
    graph.nodes.push(storage);
    graph.edges.push({ id: crypto.randomUUID(), source: graph.nodes[2].id, target: storage.id });
    expect(validateGraph(graph)).toEqual([]);
  });
});
