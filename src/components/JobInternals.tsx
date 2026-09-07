import type { JobMetrics, NodeMetrics } from "../domain/metrics";
import { workerCount, type ModelNode } from "../domain/model";
import { JobControls } from "./JobControls";
export function JobInternals({
  node,
  metrics: m,
  jobs,
  hasRun,
}: {
  node: ModelNode;
  metrics?: NodeMetrics;
  jobs?: JobMetrics;
  hasRun: boolean;
}) {
  const queue = node.kind === "queue",
    count = workerCount(node),
    occupied = queue ? (m?.queued ?? 0) : (m?.activeWorkers ?? 0),
    limit = queue ? node.queueLimit : count;
  return (
    <div
      className="component-internals"
      role="region"
      aria-label={`${node.name} internals`}
    >
      <div className="internal-heading">
        <span>
          {queue ? "Shared FIFO waiting" : `${count} processing slots`}
        </span>
        <strong>
          {hasRun ? occupied : "—"}
          <small> / {limit}</small>
        </strong>
      </div>
      <div
        className={queue ? "queue-occupancy" : "worker-occupancy"}
        role="meter"
        aria-label={`${node.name} occupancy`}
        aria-valuemin={0}
        aria-valuemax={Math.max(1, limit)}
        aria-valuenow={occupied}
      >
        {Array.from({ length: queue ? 10 : count }, (_, i) => (
          <span
            key={i}
            className={
              hasRun &&
              (queue ? occupied / Math.max(1, limit) > i / 10 : i < occupied)
                ? queue
                  ? "filled"
                  : "occupied"
                : ""
            }
          />
        ))}
      </div>
      <p className="internal-caption">
        {queue
          ? "Admission acknowledged after 8 ms. Full queue + busy workers → reject."
          : `${(1000 / node.capacity).toFixed(2)} ms/attempt per worker · ${((m?.utilization ?? 0) * 100).toFixed(1)}% utilization`}
      </p>
      <div className="internal-stat">
        <span>
          {queue ? "Accepted / acknowledged" : "Attempts / retries scheduled"}
        </span>
        <strong>
          {hasRun
            ? queue
              ? `${jobs?.accepted} / ${jobs?.acknowledged}`
              : `${jobs?.attempts} / ${jobs?.retries}`
            : "—"}
        </strong>
      </div>
      <div className="internal-stat">
        <span>{queue ? "Enqueue rejects" : "Permanent job failures"}</span>
        <strong>{hasRun ? (queue ? m?.rejected : jobs?.failed) : "—"}</strong>
      </div>
      <p className="internal-caption">
        {queue
          ? "Acknowledgement means admitted, not completed."
          : "Failures retry after backoff. Expired active work keeps its slot."}
      </p>
      <JobControls node={node} />
    </div>
  );
}
