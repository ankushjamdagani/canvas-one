import { describe, it, expect, beforeEach } from "vitest";
import { useEditor } from "./editor";
import { newOpenProject } from "../domain/openGraph";
import { groupingReason } from "../domain/grouping";
import { VALID_KINDS } from "../domain/execution";


describe("Open Editor State & Grouping", () => {
  beforeEach(() => {
    useEditor.getState().load(newOpenProject());
  });

  it("adds all 29 open component kinds without legacy routing insertions", () => {
    for (const kind of VALID_KINDS) {
      const added = useEditor.getState().add(kind);
      expect(added).toBe(true);
    }
    const graph = useEditor.getState().project.graph;
    expect(graph.nodes.length).toBe(29);
    for (const node of graph.nodes) {
      expect(node.behavior).toBeDefined();
    }
    // traffic added default workload
    expect(graph.workloads?.length).toBe(1);
    expect(graph.workloads?.[0].entryNodeId).toBe(graph.nodes.find(n => n.kind === "traffic")?.id);
  });

  it("enforces node limit of 100 on open graph add", () => {
    for (let i = 0; i < 100; i++) {
      expect(useEditor.getState().add("service")).toBe(true);
    }
    expect(useEditor.getState().project.graph.nodes.length).toBe(100);
    expect(useEditor.getState().add("service")).toBe(false);
  });

  it("enforces workload limit of 20 when adding traffic nodes", () => {
    for (let i = 0; i < 20; i++) {
      expect(useEditor.getState().add("traffic")).toBe(true);
    }
    expect(useEditor.getState().project.graph.nodes.length).toBe(20);
    expect(useEditor.getState().project.graph.workloads?.length).toBe(20);
    expect(useEditor.getState().add("traffic")).toBe(false);
    expect(useEditor.getState().project.graph.nodes.length).toBe(20);
  });

  it("duplicates open node with behavior and copies attached workloads with fresh IDs", () => {
    useEditor.getState().add("service");
    const node = useEditor.getState().project.graph.nodes[0];
    useEditor.getState().generateTraffic(node.id);

    expect(useEditor.getState().project.graph.workloads?.length).toBe(1);
    const success = useEditor.getState().duplicateNode(node.id);
    expect(success).toBe(true);

    const graph = useEditor.getState().project.graph;
    expect(graph.nodes.length).toBe(2);
    expect(graph.workloads?.length).toBe(2);

    const dupNode = graph.nodes[1];
    expect(dupNode.id).not.toBe(node.id);
    expect(dupNode.behavior).toBeDefined();

    const dupWl = graph.workloads![1];
    expect(dupWl.entryNodeId).toBe(dupNode.id);
    expect(dupWl.id).not.toBe(graph.workloads![0].id);
    expect(dupWl.classes[0].id).not.toBe(graph.workloads![0].classes[0].id);
  });

  it("removes workloads when node is deleted and supports undo", () => {
    useEditor.getState().add("service");
    const id = useEditor.getState().project.graph.nodes[0].id;
    useEditor.getState().generateTraffic(id);
    expect(useEditor.getState().project.graph.workloads?.length).toBe(1);

    useEditor.getState().remove(id);
    expect(useEditor.getState().project.graph.nodes.length).toBe(0);
    expect(useEditor.getState().project.graph.workloads?.length).toBe(0);

    useEditor.getState().undo();
    expect(useEditor.getState().project.graph.nodes.length).toBe(1);
    expect(useEditor.getState().project.graph.workloads?.length).toBe(1);
  });

  it("updates and deletes workloads", () => {
    useEditor.getState().add("service");
    const id = useEditor.getState().project.graph.nodes[0].id;
    useEditor.getState().generateTraffic(id);
    const wlId = useEditor.getState().project.graph.workloads![0].id;

    useEditor.getState().updateWorkload(wlId, { rate: 500 });
    expect(useEditor.getState().project.graph.workloads![0].rate).toBe(500);

    useEditor.getState().removeWorkload(wlId);
    expect(useEditor.getState().project.graph.workloads?.length).toBe(0);

    useEditor.getState().undo();
    expect(useEditor.getState().project.graph.workloads?.length).toBe(1);
    expect(useEditor.getState().project.graph.workloads![0].rate).toBe(500);
  });

  it("scheduler node gets intervalMs 1000 preset on generateTraffic", () => {
    useEditor.getState().add("scheduler");
    const id = useEditor.getState().project.graph.nodes[0].id;
    useEditor.getState().generateTraffic(id);
    expect(useEditor.getState().project.graph.workloads![0].intervalMs).toBe(1000);
  });

  it("validates grouping reason", () => {
    const project = newOpenProject();
    expect(groupingReason(project, ["a"])).toContain("between 2 and 20");

    const ids21 = Array.from({ length: 21 }, (_, i) => `id-${i}`);
    expect(groupingReason(project, ids21)).toContain("between 2 and 20");

    useEditor.getState().add("service");
    useEditor.getState().add("database");
    const [n1, n2] = useEditor.getState().project.graph.nodes;

    expect(groupingReason(useEditor.getState().project, [n1.id, "non-existent"])).toContain("existing visible component");
    expect(groupingReason(useEditor.getState().project, [n1.id, n2.id])).toBeNull();
    expect(groupingReason(useEditor.getState().project, [n1.id, n2.id, n1.id])).toContain("only once");
    const history = useEditor.getState().past.length;
    expect(useEditor.getState().createSubsystem("Duplicate selection", [n1.id, n2.id, n1.id])).toBe(false);
    expect(useEditor.getState().past.length).toBe(history);

    useEditor.getState().createSubsystem("Core", [n1.id, n2.id]);
    expect(groupingReason(useEditor.getState().project, [n1.id, n2.id])).toContain("already assigned");
  });

  it("creates, renames, collapses, and dissolves subsystem with undo/redo atomic graph preservation", () => {
    useEditor.getState().add("service");
    useEditor.getState().add("database");
    const [n1, n2] = useEditor.getState().project.graph.nodes;
    const initialGraphRef = useEditor.getState().project.graph;

    const ok = useEditor.getState().createSubsystem("Sub1", [n1.id, n2.id]);
    expect(ok).toBe(true);
    expect(useEditor.getState().project.graph).toBe(initialGraphRef); // object identity preserved
    const subId = useEditor.getState().project.subsystems![0].id;
    expect(useEditor.getState().selected).toBe(subId);
    expect(useEditor.getState().selectedNodeIds).toEqual([]);

    // rename
    expect(useEditor.getState().renameSubsystem(subId, "SubNew")).toBe(true);
    expect(useEditor.getState().project.subsystems![0].name).toBe("SubNew");
    expect(useEditor.getState().renameSubsystem(subId, "SubNew")).toBe(false);

    // toggle collapse
    useEditor.getState().toggleSubsystem(subId);
    expect(useEditor.getState().project.subsystems![0].collapsed).toBe(true);
    expect(useEditor.getState().selected).toBe(subId);

    // dissolve
    useEditor.getState().dissolveSubsystem(subId);
    expect(useEditor.getState().project.subsystems?.length).toBe(0);
    expect(useEditor.getState().selected).toBeNull();

    // undo dissolve
    useEditor.getState().undo();
    expect(useEditor.getState().project.subsystems?.length).toBe(1);
    expect(useEditor.getState().project.subsystems![0].collapsed).toBe(true);

    // undo toggle
    useEditor.getState().undo();
    expect(useEditor.getState().project.subsystems![0].collapsed).toBe(false);

    // undo rename
    useEditor.getState().undo();
    expect(useEditor.getState().project.subsystems![0].name).toBe("Sub1");

    // undo create
    useEditor.getState().undo();
    expect(useEditor.getState().project.subsystems?.length).toBe(0);

    // redo create
    useEditor.getState().redo();
    expect(useEditor.getState().project.subsystems?.length).toBe(1);
  });

  it("readOnly mode prevents mutations while allowing selection and load", () => {
    useEditor.getState().add("service");
    const p = useEditor.getState().project;
    const selectedId = p.graph.nodes[0].id;
    useEditor.getState().load(p, true);
    expect(useEditor.getState().readOnly).toBe(true);

    expect(useEditor.getState().add("service")).toBe(false);
    expect(useEditor.getState().checkpoint("cp1")).toBe(false);
    expect(useEditor.getState().createSubsystem("sub", ["a", "b"])).toBe(false);
    expect(useEditor.getState().project).toEqual(p);
    useEditor.getState().rename("Changed");
    useEditor.getState().viewport({ x: 40, y: 20, zoom: 2 });
    useEditor.getState().updateNode(selectedId, { name: "Changed" });
    useEditor.getState().generateTraffic(selectedId);
    useEditor.getState().remove(selectedId);
    useEditor.getState().beginMove();
    useEditor.getState().move([{ id: selectedId, position: { x: 99, y: 99 } }]);
    useEditor.getState().undo();
    useEditor.getState().redo();
    expect(useEditor.getState().project).toEqual(p);
    expect(useEditor.getState().past).toEqual([]);

    // selection works
    useEditor.getState().select(selectedId);
    expect(useEditor.getState().selected).toBe(selectedId);

    // load can switch projects and reset readOnly
    const p2 = newOpenProject();
    useEditor.getState().load(p2, false);
    expect(useEditor.getState().readOnly).toBe(false);
    expect(useEditor.getState().add("service")).toBe(true);
    expect(useEditor.getState().project.graph.nodes.length).toBe(1);
  });

  it("retains dormant groups when ordinary node is deleted and undone", () => {
    useEditor.getState().add("service");
    useEditor.getState().add("database");
    const [n1, n2] = useEditor.getState().project.graph.nodes;
    useEditor.getState().createSubsystem("Core", [n1.id, n2.id]);
    expect(useEditor.getState().project.subsystems?.length).toBe(1);

    // delete one member node
    useEditor.getState().remove(n1.id);
    expect(useEditor.getState().project.graph.nodes.length).toBe(1);
    // subsystem metadata retained
    expect(useEditor.getState().project.subsystems?.length).toBe(1);

    useEditor.getState().undo();
    expect(useEditor.getState().project.graph.nodes.length).toBe(2);
    expect(useEditor.getState().project.subsystems?.length).toBe(1);
    expect(useEditor.getState().project.subsystems![0].nodeIds).toEqual([n1.id, n2.id]);
  });

  it("rejects 51st checkpoint without dropping the first", () => {
    useEditor.getState().load(newOpenProject());
    for (let i = 0; i < 50; i++) {
      expect(useEditor.getState().checkpoint(`cp-${i}`)).toBe(true);
    }
    expect(useEditor.getState().project.checkpoints.length).toBe(50);
    expect(useEditor.getState().project.checkpoints[0].name).toBe("cp-0");

    expect(useEditor.getState().checkpoint("cp-50")).toBe(false);
    expect(useEditor.getState().project.checkpoints.length).toBe(50);
    expect(useEditor.getState().project.checkpoints[0].name).toBe("cp-0");
  });

  it("selectNodes selects multiple visible nodes and calculates single selected", () => {
    useEditor.getState().add("service");
    useEditor.getState().add("database");
    const [n1, n2] = useEditor.getState().project.graph.nodes;

    useEditor.getState().selectNodes([n1.id, n2.id]);
    expect(useEditor.getState().selectedNodeIds).toEqual([n1.id, n2.id]);
    expect(useEditor.getState().selected).toBeNull();

    useEditor.getState().selectNodes([n1.id]);
    expect(useEditor.getState().selectedNodeIds).toEqual([n1.id]);
    expect(useEditor.getState().selected).toBe(n1.id);
  });
});
