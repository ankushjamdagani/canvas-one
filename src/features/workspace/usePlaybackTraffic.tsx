import * as React from "react";
import type { LegAt, NodeAt, PlaybackStore } from "../runs/playback";

type Traffic = {
  legs: ReadonlyMap<string, readonly LegAt[]>;
  nodes: ReadonlyMap<string, NodeAt>;
  reduced: boolean;
  hasRun: boolean;
};
const EMPTY: Traffic = {
  legs: new Map(),
  nodes: new Map(),
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
    const read = () => {
      const store = source.getPlayback();
      if (store) {
        const state = store.stateAt(store.playheadMs);
        const legs = new Map<string, LegAt[]>();
        for (const leg of state.legs) {
          const list = legs.get(leg.connectionId);
          if (list) list.push(leg);
          else legs.set(leg.connectionId, [leg]);
        }
        setTraffic({
          legs,
          nodes: state.nodes,
          reduced: media.matches,
          hasRun: true,
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
