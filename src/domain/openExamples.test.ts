import { describe, it, expect } from "vitest";
import { openExamples, openExample } from "./openExamples";
import { compileExecution } from "./execution";
import { OpenSimulation } from "../simulation/open/kernel";

describe("openExamples catalog", () => {
  it("exports all 9 examples with unique ids and valid kinds", () => {
    expect(openExamples).toHaveLength(9);
    const ids = new Set(openExamples.map((e) => e.id));
    expect(ids.size).toBe(9);

    const starters = openExamples.filter((e) => e.kind === "starter");
    const tutorials = openExamples.filter((e) => e.kind === "tutorial");
    expect(starters).toHaveLength(3);
    expect(tutorials).toHaveLength(6);

    for (const ex of openExamples) {
      expect(ex.title.trim().length).toBeGreaterThan(0);
      expect(ex.purpose.trim().length).toBeGreaterThan(0);
      expect(ex.steps.length).toBeGreaterThan(0);
      expect(openExample(ex.id)).toBe(ex);
    }
  });

  it("sets guideId ONLY on tutorial examples", () => {
    for (const ex of openExamples) {
      const g = ex.create();
      if (ex.kind === "tutorial") {
        expect(g.guideId).toBe(ex.id);
      } else {
        expect(g.guideId).toBeUndefined();
      }
    }
  });

  it("produces fresh, independent IDs on each create call", () => {
    for (const ex of openExamples) {
      const g1 = ex.create();
      const g2 = ex.create();

      const nodeIds1 = new Set(g1.nodes.map((n) => n.id));
      const nodeIds2 = new Set(g2.nodes.map((n) => n.id));
      for (const id of nodeIds1) {
        expect(nodeIds2.has(id)).toBe(false);
      }

      const edgeIds1 = new Set(g1.edges.map((e) => e.id));
      const edgeIds2 = new Set(g2.edges.map((e) => e.id));
      for (const id of edgeIds1) {
        expect(edgeIds2.has(id)).toBe(false);
      }

      if (g1.workloads && g2.workloads) {
        const wlIds1 = new Set(g1.workloads.map((w) => w.id));
        const wlIds2 = new Set(g2.workloads.map((w) => w.id));
        for (const id of wlIds1) {
          expect(wlIds2.has(id)).toBe(false);
        }
        const classIds1 = new Set(g1.workloads.flatMap((w) => w.classes.map((c) => c.id)));
        const classIds2 = new Set(g2.workloads.flatMap((w) => w.classes.map((c) => c.id)));
        for (const id of classIds1) {
          expect(classIds2.has(id)).toBe(false);
        }
      }
    }
  });

  it("compiles each example cleanly without compileExecution errors", () => {
    for (const ex of openExamples) {
      const graph = ex.create();
      const { plan, issues } = compileExecution(graph, true);
      const errors = issues.filter((i) => i.severity === "error");
      expect(errors, `Errors in ${ex.id}: ${JSON.stringify(errors)}`).toHaveLength(0);
      expect(plan).toBeDefined();
    }
  });

  it("runs every example to horizon without incomplete operations and exact root/message partition", () => {
    for (const ex of openExamples) {
      const graph = ex.create();
      const { plan } = compileExecution(graph, true);
      expect(plan).toBeDefined();

      const duration = graph.settings.duration ?? 2;
      const sim = new OpenSimulation(plan!.graph);
      const snap = sim.advance(duration);

      // Roots exact partition: generated === succeeded + rejected + failed + expired + inFlight
      const roots = snap.roots;
      expect(roots.generated).toBe(
        roots.succeeded + roots.rejected + roots.failed + roots.expired + roots.inFlight,
      );
      expect(roots.generated).toBeGreaterThan(0);

      // Messages exact partition: generated === succeeded + rejected + failed + expired + inFlight
      const msgs = snap.messages;
      expect(msgs.generated).toBe(
        msgs.succeeded + msgs.rejected + msgs.failed + msgs.expired + msgs.inFlight,
      );
    }
  });
});
