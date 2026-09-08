import { randomGenerator } from "./primitives";
import type { ModelNode } from "../domain/model";

/** Deterministic URL identity draw, independent of arrival scheduling. */
export function urlKey(seed: number, requestId: number, source: ModelNode): number {
  const draw = randomGenerator((seed ^ Math.imul(requestId, 2246822519)) >>> 0);
  const catalogSize = source.catalogSize ?? 1000;
  if ((source.popularity ?? "uniform") === "hot") {
    const hotCount = source.hotSubset ?? 10;
    const hotShare = (source.hotShare ?? 80) / 100;
    if (draw() < hotShare) return Math.floor(draw() * hotCount);
    return hotCount + Math.floor(draw() * (catalogSize - hotCount));
  }
  return Math.floor(draw() * catalogSize);
}
