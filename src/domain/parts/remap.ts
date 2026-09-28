/**
 * Typed ID remapping for detached part placement.
 *
 * Reference coverage is intentionally expressed through the model's closed unions;
 * literal payload values, labels, paths, and other user-authored strings are copied.
 * See parts-and-export.md "Reference-remap coverage".
 */

import type {
  Behavior,
  Connection,
  DecisionBehavior,
  Effect,
  Element,
  Endpoint,
  Id,
  MachineBehavior,
  Operation,
  PayloadSchema,
  PipelineBehavior,
  Shape,
} from '../studio/model';
import type { PartContent } from './types';

export type MintId = () => Id;

function assertNever(value: never): never {
  throw new Error(`Unhandled part member kind: ${String(value)}`);
}

function visitShapeIds(shape: Shape, visit: (id: Id) => void): void {
  switch (shape.type) {
    case 'record':
      for (const field of shape.fields) {
        visit(field.id);
        visitShapeIds(field.shape, visit);
      }
      return;
    case 'list':
      visitShapeIds(shape.items, visit);
      return;
    case 'string':
    case 'boolean':
    case 'number':
    case 'integer':
    case 'scalar-union':
      return;
    default:
      assertNever(shape);
  }
}

function visitBehaviorIds(behavior: Behavior, visit: (id: Id) => void): void {
  switch (behavior.kind) {
    case 'machine':
      behavior.states.forEach((state) => visit(state.id));
      for (const transition of behavior.transitions) {
        visit(transition.id);
        transition.effects.forEach((effect) => visit(effect.id));
      }
      behavior.responseBindings.forEach((binding) => visit(binding.id));
      return;
    case 'pipeline':
      for (const operation of behavior.operations) {
        visit(operation.id);
        if (operation.kind === 'map') operation.fields.forEach((field) => visit(field.id));
      }
      return;
    case 'decision':
      behavior.cases.forEach((decisionCase) => visit(decisionCase.id));
      return;
    case 'unmodeled':
    case 'resource':
    case 'host':
      return;
    default:
      assertNever(behavior);
  }
}

function visitDefinitionIds(content: PartContent, visit: (id: Id) => void): void {
  for (const schema of content.schemas) {
    visit(schema.id);
    visitShapeIds(schema.shape, visit);
  }
  for (const fixture of content.fixtures) visit(fixture.id);
  for (const element of content.elements) {
    visit(element.id);
    element.ports.forEach((port) => visit(port.id));
    visitBehaviorIds(element.behavior, visit);
  }
  content.connections.forEach((connection) => {
    visit(connection.id);
    if (connection.kind !== 'data' && connection.config.resource !== null) {
      // A request class is a classification token rather than a document record,
      // but it still has identity shared across copied resource-call edges.
      visit(connection.config.resource.requestClassId);
    }
  });
  content.relations.forEach((relation) => visit(relation.id));
  for (const refinement of content.refinements) {
    visit(refinement.id);
    refinement.portMappings.forEach((mapping) => visit(mapping.id));
  }
  content.view.placements.forEach((placement) => visit(placement.id));
  content.view.groups.forEach((group) => visit(group.id));
  content.view.notes.forEach((note) => visit(note.id));
}

function remapShape(shape: Shape, id: (oldId: Id) => Id): Shape {
  switch (shape.type) {
    case 'record':
      return {
        ...shape,
        fields: shape.fields.map((field) => ({
          ...field,
          id: id(field.id),
          shape: remapShape(field.shape, id),
        })),
      };
    case 'list':
      return { ...shape, items: remapShape(shape.items, id) };
    case 'string':
    case 'boolean':
    case 'number':
    case 'integer':
    case 'scalar-union':
      return { ...shape };
    default:
      return assertNever(shape);
  }
}

function remapSchema(schema: PayloadSchema, id: (oldId: Id) => Id): PayloadSchema {
  return { ...schema, id: id(schema.id), shape: remapShape(schema.shape, id) };
}

function remapEndpoint(endpoint: Endpoint, id: (oldId: Id) => Id): Endpoint {
  return { elementId: id(endpoint.elementId), portId: id(endpoint.portId) };
}

function remapEffect(effect: Effect, id: (oldId: Id) => Id): Effect {
  switch (effect.kind) {
    case 'emit':
      return { ...effect, id: id(effect.id), portId: id(effect.portId) };
    case 'schedule-event':
      return { ...effect, id: id(effect.id), eventPortId: id(effect.eventPortId) };
    case 'assign':
    case 'request-id':
    case 'reply':
    case 'trace':
      return { ...effect, id: id(effect.id) };
    default:
      return assertNever(effect);
  }
}

function remapMachine(behavior: MachineBehavior, id: (oldId: Id) => Id): MachineBehavior {
  return {
    ...behavior,
    states: behavior.states.map((state) => ({ ...state, id: id(state.id) })),
    initialStateId: id(behavior.initialStateId),
    contextSchemaId: id(behavior.contextSchemaId),
    initialContextFixtureId: id(behavior.initialContextFixtureId),
    transitions: behavior.transitions.map((transition) => ({
      ...transition,
      id: id(transition.id),
      fromStateId: id(transition.fromStateId),
      eventPortId: id(transition.eventPortId),
      toStateId: id(transition.toStateId),
      effects: transition.effects.map((effect) => remapEffect(effect, id)),
    })),
    responseBindings: behavior.responseBindings.map((binding) => ({
      ...binding,
      id: id(binding.id),
      callPortId: id(binding.callPortId),
      eventPortId: id(binding.eventPortId),
    })),
  };
}

function remapOperation(operation: Operation, id: (oldId: Id) => Id): Operation {
  switch (operation.kind) {
    case 'validate':
      return { ...operation, id: id(operation.id), schemaId: id(operation.schemaId) };
    case 'map':
      return {
        ...operation,
        id: id(operation.id),
        fields: operation.fields.map((field) => ({ ...field, id: id(field.id) })),
      };
    case 'trim':
    case 'filter':
    case 'deduplicate':
    case 'group-sum':
      return { ...operation, id: id(operation.id) };
    default:
      return assertNever(operation);
  }
}

function remapPipeline(behavior: PipelineBehavior, id: (oldId: Id) => Id): PipelineBehavior {
  return {
    ...behavior,
    inputSchemaId: id(behavior.inputSchemaId),
    outputSchemaId: id(behavior.outputSchemaId),
    errorSchemaId: id(behavior.errorSchemaId),
    inputPortId: id(behavior.inputPortId),
    outputPortId: id(behavior.outputPortId),
    errorPortId: id(behavior.errorPortId),
    operations: behavior.operations.map((operation) => remapOperation(operation, id)),
  };
}

function remapDecision(behavior: DecisionBehavior, id: (oldId: Id) => Id): DecisionBehavior {
  return {
    ...behavior,
    inputSchemaId: id(behavior.inputSchemaId),
    inputPortId: id(behavior.inputPortId),
    cases: behavior.cases.map((decisionCase) => ({
      ...decisionCase,
      id: id(decisionCase.id),
      outputPortId: id(decisionCase.outputPortId),
    })),
    fallback: { ...behavior.fallback, outputPortId: id(behavior.fallback.outputPortId) },
  };
}

function remapBehavior(behavior: Behavior, id: (oldId: Id) => Id): Behavior {
  switch (behavior.kind) {
    case 'resource':
      return { ...behavior, config: { ...behavior.config }, entryPortId: id(behavior.entryPortId) };
    case 'machine':
      return remapMachine(behavior, id);
    case 'pipeline':
      return remapPipeline(behavior, id);
    case 'decision':
      return remapDecision(behavior, id);
    case 'unmodeled':
    case 'host':
      return { ...behavior };
    default:
      return assertNever(behavior);
  }
}

function remapElement(element: Element, id: (oldId: Id) => Id): Element {
  return {
    ...element,
    id: id(element.id),
    ports: element.ports.map((port) => ({
      ...port,
      id: id(port.id),
      schemaId: id(port.schemaId),
      responseSchemaId: port.responseSchemaId === null ? null : id(port.responseSchemaId),
    })),
    behavior: remapBehavior(element.behavior, id),
  };
}

function remapConnection(
  connection: Connection,
  id: (oldId: Id) => Id,
  remapCapturedToken: (value: string) => string,
): Connection {
  const common = {
    ...connection,
    id: id(connection.id),
    source: remapEndpoint(connection.source, id),
    target: remapEndpoint(connection.target, id),
  };
  if (connection.kind === 'data') return { ...common, kind: 'data', config: { ...connection.config } };
  if (connection.kind === 'call') {
    return {
      ...common,
      kind: 'call',
      config: {
        ...connection.config,
        condition: connection.config.condition
          ? {
              ...connection.config.condition,
              value: connection.config.condition.field === 'class'
                ? remapCapturedToken(connection.config.condition.value)
                : connection.config.condition.value,
            }
          : null,
        resource: connection.config.resource
          ? { ...connection.config.resource, requestClassId: id(connection.config.resource.requestClassId), tags: [...connection.config.resource.tags] }
          : null,
      },
    };
  }
  return {
    ...common,
    kind: 'message',
    config: {
      ...connection.config,
      condition: connection.config.condition
        ? {
            ...connection.config.condition,
            value: connection.config.condition.field === 'class'
              ? remapCapturedToken(connection.config.condition.value)
              : connection.config.condition.value,
          }
        : null,
      resource: connection.config.resource
        ? { ...connection.config.resource, requestClassId: id(connection.config.resource.requestClassId), tags: [...connection.config.resource.tags] }
        : null,
    },
  };
}

/** Remaps every independently identified part member exactly once. */
export function remapContent(content: PartContent, mintId: MintId): PartContent {
  const mapping = new Map<Id, Id>();
  const minted = new Set<Id>();
  const oldIds = new Set<Id>();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  visitDefinitionIds(content, (oldId) => oldIds.add(oldId));
  for (const oldId of oldIds) {
    const newId = mintId();
    if (!uuidPattern.test(newId) || oldIds.has(newId) || minted.has(newId)) {
      throw new Error('mintId must return a fresh, unique canonical UUID for every part member');
    }
    mapping.set(oldId, newId);
    minted.add(newId);
  }

  const id = (oldId: Id): Id => {
    const next = mapping.get(oldId);
    if (!next) throw new Error(`Part contains a typed reference outside its captured closure: ${oldId}`);
    return next;
  };

  return {
    schema: content.schema,
    schemas: content.schemas.map((schema) => remapSchema(schema, id)),
    fixtures: content.fixtures.map((fixture) => ({
      ...fixture,
      id: id(fixture.id),
      schemaId: id(fixture.schemaId),
    })),
    elements: content.elements.map((element) => remapElement(element, id)),
    connections: content.connections.map((connection) =>
      remapConnection(connection, id, (value) => mapping.get(value) ?? value),
    ),
    relations: content.relations.map((relation) => {
      if (relation.kind === 'contains') {
        return { ...relation, id: id(relation.id), parentId: id(relation.parentId), childId: id(relation.childId) };
      }
      if (relation.kind === 'deployed-on') {
        return { ...relation, id: id(relation.id), elementId: id(relation.elementId), hostId: id(relation.hostId) };
      }
      return { ...relation, id: id(relation.id), sourceId: id(relation.sourceId), targetId: id(relation.targetId) };
    }),
    refinements: content.refinements.map((refinement) => ({
      ...refinement,
      id: id(refinement.id),
      ownerElementId: id(refinement.ownerElementId),
      memberElementIds: refinement.memberElementIds.map(id),
      portMappings: refinement.portMappings.map((mapping) => ({
        ...mapping,
        id: id(mapping.id),
        outer: remapEndpoint(mapping.outer, id),
        inner: remapEndpoint(mapping.inner, id),
      })),
    })),
    view: {
      placements: content.view.placements.map((placement) => ({
        ...placement,
        id: id(placement.id),
        elementId: id(placement.elementId),
      })),
      groups: content.view.groups.map((group) => ({
        ...group,
        id: id(group.id),
        elementIds: group.elementIds.map(id),
      })),
      notes: content.view.notes.map((note) => ({
        ...note,
        id: id(note.id),
        attachedElementIds: note.attachedElementIds.map(id),
      })),
    },
  };
}
