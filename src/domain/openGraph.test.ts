import { describe, it, expect } from "vitest";
import {
  makeOpenNode,
  emptyOpenGraph,
  newOpenProject,
  createRunnableCopy,
  executionSignature,
} from "./openGraph";
import {
  baseline,
  backgroundJobs,
  architectureDiagram,
  newProject,
  validateGraph,
  isOpenGraph,
} from "./model";
import { Simulation } from "../simulation/engine";
import type { Graph } from "./model";
import type { ExecutionGraph } from "./execution";
import { defaultWorkload } from "./behaviorDefaults";

describe("openGraph and open-model integration", () => {
  it("accepts more than 20 open components without legacy capacity constraints", () => {
    const g = emptyOpenGraph();
    g.nodes = Array.from({ length: 29 }, () => makeOpenNode("service", 0, 0));
    g.nodes[0].capacity = -1; // ignored legacy scaffold
    expect(validateGraph(g, false)).toEqual([]);
  });

  it("keeps historical workload rates at their actual sample times", () => {
    const g = emptyOpenGraph();
    g.nodes = [makeOpenNode("traffic", 0, 0)];
    g.settings.duration = 3;
    g.workloads = [{ ...defaultWorkload(g.nodes[0].id), rate: 10, profile: { kind: "ramp", endRate: 40 } }];
    const m = new Simulation(g).advance(3);
    expect(m.history.map(s => s.arrivalRate)).toEqual([20, 30, 40]);
  });

  it("rejects malformed open nodes without throwing", () => {
    const g = { ...emptyOpenGraph(), nodes: [null] } as unknown as Graph;
    expect(() => validateGraph(g, false)).not.toThrow();
    expect(validateGraph(g, false).length).toBeGreaterThan(0);
  });

  it("new open project is empty and uses independent factories", () => {
    const project = newOpenProject();
    expect(project.graph.nodes).toEqual([]);
    expect(project.graph.edges).toEqual([]);
    expect(isOpenGraph(project.graph)).toBe(true);
    const node1 = makeOpenNode("service", 10, 20);
    const node2 = makeOpenNode("queue", 30, 40);
    expect(node1.id).not.toBe(node2.id);
    expect(node1.name).toBe("Service");
    expect(node2.name).toBe("Message queue");
    expect(node1.behavior?.type).toBe("processor");
    expect(node2.behavior?.type).toBe("broker");
  });

  it("unrestricted client -> two storage paths through Simulation returns execution metrics", () => {
    const client = makeOpenNode("client", 0, 0);
    const db1 = makeOpenNode("database", 100, 0);
    const db2 = makeOpenNode("nosql", 100, 100);

    const edge1 = {
      id: "e1",
      source: client.id,
      target: db1.id,
      transport: "call" as const,
      latencyMs: 0,
      returnLatencyMs: 0,
      ackDelayMs: 8,
      messageTtlMs: 2000,
      weight: 1,
    };
    const edge2 = {
      id: "e2",
      source: client.id,
      target: db2.id,
      transport: "call" as const,
      latencyMs: 0,
      returnLatencyMs: 0,
      ackDelayMs: 8,
      messageTtlMs: 2000,
      weight: 1,
    };

    const graph: Graph & ExecutionGraph = {
      executionVersion: "open-system/1",
      nodes: [client, db1, db2],
      edges: [edge1, edge2],
      workloads: [
        {
          id: "w1",
          entryNodeId: client.id,
          enabled: true,
          rate: 50,
          timeoutMs: 2000,
          classes: [
            {
              id: "c1",
              name: "read",
              weight: 1,
              operation: "read",
              tags: [],
              keyDistribution: { kind: "uniform", catalogSize: 100, hotSubset: 10, hotShare: 80 },
            },
          ],
        },
      ],
      settings: { traffic: 50, seed: 42, duration: 5, timeoutMs: 2000 },
    };

    expect(validateGraph(graph)).toEqual([]);
    const sim = new Simulation(graph);
    const metrics = sim.advance(2);
    expect(metrics.execution).toBeDefined();
    expect(metrics.succeeded).toBeGreaterThan(0);
    expect(metrics.databaseLookups).toBeGreaterThan(0);
  });

  it("changing legacy node capacity while behavior unchanged has no effect", () => {
    const client = makeOpenNode("client", 0, 0);
    const svc = makeOpenNode("service", 100, 0);
    const edge = {
      id: "e1",
      source: client.id,
      target: svc.id,
      transport: "call" as const,
      latencyMs: 0,
      returnLatencyMs: 0,
      ackDelayMs: 8,
      messageTtlMs: 2000,
      weight: 1,
    };
    const makeG = (legacyCap: number): Graph & ExecutionGraph => ({
      executionVersion: "open-system/1",
      nodes: [client, { ...svc, capacity: legacyCap }],
      edges: [edge],
      workloads: [
        {
          id: "w1",
          entryNodeId: client.id,
          enabled: true,
          rate: 20,
          timeoutMs: 2000,
          classes: [
            { id: "c1", name: "req", weight: 1, operation: "read", tags: [], keyDistribution: { kind: "uniform", catalogSize: 10, hotSubset: 2, hotShare: 50 } },
          ],
        },
      ],
      settings: { traffic: 20, seed: 123, duration: 2, timeoutMs: 2000 },
    });

    const g1 = makeG(10);
    const g2 = makeG(99999);
    const sim1 = new Simulation(g1);
    const sim2 = new Simulation(g2);
    expect(sim1.advance(1)).toEqual(sim2.advance(1));
  });

  it("metadata edits signature unchanged but behavior/workload/edge changes differ", () => {
    const client = makeOpenNode("client", 0, 0);
    const graph: Graph & ExecutionGraph = {
      executionVersion: "open-system/1",
      nodes: [client],
      edges: [],
      workloads: [],
      settings: { traffic: 10, seed: 1, duration: 10, timeoutMs: 1000 },
    };
    const sigBefore = executionSignature(graph);
    const graphMetaEdited = {
      ...graph,
      nodes: [{ ...client, name: "New Name", position: { x: 500, y: 500 }, description: "hello" }],
    };
    expect(executionSignature(graphMetaEdited)).toBe(sigBefore);

    const graphBehaviorEdited = {
      ...graph,
      nodes: [{ ...client, behavior: { ...client.behavior!, capacity: 999 } }],
    };
    expect(executionSignature(graphBehaviorEdited)).not.toBe(sigBefore);
  });

  it("conversion preserves original deep equality, new ID, notes/groups/currentview and clears old history", () => {
    const original = newProject("My URL Shortener");
    original.graph.notes = [{ id: "n1", kind: "general", title: "Note", body: "note", position: { x: 10, y: 10 }, collapsed: false }];
    original.subsystems = [{ id: "group", name: "Subsystem", nodeIds: original.graph.nodes.slice(0, 2).map(n => n.id), collapsed: true }];
    original.expandedNodeIds = [original.graph.nodes[1].id];
    original.checkpoints = [{ id: "old", name: "Old graph", graph: structuredClone(original.graph), createdAt: 1 }];
    const origCopy = structuredClone(original);

    const copy = createRunnableCopy(original);
    expect(original).toEqual(origCopy);
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toContain("(runnable copy)");
    expect(copy.graph.notes).toEqual(original.graph.notes);
    expect(copy.subsystems).toEqual(original.subsystems);
    expect(copy.expandedNodeIds).toEqual(original.expandedNodeIds);
    expect(copy.checkpoints).toEqual([]);
    expect(isOpenGraph(copy.graph)).toBe(true);
  });

  it("diagram missing workloads/review edges allowed edit but rejected run", () => {
    const diagProject = { ...newProject("Diag"), graph: architectureDiagram() };
    const copy = createRunnableCopy(diagProject);
    expect(validateGraph(copy.graph, false)).toEqual([]);
    const runErrors = validateGraph(copy.graph, true);
    expect(runErrors.length).toBeGreaterThan(0);
  });

  it("known jobs runnable and counts messages", () => {
    const jobsProject = { ...newProject("Jobs"), graph: backgroundJobs() };
    const copy = createRunnableCopy(jobsProject);
    expect(validateGraph(copy.graph, true)).toEqual([]);
    const sim = new Simulation(copy.graph);
    const metrics = sim.advance(2);
    expect(metrics.execution).toBeDefined();
    expect(metrics.execution!.messages.generated).toBeGreaterThan(0);
  });

  it("invalid open extra metadata rejected", () => {
    const proj = newOpenProject();
    const openG = proj.graph as Graph & ExecutionGraph;
    openG.guideId = "a".repeat(100);
    expect(validateGraph(openG, false)).toContain("Experiment guide metadata is invalid.");
  });
});
