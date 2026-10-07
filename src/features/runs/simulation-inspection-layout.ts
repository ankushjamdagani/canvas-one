import type { Cycle, FlowRecord } from "../../domain/studio/runner/types";

/** Start-time bins preserve counts and classify only recorded terminal outcomes. */
export function requestStartBins(
  cycles: readonly Cycle[],
  start: number,
  end: number,
  count: number,
) {
  const bins = Array.from({ length: count }, () => ({
    succeeded: 0,
    failed: 0,
    open: 0,
  }));
  for (const cycle of cycles) {
    if (cycle.startedAtMs < start || cycle.startedAtMs > end) continue;
    const index = Math.min(
      count - 1,
      Math.floor(
        ((cycle.startedAtMs - start) / Math.max(1, end - start)) * count,
      ),
    );
    const bin = bins[Math.max(0, index)];
    if (cycle.outcome === null) bin.open++;
    else if (cycle.outcome === "ok") bin.succeeded++;
    else bin.failed++;
  }
  return bins;
}

/** Match facts in retained order, including distinct attempts at the same timestamp. */
export function recordedProcessingIntervals(events: readonly FlowRecord[]) {
  return events
    .flatMap((event, index) =>
      event.phase === "processing" ? [{ event, index }] : [],
    )
    .map(({ event, index }) => ({
      event,
      stop: events
        .slice(index + 1)
        .find(
          (next) =>
            next.key === event.key &&
            next.attempt === event.attempt &&
            next.atMs >= event.atMs &&
            ["settled", "released", "slot_released"].includes(next.phase),
        ),
    }));
}

export function intervalPosition(
  start: number,
  stop: number | undefined,
  origin: number,
  duration: number,
) {
  const left = Math.min(
    100,
    Math.max(0, ((start - origin) / Math.max(1, duration)) * 100),
  );
  const width =
    stop === undefined
      ? 0
      : Math.min(
          100 - left,
          Math.max(0, ((stop - start) / Math.max(1, duration)) * 100),
        );
  return { left, width };
}
/** Processing facts use one-based attempt numbers from the kernel. */
export function processingAttemptLabel(attempt: number | undefined) {
  return attempt !== undefined && attempt > 1 ? ` · try ${attempt}` : "";
}
