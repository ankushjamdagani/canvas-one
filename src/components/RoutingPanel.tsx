import { useEditor } from "../state/editor";
import { MAX_SERVICE_INSTANCES, serviceInstances } from "../domain/routing";
import { totalCapacity, workerCount } from "../domain/model";
import type { Metrics } from "../domain/metrics";
import { Button } from "@/components/ui/button";

export function RoutingPanel({ metrics }: { metrics: Metrics | null }) {
  const editor = useEditor(), instances = serviceInstances(editor.project.graph);
  return <section className="routing-panel nodrag nopan" aria-label="Service instance routing">
    <h3>Round robin</h3>
    <p>Each arrival takes the next instance in this order. Full queues reject; there is no retry or reroute. Routing is instantaneous, with no balancer queue or capacity limit.</p>
    <ol className="routing-list">
      {instances.map((node) => {
        const m = metrics?.nodes[node.id];
        return <li key={node.id}>
          <button onClick={() => editor.select(node.id)}>{node.name}</button>
          <span>{workerCount(node)} workers · {totalCapacity(node).toLocaleString()} req/s total</span>
          <span>{metrics?.time ? `${m?.arrived.toLocaleString() ?? 0} routed · ${m?.queued ?? 0} waiting · ${((m?.utilization ?? 0) * 100).toFixed(0)}% busy` : `Expected share: ${(100 / instances.length).toFixed(1)}%`}</span>
          {!!metrics?.time && <span>{m?.rejected.toLocaleString() ?? 0} rejected here</span>}
        </li>;
      })}
    </ol>
    <Button
      size="sm"
      variant="outline"
      className="suggestion w-full justify-center text-xs mt-2"
      disabled={instances.length >= MAX_SERVICE_INSTANCES || !instances.length}
      onClick={editor.addServiceInstance}
    >
      Add service instance
    </Button>
    <p>Up to 8 instances. A new instance copies the first instance’s settings. Each owns a worker pool and FIFO queue; all share the downstream cache/database.</p>
  </section>;
}
