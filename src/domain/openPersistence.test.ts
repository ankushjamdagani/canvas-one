import { describe, it, expect } from "vitest";
import { newOpenProject, makeOpenNode, emptyOpenGraph } from "./openGraph";
import { exportProject, importProject } from "../persistence/projects";
import { newProject, makeNode, type Project } from "./model";
import { createSavedRun, validateSavedRun, modelChanges, comparisonStatus } from "./results";
import { defaultWorkload, defaultExecutionEdge } from "./behaviorDefaults";
import type { Metrics } from "./metrics";
import { Simulation } from "../simulation/engine";
import type { OpenMetrics } from "../simulation/open/kernel";
import { sameGraphWorkload } from "./workload";
import { compareArchitectures, type ArchitectureSnapshot } from "./revisions";

function buildValidOpenMetrics(graph: import("./model").Graph): Metrics {
  return new Simulation(graph).advance(graph.settings.duration);
}

describe("Open System Validation & Format 8 Persistence", () => {
  it("retains imported string IDs as own metric record keys", () => {
    const graph = emptyOpenGraph();
    const source = makeOpenNode('traffic', 0, 0), sink = makeOpenNode('service', 1, 0);
    source.id = '__proto__';
    graph.nodes = [source, sink];
    graph.edges = [{ ...defaultExecutionEdge(source.id, sink.id), id: '__proto__' + '-edge' }];
    graph.workloads = [defaultWorkload(source.id)];
    const metrics = new Simulation(graph).advance(graph.settings.duration);
    expect(Object.hasOwn(metrics.nodes, source.id)).toBe(true);
    expect(Object.hasOwn(metrics.execution!.nodes, source.id)).toBe(true);
    expect(validateSavedRun(createSavedRun({ id: 'ids', graph, metrics }, 'Imported IDs'))).toEqual([]);
  });

  it("validates real failures, expiry cleanup, caches and background work at the horizon", () => {
    const graph = emptyOpenGraph();
    graph.settings.duration = 1;
    graph.nodes = [makeOpenNode('traffic', 0, 0), makeOpenNode('service', 1, 0), makeOpenNode('queue', 2, 0),
      makeOpenNode('worker', 3, 0), makeOpenNode('cache', 4, 0), makeOpenNode('database', 5, 0)];
    const [src, service, broker, worker, cache, db] = graph.nodes;
    service.behavior.capacity = 5;
    service.behavior.queueLimit = 1;
    service.behavior.failureRate = 35;
    worker.behavior.capacity = 5;
    broker.behavior.queueLimit = 2;
    if (cache.behavior.type === 'cache') { cache.behavior.mode = 'lru'; cache.behavior.ttlMs = 20; }
    graph.edges = [[src, service], [src, broker], [src, cache], [broker, worker], [cache, db]]
      .map(([s, t]) => ({ ...defaultExecutionEdge(s.id, t.id, t.behavior),
        transport: s === broker || t === broker ? 'message' : 'call', messageTtlMs: 60 }));
    graph.workloads = [{ ...defaultWorkload(src.id), intervalMs: 10, timeoutMs: 50 }];
    const metrics = new Simulation(graph).advance(1);
    const run = createSavedRun({ id: 'stress', graph, metrics }, 'Stress');
    expect(validateSavedRun(run)).toEqual([]);
    expect(metrics.execution!.messages.expired).toBeGreaterThan(0);
    const corruptions = [
      (m: Metrics) => { m.throughput = NaN; },
      (m: Metrics) => { m.meanLatency = NaN; },
      (m: Metrics) => { m.nodes[src.id].utilization = NaN; },
      (m: Metrics) => { delete m.edges![graph.edges[0].id]; },
      (m: Metrics) => { m.execution!.nodes = null as never; },
      (m: Metrics) => { m.execution!.messages.generated++; },
    ];
    for (const corrupt of corruptions) {
      const bad = structuredClone(run); corrupt(bad.metrics);
      expect(() => validateSavedRun(bad)).not.toThrow();
      expect(validateSavedRun(bad).length).toBeGreaterThan(0);
    }
  });

  it("preserves checkpoint and authored revision links and rejects mixed archive histories", () => {
    const project = newOpenProject();
    project.checkpoints = [{ id: 'cp', name: 'Draft', graph: structuredClone(project.graph), createdAt: 1 }];
    const draft = { id: 'draft', name: 'Draft', author: 'Team', reason: 'Review', message: 'Open system', issue: '',
      status: 'draft' as const, createdAt: 1, graph: structuredClone(project.graph), subsystems: [], expandedNodeIds: [] };
    project.revisions = [draft, { ...structuredClone(draft), id: 'final', status: 'final', sourceId: 'draft', createdAt: 2 }];
    const imported = importProject(exportProject(project));
    expect(imported.revisions).toEqual(project.revisions);
    expect(imported.checkpoints[0].graph).toEqual(project.graph);
    const malformed = JSON.parse(exportProject(project));
    malformed.project.revisions[0].graph = newProject().graph;
    expect(() => importProject(JSON.stringify(malformed))).toThrow(/Revision model/);
  });

  // 1. open empty draft export 8 / import retains behavior/workloads/notes/groups/revisions/checkpoints
  it("Test 1: open draft roundtrip retains open behaviors, workloads, notes, subsystems, and assigns new project ID", () => {
    const project = newOpenProject("Draft Project");
    const n1 = makeOpenNode("traffic", 100, 100);
    const n2 = makeOpenNode("service", 300, 100);
    project.graph.nodes = [n1, n2];
    project.graph.edges = [{
      id: "e1",
      source: n1.id,
      target: n2.id,
      transport: "call",
      latencyMs: 1,
      returnLatencyMs: 2,
      ackDelayMs: 0,
      messageTtlMs: 2000,
      weight: 1,
    }];
    const wl = defaultWorkload(n1.id);
    project.graph.workloads = [wl];
    project.graph.notes = [{
      id: "note-1",
      kind: "general",
      title: "Arch Note",
      body: "Draft notes",
      position: { x: 50, y: 50 },
      collapsed: false,
    }];
    project.subsystems = [{
      id: "sub-1",
      name: "Core Subsystem",
      nodeIds: [n1.id, n2.id],
      collapsed: false,
    }];

    const exported = exportProject(project);
    const parsed = JSON.parse(exported);
    expect(parsed.version).toBe(8);

    const imported = importProject(exported);
    expect(imported.id).not.toBe(project.id);
    expect(imported.graph.nodes[0].id).toBe(n1.id);
    expect(imported.graph.nodes[0].behavior).toEqual(n1.behavior);
    expect(imported.graph.workloads).toEqual(project.graph.workloads);
    expect(imported.graph.notes).toEqual(project.graph.notes);
    expect(imported.subsystems).toEqual(project.subsystems);
  });

  // 2. completed mixed source parallel storage calls + async broker through Simulation createSavedRun accepted
  it("Test 2: completed open simulation with storage arrivals > roots is accepted and roundtripped", () => {
    const graph = emptyOpenGraph();
    const src = makeOpenNode("traffic", 0, 0);
    const svc = makeOpenNode("service", 100, 0);
    const db1 = makeOpenNode("database", 200, -50);
    const db2 = makeOpenNode("database", 200, 50);
    const brk = makeOpenNode("queue", 300, 0);
    const wrk = makeOpenNode("worker", 400, 0);

    graph.nodes = [src, svc, db1, db2, brk, wrk];
    graph.edges = [
      { id: "e1", source: src.id, target: svc.id, transport: "call", latencyMs: 0, returnLatencyMs: 0, ackDelayMs: 0, messageTtlMs: 2000, weight: 1 },
      { id: "e2", source: svc.id, target: db1.id, transport: "call", latencyMs: 0, returnLatencyMs: 0, ackDelayMs: 0, messageTtlMs: 2000, weight: 1 },
      { id: "e3", source: svc.id, target: db2.id, transport: "call", latencyMs: 0, returnLatencyMs: 0, ackDelayMs: 0, messageTtlMs: 2000, weight: 1 },
      { id: "e4", source: svc.id, target: brk.id, transport: "message", latencyMs: 0, returnLatencyMs: 0, ackDelayMs: 0, messageTtlMs: 2000, weight: 1 },
      { id: "e5", source: brk.id, target: wrk.id, transport: "message", latencyMs: 0, returnLatencyMs: 0, ackDelayMs: 0, messageTtlMs: 2000, weight: 1 },
    ];
    graph.workloads = [defaultWorkload(src.id)];

    const metrics = buildValidOpenMetrics(graph);
    // Storage lookups = 100 on db1 + 100 on db2 = 200 > generated roots (100)
    expect(metrics.databaseLookups).toBeGreaterThan(metrics.generated);

    const run = createSavedRun({ id: "run-1", graph, metrics }, "Custom Run");
    expect(run.modelVersion).toBe("open-system/1");
    expect(validateSavedRun(run)).toEqual([]);

    const proj: Project = {
      ...newOpenProject("Saved Run Project"),
      graph,
      savedRuns: [run],
    };
    const exported = exportProject(proj);
    const imported = importProject(exported);
    expect(imported.savedRuns?.length).toBe(1);
    expect(imported.savedRuns![0].metrics.execution).toBeDefined();
  });

  // 3. corrupted root/message partition, missing node/edge, negative/NaN counters, malformed nested metrics, incomplete flag rejected without throw
  it("Test 3: corruptions are rejected safely without throwing", () => {
    const graph = emptyOpenGraph();
    const src = makeOpenNode("traffic", 0, 0);
    graph.nodes = [src];
    graph.workloads = [defaultWorkload(src.id)];

    const validMetrics = buildValidOpenMetrics(graph);

    // Corrupt root flow count conservation
    const badFlow = structuredClone(validMetrics);
    badFlow.execution!.roots.succeeded = 999;
    expect(validateSavedRun({ id: "r", name: "r", completedAt: 1000, graph, metrics: badFlow, modelVersion: "open-system/1", origin: "simulation" })).toContain(
      "Execution roots flow conservation violated."
    );

    // Incomplete flag
    const badIncomplete = structuredClone(validMetrics);
    (badIncomplete.execution as any).incomplete = true;
    expect(validateSavedRun({ id: "r", name: "r", completedAt: 1000, graph, metrics: badIncomplete, modelVersion: "open-system/1", origin: "simulation" })).toContain(
      "Only completed results with valid observed metrics can be saved."
    );

    // Missing node in execution metrics
    const badNodes = structuredClone(validMetrics);
    delete badNodes.execution!.nodes[src.id];
    expect(validateSavedRun({ id: "r", name: "r", completedAt: 1000, graph, metrics: badNodes, modelVersion: "open-system/1", origin: "simulation" })).toContain(
      "Saved component IDs do not match the experiment graph."
    );

    // Negative or NaN counter
    const badCounter = structuredClone(validMetrics);
    badCounter.execution!.nodes[src.id].arrived = -1;
    expect(validateSavedRun({ id: "r", name: "r", completedAt: 1000, graph, metrics: badCounter, modelVersion: "open-system/1", origin: "simulation" })).toContain(
      `Node ${src.id} measurement arrived must be a non-negative integer.`
    );
  });

  // 4. normalized same workload ignores moving/renaming/grouping/capacity but rejects entrypoint/class/keydistribution/timeout changes
  it("Test 4: sameGraphWorkload normalizes and ignores layout/capacity but catches workload differences", () => {
    const g1 = emptyOpenGraph();
    const s1 = makeOpenNode("traffic", 0, 0);
    g1.nodes = [s1];
    g1.workloads = [defaultWorkload(s1.id)];

    const g2 = structuredClone(g1);
    g2.nodes[0].position = { x: 500, y: 500 };
    g2.nodes[0].name = "Renamed Source";
    g2.nodes[0].behavior.capacity = 99999;
    expect(sameGraphWorkload(g1, g2)).toBe(true);

    // Change entrypoint
    const g3 = structuredClone(g1);
    g3.workloads![0].entryNodeId = "other-node";
    expect(sameGraphWorkload(g1, g3)).toBe(false);

    // Change timeout
    const g4 = structuredClone(g1);
    g4.workloads![0].timeoutMs = 9999;
    expect(sameGraphWorkload(g1, g4)).toBe(false);

    // Change key distribution
    const g5 = structuredClone(g1);
    g5.workloads![0].classes[0].keyDistribution.catalogSize = 25000;
    expect(sameGraphWorkload(g1, g5)).toBe(false);
  });

  // 5. legacy export remains 7 byte content unchanged; import 7 accepted legacy, mismatched 7 open / 8 legacy rejected
  it("Test 5: format version compatibility and cross-mismatch rejection", () => {
    const legacyProj = newProject("Legacy Project");
    const exp7 = exportProject(legacyProj);
    const parsed7 = JSON.parse(exp7);
    expect(parsed7.version).toBe(7);
    expect(parsed7.format).toBe("system-studio");

    const imported7 = importProject(exp7);
    expect(imported7.name).toContain("(imported)");

    // Mismatch 1: Version 7 containing open-system graph
    const forged7 = JSON.parse(exp7);
    forged7.project.graph.executionVersion = "open-system/1";
    expect(() => importProject(JSON.stringify(forged7))).toThrow(
      "Format version 7 cannot contain open-system execution graphs."
    );

    // Mismatch 2: Version 8 containing legacy graph
    const openProj = newOpenProject("Open Project");
    const exp8 = exportProject(openProj);
    const forged8 = JSON.parse(exp8);
    delete forged8.project.graph.executionVersion;
    expect(() => importProject(JSON.stringify(forged8))).toThrow(
      "Format version 8 requires an open-system execution graph."
    );
  });

  // 6. authored revision comparison reports workload/behavior changes and format 8 roundtrip preserves links
  it("Test 6: compareArchitectures reports workload and executionVersion differences", () => {
    const p1 = newOpenProject("Project v1");
    const s1 = makeOpenNode("traffic", 0, 0);
    p1.graph.nodes = [s1];
    p1.graph.workloads = [defaultWorkload(s1.id)];

    const p2 = structuredClone(p1);
    p2.graph.workloads![0].rate = 500;
    p2.graph.nodes[0].behavior!.capacity = 2500;

    const snap1: ArchitectureSnapshot = {
      graph: p1.graph,
      subsystems: [],
      expandedNodeIds: [],
    };
    const snap2: ArchitectureSnapshot = {
      graph: p2.graph,
      subsystems: [],
      expandedNodeIds: [],
    };

    const diffs = compareArchitectures(snap1, snap2);
    expect(diffs.some(d => d.includes("Workload definitions changed"))).toBe(true);
    expect(diffs.some(d => d.includes("Component changed: Traffic source"))).toBe(true);

    // Model changes check
    const modChanges = modelChanges(p1.graph, p2.graph);
    expect(modChanges).toContain("Traffic source capacity: 2000 → 2500 req/s.");

    // Comparison status check
    const r1 = createSavedRun({ id: "r1", graph: p1.graph, metrics: buildValidOpenMetrics(p1.graph) }, "Run 1");
    const r2 = createSavedRun({ id: "r2", graph: p2.graph, metrics: buildValidOpenMetrics(p2.graph) }, "Run 2");
    const status = comparisonStatus(r1, r2);
    expect(status.matched).toBe(false);
    expect(status.message).toContain("Different workloads.");
  });
});
