import { useEffect, useState } from "react";
import { workerCount, totalCapacity, type ModelNode } from "../domain/model";
import { useEditor } from "../state/editor";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
type Field = {
  key:
    | "capacity"
    | "workers"
    | "failureRate"
    | "maxRetries"
    | "retryDelayMs"
    | "queueLimit";
  label: string;
  min: number;
  max: number;
  fallback: number;
  integer?: boolean;
};
const queueFields: Field[] = [
  {
    key: "queueLimit",
    label: "Waiting slots",
    min: 0,
    max: 10000,
    fallback: 500,
    integer: true,
  },
];
const workerFields: Field[] = [
  {
    key: "capacity",
    label: "Per worker · jobs/s",
    min: 1,
    max: 100000,
    fallback: 100,
  },
  {
    key: "workers",
    label: "Workers",
    min: 1,
    max: 16,
    fallback: 1,
    integer: true,
  },
  {
    key: "failureRate",
    label: "Failure · %/attempt",
    min: 0,
    max: 100,
    fallback: 0,
  },
  {
    key: "maxRetries",
    label: "Max retries",
    min: 0,
    max: 5,
    fallback: 2,
    integer: true,
  },
  {
    key: "retryDelayMs",
    label: "Retry delay · ms",
    min: 0,
    max: 10000,
    fallback: 100,
  },
];
export function JobControls({ node }: { node: ModelNode }) {
  const fields = node.kind === "queue" ? queueFields : workerFields;
  const values = Object.fromEntries(
    fields.map((f) => [f.key, String(node[f.key] ?? f.fallback)]),
  );
  const signature = JSON.stringify(values);
  const [draft, setDraft] = useState(values);
  useEffect(() => setDraft(values), [signature, node.id]);
  const dirty = fields.some((f) => draft[f.key] !== values[f.key]);
  const editor = useEditor();
  return (
    <form
      className="job-controls nodrag nopan nowheel"
      aria-label={`${node.name} configuration`}
      onFocus={() => editor.select(node.id)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          setDraft(values);
        }
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (
          fields.some(
            (f) =>
              !draft[f.key] ||
              !Number.isFinite(Number(draft[f.key])) ||
              Number(draft[f.key]) < f.min ||
              Number(draft[f.key]) > f.max ||
              (f.integer && !Number.isInteger(Number(draft[f.key]))),
          )
        )
          return;
        if (dirty)
          editor.updateNode(
            node.id,
            Object.fromEntries(
              fields.map((f) => [f.key, Number(draft[f.key])]),
            ),
          );
      }}
    >
      <div className="internal-edit-fields">
        {fields.map((f) => (
          <label key={f.key}>
            <span>{f.label}</span>
            <Input
              aria-label={`${node.name} ${f.label}`}
              type="number"
              min={f.min}
              max={f.max}
              step={f.integer ? 1 : "any"}
              required
              value={draft[f.key] ?? ""}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      {node.kind === "worker" && (
        <p className="internal-caption">
          {workerCount(node)} × {node.capacity} = {totalCapacity(node)} jobs/s
          total · applied
        </p>
      )}
      <div className="internal-edit-actions">
        <Button type="submit" disabled={!dirty} size="sm">
          Apply job settings
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!dirty}
          onClick={() => setDraft(values)}
        >
          Cancel
        </Button>
      </div>
      <p className="internal-caption">
        Apply resets the run. Undo restores settings.
      </p>
    </form>
  );
}
