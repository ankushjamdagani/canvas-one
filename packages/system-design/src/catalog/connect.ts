/**
 * Connection planning compiler: turns a connect gesture into the connection, port and schema
 * record changes (or a typed rejection).
 */

import { LINK_CLASS_LATENCY_MS } from '../studio/model.js';
import type {
  CallConnection,
  CallConnectionConfig,
  Connection,
  DataConnection,
  Document,
  Element,
  Endpoint,
  Id,
  MessageConnection,
  MessageConnectionConfig,
  PayloadSchema,
  PortSettings,
  Port,
  Shape,
  View,
} from '../studio/model.js';
import { shapesCompatible } from '../studio/readiness.js';
import type { ProjectExposure } from '../studio/exposure.js';
import {
  describeEndpoint,
  normalizePath,
  PORT_PATH_MAX_LENGTH,
  PROTOCOL_LABELS,
  portPath,
  protocolsFor,
  type Protocol,
} from '../studio/protocols.js';
import type { Issue } from '../studio/validate.js';
import type { RecordChange } from '../studio/records.js';
import { createIssue } from '../studio/issue.js';

/** Port, schema and connection labels are limited to 80 characters; a long path must not break validation. */
const clip = (text: string): string => Array.from(text).slice(0, 80).join('');

/** A new connection starts as a same-AZ hop (an assumption); the inspector changes the link class. */
const DEFAULT_CALL_CONFIG: CallConnectionConfig = {
  latencyMs: LINK_CLASS_LATENCY_MS['same-az'],
  returnLatencyMs: LINK_CLASS_LATENCY_MS['same-az'],
  linkClass: 'same-az',
  jitterMs: 0,
  lossRate: 0,
  bandwidthKbps: null,
  weight: 1, // assumption
  condition: null,
  fallback: false,
};
const DEFAULT_MESSAGE_CONFIG: MessageConnectionConfig = {
  latencyMs: LINK_CLASS_LATENCY_MS['same-az'],
  linkClass: 'same-az',
  jitterMs: 0,
  lossRate: 0,
  bandwidthKbps: null,
  weight: 1, // assumption
  condition: null,
  fallback: false,
};

const linkedLabel = (element: Element): string => `'${element.label}'`;

export type PlanConnectionParams = {
  readonly document: Document;
  readonly viewId: Id;
  readonly source: Endpoint;
  readonly target: Endpoint | { readonly elementId: Id };
  readonly mintId: () => Id;
  /** The connection type chosen in the connect form; defaults to the target's entry protocol. */
  readonly protocol?: Protocol;
  /** The endpoint path or name; defaults to the target's own path for the chosen type. */
  readonly path?: string;
  /** The connection types the project a linked-project target points at exposes right now. */
  readonly linkedExposures?: readonly ProjectExposure[];
};

export type ConnectionDraft = {
  readonly document: Document;
  readonly viewId: Id;
  readonly connectionId: Id;
  readonly source: Endpoint;
  readonly target: Endpoint;
  readonly kind: 'call' | 'message';
  readonly sourceElementReplacement?: Element;
  /** The connection type this draft was planned with, and the types the form may offer. */
  readonly protocol: Protocol | null;
  readonly protocolOptions: readonly Protocol[];
  /** The endpoint path or name this draft was planned with, and the paths the target already has for the type. */
  readonly path: string;
  readonly pathOptions: readonly string[];
  /** Schema inserts and element replacements for ports added by this connection. */
  readonly portChanges: readonly RecordChange[];
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

/**
 * Checks whether adding a directed 'call' edge from sourceElementId to targetElementId
 * would close a synchronous call cycle .
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

  const resolvedTargetPort: Port = targetPort;

  // Event ports are never connectable
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

  // Messaging between resources: a service-like resource publishes
  // to a broker through its own out:message port, and a broker delivers to a consumer's
  // in:call entry through an out:call route port (the consumer shape). Both ports
  // are added by the connect gesture, like a router's route ports.
  const resourceType = (el: Element) => (el.behavior.kind === 'resource' ? (el.behavior.config as { type: string }).type : null);
  const publishesToBroker =
    resourceType(sourceElement) === 'processor' &&
    resourceType(targetElement) === 'broker' &&
    sourcePort.channel === 'call' &&
    targetPort.channel === 'message';
  const brokerDeliversToCallEntry =
    resourceType(sourceElement) === 'broker' &&
    resourceType(targetElement) === 'processor' &&
    sourcePort.channel === 'message' &&
    targetPort.channel === 'call';

  // Both add a port, so the duplicate-pair check below can't see an existing link to the
  // same target port; a second publish or delivery would double every message.
  if (
    (publishesToBroker || brokerDeliversToCallEntry) &&
    document.connections.some(
      (c) => c.source.elementId === source.elementId && c.target.elementId === targetElement.id && c.target.portId === resolvedTargetPort.id,
    )
  ) {
    return {
      kind: 'rejected',
      issues: [
        createIssue(
          'structural-rule',
          `'${sourceElement.label}' is already connected to '${targetElement.label}'`,
          ['duplicate'],
        ),
      ],
    };
  }

  if ((isRouterOrBroker && hasExistingOutgoing) || publishesToBroker || brokerDeliversToCallEntry) {
    const newPortId = mintId();
    const acceptedChannel = targetPort.channel;
    const acceptedProtocol = targetPort.protocol;
    const routePort: Port = {
      id: newPortId,
      label: publishesToBroker ? 'publish' : 'out',
      direction: 'out',
      channel: acceptedChannel,
      protocol: acceptedProtocol,
      schemaId: targetPort.schemaId,
      responseSchemaId: acceptedChannel === 'call' ? targetPort.responseSchemaId : null,
      ...(targetPort.path ? { path: targetPort.path } : {}),
    };
    const newPort = routePort;

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

  // Connection types. A node is connected through a port per (direction, channel, protocol); a
  // connection of type P reuses the source and target port of that type or adds the missing one, and a
  // new port shares the schemas of the port on the other side (a fresh pair if both are new).
  const portChanges: RecordChange[] = [];
  const pendingSchemas = new Map<Id, PayloadSchema>();
  const findSchema = (id: Id | null | undefined): PayloadSchema | undefined =>
    id ? (pendingSchemas.get(id) ?? document.schemas.find((x) => x.id === id)) : undefined;
  let protocolOptions: readonly Protocol[] = [];
  let pathOptions: readonly string[] = [];
  let chosenProtocol: Protocol | null = null;
  let chosenPath = '';
  let targetElementReplacement: Element | undefined;

  if (sourceElementReplacement === undefined && effectiveSourcePort.channel === targetPort.channel) {
    const channel = effectiveSourcePort.channel;
    const isLinked = targetElement.linkedProjectId !== undefined;
    const exposures = (params.linkedExposures ?? []).filter((x) => x.channel === channel);
    const targetDefault = targetPort.protocol;
    // A project can only be connected with the types it supports; any other node accepts every type of the channel.
    protocolOptions = isLinked
      ? [...new Set([
          ...targetElement.ports.filter((p) => p.direction === 'in' && p.channel === channel).map((p) => p.protocol),
          ...exposures.map((x) => x.protocol),
        ].filter((x): x is Protocol => x !== null))]
      : protocolsFor(channel);
    const protocol: Protocol | null = 'portId' in target ? targetDefault : (params.protocol ?? targetDefault ?? effectiveSourcePort.protocol);
    chosenProtocol = protocol;

    // The paths the target already has for this type (for a linked project, the ones it exposes).
    const knownPaths = (protocolValue: Protocol | null): readonly string[] => [
      ...new Set([
        ...targetElement.ports
          .filter((p) => p.direction === 'in' && p.channel === channel && p.protocol === protocolValue)
          .map(portPath),
        ...(isLinked ? exposures.filter((x) => x.protocol === protocolValue).map((x) => x.path) : []),
      ]),
    ];
    pathOptions = knownPaths(protocol);
    const path = normalizePath(
      'portId' in target
        ? portPath(targetPort)
        : (params.path ?? (protocol === targetDefault ? portPath(targetPort) : (pathOptions[0] ?? ''))),
    );
    chosenPath = path;
    if (Array.from(path).length > PORT_PATH_MAX_LENGTH) {
      return {
        kind: 'rejected',
        issues: [createIssue('too-long', `A path or name can be at most ${PORT_PATH_MAX_LENGTH} characters`, ['path'])],
      };
    }

    if (protocol !== null && !protocolsFor(channel).includes(protocol)) {
      return {
        kind: 'rejected',
        issues: [createIssue('invalid-literal', `'${protocol}' is not a ${channel} connection type`, ['protocol'])],
      };
    }

    if (protocol !== null) {
      const samePort = (el: Element, port: Port) =>
        port.channel === channel && port.protocol === protocol && portPath(port) === path;
      let sourceOut: Port | undefined =
        samePort(sourceElement, effectiveSourcePort) ? effectiveSourcePort : sourceElement.ports.find((p) => p.direction === 'out' && samePort(sourceElement, p));
      let targetIn: Port | undefined =
        samePort(targetElement, targetPort) ? targetPort : targetElement.ports.find((p) => p.direction === 'in' && samePort(targetElement, p));

      const exposure = exposures.find((x) => x.protocol === protocol && x.path === path);
      if (!targetIn && isLinked && !exposure) {
        const name = linkedLabel(targetElement);
        return {
          kind: 'rejected',
          issues: [
            createIssue(
              'structural-rule',
              `${name} doesn't expose ${describeEndpoint(protocol, path)}. Edit that project to expose it, then connect.`,
              ['protocol'],
            ),
          ],
        };
      }

      const newSchemaPair = (label: string) => {
        const request: PayloadSchema = {
          id: mintId(),
          label: `${label} request`,
          shape: { type: 'record', nullable: false, fields: [] },
        };
        const response: PayloadSchema | null =
          channel === 'call'
            ? {
                id: mintId(),
                label: `${label} response`,
                shape: { type: 'record', nullable: false, fields: [] },
              }
            : null;
        for (const schema of [request, response]) {
          if (!schema) continue;
          pendingSchemas.set(schema.id, schema);
          portChanges.push({ kind: 'insert', value: { recordKind: 'schema', record: schema } });
        }
        return { schemaId: request.id, responseSchemaId: response?.id ?? null };
      };

      const labelFor = (el: Element) => clip(`${el.label} ${describeEndpoint(protocol, path)}`.slice(0, 60));
      let shared: { schemaId: Id; responseSchemaId: Id | null } | null =
        targetIn ? { schemaId: targetIn.schemaId, responseSchemaId: targetIn.responseSchemaId }
        : sourceOut ? { schemaId: sourceOut.schemaId, responseSchemaId: sourceOut.responseSchemaId }
        : null;

      if (!targetIn) {
        const ids = shared ?? newSchemaPair(labelFor(targetElement));
        shared = ids;
        targetIn = {
          id: mintId(),
          label: clip(describeEndpoint(protocol, path)),
          direction: 'in',
          channel,
          protocol,
          schemaId: ids.schemaId,
          responseSchemaId: ids.responseSchemaId,
          ...(path ? { path } : {}),
          ...(exposure?.contract ? { settings: { ...exposure.contract } as PortSettings } : {}),
        };
        targetElementReplacement = { ...targetElement, ports: [...targetElement.ports, targetIn] };
        portChanges.push({ kind: 'replace', value: { recordKind: 'element', record: targetElementReplacement } });
      }

      if (!sourceOut) {
        // A node ships with a default out-port; while nothing is connected through it, it takes the
        // type and path of the first endpoint the node calls instead of staying behind unused.
        const inUse = (port: Port) =>
          document.connections.some((c) => c.source.elementId === sourceElement.id && c.source.portId === port.id);
        const unused = [effectiveSourcePort, ...sourceElement.ports].find(
          (p) => p.direction === 'out' && p.channel === channel && !inUse(p),
        );
        const endpointFields = {
          label: clip(describeEndpoint(protocol, path)),
          protocol,
          schemaId: targetIn.schemaId,
          responseSchemaId: targetIn.responseSchemaId,
        };
        if (unused) {
          const { path: _oldPath, ...rest } = unused;
          sourceOut = { ...rest, ...endpointFields, ...(path ? { path } : {}) };
          const retyped = sourceOut;
          sourceElementReplacement = { ...sourceElement, ports: sourceElement.ports.map((p) => (p.id === unused.id ? retyped : p)) };
        } else {
          sourceOut = { id: mintId(), direction: 'out', channel, ...endpointFields, ...(path ? { path } : {}) };
          sourceElementReplacement = { ...sourceElement, ports: [...sourceElement.ports, sourceOut] };
        }
        newSourcePortChanges.push({ kind: 'replace', value: { recordKind: 'element', record: sourceElementReplacement } });
      }

      effectiveSourcePort = sourceOut;
      targetPort = targetIn;
    }
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
  const sourceSchema = findSchema(effectiveSourcePort.schemaId);
  const targetSchema = findSchema(targetPort.schemaId);
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

    const sourceRespSchema = findSchema(effectiveSourcePort.responseSchemaId);
    const targetRespSchema = findSchema(targetPort.responseSchemaId);
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

  // Synchronous call cycle rejection
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
      protocol: chosenProtocol,
      protocolOptions,
      path: chosenPath,
      pathOptions,
      portChanges,
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
      kind: 'data',
      source: sourceEndpoint,
      target: targetEndpoint,
      config: {},
    };
    connection = dataConnection;
  } else if (connectionKind === 'call') {
    const callConnection: CallConnection = {
      id: connectionId,
      kind: 'call',
      source: sourceEndpoint,
      target: targetEndpoint,
      config: DEFAULT_CALL_CONFIG,
    };
    connection = callConnection;
  } else {
    // message
    const messageConnection: MessageConnection = {
      id: connectionId,
      kind: 'message',
      source: sourceEndpoint,
      target: targetEndpoint,
      config: DEFAULT_MESSAGE_CONFIG,
    };
    connection = messageConnection;
  }

  const updatedView: View = {
    ...view,
    connectionIds: [...view.connectionIds, connectionId],
  };

  const changes: RecordChange[] = [
    ...portChanges,
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
 * Completes a connection into a resource element once its type and path are confirmed. The
 * caller's request, retries and other policies are not part of connecting: a simulated caller's
 * requests inherit, and an unsimulated one's use defaults.
 */
export function completeConnection(draft: ConnectionDraft): CompleteConnectionResult {
  const sourceElement: Element | undefined = draft.sourceElementReplacement;
  const sourceChanged = sourceElement !== undefined;

  const connection: Connection =
    draft.kind === 'call'
      ? { id: draft.connectionId, kind: 'call', source: draft.source, target: draft.target, config: DEFAULT_CALL_CONFIG }
      : { id: draft.connectionId, kind: 'message', source: draft.source, target: draft.target, config: DEFAULT_MESSAGE_CONFIG };

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

  const changes: RecordChange[] = [...draft.portChanges];
  if (sourceChanged && sourceElement) {
    changes.push({
      kind: 'replace',
      value: { recordKind: 'element', record: sourceElement },
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
