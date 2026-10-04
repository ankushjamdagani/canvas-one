/** Occupancy is exact; bar length compresses an unbounded queue without implying a capacity. */
export function NodeOccupancy({
  queued,
  active,
}: {
  queued: number;
  active: number;
}) {
  if (queued === 0 && active === 0) return null;
  return (
    <div
      data-testid="node-occupancy"
      data-queued={queued}
      data-active={active}
      aria-label={`${queued} queued, ${active} active`}
      className="flex h-7 items-center gap-2 border border-control-border bg-panel px-2.5 font-mono text-[10px] text-secondary-text"
    >
      <div className="min-w-0 flex-1">
        <span>{queued} queued</span>
        <div className="mt-0.5 h-1 bg-sunken" aria-hidden="true">
          <div
            className="h-full bg-primary"
            style={{ width: `${(100 * queued) / (queued + 6)}%` }}
          />
        </div>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1">
        <span
          aria-hidden="true"
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-primary px-1 text-primary"
        >
          {active}
        </span>{" "}
        active
      </span>
    </div>
  );
}
