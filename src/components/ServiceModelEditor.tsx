import { useEffect, useState } from "react";
import {
  MAX_SERVICE_WORKERS,
  workerCount,
  type ModelNode,
} from "../domain/model";
import { useEditor } from "../state/editor";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ServiceModelEditor({ node }: { node: ModelNode }) {
  const updateNode = useEditor((state) => state.updateNode);
  const select = useEditor((state) => state.select);
  const [capacity, setCapacity] = useState(String(node.capacity));
  const [workers, setWorkers] = useState(String(workerCount(node)));
  const [queue, setQueue] = useState(String(node.queueLimit));
  const resetDraft = () => {
    setCapacity(String(node.capacity));
    setWorkers(String(workerCount(node)));
    setQueue(String(node.queueLimit));
  };
  useEffect(resetDraft, [
    node.id,
    node.capacity,
    node.queueLimit,
    node.workers,
  ]);
  const dirty =
    capacity !== String(node.capacity) ||
    queue !== String(node.queueLimit) ||
    workers !== String(workerCount(node));
  return (
    <form
      className="service-model-editor nodrag nopan nowheel"
      aria-label={`${node.name} model settings`}
      onClick={(event) => event.stopPropagation()}
      onFocus={() => select(node.id)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          resetDraft();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const nextCapacity = Number(capacity),
          nextQueue = Number(queue),
          nextWorkers = Number(workers);
        if (
          !workers ||
          !Number.isInteger(nextWorkers) ||
          nextWorkers < 1 ||
          nextWorkers > MAX_SERVICE_WORKERS ||
          !capacity ||
          !queue ||
          !Number.isFinite(nextCapacity) ||
          nextCapacity < 1 ||
          nextCapacity > 100000 ||
          !Number.isInteger(nextQueue) ||
          nextQueue < 0 ||
          nextQueue > 10000
        )
          return;
        if (
          nextCapacity !== node.capacity ||
          nextQueue !== node.queueLimit ||
          nextWorkers !== workerCount(node)
        )
          updateNode(node.id, {
            capacity: nextCapacity,
            workers: nextWorkers,
            queueLimit: nextQueue,
          });
        setCapacity(String(nextCapacity));
        setWorkers(String(nextWorkers));
        setQueue(String(nextQueue));
      }}
    >
      <div className="internal-edit-fields">
        <label>
          <span>Per worker · req/s</span>
          <Input
            aria-label="Service processing capacity"
            type="number"
            min={1}
            max={100000}
            step="any"
            required
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
          />
        </label>
        <label>
          <span>Queue · slots</span>
          <Input
            aria-label="Service queue limit"
            type="number"
            min={0}
            max={10000}
            step={1}
            required
            value={queue}
            onChange={(event) => setQueue(event.target.value)}
          />
        </label>
      </div>
      <label className="worker-count-field">
        <span>Workers</span>
        <Input
          aria-label="Service worker count"
          type="number"
          min={1}
          max={MAX_SERVICE_WORKERS}
          step={1}
          required
          value={workers}
          onChange={(event) => setWorkers(event.target.value)}
        />
      </label>
      <p className="internal-caption">
        {workerCount(node)} × {node.capacity.toLocaleString()} ={" "}
        {(workerCount(node) * node.capacity).toLocaleString()} req/s total ·
        applied model
      </p>
      <div className="internal-edit-actions">
        <Button type="submit" disabled={!dirty} size="sm">
          Apply changes
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!dirty}
          onClick={resetDraft}
        >
          Cancel
        </Button>
      </div>
      <p className="internal-caption">
        Applying resets the run. Undo restores settings.
      </p>
    </form>
  );
}
