import { createContext } from "react";
export type SimulationHighlight = {
  readonly connectionId: string | null;
  readonly elementIds: ReadonlySet<string>;
};
/** Recorded-event presentation stays separate from guarded authoring selection. */
export const SimulationHighlightContext =
  createContext<SimulationHighlight | null>(null);
