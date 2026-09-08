import { describe, expect, it } from "vitest";
import { alignNodes, distributeNodes, type LayoutNode } from "./canvasLayout";

const nodes: LayoutNode[] = [
  { id: "a", position: { x: -40, y: 30 }, size: { width: 100, height: 50 } },
  { id: "b", position: { x: 120, y: -20 }, size: { width: 80, height: 90 } },
  { id: "c", position: { x: 300, y: 140 }, size: { width: 120, height: 40 } },
];

describe("canvas layout", () => {
  it("aligns varied bounds in negative coordinate space regardless of selection order", () => {
    expect(alignNodes(nodes, ["c", "a", "b"], "right").updates).toEqual([
      { id: "a", position: { x: 320, y: 30 } },
      { id: "b", position: { x: 340, y: -20 } },
    ]);
    expect(alignNodes(nodes, ["b", "a"], "top").updates).toEqual([
      { id: "a", position: { x: -40, y: -20 } },
    ]);
  });

  it("distributes equal non-overlapping gaps while preserving outer bounds", () => {
    const result = distributeNodes(nodes, ["c", "a", "b"], "horizontal");
    expect(result.reason).toBeUndefined();
    expect(result.updates).toEqual([{ id: "b", position: { x: 140, y: -20 } }]);
  });

  it("guards overlap, stale IDs, small selections, and no-op layouts", () => {
    const tight = nodes.map((node, index) => ({ ...node, position: { x: index * 20, y: 0 } }));
    expect(distributeNodes(tight, ["a", "b", "c"], "horizontal").reason).toContain("Not enough horizontal space");
    expect(alignNodes(nodes, ["a", "missing"], "left").reason).toContain("hidden or missing");
    expect(distributeNodes(nodes, ["a", "b"], "vertical").reason).toContain("at least 3");
    expect(alignNodes(nodes, ["a", "a"], "left").reason).toContain("at least 2");
    expect(alignNodes(nodes, ["a", "b"], "left").updates.length).toBe(1);
  });
});
