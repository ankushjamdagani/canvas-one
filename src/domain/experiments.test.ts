import { expect, it } from "vitest";
import { experiments, observations } from "./experiments";
import { clone, newProject, validateGraph } from "./model";
import { Simulation } from "../simulation/engine";
import { useEditor } from "../state/editor";
import { exportProject, importProject } from "../persistence/projects";
it("every guided starter is executable and its suggested comparison has meaningful effects", () => {
  for (const experiment of experiments)
    expect(validateGraph(experiment.build())).toEqual([]);
  const pool = experiments.find((e) => e.id === "worker-scaling")!.build();
  const one = new Simulation(pool).advance(30);
  const four = clone(pool);
  four.nodes[1].workers = 4;
  const scaled = new Simulation(four).advance(30);
  expect(scaled.generated).toBe(one.generated);
  expect(scaled.succeeded).toBeGreaterThan(one.succeeded * 2);
  const retry = experiments.find((e) => e.id === "retry-budget")!.build();
  const none = new Simulation(retry).advance(30);
  retry.nodes[2].maxRetries = 2;
  const retried = new Simulation(retry).advance(30);
  expect(retried.generated).toBe(none.generated);
  expect(retried.jobs!.attempts).toBeGreaterThan(none.jobs!.attempts);
  expect(retried.jobs!.failed).toBeLessThan(none.jobs!.failed);
  expect(observations(retry, retried).join()).toContain(
    "confirm admission, not completion",
  );
});
it("guide selection follows model undo and portable checkpoints without changing measurements", () => {
  useEditor.getState().load(newProject());
  useEditor.getState().loadExperiment("worker-scaling");
  const graph = useEditor.getState().project.graph;
  expect(graph.guideId).toBe("worker-scaling");
  useEditor.getState().checkpoint("Pool lesson");
  useEditor.getState().loadExperiment("retry-budget");
  useEditor.getState().undo();
  expect(useEditor.getState().project.graph).toEqual(graph);
  const restored = importProject(exportProject(useEditor.getState().project));
  expect(restored.graph.guideId).toBe("worker-scaling");
  expect(restored.checkpoints[0].graph.guideId).toBe("worker-scaling");
  const withoutGuide = clone(graph);
  delete withoutGuide.guideId;
  expect(new Simulation(graph).advance(30)).toEqual(
    new Simulation(withoutGuide).advance(30),
  );
});
