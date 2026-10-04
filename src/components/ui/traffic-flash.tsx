import type { CycleOutcome } from "../../domain/studio/runner/types";

const colors: Record<CycleOutcome, string> = {
  ok: "green",
  failed: "risk-text",
  rejected: "clay",
  expired: "clay",
  "timed-out": "clay",
  lost: "risk-text",
  stuck: "purple",
};

/** SVG decoration driven entirely by recorded time, including its fade. */
export function TrafficFlash({
  kind,
  outcome,
  count,
  age,
  reduced,
}: {
  kind: "sent" | "arrived" | "outcome";
  outcome: CycleOutcome | null;
  count: number;
  age: number;
  reduced: boolean;
}) {
  const label = `${count} ${kind === "outcome" ? outcome : kind}`;
  const elapsed = Math.max(0, Math.min(1, age));
  return (
    <g
      data-testid="traffic-flash"
      data-kind={kind}
      data-outcome={outcome ?? undefined}
      data-count={count}
      data-age={age}
      data-reduced={reduced}
      role="img"
      aria-label={label}
      pointerEvents="none"
      opacity={reduced ? 1 : 1 - elapsed}
      style={{
        color: `var(--color-${outcome === null ? "primary" : colors[outcome]})`,
      }}
    >
      <title>{label}</title>
      <g
        fill="var(--color-background)"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {kind === "sent" ? (
          <circle r={reduced ? 7 : 4 + elapsed * 7} fill="none" />
        ) : kind === "arrived" ? (
          <path d="M-5 0 L-1 4 L6 -4" fill="none" />
        ) : (
          <>
            {outcome === "lost" ? (
              <path d="M0 -8 L8 0 L0 8 L-8 0 Z" strokeDasharray="2 2" />
            ) : outcome === "stuck" ? (
              <rect x={-7} y={-7} width={14} height={14} rx={2} />
            ) : (
              <circle r={8} />
            )}
            <path
              fill="none"
              d={
                outcome === "ok"
                  ? "M-4 0 L-1 3 L5 -4"
                  : outcome === "rejected"
                    ? "M-5 5 L5 -5"
                    : outcome === "expired"
                      ? "M-3 -4 H3 L-3 4 H3 Z"
                      : outcome === "timed-out"
                        ? "M0 -5 V0 L4 2"
                        : outcome === "stuck"
                          ? "M-4 0 H4"
                          : "M-3 -3 L3 3 M3 -3 L-3 3"
              }
            />
          </>
        )}
      </g>
      {count > 1 && (
        <text
          x={13}
          y={3}
          fill="currentColor"
          fontSize={10}
          fontFamily="monospace"
        >
          {count}
        </text>
      )}
    </g>
  );
}
