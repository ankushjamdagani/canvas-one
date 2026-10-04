/**
 * Live traffic on the canvas: while a run is going, each request that is admitted at (or rejected by) a node's
 * in-port sends a dot along the connection that enters that port. The dots come from the run's trace events,
 * so they follow the paced clock (a run at Instant speed finishes before any dot is drawn).
 */

import * as React from 'react';
import type { Connection, Id } from '../../domain/studio/model';
import type { TraceEvent } from '../../domain/studio/runner/types';

export type TrafficPulse = {
  readonly key: string;
  /** `ok` for a request admitted at the target; `refused` for one it turned away or that failed. */
  readonly tone: 'ok' | 'refused';
  readonly startedAt: number;
};

export const PULSE_TRAVEL_MS = 700;
const PULSE_LIFETIME_MS = PULSE_TRAVEL_MS + 150;
const MAX_NEW_PULSES_PER_UPDATE = 24;
const MAX_PULSES_PER_CONNECTION = 4;

const EMPTY: ReadonlyMap<Id, readonly TrafficPulse[]> = new Map();

export const TrafficPulseContext = React.createContext<ReadonlyMap<Id, readonly TrafficPulse[]>>(EMPTY);

/** The pulses to draw, per connection id, for the events recorded so far. */
export function useTrafficPulses(
  events: readonly TraceEvent[] | undefined,
  connections: readonly Connection[] | undefined,
): ReadonlyMap<Id, readonly TrafficPulse[]> {
  const [pulses, setPulses] = React.useState<ReadonlyMap<Id, readonly TrafficPulse[]>>(EMPTY);
  const processed = React.useRef(0);
  const elementOfEvent = React.useRef(new Map<string, Id>());

  React.useEffect(() => {
    const list = events ?? [];
    if (list.length < processed.current) {
      // A new run replaced the trace.
      processed.current = 0;
      elementOfEvent.current.clear();
      setPulses(EMPTY);
    }
    if (list.length === processed.current) return;
    const fresh = list.slice(processed.current);
    processed.current = list.length;
    for (const event of fresh) elementOfEvent.current.set(event.id, event.elementId);
    if (!connections || connections.length === 0) return;

    const now = performance.now();
    const born: Array<[Id, TrafficPulse]> = [];
    for (const event of fresh) {
      if (born.length >= MAX_NEW_PULSES_PER_UPDATE) break;
      const admitted = event.kind === 'dispatch' && event.code === 'admitted';
      const refused =
        event.kind === 'settled' && (event.outcome === 'rejected' || event.outcome === 'failed' || event.outcome === 'expired');
      if ((!admitted && !refused) || !event.portId) continue;
      const callerId = event.parentId ? elementOfEvent.current.get(event.parentId) : undefined;
      const entering = connections.filter(
        (c) => c.target.elementId === event.elementId && c.target.portId === event.portId,
      );
      // With several callers on one port, follow the one that sent this request when the trace says which.
      const fromCaller = callerId ? entering.filter((c) => c.source.elementId === callerId) : [];
      for (const connection of fromCaller.length > 0 ? fromCaller : entering) {
        born.push([connection.id, { key: event.id, tone: admitted ? 'ok' : 'refused', startedAt: now }]);
      }
    }
    if (born.length === 0) return;

    setPulses((previous) => {
      const next = new Map(previous);
      for (const [connectionId, pulse] of born) {
        const current = next.get(connectionId) ?? [];
        next.set(connectionId, [...current, pulse].slice(-MAX_PULSES_PER_CONNECTION));
      }
      return next;
    });
  }, [events, connections]);

  const hasPulses = pulses.size > 0;
  React.useEffect(() => {
    if (!hasPulses) return;
    const timer = window.setInterval(() => {
      const cutoff = performance.now() - PULSE_LIFETIME_MS;
      setPulses((previous) => {
        const next = new Map<Id, readonly TrafficPulse[]>();
        for (const [connectionId, list] of previous) {
          const alive = list.filter((p) => p.startedAt > cutoff);
          if (alive.length > 0) next.set(connectionId, alive);
        }
        return next.size === previous.size && [...next].every(([id, list]) => previous.get(id)?.length === list.length)
          ? previous
          : next;
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [hasPulses]);

  return pulses;
}
