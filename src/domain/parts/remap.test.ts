import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Document, Element, Id } from '../studio/model';
import { validateDocument } from '../studio/validate';
import { captureSelection } from './capture';
import { remapContent } from './remap';

function mintFactory(start = 1): () => Id {
  let next = start;
  return () => `f0000000-0000-4000-8000-${(next++).toString(16).padStart(12, '0')}`;
}

function collectIdentityValues(value: unknown, output = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((entry) => collectIdentityValues(entry, output));
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if ((key === 'id' || key === 'requestClassId') && typeof entry === 'string') output.add(entry);
      collectIdentityValues(entry, output);
    }
  }
  return output;
}

describe('remapContent', () => {
  it('remaps every fixture identity/reference and leaves labels and literal payloads exact', () => {
    const source = JSON.parse(readFileSync(join(process.cwd(), 'specs/revamp/fixtures/s05.json'), 'utf8')) as Document;
    const capture = captureSelection(source, source.views[0].id, {
      elementIds: source.elements.map((element) => element.id),
      noteIds: [],
    });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;

    const machine = capture.content.elements.find((element) => element.behavior.kind === 'machine')!;
    const pipeline = capture.content.elements.find((element) => element.behavior.kind === 'pipeline')!;
    const member = capture.content.elements.find((element) => element.id !== machine.id)!;
    const refinementId = 'a0000000-0000-4000-8000-000000000001';
    const mappingId = 'a0000000-0000-4000-8000-000000000002';
    const scheduleId = 'a0000000-0000-4000-8000-000000000003';
    const mapOperationId = 'a0000000-0000-4000-8000-000000000004';
    const mapFieldId = 'a0000000-0000-4000-8000-000000000005';
    const groupId = 'a0000000-0000-4000-8000-000000000006';
    const noteId = 'a0000000-0000-4000-8000-000000000007';
    // D53: the request class lives on the out-port that sends it.
    const requestPort = capture.content.elements.flatMap((element) => element.ports).find(
      (port) => (port.settings as { request?: unknown } | undefined)?.request !== undefined,
    )!;
    const requestClassId = (requestPort.settings as { request: { requestClassId: string } }).request.requestClassId;
    const resourceConnectionId = capture.content.connections.find(
      (connection) => connection.kind !== 'data' && connection.source.portId === requestPort.id,
    )!.id;
    const augmentedElements = capture.content.elements.map((element): Element => {
      if (element.id === machine.id && element.behavior.kind === 'machine') {
        return {
          ...element,
          behavior: {
            ...element.behavior,
            transitions: element.behavior.transitions.map((transition, index) => index === 0
              ? {
                  ...transition,
                  effects: [...transition.effects, {
                    id: scheduleId,
                    kind: 'schedule-event' as const,
                    delayMs: 1,
                    eventPortId: element.ports.find((port) => port.channel === 'event')!.id,
                    value: { kind: 'literal' as const, value: 'literal-user-value' },
                  }],
                }
              : transition),
          },
        };
      }
      if (element.id === pipeline.id && element.behavior.kind === 'pipeline') {
        return {
          ...element,
          behavior: {
            ...element.behavior,
            operations: [...element.behavior.operations, {
              id: mapOperationId,
              kind: 'map' as const,
              fields: [{ id: mapFieldId, targetKey: 'copied', value: { kind: 'literal' as const, value: 'literal-user-value' } }],
            }],
          },
        };
      }
      return element;
    });
    const augmented = {
      ...capture.content,
      elements: augmentedElements,
      connections: capture.content.connections.map((connection) => {
        if (connection.id !== resourceConnectionId || connection.kind === 'data') return connection;
        if (connection.kind === 'call') {
          return {
            ...connection,
            kind: 'call' as const,
            config: {
              ...connection.config,
              condition: { field: 'class' as const, value: requestClassId },
            },
          };
        }
        return {
          ...connection,
          kind: 'message' as const,
          config: {
            ...connection.config,
            condition: { field: 'class' as const, value: requestClassId },
          },
        };
      }),
      refinements: [{
        id: refinementId,
        ownerElementId: machine.id,
        memberElementIds: [member.id],
        portMappings: [{
          id: mappingId,
          outer: { elementId: machine.id, portId: machine.ports[0].id },
          inner: { elementId: member.id, portId: member.ports[0].id },
        }],
      }],
      view: {
        ...capture.content.view,
        groups: [{ id: groupId, label: 'Synthetic group', elementIds: [machine.id, member.id], collapsed: false }],
        notes: [{ id: noteId, text: 'Literal note text', x: -12, y: -8, width: 180, tone: 'paper' as const, attachedElementIds: [machine.id, member.id] }],
      },
    };

    const oldIds = collectIdentityValues(augmented);
    const oldLabels = augmented.elements.map((element) => element.label);
    const oldFixtureValues = augmented.fixtures.map((fixture) => fixture.value);
    const mint = mintFactory();
    const remapped = remapContent(augmented, mint);
    const serialized = JSON.stringify(remapped);
    for (const oldId of oldIds) expect(serialized).not.toContain(oldId);
    expect(remapped.elements.map((element) => element.label)).toEqual(oldLabels);
    expect(remapped.fixtures.map((fixture) => fixture.value)).toEqual(oldFixtureValues);

    const detached: Document = {
      schema: 'studio-model/1',
      id: mint(),
      title: 'Remapped part',
      elements: remapped.elements,
      connections: remapped.connections,
      relations: remapped.relations,
      schemas: remapped.schemas,
      fixtures: remapped.fixtures,
      refinements: remapped.refinements,
      scenarios: [],
      views: [{
        id: mint(), label: 'Part', placements: remapped.view.placements,
        connectionIds: remapped.connections.map((connection) => connection.id),
        relationIds: remapped.relations.map((relation) => relation.id),
        groups: remapped.view.groups, notes: remapped.view.notes,
      }],
    };
    expect(validateDocument(detached)).toMatchObject({ ok: true });
  });

  it('rejects a mint that collides with any source identity', () => {
    const source = JSON.parse(readFileSync(join(process.cwd(), 'specs/revamp/fixtures/s03.json'), 'utf8')) as Document;
    const capture = captureSelection(source, source.views[0].id, { elementIds: [source.elements[0].id], noteIds: [] });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;
    expect(() => remapContent(capture.content, () => source.elements[0].id)).toThrow('fresh, unique canonical UUID');
  });
});
