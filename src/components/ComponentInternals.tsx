import { JobInternals } from "./JobInternals";
import { ArrowDown, ArrowUpRight, CornerDownRight } from "lucide-react";
import { ServiceModelEditor } from "./ServiceModelEditor";
import { profileLabel } from "../domain/workload";
import { workerCount, type ModelNode, type Settings } from "../domain/model";
import type { Metrics, NodeMetrics } from "../simulation/engine";
import { observedCacheHitRate } from "../domain/cache-metrics";

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
  totals: Pick<
    Metrics,
    "generated" | "cacheHits" | "cacheMisses" | "arrivalRate" | "jobs"
  > | null;
  hasRun: boolean;
}) {
  if (["queue", "worker"].includes(node.kind))
    return (
      <JobInternals
        node={node}
        metrics={metrics}
        jobs={totals?.jobs}
        hasRun={hasRun}
      />
    );
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
  const workers = workerCount(node);
  const activeWorkers = metrics?.activeWorkers ?? (metrics?.busy ? 1 : 0);
  const queue = metrics?.queued ?? 0,
    occupancy = node.queueLimit ? queue / node.queueLimit : 0;
  return (
    <div
      className="component-internals"
      role="region"
      aria-label={`${node.name} internals`}
    >
      <div className="internal-heading">
        <span>
          {node.kind === "service" ? "Shared FIFO queue" : "FIFO waiting queue"}
        </span>
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
          ? node.kind === "service"
            ? "All workers busy + full queue → reject"
            : "Queue full → reject new arrivals"
          : node.kind === "service"
            ? "No waiting → reject when all workers busy"
            : "No waiting slots → reject when busy"}
      </p>
      <div className="internal-flow-arrow">
        <ArrowDown size={13} />
      </div>
      <div className="internal-processor">
        <div>
          <strong>
            {workers === 1
              ? "One processing slot"
              : `${workers} processing slots`}
          </strong>
          <span>
            {(1000 / node.capacity).toLocaleString(undefined, {
              maximumFractionDigits: 3,
            })}{" "}
            ms / request{node.kind === "service" ? " per worker" : ""}
          </span>
        </div>
        <span
          className={`processor-state ${hasRun && metrics?.busy ? "busy" : ""}`}
        >
          {hasRun
            ? workers > 1
              ? `${activeWorkers}/${workers} busy`
              : metrics?.busy
                ? "Busy"
                : "Idle"
            : "Ready"}
        </span>
      </div>
      {node.kind === "service" && workers > 1 && (
        <div
          className="worker-occupancy"
          role="meter"
          aria-label={`${node.name} worker occupancy`}
          aria-valuemin={0}
          aria-valuemax={workers}
          aria-valuenow={activeWorkers}
          aria-valuetext={
            hasRun
              ? `${activeWorkers} of ${workers} workers occupied (sampled)`
              : "Run to observe worker occupancy"
          }
        >
          {Array.from({ length: workers }, (_, i) => (
            <span
              key={i}
              className={hasRun && i < activeWorkers ? "occupied" : ""}
            />
          ))}
        </div>
      )}
      <p className="internal-caption">
        {hasRun
          ? `${((metrics?.utilization ?? 0) * 100).toFixed(1)}% worker utilization · state sampled`
          : "Run to observe processing"}
      </p>
      {node.kind === "cache" && (
        <div className="internal-routes">
          {node.cacheMode === "lru" ? <><div><ArrowUpRight size={12} /><span>Observed hits → response</span></div><div><CornerDownRight size={12} /><span>Observed misses → database</span></div><p>Finite cache decisions from this run</p></> : <><div><ArrowUpRight size={12} /><span>{node.hitRate}% hit → response</span></div><div><CornerDownRight size={12} /><span>{100 - node.hitRate}% miss → database</span></div><p>Configured probabilities</p></>}
        </div>
      )}
      {node.kind === "cache" && hasRun && <div className="internal-stat"><span>Observed hit rate</span><strong>{observedCacheHitRate({ cacheHits: totals?.cacheHits ?? 0, cacheMisses: totals?.cacheMisses ?? 0 }) === null ? "—" : `${observedCacheHitRate({ cacheHits: totals?.cacheHits ?? 0, cacheMisses: totals?.cacheMisses ?? 0 })!.toFixed(1)}%`}</strong></div>}
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
