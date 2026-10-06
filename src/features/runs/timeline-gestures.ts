export type TimeWindow = { startMs: number; endMs: number };
export type PlaybackRange = TimeWindow;

const durationOf = (window: TimeWindow) => window.endMs - window.startMs;

export function clampWindow(
  window: TimeWindow,
  bounds: TimeWindow,
  minimumSpanMs = 1,
): TimeWindow {
  const boundsSpan = Math.max(0, durationOf(bounds));
  const span = Math.min(boundsSpan, Math.max(minimumSpanMs, durationOf(window)));
  const startMs = Math.max(
    bounds.startMs,
    Math.min(bounds.endMs - span, window.startMs),
  );
  return { startMs, endMs: startMs + span };
}

export function timeAtPosition(
  clientX: number,
  left: number,
  width: number,
  window: TimeWindow,
): number {
  const ratio = width <= 0 ? 0 : Math.max(0, Math.min(1, (clientX - left) / width));
  return window.startMs + ratio * durationOf(window);
}

export function panWindow(
  window: TimeWindow,
  deltaPixels: number,
  widthPixels: number,
  bounds: TimeWindow,
): TimeWindow {
  if (widthPixels <= 0) return window;
  const shift = (-deltaPixels / widthPixels) * durationOf(window);
  return clampWindow(
    { startMs: window.startMs + shift, endMs: window.endMs + shift },
    bounds,
  );
}

/** factor > 1 zooms in; the time under anchorTime stays at the same position. */
export function zoomWindow(
  window: TimeWindow,
  anchorTime: number,
  factor: number,
  bounds: TimeWindow,
  minimumSpanMs = 1,
): TimeWindow {
  if (!Number.isFinite(factor) || factor <= 0) return window;
  const oldSpan = durationOf(window);
  const anchorRatio = oldSpan <= 0 ? 0.5 : (anchorTime - window.startMs) / oldSpan;
  const newSpan = Math.max(minimumSpanMs, oldSpan / factor);
  return clampWindow(
    {
      startMs: anchorTime - anchorRatio * newSpan,
      endMs: anchorTime + (1 - anchorRatio) * newSpan,
    },
    bounds,
    minimumSpanMs,
  );
}

export function rangeFromDrag(
  anchorMs: number,
  currentMs: number,
  bounds: TimeWindow,
  minimumSpanMs = 1,
): PlaybackRange {
  let startMs = Math.max(bounds.startMs, Math.min(anchorMs, currentMs));
  let endMs = Math.min(bounds.endMs, Math.max(anchorMs, currentMs));
  if (endMs - startMs < minimumSpanMs) {
    if (startMs + minimumSpanMs <= bounds.endMs) endMs = startMs + minimumSpanMs;
    else startMs = Math.max(bounds.startMs, endMs - minimumSpanMs);
  }
  return { startMs, endMs };
}

export function moveRangeEndpoint(
  range: PlaybackRange,
  endpoint: "start" | "end",
  timeMs: number,
  bounds: TimeWindow,
  minimumSpanMs = 1,
): PlaybackRange {
  if (endpoint === "start") {
    return {
      startMs: Math.max(bounds.startMs, Math.min(timeMs, range.endMs - minimumSpanMs)),
      endMs: range.endMs,
    };
  }
  return {
    startMs: range.startMs,
    endMs: Math.min(bounds.endMs, Math.max(timeMs, range.startMs + minimumSpanMs)),
  };
}
