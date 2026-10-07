import * as React from "react";
import type { FlashAt, LegAt, NodeAt, PlaybackStore } from "../runs/playback";
import type { TrafficNodeActivity, TrafficConnectionActivity } from '@/components/traffic/cells-and-lanes';

type Traffic = {
  legs: ReadonlyMap<string, readonly LegAt[]>;
  nodes: ReadonlyMap<string, NodeAt>;
  connectionFlashes: ReadonlyMap<string, readonly FlashAt[]>;
  nodeFlashes: ReadonlyMap<string, readonly FlashAt[]>;
  reduced: boolean;
  hasRun: boolean;
  activities?: { nodes: ReadonlyMap<string, TrafficNodeActivity>; connections: ReadonlyMap<string, TrafficConnectionActivity> };
  progress?: number;
};
const EMPTY: Traffic = {
  legs: new Map(),
  nodes: new Map(),
  connectionFlashes: new Map(),
  nodeFlashes: new Map(),
  reduced: false,
  hasRun: false,
};
export const PlaybackTrafficContext = React.createContext<Traffic>(EMPTY);
export type PlaybackSource = { getPlayback(): PlaybackStore | null };

export function usePlaybackTraffic(
  source: PlaybackSource | null | undefined,
): Traffic {
  const [traffic, setTraffic] = React.useState(EMPTY);
  React.useEffect(() => {
    setTraffic(EMPTY);
    if (!source) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let hadStore = false;
    let lastStore: PlaybackStore | null = null;
    let lastAt = -Infinity;
    let lastVersion = -1;
    let lastReduced = media.matches;
    const read = () => {
      const store = source.getPlayback();
      if (store) {
        if (store === lastStore && store.playheadMs === lastAt && store.version === lastVersion && media.matches === lastReduced) {
          frame = requestAnimationFrame(read);
          return;
        }
        lastStore = store; lastAt = store.playheadMs; lastVersion = store.version; lastReduced = media.matches;
        setTraffic({
          // Retain the old provider shape for independently authored stories;
          // production consumes aggregates rather than allocating per-unit decorations.
          legs: EMPTY.legs,
          nodes: EMPTY.nodes,
          connectionFlashes: EMPTY.connectionFlashes,
          nodeFlashes: EMPTY.nodeFlashes,
          reduced: media.matches,
          hasRun: true,
          activities: store.trafficAt(store.playheadMs),
          progress: (store.playheadMs % 1000) / 1000,
        });
      } else if (hadStore) setTraffic(EMPTY);
      hadStore = Boolean(store);
      frame = requestAnimationFrame(read);
    };
    read();
    return () => cancelAnimationFrame(frame);
  }, [source]);
  return traffic;
}
