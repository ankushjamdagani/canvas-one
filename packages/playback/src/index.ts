/** Generic timeframe operations. No renderer, recording or simulation dependency. */
export * from './timeline.js';
export * from './traffic.js';
export * from './controller.js';
export type TimeRange = { readonly startMs: number; readonly endMs: number };

export type TimeBounds = {
  readonly availableMs: number;
  readonly startMs: number;
  readonly endMs: number | null;
};

export type PlaybackProvenance =
  | { readonly kind: 'authored'; readonly description: string }
  | { readonly kind: 'example'; readonly description: string }
  | { readonly kind: 'recorded'; readonly recordingId: string };

/** Invalid input leaves the current playhead intact; seeking never manufactures time. */
export function seekTime(currentMs: number, requestedMs: number, bounds: TimeBounds): number {
  if (Number.isNaN(requestedMs)) return currentMs;
  return Math.max(bounds.startMs, Math.min(requestedMs, bounds.availableMs, bounds.endMs ?? Infinity));
}

/** Forward-only advancement, bounded by the available timeframe and optional range. */
export function advanceTime(currentMs: number, elapsedMs: number, speed: number,
  bounds: TimeBounds, rangeEndMs: number | null = null): number {
  const limit = Math.min(bounds.availableMs, bounds.endMs ?? Infinity, rangeEndMs ?? Infinity);
  return Math.max(currentMs, Math.min(currentMs + elapsedMs * speed, limit));
}

/** A range shorter than one millisecond is empty; invalid ranges cannot replace a selection. */
export function normalizeRange(range: TimeRange, bounds: TimeBounds): TimeRange | null | undefined {
  if (!Number.isFinite(range.startMs) || !Number.isFinite(range.endMs)) return undefined;
  const limit = Math.min(bounds.availableMs, bounds.endMs ?? Infinity);
  const startMs = Math.max(bounds.startMs, Math.min(range.startMs, limit));
  const endMs = Math.max(bounds.startMs, Math.min(range.endMs, limit));
  return endMs - startMs >= 1 ? { startMs, endMs } : null;
}
