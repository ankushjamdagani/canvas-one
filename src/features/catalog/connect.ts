/**
 * Connection Planning Compiler (RV-06a).
 *
 * Implements specifications from:
 * - specs/revamp/contracts/catalog.md (§4 Connection defaults per kind, Approved resolutions 5, 8, 11)
 * - specs/revamp/contracts/model-and-runner.md (§2 Records, §3 Payload schemas, §4 Behaviors)
 * - specs/revamp/decisions.md (D36, D42)
 */

import type {
  CallConnection,
  Connection,
  DataConnection,
  Document,
  Element,
  Endpoint,
  Id,
  MessageConnection,
  Port,
  ResourceCallMetadata,
  View,
} from '../../domain/studio/model';
import { shapesCompatible } from '../../domain/studio/readiness';
import type { Issue } from '../../domain/studio/validate';
import type { RecordChange } from '../../persistence/studio/types';

export type PlanConnectionParams = {
  readonly document: Document;
  readonly viewId: Id;
  readonly source: Endpoint;
  readonly target: Endpoint | { readonly elementId: Id };
  readonly mintId: () => Id;
};

export type ConnectionDraft = {
  readonly document: Document;
  readonly viewId: Id;
  readonly connectionId: Id;
  readonly source: Endpoint;
  readonly target: Endpoint;
  readonly kind: 'call' | 'message';
  readonly sourceElementReplacement?: Element;
};

export type ResourceMetadataInput = {
  readonly requestClassId: Id;
  readonly operation: 'read' | 'write';
  readonly deadlineDurationMs: number;
  readonly key?: string | null;
  readonly tags?: readonly string[];
};

export type PlanConnectionResult =
  | {
      readonly kind: 'ready';
      readonly changes: readonly RecordChange[];
      readonly connectionId: Id;
    }
  | {
      readonly kind: 'needs-resource-metadata';
      readonly draft: ConnectionDraft;
    }
  | {
      readonly kind: 'rejected';
      readonly issues: readonly Issue[];
    };

export type CompleteConnectionResult =
  | {
      readonly ok: true;
      readonly kind: 'ready';
      readonly changes: readonly RecordChange[];
      readonly connectionId: Id;
    }
  | {
      readonly ok: false;
      readonly kind: 'rejected';
      readonly issues: readonly Issue[];
    };

function createIssue(
  code: string,
  message: string,
  path: readonly (string | number)[],
  entityId: Id | null = null,
): Issue {
  return {
    code: code as any,
    message,
    path,
    entityId,
    severity: 'error',
  };
}

/**
 * Checks whether adding a directed 'call' edge from sourceElementId to targetElementId
 * would close a synchronous call cycle (model-and-runner.md §2).
 */
function wouldCreateSyncCallCycle(
  connections: readonly Connection[],
  sourceElementId: Id,
  targetElementId: Id,
): boolean {
  if (sourceElementId === targetElementId) {
    return true; // Self-loop is an immediate cycle
  }

  // Build adjacency list for existing 'call' connections
  const callAdj = new Map<Id, Id[]>();
  for (const c of connections) {
    if (c.kind !== 'call') continue;
    const list = callAdj.get(c.source.elementId) ?? [];
    list.push(c.target.elementId);
    callAdj.set(c.source.elementId, list);
  }

  // Check if targetElementId can reach sourceElementId
  const visited = new Set<Id>();
  const queue: Id[] = [targetElementId];
  visited.add(targetElementId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === sourceElementId) {
      return true;
    }
    const neighbors = callAdj.get(current) ?? [];
    for (const next of neighbors) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  return false;
}

/**
 * Plans a connection from an outbound source endpoint to an inbound target endpoint or element.
 */
export function planConnection(params: PlanConnectionParams): PlanConnectionResult {
  const { document, viewId, source, target, mintId } = params;

  if (!mintId || typeof mintId !== 'function') {
    return {
      kind: 'rejected',
      issues: [createIssue('missing-property', 'mintId is required and must be a function', ['mintId'])],
    };
  }

  const view = document.views.find((v) => v.id === viewId);
  if (!view) {
    return {
      kind: 'rejected',
      issues: [createIssue('dangling-reference', `View '${viewId}' does not exist in document`, ['viewId'])],
    };
  }

  const sourceElement = document.elements.find((e) => e.id === source.elementId);
  if (!sourceElement) {
    return {
      kind: 'rejected',
      issues: [createIssue('dangling-reference', `Source element '${source.elementId}' does not exist`, ['source', 'elementId'])],
    };
  }

  const sourcePort = sourceElement.ports.find((p) => p.id === source.portId);
  if (!sourcePort) {
    return {
      kind: 'rejected',
      issues: [createIssue('dangling-reference', `Source port '${source.portId}' does not exist on element '${source.elementId}'`, ['source', 'portId'])],
    };
  }

  const targetElementId = 'elementId' in target ? target.elementId : null;
  const targetElement = document.elements.find((e) => e.id === targetElementId);
  if (!targetElement) {
    return {
      kind: 'rejected',
      issues: [createIssue('dangling-reference', `Target element '${targetElementId}' does not exist`, ['target', 'elementId'])],
    };
  }

  // Resolve target port
  let targetPort: Port | undefined;
  if ('portId' in target) {
    targetPort = targetElement.ports.find((p) => p.id === target.portId);
    if (!targetPort) {
      return {
        kind: 'rejected',
        issues: [createIssue('dangling-reference', `Target port '${target.portId}' does not exist on element '${targetElement.id}'`, ['target', 'portId'])],
      };
    }
  } else {
    // Target is an element; resolve to its entry port or matching inbound port
    if (targetElement.behavior.kind === 'resource') {
      const entryPortId = targetElement.behavior.entryPortId;
      targetPort = targetElement.ports.find((p) => p.id === entryPortId);
    }
    if (!targetPort) {
      const inPorts = targetElement.ports.filter((p) => p.direction === 'in');
      targetPort = inPorts.find((p) => p.channel === sourcePort.channel) ?? inPorts[0];
    }
    if (!targetPort) {
      return {
        kind: 'rejected',
        issues: [createIssue('structural-rule', `Target element '${targetElement.id}' has no connectable inbound ports`, ['target'])],
      };
    }
  }

  // Contract §4: Event ports are never connectable
  if (sourcePort.channel === 'event') {
    return {
      kind: 'rejected',
      issues: [createIssue('structural-rule', 'Event ports cannot be connected via behavioral edges', ['source', 'channel'])],
    };
  }
  if (targetPort.channel === 'event') {
    return {
      kind: 'rejected',
      issues: [createIssue('structural-rule', 'Event ports cannot be connected via behavioral edges', ['target', 'channel'])],
    };
  }

  // Direction checks
  if (sourcePort.direction !== 'out') {
    return {
      kind: 'rejected',
      issues: [createIssue('structural-rule', `Source port must be an outbound port, got '${sourcePort.direction}'`, ['source', 'direction'])],
    };
  }
  if (targetPort.direction !== 'in') {
    return {
      kind: 'rejected',
      issues: [createIssue('structural-rule', `Target port must be an inbound port, got '${targetPort.direction}'`, ['target', 'direction'])],
    };
  }

  // Resolution 11: router/broker route additions
  // When the source is a router/broker out port that already has a connection,
  // add a new out port on the source element with the channel the target accepts.
  const hasExistingOutgoing = document.connections.some(
    (c) => c.source.elementId === source.elementId && c.source.portId === source.portId,
  );
  const isRouterOrBroker =
    sourceElement.behavior.kind === 'resource' &&
    ['router', 'broker'].includes((sourceElement.behavior.config as any).type);

  let effectiveSourcePort: Port = sourcePort;
  let sourceElementReplacement: Element | undefined = undefined;
  const newSourcePortChanges: RecordChange[] = [];

  if (isRouterOrBroker && hasExistingOutgoing) {
    const newPortId = mintId();
    const acceptedChannel = targetPort.channel;
    const newPort: Port = {
      id: newPortId,
      label: 'out',
      direction: 'out',
      channel: acceptedChannel,
      schemaId: targetPort.schemaId,
      responseSchemaId: acceptedChannel === 'call' ? targetPort.responseSchemaId : null,
    };

    sourceElementReplacement = {
      ...sourceElement,
      ports: [...sourceElement.ports, newPort],
    };

    newSourcePortChanges.push({
      kind: 'replace',
      value: { recordKind: 'element', record: sourceElementReplacement },
    });

    effectiveSourcePort = newPort;
  }

  // Channel match
  if (effectiveSourcePort.channel !== targetPort.channel) {
    return {
      kind: 'rejected',
      issues: [
        createIssue(
          'structural-rule',
          `Channel mismatch: source port is '${effectiveSourcePort.channel}' but target port is '${targetPort.channel}'`,
          ['channel'],
        ),
      ],
    };
  }

  const connectionKind = effectiveSourcePort.channel as 'call' | 'message' | 'data';

  // Shapes compatibility
  const sourceSchema = document.schemas.find((s) => s.id === effectiveSourcePort.schemaId);
  const targetSchema = document.schemas.find((s) => s.id === targetPort.schemaId);
  if (!sourceSchema || !targetSchema) {
    return {
      kind: 'rejected',
      issues: [createIssue('dangling-reference', 'Port payload schema not found in document', ['schemaId'])],
    };
  }

  if (!shapesCompatible(sourceSchema.shape, targetSchema.shape)) {
    return {
      kind: 'rejected',
      issues: [
        createIssue(
          'structural-rule',
          `Incompatible payload shapes between source port '${effectiveSourcePort.id}' and target port '${targetPort.id}'`,
          ['shape'],
        ),
      ],
    };
  }

  // Call response schema compatibility
  if (connectionKind === 'call') {
    if (!effectiveSourcePort.responseSchemaId) {
      return {
        kind: 'rejected',
        issues: [
          createIssue(
            'structural-rule',
            `Call source port '${effectiveSourcePort.id}' is missing a response schema`,
            ['source', 'responseSchemaId'],
          ),
        ],
      };
    }
    if (!targetPort.responseSchemaId) {
      return {
        kind: 'rejected',
        issues: [
          createIssue(
            'structural-rule',
            `Call target port '${targetPort.id}' is missing a response schema`,
            ['target', 'responseSchemaId'],
          ),
        ],
      };
    }

    const sourceRespSchema = document.schemas.find((s) => s.id === effectiveSourcePort.responseSchemaId);
    const targetRespSchema = document.schemas.find((s) => s.id === targetPort.responseSchemaId);
    if (!sourceRespSchema || !targetRespSchema) {
      return {
        kind: 'rejected',
        issues: [createIssue('dangling-reference', 'Call response schema not found in document', ['responseSchemaId'])],
      };
    }

    if (!shapesCompatible(sourceRespSchema.shape, targetRespSchema.shape)) {
      return {
        kind: 'rejected',
        issues: [
          createIssue(
            'structural-rule',
            `Incompatible response shapes between call source port '${effectiveSourcePort.id}' and target port '${targetPort.id}'`,
            ['responseShape'],
          ),
        ],
      };
    }
  }

  // Duplicate pair rejection
  const isDuplicate = document.connections.some(
    (c) =>
      c.kind === connectionKind &&
      c.source.elementId === source.elementId &&
      c.source.portId === effectiveSourcePort.id &&
      c.target.elementId === targetElement.id &&
      c.target.portId === targetPort.id,
  );
  if (isDuplicate) {
    return {
      kind: 'rejected',
      issues: [
        createIssue(
          'structural-rule',
          `Duplicate connection between source port '${effectiveSourcePort.id}' and target port '${targetPort.id}'`,
          ['duplicate'],
        ),
      ],
    };
  }

  // Synchronous call cycle rejection (§2)
  if (connectionKind === 'call') {
    if (wouldCreateSyncCallCycle(document.connections, source.elementId, targetElement.id)) {
      return {
        kind: 'rejected',
        issues: [
          createIssue(
            'structural-rule',
            `Adding synchronous call connection from element '${source.elementId}' to '${targetElement.id}' would create a synchronous call cycle`,
            ['sync-call-cycle'],
          ),
        ],
      };
    }
  }

  const connectionId = mintId();
  const sourceEndpoint: Endpoint = { elementId: source.elementId, portId: effectiveSourcePort.id };
  const targetEndpoint: Endpoint = { elementId: targetElement.id, portId: targetPort.id };

  // Resolution 8: Connecting into a resource element requires interactive metadata
  if (targetElement.behavior.kind === 'resource') {
    const draft: ConnectionDraft = {
      document,
      viewId,
      connectionId,
      source: sourceEndpoint,
      target: targetEndpoint,
      kind: connectionKind as 'call' | 'message',
      sourceElementReplacement,
    };
    return {
      kind: 'needs-resource-metadata',
      draft,
    };
  }

  // Target is non-resource: ready immediately with defaults and resource: null
  let connection: Connection;
  if (connectionKind === 'data') {
    const dataConnection: DataConnection = {
      id: connectionId,
      label: connectionKind,
      kind: 'data',
      source: sourceEndpoint,
      target: targetEndpoint,
      config: {},
    };
    connection = dataConnection;
  } else if (connectionKind === 'call') {
    const callConnection: CallConnection = {
      id: connectionId,
      label: connectionKind,
      kind: 'call',
      source: sourceEndpoint,
      target: targetEndpoint,
      config: {
        latencyMs: 0, // assumption (catalog.md)
        returnLatencyMs: 0, // assumption (catalog.md)
        weight: 1, // assumption (catalog.md)
        condition: null,
        fallback: false,
        resource: null,
      },
    };
    connection = callConnection;
  } else {
    // message
    const messageConnection: MessageConnection = {
      id: connectionId,
      label: connectionKind,
      kind: 'message',
      source: sourceEndpoint,
      target: targetEndpoint,
      config: {
        latencyMs: 0, // assumption (catalog.md)
        ackDelayMs: 0, // assumption (catalog.md, resolution 5)
        messageTtlMs: 10000, // assumption (catalog.md, resolution 5)
        weight: 1, // assumption (catalog.md)
        condition: null,
        fallback: false,
        resource: null,
      },
    };
    connection = messageConnection;
  }

  const updatedView: View = {
    ...view,
    connectionIds: [...view.connectionIds, connectionId],
  };

  const changes: RecordChange[] = [
    ...newSourcePortChanges,
    { kind: 'insert', value: { recordKind: 'connection', record: connection } },
    { kind: 'replace', value: { recordKind: 'view', record: updatedView } },
  ];

  return {
    kind: 'ready',
    changes,
    connectionId,
  };
}

/**
 * Completes a connection into a resource element once resource call metadata is provided.
 */
export function completeConnection(
  draft: ConnectionDraft,
  metadata: ResourceMetadataInput,
): CompleteConnectionResult {
  if (!metadata || typeof metadata !== 'object') {
    return {
      ok: false,
      kind: 'rejected',
      issues: [createIssue('missing-property', 'Resource metadata is required', ['metadata'])],
    };
  }

  if (typeof metadata.requestClassId !== 'string' || metadata.requestClassId.trim().length === 0) {
    return {
      ok: false,
      kind: 'rejected',
      issues: [createIssue('missing-property', 'requestClassId is required', ['metadata', 'requestClassId'])],
    };
  }

  if (metadata.operation !== 'read' && metadata.operation !== 'write') {
    return {
      ok: false,
      kind: 'rejected',
      issues: [createIssue('invalid-literal', "operation must be 'read' or 'write'", ['metadata', 'operation'])],
    };
  }

  if (
    typeof metadata.deadlineDurationMs !== 'number' ||
    !Number.isFinite(metadata.deadlineDurationMs) ||
    metadata.deadlineDurationMs <= 0 ||
    metadata.deadlineDurationMs > 600000
  ) {
    return {
      ok: false,
      kind: 'rejected',
      issues: [
        createIssue(
          'out-of-range',
          'deadlineDurationMs must be a positive number up to 600,000 ms',
          ['metadata', 'deadlineDurationMs'],
        ),
      ],
    };
  }

  const resourceCallMetadata: ResourceCallMetadata = {
    requestClassId: metadata.requestClassId,
    operation: metadata.operation,
    key: metadata.key ?? null,
    tags: metadata.tags ?? [],
    deadlineDurationMs: metadata.deadlineDurationMs,
  };

  let connection: Connection;
  if (draft.kind === 'call') {
    const callConn: CallConnection = {
      id: draft.connectionId,
      label: draft.kind,
      kind: 'call',
      source: draft.source,
      target: draft.target,
      config: {
        latencyMs: 0, // assumption (catalog.md)
        returnLatencyMs: 0, // assumption (catalog.md)
        weight: 1, // assumption (catalog.md)
        condition: null,
        fallback: false,
        resource: resourceCallMetadata,
      },
    };
    connection = callConn;
  } else {
    const msgConn: MessageConnection = {
      id: draft.connectionId,
      label: draft.kind,
      kind: 'message',
      source: draft.source,
      target: draft.target,
      config: {
        latencyMs: 0, // assumption (catalog.md)
        ackDelayMs: 0, // assumption (catalog.md, resolution 5)
        messageTtlMs: 10000, // assumption (catalog.md, resolution 5)
        weight: 1, // assumption (catalog.md)
        condition: null,
        fallback: false,
        resource: resourceCallMetadata,
      },
    };
    connection = msgConn;
  }

  const view = draft.document.views.find((v) => v.id === draft.viewId);
  const updatedView: View = {
    ...(view ?? {
      id: draft.viewId,
      label: 'View',
      placements: [],
      connectionIds: [],
      relationIds: [],
      groups: [],
      notes: [],
    }),
    connectionIds: [...(view?.connectionIds ?? []), draft.connectionId],
  };

  const changes: RecordChange[] = [];
  if (draft.sourceElementReplacement) {
    changes.push({
      kind: 'replace',
      value: { recordKind: 'element', record: draft.sourceElementReplacement },
    });
  }
  changes.push({
    kind: 'insert',
    value: { recordKind: 'connection', record: connection },
  });
  changes.push({
    kind: 'replace',
    value: { recordKind: 'view', record: updatedView },
  });

  return {
    ok: true,
    kind: 'ready',
    changes,
    connectionId: draft.connectionId,
  };
}
