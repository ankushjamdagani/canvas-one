import { useEffect, useState } from "react";
import type { ModelNode } from "../domain/model";
import { useEditor } from "../state/editor";

export function ServiceModelEditor({ node }: { node: ModelNode }) {
  const updateNode = useEditor((state) => state.updateNode);
  const select = useEditor((state) => state.select);
  const [capacity, setCapacity] = useState(String(node.capacity));
  const [queue, setQueue] = useState(String(node.queueLimit));
  const resetDraft = () => {
    setCapacity(String(node.capacity));
    setQueue(String(node.queueLimit));
  };
  useEffect(resetDraft, [node.id, node.capacity, node.queueLimit]);
  const dirty =
    capacity !== String(node.capacity) || queue !== String(node.queueLimit);
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
          nextQueue = Number(queue);
        if (
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
        if (nextCapacity !== node.capacity || nextQueue !== node.queueLimit)
          updateNode(node.id, {
            capacity: nextCapacity,
            queueLimit: nextQueue,
          });
        setCapacity(String(nextCapacity));
        setQueue(String(nextQueue));
      }}
    >
      <div className="internal-edit-fields">
        <label>
          <span>Capacity · req/s</span>
          <input
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
          <input
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
      <div className="internal-edit-actions">
        <button type="submit" disabled={!dirty}>
          Apply changes
        </button>
        <button type="button" disabled={!dirty} onClick={resetDraft}>
          Cancel
        </button>
      </div>
      <p className="internal-caption">
        Applying resets the run. Undo restores settings.
      </p>
    </form>
  );
}
