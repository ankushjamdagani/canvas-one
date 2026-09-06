import { ArrowDown, ArrowUpRight, CornerDownRight } from "lucide-react";
import { ServiceModelEditor } from "./ServiceModelEditor";
import { profileLabel } from "../domain/workload";
import type { ModelNode, Settings } from "../domain/model";
import type { Metrics, NodeMetrics } from "../simulation/engine";

export function ComponentInternals({
  node,
  settings,
  metrics,
  totals,
  hasRun,
}: {
  node: ModelNode;
  settings: Settings;
  metrics?: NodeMetrics;
  totals: Pick<Metrics, "generated" | "cacheHits" | "arrivalRate"> | null;
  hasRun: boolean;
}) {
  if (node.kind === "traffic")
    return (
      <div
        className="component-internals"
        role="region"
        aria-label={`${node.name} internals`}
      >
        <div className="internal-heading">Arrival generator</div>
        <div className="internal-generator">
          <strong>
            {(totals?.arrivalRate ?? settings.traffic).toLocaleString(
              undefined,
              { maximumFractionDigits: 0 },
            )}
            <small> req/s expected now</small>
          </strong>
          <span>Poisson arrivals · seed {settings.seed}</span>
        </div>
        <p className="internal-caption">{profileLabel(settings)}</p>
        <div className="internal-stat">
          <span>Generated so far</span>
          <strong>{hasRun ? totals?.generated.toLocaleString() : "—"}</strong>
        </div>
        <div className="internal-model-note">Same model · view only</div>
      </div>
    );
  const queue = metrics?.queued ?? 0,
    occupancy = node.queueLimit ? queue / node.queueLimit : 0;
  return (
    <div
      className="component-internals"
      role="region"
      aria-label={`${node.name} internals`}
    >
      <div className="internal-heading">
        <span>FIFO waiting queue</span>
        <strong>
          {hasRun ? queue : "—"}
          <small> / {node.queueLimit}</small>
        </strong>
      </div>
      <div
        className="queue-occupancy"
        role="meter"
        aria-label={`${node.name} queue occupancy`}
        aria-valuenow={queue}
        aria-valuemin={0}
        aria-valuemax={Math.max(1, node.queueLimit)}
        aria-valuetext={
          hasRun
            ? `${queue} of ${node.queueLimit} waiting slots occupied`
            : "Run to observe queue occupancy"
        }
      >
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={occupancy > i / 10 ? "filled" : ""} />
        ))}
      </div>
      <p className="internal-caption">
        {node.queueLimit
          ? "Queue full → reject new arrivals"
          : "No waiting slots → reject when busy"}
      </p>
      <div className="internal-flow-arrow">
        <ArrowDown size={13} />
      </div>
      <div className="internal-processor">
        <div>
          <strong>One processing slot</strong>
          <span>
            {(1000 / node.capacity).toLocaleString(undefined, {
              maximumFractionDigits: 3,
            })}{" "}
            ms / request
          </span>
        </div>
        <span
          className={`processor-state ${hasRun && metrics?.busy ? "busy" : ""}`}
        >
          {hasRun ? (metrics?.busy ? "Busy" : "Idle") : "Ready"}
        </span>
      </div>
      <p className="internal-caption">
        {hasRun
          ? `${((metrics?.utilization ?? 0) * 100).toFixed(1)}% busy time · state sampled`
          : "Run to observe processing"}
      </p>
      {node.kind === "cache" && (
        <div className="internal-routes">
          <div>
            <ArrowUpRight size={12} />
            <span>{node.hitRate}% hit → response</span>
          </div>
          <div>
            <CornerDownRight size={12} />
            <span>{100 - node.hitRate}% miss → database</span>
          </div>
          <p>Configured probabilities</p>
        </div>
      )}
      <div className="internal-stat">
        <span>
          {node.kind === "cache" ? "Observed hits" : "Processed here"}
        </span>
        <strong>
          {hasRun
            ? (node.kind === "cache"
                ? totals?.cacheHits
                : metrics?.completed
              )?.toLocaleString()
            : "—"}
        </strong>
      </div>
      <div className="internal-stat">
        <span>Rejected here</span>
        <strong>{hasRun ? metrics?.rejected.toLocaleString() : "—"}</strong>
      </div>
      {node.kind === "service" ? (
        <ServiceModelEditor node={node} />
      ) : (
        <div className="internal-model-note">Same model · view only</div>
      )}
    </div>
  );
}
