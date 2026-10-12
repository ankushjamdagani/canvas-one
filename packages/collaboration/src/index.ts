export type CollaborationParticipant = {
  readonly id: string; readonly displayName: string; readonly authenticated: boolean;
  readonly role: 'viewer' | 'editor' | 'owner' | 'agent';
};
export type CollaborationScope = { readonly projectId: string; readonly branchId: string };
export type Presence = {
  readonly participantId: string; readonly pageId?: string;
  readonly selection: readonly string[];
  readonly cursor?: { readonly x: number; readonly y: number };
};
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
export type CollaborationCapabilities = {
  readonly presence: boolean; readonly documentUpdates: boolean;
  readonly concurrency: 'none' | 'compare-and-swap' | 'conflict-resolution';
  readonly offline: boolean;
};
export type CollaborationUpdate<Change> = {
  readonly operationId: string; readonly scope: CollaborationScope;
  readonly expectedRevision: number; readonly participant: CollaborationParticipant;
  readonly changes: readonly Change[];
};
export type CollaborationEvent<Change> =
  | { readonly type: 'status'; readonly status: ConnectionStatus }
  | { readonly type: 'participants'; readonly participants: readonly CollaborationParticipant[] }
  | { readonly type: 'presence'; readonly presence: readonly Presence[] }
  | { readonly type: 'update'; readonly update: CollaborationUpdate<Change> };
/** Document ingress stays separate from storage. Hosts validate permissions, revisions and transactions. */
export type CollaborationProvider<Change> = {
  readonly capabilities: CollaborationCapabilities;
  readonly connect: (scope: CollaborationScope) => Promise<void>;
  readonly disconnect: () => void;
  readonly subscribe: (listener: (event: CollaborationEvent<Change>) => void) => () => void;
  readonly publishPresence: (presence: Presence) => void;
  readonly publishUpdate: (update: CollaborationUpdate<Change>) => Promise<
    { readonly status: 'sent' } | { readonly status: 'unsupported' | 'disconnected' | 'conflict'; readonly message: string }>;
  readonly dispose: () => void;
};

/** Explicit local provider for host composition; does not claim multiplayer synchronization. */
export function createLocalCollaborationProvider<Change>(): CollaborationProvider<Change> {
  let connected = false;
  let disposed = false;
  const listeners = new Set<(event: CollaborationEvent<Change>) => void>();
  const emit = (event: CollaborationEvent<Change>) => { for (const listener of listeners) { try { listener(event); } catch { /* isolate host observers */ } } };
  return {
    capabilities: { presence: false, documentUpdates: false, concurrency: 'none', offline: false },
    async connect() { if (disposed) throw new Error('Collaboration provider is disposed'); connected = true; emit({ type: 'status', status: 'connected' }); },
    disconnect() { connected = false; emit({ type: 'status', status: 'disconnected' }); },
    subscribe(listener) { if (disposed) throw new Error('Collaboration provider is disposed'); listeners.add(listener); return () => listeners.delete(listener); },
    publishPresence() {},
    async publishUpdate() { return { status: connected ? 'unsupported' : 'disconnected', message: 'Hosted document synchronization is not configured' }; },
    dispose() { connected = false; disposed = true; listeners.clear(); },
  };
}
