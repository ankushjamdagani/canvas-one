/** Renderer-neutral activity projections; hosts own presentation and clocks. */
export type TrafficOutcomeKind = 'success' | 'error' | 'rejected' | 'timeout' | 'expired' | 'cancelled' | 'retryExhausted' | 'redeliveryExhausted' | 'lost' | 'late';

/** Supply rates over the trailing ten simulation seconds, independent of zoom. */
export interface TrafficOutcome { kind: TrafficOutcomeKind; rate: number; detail?: string }

export interface TrafficNodeActivity {
  queued: number; processing: number; capacity: number; awaiting: number; retry: number;
  retryIn?: string; services?: { name: string; pending: number }[];
  noProgress?: { count: number; service: string; age: string }; outcomes?: TrafficOutcome[];
}

export interface TrafficConnectionActivity {
  forward: number; returning: number; asynchronous?: boolean; blocked?: number; errors?: number; late?: number;
  loss?: boolean; exhausted?: boolean; outcomes?: TrafficOutcome[];
}
