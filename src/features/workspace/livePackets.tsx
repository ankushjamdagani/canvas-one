/**
 * Live traffic on the canvas. While a run goes, every request or message the worker reports (`FlowRecord`) is a
 * packet on its connection that moves through visible stages: sent, on the way, received, queued, processing,
 * then done / rejected / failed, and for a call the response on its way back and delivered. Stages follow the
 * worker's reports in order, each shown for a minimum time so a fast run is still readable.
 */

import * as React from 'react';
import type { Id } from '../../domain/studio/model';
import type { FlowRecord } from '../../domain/studio/runner/types';

export type PacketStage =
  | 'sent'
  | 'transit'
  | 'received'
  | 'queued'
  | 'processing'
  | 'done'
  | 'rejected'
  | 'failed'
  | 'lost'
  | 'returning'
  | 'delivered';

export type Packet = {
  readonly key: string;
  readonly stage: PacketStage;
  /** performance.now() when the current stage began. */
  readonly stageStartedAt: number;
};

export const STAGE_LABEL: Record<PacketStage, string> = {
  sent: 'sent',
  transit: 'on the way',
  received: 'received',
  queued: 'queued',
  processing: 'processing',
  done: 'done',
  rejected: 'rejected',
  failed: 'failed',
  lost: 'lost',
  returning: 'response',
  delivered: 'delivered',
};

/** How long each stage stays on screen at least. */
export const STAGE_MIN_MS: Record<PacketStage, number> = {
  sent: 300,
  transit: 700,
  received: 400,
  queued: 400,
  processing: 450,
  done: 600,
  rejected: 1200,
  failed: 1200,
  lost: 1200,
  returning: 700,
  delivered: 500,
};

/** A stage nothing follows on its own: once its time is up the packet is removed. */
const ENDING: ReadonlySet<PacketStage> = new Set(['done', 'rejected', 'failed', 'lost', 'delivered']);

const MAX_PACKETS_PER_CONNECTION = 2;
const MAX_PACKETS = 80;
const MAX_PENDING_STAGES = 3;
const TICK_MS = 60;

type Tracked = { key: string; connectionId: Id; stage: PacketStage; stageStartedAt: number; pending: PacketStage[]; born: number };

/** The stages a worker report adds to its packet. */
export function stagesFor(record: FlowRecord): PacketStage[] {
  switch (record.phase) {
    case 'sent':
      return record.arriveAtMs === null ? ['sent', 'transit', 'lost'] : ['sent', 'transit'];
    case 'received':
      return ['received'];
    case 'queued':
      return ['queued'];
    case 'processing':
      return ['processing'];
    case 'settled':
      return [record.outcome === 'succeeded' ? 'done' : record.outcome === 'rejected' ? 'rejected' : 'failed'];
    case 'response':
      return ['returning', 'delivered'];
  }
}

export const PacketContext = React.createContext<ReadonlyMap<Id, readonly Packet[]>>(new Map());

const NONE: ReadonlyMap<Id, readonly Packet[]> = new Map();

export function useLivePackets(
  source: { subscribeFlow(listener: (runId: string, records: readonly FlowRecord[], ended: boolean) => void): () => void } | null | undefined,
): ReadonlyMap<Id, readonly Packet[]> {
  const [snapshot, setSnapshot] = React.useState<ReadonlyMap<Id, readonly Packet[]>>(NONE);
  const tracked = React.useRef(new Map<string, Tracked>());
  const runId = React.useRef<string | null>(null);
  const dirty = React.useRef(false);

  React.useEffect(() => {
    if (!source) return;
    const unsubscribe = source.subscribeFlow((id, records, ended) => {
      if (runId.current !== id) {
        runId.current = id;
        tracked.current.clear();
        dirty.current = true;
      }
      if (ended) {
        // The run is over: packets still waiting for a report that will never come go; finished ones fade out.
        for (const packet of tracked.current.values()) if (!ENDING.has(packet.stage)) tracked.current.delete(packet.key);
        dirty.current = true;
        return;
      }
      const now = performance.now();
      for (const record of records) {
        let packet = tracked.current.get(record.key);
        if (!packet) {
          if (record.phase !== 'sent') continue;
          // A busy connection shows a sample: new requests are skipped while its packets are all still in view.
          let onConnection = 0;
          for (const other of tracked.current.values()) if (other.connectionId === record.connectionId) onConnection++;
          if (onConnection >= MAX_PACKETS_PER_CONNECTION || tracked.current.size >= MAX_PACKETS) continue;
          packet = { key: record.key, connectionId: record.connectionId, stage: 'sent', stageStartedAt: now, pending: [], born: now };
          tracked.current.set(record.key, packet);
          packet.pending.push(...stagesFor(record).slice(1));
        } else {
          packet.pending.push(...stagesFor(record));
        }
        // A packet that falls behind jumps to its latest stages instead of replaying them all.
        if (packet.pending.length > MAX_PENDING_STAGES) packet.pending.splice(0, packet.pending.length - MAX_PENDING_STAGES);
      }
      dirty.current = true;
    });
    const timer = window.setInterval(() => {
      const now = performance.now();
      for (const packet of tracked.current.values()) {
        if (now - packet.stageStartedAt < STAGE_MIN_MS[packet.stage]) continue;
        const next = packet.pending.shift();
        if (next) {
          packet.stage = next;
          packet.stageStartedAt = now;
          dirty.current = true;
        } else if (ENDING.has(packet.stage)) {
          tracked.current.delete(packet.key);
          dirty.current = true;
        }
      }
      if (!dirty.current) return;
      dirty.current = false;
      const next = new Map<Id, Packet[]>();
      for (const packet of tracked.current.values()) {
        const list = next.get(packet.connectionId) ?? [];
        list.push({ key: packet.key, stage: packet.stage, stageStartedAt: packet.stageStartedAt });
        next.set(packet.connectionId, list);
      }
      setSnapshot(next.size === 0 ? NONE : next);
    }, TICK_MS);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
      tracked.current.clear();
      runId.current = null;
      setSnapshot(NONE);
    };
  }, [source]);

  return snapshot;
}
