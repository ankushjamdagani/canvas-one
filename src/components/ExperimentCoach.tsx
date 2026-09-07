import { experiments, observations } from "../domain/experiments";
import { isJobGraph, type Project } from "../domain/model";
import type { Metrics } from "../domain/metrics";
export function ExperimentCoach({
  project,
  metrics,
}: {
  project: Project;
  metrics: Metrics | null;
}) {
  const experiment = experiments.find(
    (item) => item.id === project.activeExperiment,
  );
  if (!experiment) return null;
  const jobGuide =
    experiment.id === "burst-jobs" || experiment.id === "retry-budget";
  if (jobGuide !== isJobGraph(project.graph)) return null;
  return (
    <section className="experiment-coach" aria-label="Experiment guide">
      <h3>{experiment.title}</h3>
      <p>{experiment.question}</p>
      <ol>
        {experiment.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <details open={!!metrics?.finished}>
        <summary>Observed in this run</summary>
        <ul>
          {observations(project.graph, metrics).map((finding) => (
            <li key={finding}>{finding}</li>
          ))}
        </ul>
      </details>
      <p className="small muted">
        Save each completed run to compare with identical traffic. Loading
        another guide changes the model; Undo restores it.
      </p>
    </section>
  );
}
