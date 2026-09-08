import { describe, expect, it } from "vitest";
import { architectureTemplates } from "./architectureTemplates";
import { validateGraph } from "./model";

describe("architecture templates", () => {
  it("creates valid connected diagram graphs with meaningful metadata", () => {
    expect(architectureTemplates).toHaveLength(3);
    for (const template of architectureTemplates) {
      const graph = template.create();
      expect(graph.scenario).toBe("diagram");
      expect(graph.nodes.length).toBeGreaterThanOrEqual(6);
      expect(graph.nodes.length).toBeLessThanOrEqual(9);
      expect(graph.nodes.length).toBeLessThanOrEqual(100);
      expect(graph.edges.length).toBeLessThanOrEqual(200);
      expect(validateGraph(graph, false)).toEqual([]);
      expect(graph.nodes.every((node) => graph.edges.some((edge) => edge.source === node.id || edge.target === node.id))).toBe(true);
      expect(graph.nodes.every((node) => node.description?.trim())).toBe(true);
      expect(graph.edges.every((edge) => edge.label && edge.protocol && edge.communication)).toBe(true);
    }
  });

  it("returns fresh isolated graphs on every call", () => {
    for (const template of architectureTemplates) {
      const first = template.create();
      const second = template.create();
      expect(new Set(first.nodes.map((node) => node.id)).size).toBe(first.nodes.length);
      expect(new Set(first.edges.map((edge) => edge.id)).size).toBe(first.edges.length);
      expect(first.nodes.map((node) => node.id)).not.toEqual(second.nodes.map((node) => node.id));
      expect(first.edges.map((edge) => edge.id)).not.toEqual(second.edges.map((edge) => edge.id));
      first.nodes[0].name = "Mutated";
      first.edges[0].label = "Mutated";
      expect(second.nodes[0].name).not.toBe("Mutated");
      expect(second.edges[0].label).not.toBe("Mutated");
    }
  });
});
