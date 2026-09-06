import type { Settings } from "../domain/model";
import { rateAt } from "../domain/workload";

export function WorkloadChart({
  settings: s,
  time,
}: {
  settings: Settings;
  time?: number;
}) {
  const p = s.profile;
  const points =
    p?.kind === "burst"
      ? [
          [0, s.traffic],
          [p.start, s.traffic],
          [p.start, p.peakRate],
          [p.end, p.peakRate],
          [p.end, s.traffic],
          [s.duration, s.traffic],
        ]
      : [
          [0, s.traffic],
          [s.duration, rateAt(s, s.duration)],
        ];
  const max = Math.max(1, ...points.map((p) => p[1]));
  return (
    <div className="workload-chart">
      <svg
        viewBox="0 0 240 72"
        preserveAspectRatio="none"
        role="img"
        aria-label="Configured incoming traffic over time"
      >
        <line x1="0" y1="61" x2="240" y2="61" stroke="#dce5dd" />
        <polyline
          fill="none"
          stroke="#087f84"
          strokeWidth="2"
          points={points
            .map(([t, r]) => `${(t / s.duration) * 240},${61 - (r / max) * 52}`)
            .join(" ")}
        />
        {time !== undefined && (
          <line
            x1={(time / s.duration) * 240}
            x2={(time / s.duration) * 240}
            y1="0"
            y2="62"
            stroke="#6b8273"
            strokeDasharray="3 3"
          />
        )}
      </svg>
      <div>
        <span>0s</span>
        <span>Peak {max.toLocaleString()} req/s · configured</span>
        <span>{s.duration}s</span>
      </div>
    </div>
  );
}
