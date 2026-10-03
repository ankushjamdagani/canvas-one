import { describe, expect, it } from "vitest";
import type { BranchRecord } from "../../persistence/studio/types";
import type { Document } from "../../domain/studio/model";
import { buildThumbnail, resolveOpenTarget } from "./projectCard";

const branch = (id: string, state: "open" | "closed", createdAt: number): BranchRecord => ({
  projectId: "p",
  id,
  label: id,
  state,
  headCommitId: null,
  workingSnapshotId: `snap-${id}`,
  workingRevision: 1,
  createdAt,
});

describe("resolveOpenTarget", () => {
  const project = { mainBranchId: "main" };

  it("opens main when there is no open draft", () => {
    const target = resolveOpenTarget(project, [branch("main", "open", 1), branch("old", "closed", 5)]);
    expect(target).toEqual({ branchId: "main", isDraft: false });
  });

  it("opens the newest open draft, ignoring closed ones", () => {
    const target = resolveOpenTarget(project, [
      branch("main", "open", 1),
      branch("a", "open", 2),
      branch("b", "open", 3),
      branch("c", "closed", 9),
    ]);
    expect(target).toEqual({ branchId: "b", isDraft: true });
  });
});

describe("buildThumbnail", () => {
  const doc = (overrides: Partial<Document>): Document =>
    ({
      schema: "studio-model/1",
      id: "d",
      title: "t",
      elements: [],
      connections: [],
      relations: [],
      schemas: [],
      fixtures: [],
      refinements: [],
      scenarios: [],
      views: [],
      ...overrides,
    }) as Document;

  it("is null without placements", () => {
    expect(buildThumbnail(doc({}))).toBeNull();
  });

  it("places nodes, draws connections between their centres and pads the box", () => {
    const thumb = buildThumbnail(
      doc({
        elements: [
          { id: "e1", visualKind: "service" },
          { id: "e2", visualKind: "database" },
        ] as unknown as Document["elements"],
        connections: [
          { id: "c1", source: { elementId: "e1", portId: "o" }, target: { elementId: "e2", portId: "i" } },
        ] as unknown as Document["connections"],
        views: [
          {
            id: "v",
            label: "v",
            placements: [
              { id: "p1", elementId: "e1", x: 0, y: 0, width: 100, expanded: false },
              { id: "p2", elementId: "e2", x: 300, y: 100, width: 100, expanded: false },
            ],
            connectionIds: ["c1", "missing"],
            relationIds: [],
            groups: [],
            notes: [],
          },
        ],
      }),
    );
    expect(thumb?.nodes.map((n) => n.visualKind)).toEqual(["service", "database"]);
    expect(thumb?.edges).toEqual([{ x1: 50, y1: 32, x2: 350, y2: 132 }]);
    expect(thumb?.viewBox).toEqual({ x: -40, y: -40, width: 480, height: 244 });
  });
});
