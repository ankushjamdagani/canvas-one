/**
 * Closed merge descriptor and key classification for System Studio documents (RV-08c).
 *
 * Implements:
 * - specs/revamp/contracts/transactions.md §5 (Merge: 3-way merge rules, conflict taxonomy, ordered vs set fields)
 * - specs/revamp/contracts/model-and-runner.md §7 (Projection inventory: which lists are ordered vs sets)
 *
 * Classifies every field of every Document record, recursively, as one of:
 * - scalar: three-way value (primitives and Json values like fixture.value and literals compared by canonical JSON)
 * - object: recurse by key
 * - union: object with a discriminant (default 'kind', or 'type'), recurse only when kinds agree
 * - keyed: array of members with 'id', merged per member by ID (order non-semantic)
 * - set: array of primitive IDs with set semantics (add/remove per element, no duplicates)
 * - atomic: whole field conflicts; used for every order-semantic list
 */

import { canonicalJson } from '../studio/canonical';

// ============================================================================
// Descriptor Types
// ============================================================================

export type FieldDescriptorType = 'scalar' | 'object' | 'union' | 'keyed' | 'set' | 'atomic';

export type ScalarFieldDescriptor = {
  readonly type: 'scalar';
};

export type AtomicFieldDescriptor = {
  readonly type: 'atomic';
};

export type SetFieldDescriptor = {
  readonly type: 'set';
};

export type ObjectFieldDescriptor = {
  readonly type: 'object';
  readonly fields: Record<string, FieldDescriptor>;
};

export type UnionFieldDescriptor = {
  readonly type: 'union';
  readonly discriminant?: string; // defaults to 'kind'
  readonly variants: Record<string, ObjectFieldDescriptor>;
};

export type KeyedFieldDescriptor = {
  readonly type: 'keyed';
  readonly item: ObjectFieldDescriptor | UnionFieldDescriptor;
};

export type FieldDescriptor =
  | ScalarFieldDescriptor
  | AtomicFieldDescriptor
  | SetFieldDescriptor
  | ObjectFieldDescriptor
  | UnionFieldDescriptor
  | KeyedFieldDescriptor;

// ============================================================================
// Equality Utilities
// ============================================================================

/**
 * Compares two values for equality.
 * Primitives compare with Object.is / ===.
 * Objects, arrays, and JSON values compare by canonical JSON.
 */
export function canonicalEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  const jsonA = canonicalJson(a);
  const jsonB = canonicalJson(b);
  if (!jsonA.ok) {
    throw new Error(`canonicalEqual: canonicalJson failed: ${jsonA.issues.map((i) => i.message).join('; ')}`);
  }
  if (!jsonB.ok) {
    throw new Error(`canonicalEqual: canonicalJson failed: ${jsonB.issues.map((i) => i.message).join('; ')}`);
  }
  return jsonA.text === jsonB.text;
}

// ============================================================================
// Closed Key Assertions
// ============================================================================

/**
 * Throws if `obj` carries any key not present in `knownKeys`.
 * Mirrors assertClosedKeys in manifest.ts.
 */
export function assertClosedKeys(
  obj: Record<string, unknown>,
  knownKeys: readonly string[],
  recordLabel: string,
  entityId: string | number | null,
): void {
  const known = new Set(knownKeys);
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) {
      throw new Error(
        `mergeDescriptor: unclassified field '${key}' on ${recordLabel} record` +
          (entityId !== null ? ` '${entityId}'` : '') +
          ` — every field of every Document record must be classified in merge-descriptor.ts`,
      );
    }
  }
}

// ============================================================================
// Specific Descriptors
// ============================================================================

export const PORT_DESCRIPTOR: ObjectFieldDescriptor = {
  type: 'object',
  fields: {
    id: { type: 'scalar' },
    label: { type: 'scalar' },
    direction: { type: 'scalar' },
    channel: { type: 'scalar' },
    schemaId: { type: 'scalar' },
    responseSchemaId: { type: 'scalar' },
    protocol: { type: 'scalar' },
    path: { type: 'scalar' },
    settings: { type: 'atomic' },
  },
};

export const MACHINE_STATE_DESCRIPTOR: ObjectFieldDescriptor = {
  type: 'object',
  fields: {
    id: { type: 'scalar' },
    label: { type: 'scalar' },
  },
};

export const MACHINE_RESPONSE_BINDING_DESCRIPTOR: ObjectFieldDescriptor = {
  type: 'object',
  fields: {
    id: { type: 'scalar' },
    callPortId: { type: 'scalar' },
    eventPortId: { type: 'scalar' },
  },
};

export const RESOURCE_CONFIG_DESCRIPTOR: UnionFieldDescriptor = {
  type: 'union',
  discriminant: 'type',
  variants: {
    source: {
      type: 'object',
      fields: {
        type: { type: 'scalar' },
        capacity: { type: 'scalar' },
        concurrency: { type: 'scalar' },
        queueLimit: { type: 'scalar' },
        failureRate: { type: 'scalar' },
        maxRetries: { type: 'scalar' },
        retryDelayMs: { type: 'scalar' },
        serviceTime: { type: 'scalar' },
        serviceTimeCv: { type: 'scalar' },
      },
    },
    processor: {
      type: 'object',
      fields: {
        type: { type: 'scalar' },
        capacity: { type: 'scalar' },
        concurrency: { type: 'scalar' },
        queueLimit: { type: 'scalar' },
        failureRate: { type: 'scalar' },
        maxRetries: { type: 'scalar' },
        retryDelayMs: { type: 'scalar' },
        serviceTime: { type: 'scalar' },
        serviceTimeCv: { type: 'scalar' },
      },
    },
    storage: {
      type: 'object',
      fields: {
        type: { type: 'scalar' },
        capacity: { type: 'scalar' },
        writeCapacity: { type: 'scalar' },
        concurrency: { type: 'scalar' },
        queueLimit: { type: 'scalar' },
        failureRate: { type: 'scalar' },
        maxRetries: { type: 'scalar' },
        retryDelayMs: { type: 'scalar' },
        serviceTime: { type: 'scalar' },
        serviceTimeCv: { type: 'scalar' },
      },
    },
    router: {
      type: 'object',
      fields: {
        type: { type: 'scalar' },
        capacity: { type: 'scalar' },
        concurrency: { type: 'scalar' },
        queueLimit: { type: 'scalar' },
        failureRate: { type: 'scalar' },
        maxRetries: { type: 'scalar' },
        retryDelayMs: { type: 'scalar' },
        serviceTime: { type: 'scalar' },
        serviceTimeCv: { type: 'scalar' },
        strategy: { type: 'scalar' },
      },
    },
    cache: {
      type: 'object',
      fields: {
        type: { type: 'scalar' },
        capacity: { type: 'scalar' },
        concurrency: { type: 'scalar' },
        queueLimit: { type: 'scalar' },
        failureRate: { type: 'scalar' },
        maxRetries: { type: 'scalar' },
        retryDelayMs: { type: 'scalar' },
        serviceTime: { type: 'scalar' },
        serviceTimeCv: { type: 'scalar' },
        mode: { type: 'scalar' },
        hitRate: { type: 'scalar' },
        entries: { type: 'scalar' },
        ttlMs: { type: 'scalar' },
      },
    },
    broker: {
      type: 'object',
      fields: {
        type: { type: 'scalar' },
        capacity: { type: 'scalar' },
        concurrency: { type: 'scalar' },
        queueLimit: { type: 'scalar' },
        failureRate: { type: 'scalar' },
        maxRetries: { type: 'scalar' },
        retryDelayMs: { type: 'scalar' },
        serviceTime: { type: 'scalar' },
        serviceTimeCv: { type: 'scalar' },
        delivery: { type: 'scalar' },
      },
    },
  },
};

export const BEHAVIOR_DESCRIPTOR: UnionFieldDescriptor = {
  type: 'union',
  discriminant: 'kind',
  variants: {
    unmodeled: {
      type: 'object',
      fields: {
        kind: { type: 'scalar' },
        version: { type: 'scalar' },
        reason: { type: 'scalar' },
      },
    },
    resource: {
      type: 'object',
      fields: {
        kind: { type: 'scalar' },
        version: { type: 'scalar' },
        entryPortId: { type: 'scalar' },
        config: RESOURCE_CONFIG_DESCRIPTOR,
      },
    },
    machine: {
      type: 'object',
      fields: {
        kind: { type: 'scalar' },
        version: { type: 'scalar' },
        states: { type: 'keyed', item: MACHINE_STATE_DESCRIPTOR },
        initialStateId: { type: 'scalar' },
        contextSchemaId: { type: 'scalar' },
        initialContextFixtureId: { type: 'scalar' },
        transitions: { type: 'atomic' }, // §7: transitions are atomic
        responseBindings: { type: 'keyed', item: MACHINE_RESPONSE_BINDING_DESCRIPTOR },
      },
    },
    pipeline: {
      type: 'object',
      fields: {
        kind: { type: 'scalar' },
        version: { type: 'scalar' },
        inputSchemaId: { type: 'scalar' },
        outputSchemaId: { type: 'scalar' },
        errorSchemaId: { type: 'scalar' },
        inputPortId: { type: 'scalar' },
        outputPortId: { type: 'scalar' },
        errorPortId: { type: 'scalar' },
        operations: { type: 'atomic' }, // §7: operations are atomic
      },
    },
    decision: {
      type: 'object',
      fields: {
        kind: { type: 'scalar' },
        version: { type: 'scalar' },
        inputSchemaId: { type: 'scalar' },
        inputPortId: { type: 'scalar' },
        cases: { type: 'atomic' }, // order-semantic cases
        fallback: {
          type: 'object',
          fields: {
            outputPortId: { type: 'scalar' },
            value: { type: 'scalar' },
          },
        },
      },
    },
    host: {
      type: 'object',
      fields: {
        kind: { type: 'scalar' },
        version: { type: 'scalar' },
      },
    },
  },
};

export const ELEMENT_DESCRIPTOR: ObjectFieldDescriptor = {
  type: 'object',
  fields: {
    id: { type: 'scalar' },
    label: { type: 'scalar' },
    description: { type: 'scalar' },
    visualKind: { type: 'scalar' },
    linkedProjectId: { type: 'scalar' },
    ports: { type: 'keyed', item: PORT_DESCRIPTOR },
    behavior: BEHAVIOR_DESCRIPTOR,
  },
};

export const ENDPOINT_DESCRIPTOR: ObjectFieldDescriptor = {
  type: 'object',
  fields: {
    elementId: { type: 'scalar' },
    portId: { type: 'scalar' },
  },
};

export const CONNECTION_DESCRIPTOR: UnionFieldDescriptor = {
  type: 'union',
  discriminant: 'kind',
  variants: {
    call: {
      type: 'object',
      fields: {
        id: { type: 'scalar' },
        kind: { type: 'scalar' },
        source: ENDPOINT_DESCRIPTOR,
        target: ENDPOINT_DESCRIPTOR,
        config: {
          type: 'object',
          fields: {
            latencyMs: { type: 'scalar' },
            returnLatencyMs: { type: 'scalar' },
            linkClass: { type: 'scalar' },
            weight: { type: 'scalar' },
            condition: { type: 'atomic' },
            fallback: { type: 'scalar' },
          },
        },
      },
    },
    message: {
      type: 'object',
      fields: {
        id: { type: 'scalar' },
        kind: { type: 'scalar' },
        source: ENDPOINT_DESCRIPTOR,
        target: ENDPOINT_DESCRIPTOR,
        config: {
          type: 'object',
          fields: {
            latencyMs: { type: 'scalar' },
            linkClass: { type: 'scalar' },
            weight: { type: 'scalar' },
            condition: { type: 'atomic' },
            fallback: { type: 'scalar' },
          },
        },
      },
    },
    data: {
      type: 'object',
      fields: {
        id: { type: 'scalar' },
        kind: { type: 'scalar' },
        source: ENDPOINT_DESCRIPTOR,
        target: ENDPOINT_DESCRIPTOR,
        config: {
          type: 'object',
          fields: {},
        },
      },
    },
  },
};

export const RELATION_DESCRIPTOR: UnionFieldDescriptor = {
  type: 'union',
  discriminant: 'kind',
  variants: {
    contains: {
      type: 'object',
      fields: {
        id: { type: 'scalar' },
        label: { type: 'scalar' },
        kind: { type: 'scalar' },
        parentId: { type: 'scalar' },
        childId: { type: 'scalar' },
      },
    },
    'deployed-on': {
      type: 'object',
      fields: {
        id: { type: 'scalar' },
        label: { type: 'scalar' },
        kind: { type: 'scalar' },
        elementId: { type: 'scalar' },
        hostId: { type: 'scalar' },
      },
    },
    descriptive: {
      type: 'object',
      fields: {
        id: { type: 'scalar' },
        label: { type: 'scalar' },
        kind: { type: 'scalar' },
        sourceId: { type: 'scalar' },
        targetId: { type: 'scalar' },
      },
    },
  },
};

// Shape descriptor handles recursive nesting of record/list shapes
export const SHAPE_DESCRIPTOR: UnionFieldDescriptor = {
  type: 'union',
  discriminant: 'type',
  variants: {
    string: { type: 'object', fields: { type: { type: 'scalar' }, nullable: { type: 'scalar' } } },
    boolean: { type: 'object', fields: { type: { type: 'scalar' }, nullable: { type: 'scalar' } } },
    number: { type: 'object', fields: { type: { type: 'scalar' }, nullable: { type: 'scalar' } } },
    integer: { type: 'object', fields: { type: { type: 'scalar' }, nullable: { type: 'scalar' } } },
    record: {
      type: 'object',
      fields: {
        type: { type: 'scalar' },
        nullable: { type: 'scalar' },
        fields: {
          type: 'keyed',
          item: {
            type: 'object',
            fields: {
              id: { type: 'scalar' },
              key: { type: 'scalar' },
              optional: { type: 'scalar' },
              get shape(): UnionFieldDescriptor {
                return SHAPE_DESCRIPTOR;
              },
            },
          },
        },
      },
    },
    list: {
      type: 'object',
      fields: {
        type: { type: 'scalar' },
        nullable: { type: 'scalar' },
        get items(): UnionFieldDescriptor {
          return SHAPE_DESCRIPTOR;
        },
        maxItems: { type: 'scalar' },
      },
    },
    'scalar-union': {
      type: 'object',
      fields: {
        type: { type: 'scalar' },
        nullable: { type: 'scalar' },
        types: { type: 'atomic' }, // §7: list values are atomic
      },
    },
  },
};

export const PAYLOAD_SCHEMA_DESCRIPTOR: ObjectFieldDescriptor = {
  type: 'object',
  fields: {
    id: { type: 'scalar' },
    label: { type: 'scalar' },
    shape: SHAPE_DESCRIPTOR,
  },
};

export const FIXTURE_DESCRIPTOR: ObjectFieldDescriptor = {
  type: 'object',
  fields: {
    id: { type: 'scalar' },
    schemaId: { type: 'scalar' },
    value: { type: 'scalar' }, // Json values are atomic scalars compared by canonical JSON
  },
};

export const PORT_MAPPING_DESCRIPTOR: ObjectFieldDescriptor = {
  type: 'object',
  fields: {
    id: { type: 'scalar' },
    outer: ENDPOINT_DESCRIPTOR,
    inner: ENDPOINT_DESCRIPTOR,
  },
};

export const REFINEMENT_DESCRIPTOR: ObjectFieldDescriptor = {
  type: 'object',
  fields: {
    id: { type: 'scalar' },
    ownerElementId: { type: 'scalar' },
    memberElementIds: { type: 'atomic' },
    portMappings: { type: 'keyed', item: PORT_MAPPING_DESCRIPTOR },
  },
};

export const WORKLOAD_DESCRIPTOR: ObjectFieldDescriptor = {
  type: 'object',
  fields: {
    id: { type: 'scalar' },
    entry: ENDPOINT_DESCRIPTOR,
    enabled: { type: 'scalar' },
    rate: { type: 'scalar' },
    profile: { type: 'atomic' },
    timeoutMs: { type: 'scalar' },
    intervalMs: { type: 'scalar' },
    classes: { type: 'atomic' }, // §7: workload classes are atomic
  },
};

export const ASSERTION_DESCRIPTOR: ObjectFieldDescriptor = {
  type: 'object',
  fields: {
    id: { type: 'scalar' },
    label: { type: 'scalar' },
    subject: { type: 'atomic' },
    operator: { type: 'scalar' },
    expected: { type: 'scalar' }, // Json value
  },
};

export const COMPLETION_POLICY_DESCRIPTOR: UnionFieldDescriptor = {
  type: 'union',
  discriminant: 'kind',
  variants: {
    quiescent: {
      type: 'object',
      fields: {
        kind: { type: 'scalar' },
      },
    },
    horizon: {
      type: 'object',
      fields: {
        kind: { type: 'scalar' },
        horizonMs: { type: 'scalar' },
      },
    },
    drain: {
      type: 'object',
      fields: {
        kind: { type: 'scalar' },
        arrivalHorizonMs: { type: 'scalar' },
        deadlineMs: { type: 'scalar' },
      },
    },
  },
};

export const ASSUMPTION_DESCRIPTOR: ObjectFieldDescriptor = {
  type: 'object',
  fields: {
    id: { type: 'scalar' },
    key: { type: 'scalar' },
    value: { type: 'scalar' },
    source: { type: 'scalar' },
    description: { type: 'scalar' },
  },
};

export const SCENARIO_DESCRIPTOR: ObjectFieldDescriptor = {
  type: 'object',
  fields: {
    id: { type: 'scalar' },
    label: { type: 'scalar' },
    revision: { type: 'scalar' }, // derived during merge
    mode: { type: 'scalar' },
    scopeElementIds: { type: 'set' }, // §7: set
    entryPorts: { type: 'atomic' }, // §7: atomic
    inputs: { type: 'atomic' }, // §7: atomic
    workloads: { type: 'keyed', item: WORKLOAD_DESCRIPTOR },
    faults: { type: 'atomic' }, // §7: atomic
    boundaries: { type: 'atomic' }, // §7: atomic
    refinementSelections: { type: 'atomic' }, // §7: atomic
    initialContexts: { type: 'atomic' }, // §7: atomic
    assertions: { type: 'keyed', item: ASSERTION_DESCRIPTOR },
    seed: { type: 'scalar' },
    budgets: {
      type: 'object',
      fields: {
        maxEvents: { type: 'scalar' },
        maxTraceRows: { type: 'scalar' },
        maxTraceBytes: { type: 'scalar' },
        maxScheduledEvents: { type: 'scalar' },
        maxLiveRoots: { type: 'scalar' },
      },
    },
    completion: COMPLETION_POLICY_DESCRIPTOR,
    assumptions: { type: 'keyed', item: ASSUMPTION_DESCRIPTOR },
  },
};

export const PLACEMENT_DESCRIPTOR: ObjectFieldDescriptor = {
  type: 'object',
  fields: {
    id: { type: 'scalar' },
    elementId: { type: 'scalar' },
    x: { type: 'scalar' },
    y: { type: 'scalar' },
    width: { type: 'scalar' },
    expanded: { type: 'scalar' },
  },
};

export const GROUP_DESCRIPTOR: ObjectFieldDescriptor = {
  type: 'object',
  fields: {
    id: { type: 'scalar' },
    label: { type: 'scalar' },
    elementIds: { type: 'set' }, // §7: set
    collapsed: { type: 'scalar' },
  },
};

export const NOTE_DESCRIPTOR: ObjectFieldDescriptor = {
  type: 'object',
  fields: {
    id: { type: 'scalar' },
    text: { type: 'scalar' },
    x: { type: 'scalar' },
    y: { type: 'scalar' },
    width: { type: 'scalar' },
    tone: { type: 'scalar' },
    attachedElementIds: { type: 'set' }, // §7: set
  },
};

export const VIEW_DESCRIPTOR: ObjectFieldDescriptor = {
  type: 'object',
  fields: {
    id: { type: 'scalar' },
    label: { type: 'scalar' },
    placements: { type: 'keyed', item: PLACEMENT_DESCRIPTOR },
    connectionIds: { type: 'set' }, // §7: set
    relationIds: { type: 'set' }, // §7: set
    groups: { type: 'keyed', item: GROUP_DESCRIPTOR },
    notes: { type: 'keyed', item: NOTE_DESCRIPTOR },
  },
};

export const DOCUMENT_DESCRIPTOR: ObjectFieldDescriptor = {
  type: 'object',
  fields: {
    schema: { type: 'scalar' },
    id: { type: 'scalar' },
    title: { type: 'scalar' },
    elements: { type: 'keyed', item: ELEMENT_DESCRIPTOR },
    connections: { type: 'keyed', item: CONNECTION_DESCRIPTOR },
    relations: { type: 'keyed', item: RELATION_DESCRIPTOR },
    schemas: { type: 'keyed', item: PAYLOAD_SCHEMA_DESCRIPTOR },
    fixtures: { type: 'keyed', item: FIXTURE_DESCRIPTOR },
    refinements: { type: 'keyed', item: REFINEMENT_DESCRIPTOR },
    scenarios: { type: 'keyed', item: SCENARIO_DESCRIPTOR },
    views: { type: 'keyed', item: VIEW_DESCRIPTOR },
  },
};

// ============================================================================
// Record Descriptor Lookup by RecordKind
// ============================================================================

export function getRecordDescriptor(recordKind: string): ObjectFieldDescriptor | UnionFieldDescriptor {
  switch (recordKind) {
    case 'element':
      return ELEMENT_DESCRIPTOR;
    case 'connection':
      return CONNECTION_DESCRIPTOR;
    case 'relation':
      return RELATION_DESCRIPTOR;
    case 'schema':
      return PAYLOAD_SCHEMA_DESCRIPTOR;
    case 'fixture':
      return FIXTURE_DESCRIPTOR;
    case 'refinement':
      return REFINEMENT_DESCRIPTOR;
    case 'scenario':
      return SCENARIO_DESCRIPTOR;
    case 'view':
      return VIEW_DESCRIPTOR;
    default:
      throw new Error(`mergeDescriptor: unknown recordKind '${recordKind}'`);
  }
}

// ============================================================================
// Walk and Validate that every key is classified
// ============================================================================

/**
 * Walks a document or record using its descriptor and throws if any unclassified key is encountered.
 */
export function assertDocumentKeysClassified(doc: unknown): void {
  function walk(
    val: unknown,
    descriptor: FieldDescriptor,
    path: string,
    recordLabel: string,
    entityId: string | number | null,
  ): void {
    if (val === null || val === undefined) return;

    if (descriptor.type === 'scalar' || descriptor.type === 'atomic' || descriptor.type === 'set') {
      return;
    }

    if (descriptor.type === 'keyed') {
      if (!Array.isArray(val)) {
        throw new Error(`mergeDescriptor: expected array at '${path}', got ${typeof val}`);
      }
      for (let i = 0; i < val.length; i++) {
        const item = val[i] as Record<string, unknown>;
        const itemId = item && typeof item === 'object' && typeof item.id === 'string' ? item.id : i;
        walk(item, descriptor.item, `${path}[${i}]`, recordLabel, itemId);
      }
      return;
    }

    if (descriptor.type === 'union') {
      if (typeof val !== 'object') {
        throw new Error(`mergeDescriptor: expected object for union at '${path}', got ${typeof val}`);
      }
      const disc = descriptor.discriminant ?? 'kind';
      const variantKey = (val as Record<string, unknown>)[disc];
      if (typeof variantKey !== 'string') {
        throw new Error(`mergeDescriptor: missing discriminant '${disc}' on union at '${path}'`);
      }
      const variantDesc = descriptor.variants[variantKey];
      if (!variantDesc) {
        throw new Error(
          `mergeDescriptor: unknown variant '${variantKey}' for discriminant '${disc}' at '${path}'`,
        );
      }
      walk(val, variantDesc, path, `${recordLabel}:${variantKey}`, entityId);
      return;
    }

    if (descriptor.type === 'object') {
      if (typeof val !== 'object' || Array.isArray(val)) {
        throw new Error(`mergeDescriptor: expected plain object at '${path}', got ${typeof val}`);
      }
      const obj = val as Record<string, unknown>;
      const knownKeys = Object.keys(descriptor.fields);
      assertClosedKeys(obj, knownKeys, recordLabel, entityId);
      for (const key of Object.keys(obj)) {
        const childDesc = descriptor.fields[key];
        if (!childDesc) {
          throw new Error(
            `mergeDescriptor: unclassified field '${key}' on ${recordLabel}` +
              (entityId !== null ? ` '${entityId}'` : '') +
              ` at '${path}'`,
          );
        }
        walk(obj[key], childDesc, path ? `${path}.${key}` : key, `${recordLabel}.${key}`, entityId);
      }
    }
  }

  walk(doc, DOCUMENT_DESCRIPTOR, '', 'Document', (doc as { id?: string })?.id ?? null);
}
