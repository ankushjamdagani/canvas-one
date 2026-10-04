import * as React from "react";
import type { FlashAt, LegAt, NodeAt, PlaybackStore } from "../runs/playback";

type Traffic = {
  legs: ReadonlyMap<string, readonly LegAt[]>;
  nodes: ReadonlyMap<string, NodeAt>;
  connectionFlashes: ReadonlyMap<string, readonly FlashAt[]>;
  nodeFlashes: ReadonlyMap<string, readonly FlashAt[]>;
  reduced: boolean;
  hasRun: boolean;
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
        const connectionFlashes = new Map<string, FlashAt[]>();
        const nodeFlashes = new Map<string, FlashAt[]>();
        for (const flash of state.flashes) {
          const map =
            flash.connectionId === null ? nodeFlashes : connectionFlashes;
          const id = flash.connectionId ?? flash.elementId;
          if (id === null) continue;
          const list = map.get(id);
          if (list) list.push(flash);
          else map.set(id, [flash]);
        }
        setTraffic({
          legs,
          nodes: state.nodes,
          connectionFlashes,
          nodeFlashes,
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
