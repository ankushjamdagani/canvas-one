import { useEditor } from "../state/editor";
import { profileLabel, type TrafficProfile } from "../domain/workload";
import { NumberField } from "./NumberField";
import { WorkloadChart } from "./WorkloadChart";

export function WorkloadControls() {
  const { project, settings: update } = useEditor(),
    s = project.graph.settings,
    p = s.profile,
    kind = p?.kind ?? "steady";
  const choose = (kind: TrafficProfile["kind"]) =>
    update({
      profile:
        kind === "steady"
          ? { kind }
          : kind === "ramp"
            ? { kind, endRate: 700 }
            : {
                kind,
                peakRate: 700,
                start: Number((s.duration / 3).toFixed(1)),
                end: Number(((s.duration * 2) / 3).toFixed(1)),
              },
    });
  return (
    <div className="workload-controls">
      <fieldset className="workload-selector">
        <legend>Traffic pattern</legend>
        <div>
          {(["steady", "burst", "ramp"] as const).map((k) => (
            <button
              type="button"
              key={k}
              aria-pressed={kind === k}
              onClick={() => choose(k)}
            >
              {k === "steady" ? "Steady" : k === "burst" ? "Burst" : "Ramp"}
            </button>
          ))}
        </div>
      </fieldset>
      <WorkloadChart settings={s} />
      <p className="workload-description">{profileLabel(s)}</p>
      <NumberField
        label={
          kind === "steady"
            ? "Incoming traffic"
            : kind === "burst"
              ? "Baseline traffic"
              : "Starting traffic"
        }
        value={s.traffic}
        min={1}
        max={10000}
        unit="req/s"
        onChange={(traffic) => update({ traffic })}
      />
      {p?.kind === "burst" && (
        <>
          <NumberField
            label="Burst traffic"
            value={p.peakRate}
            min={1}
            max={10000}
            unit="req/s"
            onChange={(peakRate) => update({ profile: { ...p, peakRate } })}
          />
          <div className="workload-times">
            <NumberField
              label="Burst starts"
              value={p.start}
              min={0}
              max={p.end - 0.1}
              step={0.1}
              unit="s"
              onChange={(start) => update({ profile: { ...p, start } })}
            />
            <NumberField
              label="Burst ends"
              value={p.end}
              min={p.start + 0.1}
              max={s.duration}
              step={0.1}
              unit="s"
              onChange={(end) => update({ profile: { ...p, end } })}
            />
          </div>
        </>
      )}
      {p?.kind === "ramp" && (
        <NumberField
          label="Ending traffic"
          value={p.endRate}
          min={1}
          max={10000}
          unit="req/s"
          onChange={(endRate) => update({ profile: { ...p, endRate } })}
        />
      )}
      <p className="workload-help">
        {kind === "burst"
          ? "Watch how the queue responds during the burst and after traffic returns."
          : kind === "ramp"
            ? "Traffic changes linearly over the run. Find where the system stops keeping up."
            : "A fixed average rate with naturally irregular arrivals."}
      </p>
    </div>
  );
}
