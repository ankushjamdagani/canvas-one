import { describe, expect, it } from "vitest";
import { architectureDiagram, makeNode, validateGraph } from "./model";
import { componentCatalog, componentDefinition } from "./componentCatalog";

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

it("constructs and validates custom diagram components", () => {
  const graph = architectureDiagram();
  const custom = makeNode("custom", 980, 170);
  expect(custom.customType).toBe("Custom component");
  expect(componentDefinition("custom").category).toBe("Operations");
  graph.nodes.push(custom);
  expect(validateGraph(graph)).toEqual([]);
  custom.customType = " ";
  expect(validateGraph(graph)).toContain("Custom component type labels must be 1–60 characters.");
  custom.customType = "x".repeat(61);
  expect(validateGraph(graph)).toContain("Custom component type labels must be 1–60 characters.");
  (custom as { customType?: unknown }).customType = 42;
  expect(validateGraph(graph)).toContain("Custom component type labels must be 1–60 characters.");
});

it("does not allow custom components in executable topologies", () => {
  const graph = architectureDiagram();
  graph.scenario = "lookup";
  graph.nodes = [makeNode("traffic", 0, 0), makeNode("custom", 40, 40), makeNode("service", 80, 80), makeNode("database", 120, 120)];
  expect(validateGraph(graph)).toContain("Use one traffic source, one service, one database, and optionally one cache.");
});
