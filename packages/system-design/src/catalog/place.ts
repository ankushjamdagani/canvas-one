/**
 * Component placement compiler: turns a catalog entry placement into record changes with
 * fresh IDs, applied as one undoable command.
 */

import type {
  Behavior,
  Document,
  Element,
  Fixture,
  Id,
  PayloadSchema,
  Placement,
  Port,
  ResourceConfig,
  View,
} from '../studio/model.js';
import type { Issue } from '../studio/validate.js';
import type { RecordChange } from '../studio/records.js';
import { getEntry } from './catalog.js';
import type { ProjectExposure } from '../studio/exposure.js';
import { defaultProtocol, describeEndpoint } from '../studio/protocols.js';
import { createIssue } from '../studio/issue.js';

export type PlaceEntryParams = {
  readonly document: Document;
  readonly viewId: Id;
  readonly entryId: string;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly mintId: () => Id;
  /** Required for (and only valid with) the `linked-project` entry; `title` is the label until it is read live. */
  readonly link?: { readonly projectId: Id; readonly title: string; readonly exposures: readonly ProjectExposure[] };
};

export type PlaceEntryResult =
  | {
      readonly ok: true;
      readonly changes: readonly RecordChange[];
      readonly elementId: Id;
      readonly placementId: Id;
    }
  | {
      readonly ok: false;
      readonly issues: readonly Issue[];
    };

/**
 * Compiles placing a catalog entry into a single model.apply-records batch of RecordChanges.
 */
export function placeEntry(params: PlaceEntryParams): PlaceEntryResult {
  const { document, viewId, entryId, anchor, mintId, link } = params;

  if (!mintId || typeof mintId !== 'function') {
    return {
      ok: false,
      issues: [createIssue('missing-property', 'mintId is required and must be a function', ['mintId'])],
    };
  }

  const view = document.views.find((v) => v.id === viewId);
  if (!view) {
    return {
      ok: false,
      issues: [createIssue('dangling-reference', `View '${viewId}' does not exist in document`, ['viewId'])],
    };
  }

  const entry = getEntry(entryId);
  if (!entry) {
    return {
      ok: false,
      issues: [createIssue('dangling-reference', `Catalog entry '${entryId}' does not exist`, ['entryId'])],
    };
  }

  if ((entry.visualKind === 'linked-project') !== (link !== undefined)) {
    return {
      ok: false,
      issues: [
        createIssue(
          'structural-rule',
          entry.visualKind === 'linked-project'
            ? 'A linked project needs the project to link to'
            : 'Only the linked-project entry can carry a link',
          ['link'],
        ),
      ],
    };
  }

  // A linked node gets one in-port per endpoint the project exposes, and needs a call port as its entry.
  const linkedExposures = link
    ? [...link.exposures].sort((a, b) => Number(b.channel === 'call') - Number(a.channel === 'call'))
    : [];
  if (link && linkedExposures[0]?.channel !== 'call') {
    return {
      ok: false,
      issues: [
        createIssue(
          'structural-rule',
          `'${link.title}' exposes no call connection type. Edit that project to expose one, then link it.`,
          ['link'],
        ),
      ],
    };
  }

  const changes: RecordChange[] = [];
  const elementId = mintId();
  const placementId = mintId();

  // Resolution 3: every placement gets its own fresh copy of the generic request/response schemas
  let requestSchemaId: Id | null = null;
  let responseSchemaId: Id | null = null;

  if (entry.ports.length > 0) {
    requestSchemaId = mintId();
    const requestSchema: PayloadSchema = {
      id: requestSchemaId,
      label: `${entry.label} request`,
      shape: {
        type: 'record',
        nullable: false,
        fields: [],
      },
    };
    changes.push({
      kind: 'insert',
      value: { recordKind: 'schema', record: requestSchema },
    });

    const hasCallPort = entry.ports.some((p) => p.channel === 'call');
    if (hasCallPort) {
      responseSchemaId = mintId();
      const responseSchema: PayloadSchema = {
        id: responseSchemaId,
        label: `${entry.label} response`,
        shape: {
          type: 'record',
          nullable: false,
          fields: [],
        },
      };
      changes.push({
        kind: 'insert',
        value: { recordKind: 'schema', record: responseSchema },
      });
    }
  }

  // Fresh port IDs
  const ports: Port[] = [];
  for (const catalogPort of entry.ports) {
    const portId = mintId();
    const schemaId =
      catalogPort.schemaRef === 'generic-response' && responseSchemaId
        ? responseSchemaId
        : (requestSchemaId ?? mintId());
    const respSchemaId =
      catalogPort.channel === 'call'
        ? (responseSchemaId ?? schemaId)
        : null;

    ports.push({
      id: portId,
      label: catalogPort.label,
      direction: catalogPort.direction,
      channel: catalogPort.channel,
      protocol: defaultProtocol(entry.visualKind, catalogPort.channel),
      schemaId,
      responseSchemaId: respSchemaId,
    });
  }

  for (const exposure of linkedExposures) {
    const requestId = mintId();
    const responseId = exposure.channel === 'call' ? mintId() : null;
    const label = Array.from(describeEndpoint(exposure.protocol, exposure.path)).slice(0, 60).join('');
    changes.push({ kind: 'insert', value: { recordKind: 'schema', record: { id: requestId, label: `${label} request`, shape: { type: 'record', nullable: false, fields: [] } } } });
    if (responseId) {
      changes.push({ kind: 'insert', value: { recordKind: 'schema', record: { id: responseId, label: `${label} response`, shape: { type: 'record', nullable: false, fields: [] } } } });
    }
    const base: Port = {
      id: mintId(),
      label,
      direction: 'in',
      channel: exposure.channel,
      protocol: exposure.protocol,
      schemaId: requestId,
      responseSchemaId: responseId,
      ...(exposure.path ? { path: exposure.path } : {}),
      // The project's declared contract (what it promises), so a caller sees the real expectations.
      ...(exposure.contract ? { settings: { ...exposure.contract } } : {}),
    };
    ports.push({ ...base, protocol: exposure.protocol });
  }

  // Behavior self-references
  let behavior: Behavior;

  switch (entry.behaviorKind) {
    case 'resource': {
      const entryPort = ports.find((p) => p.direction === 'in') ?? ports[0];
      behavior = {
        kind: 'resource',
        version: 1,
        config: { ...entry.defaultConfig } as ResourceConfig,
        entryPortId: entryPort.id,
      };
      break;
    }
    case 'pipeline': {
      const inPort = ports.find((p) => p.direction === 'in') ?? ports[0];
      const outPort =
        ports.find((p) => p.direction === 'out' && p.label === 'out') ??
        ports.find((p) => p.direction === 'out') ??
        ports[0];
      const errPort =
        ports.find((p) => p.direction === 'out' && p.label === 'error') ??
        ports.filter((p) => p.direction === 'out')[1] ??
        outPort;

      const pipelineSchemaId = requestSchemaId ?? mintId();
      behavior = {
        kind: 'pipeline',
        version: 1,
        inputSchemaId: pipelineSchemaId,
        outputSchemaId: pipelineSchemaId,
        errorSchemaId: pipelineSchemaId,
        inputPortId: inPort.id,
        outputPortId: outPort.id,
        errorPortId: errPort.id,
        operations: [],
      };
      break;
    }
    case 'machine': {
      // Machine requires at least one initial state and valid schema/fixture references to pass storable validation
      const initialStateId = mintId();
      const initialContextFixtureId = mintId();
      const machineSchemaId = requestSchemaId ?? mintId();

      behavior = {
        kind: 'machine',
        version: 1,
        states: [{ id: initialStateId, label: 'initial' }],
        initialStateId,
        contextSchemaId: machineSchemaId,
        initialContextFixtureId,
        transitions: [],
        responseBindings: [],
      };

      const fixture: Fixture = {
        id: initialContextFixtureId,
        schemaId: machineSchemaId,
        value: {},
      };
      changes.push({
        kind: 'insert',
        value: { recordKind: 'fixture', record: fixture },
      });
      break;
    }
    case 'host': {
      behavior = {
        kind: 'host',
        version: 1,
      };
      break;
    }
    case 'unmodeled':
    default: {
      const reason =
        typeof entry.defaultConfig?.reason === 'string'
          ? (entry.defaultConfig.reason as string)
          : 'Not simulated';
      behavior = {
        kind: 'unmodeled',
        version: 1,
        reason,
      };
      break;
    }
  }

  // Element record
  const element: Element = {
    id: elementId,
    label: link ? link.title.trim().slice(0, 80) || entry.label : entry.label,
    description: '',
    visualKind: entry.visualKind,
    ports,
    behavior,
    ...(link ? { linkedProjectId: link.projectId } : {}),
  };

  changes.push({
    kind: 'insert',
    value: { recordKind: 'element', record: element },
  });

  // Resolution 4: placement width 184 px, expanded: false
  const placement: Placement = {
    id: placementId,
    elementId,
    x: anchor.x,
    y: anchor.y,
    width: 184,
    expanded: false,
  };

  const updatedView: View = {
    ...view,
    placements: [...view.placements, placement],
  };

  changes.push({
    kind: 'replace',
    value: { recordKind: 'view', record: updatedView },
  });

  return {
    ok: true,
    changes,
    elementId,
    placementId,
  };
}
