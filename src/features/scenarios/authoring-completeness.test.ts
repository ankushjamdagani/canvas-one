import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Shape } from '../../domain/studio/model';
import { buildEmptyScenario } from './draft';
import { makeCounterMintId, buildMockDocument } from './mockDocument';
import { SchemaPathPicker, schemaPathTemplates } from './SchemaPathPicker';
import { GuardBuilder } from './GuardBuilder';
import { BoundariesSection } from './BoundariesSection';
import { StepsSection, reorderInputs } from './StepsSection';

const nestedShape: Shape = {
  type: 'record',
  nullable: false,
  fields: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      key: 'order',
      optional: false,
      shape: {
        type: 'record',
        nullable: false,
        fields: [
          {
            id: '10000000-0000-4000-8000-000000000002',
            key: 'items',
            optional: false,
            shape: {
              type: 'list',
              nullable: false,
              maxItems: 10,
              items: {
                type: 'record',
                nullable: false,
                fields: [
                  {
                    id: '10000000-0000-4000-8000-000000000003',
                    key: 'sku',
                    optional: false,
                    shape: { type: 'string', nullable: false },
                  },
                ],
              },
            },
          },
        ],
      },
    },
  ],
};

describe('scenario authoring completeness', () => {
  it('enumerates nested record and list paths without flattening them into dotted strings', () => {
    expect(schemaPathTemplates(nestedShape).map((template) => template.label)).toEqual([
      'Whole value',
      'order',
      'order.items',
      'order.items[index]',
      'order.items[index].sku',
    ]);
  });

  it('renders an explicit list index control for a nested assertion path', () => {
    const base = buildMockDocument();
    const schemaId = base.schemas[0].id;
    const document = {
      ...base,
      schemas: base.schemas.map((schema) => (schema.id === schemaId ? { ...schema, shape: nestedShape } : schema)),
    };
    const html = renderToStaticMarkup(
      React.createElement(SchemaPathPicker, {
        document,
        schemaId,
        path: ['order', 'items', 2, 'sku'],
        onChange: vi.fn(),
        label: 'Which part of the value',
      }),
    );
    expect(html).toContain('order.items[index].sku');
    expect(html).toContain('List index for order.items[index].sku');
    expect(html).toContain('value="2"');
  });

  it('renders recursive Guard and Value variants from stored authored data', () => {
    const document = buildMockDocument();
    const html = renderToStaticMarkup(
      React.createElement(GuardBuilder, {
        document,
        inputSchemaId: document.schemas[0].id,
        guard: {
          op: 'all',
          guards: [
            {
              op: 'exists',
              value: { kind: 'read', source: 'input', path: [] },
            },
            {
              op: 'equals',
              left: {
                kind: 'record',
                fields: [{ key: 'status', value: { kind: 'literal', value: 'ok' } }],
              },
              right: {
                kind: 'record',
                fields: [{ key: 'status', value: { kind: 'literal', value: 'ok' } }],
              },
            },
          ],
        },
        onValidChange: vi.fn(),
      }),
    );
    expect(html).toContain('value="all" selected');
    expect(html).toContain('value="exists" selected');
    expect(html).toContain('value="record" selected');
    expect(html).toContain('value="literal" selected');
  });

  it('renders boundary guards and both sides of payload bindings by label', () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(0x20000000);
    const draft = buildEmptyScenario({
      mintId,
      randomSource: () => 0.5,
      mode: 'logical',
      label: 'Boundary',
      document,
    });
    const source = {
      elementId: document.elements[0].id,
      portId: document.elements[0].ports[0].id,
    };
    const scenario = {
      ...draft,
      boundaries: [
        {
          id: mintId(),
          source,
          schemaId: document.schemas[1].id,
          responses: [
            {
              id: mintId(),
              match: {
                op: 'exists' as const,
                value: {
                  kind: 'read' as const,
                  source: 'input' as const,
                  path: [],
                },
              },
              responseFixtureId: document.fixtures[1].id,
              payloadBindings: [{ requestPath: [], targetPath: [] }],
              delayMs: null,
              afterInputId: null,
              outcome: 'succeeded' as const,
            },
          ],
        },
      ],
    };
    const html = renderToStaticMarkup(
      React.createElement(BoundariesSection, {
        document,
        scenario,
        onChange: vi.fn(),
        mintId,
        _defaultExpandedId: scenario.boundaries[0].responses[0].id,
      }),
    );
    expect(html).toContain('Storefront · checkout call');
    expect(html).toContain('Match condition');
    expect(html).toContain('From request');
    expect(html).toContain('Into response');
    expect(html).toContain('Checkout response #1');
  });

  it('keeps accessible move buttons alongside a draggable step handle', () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(0x30000000);
    const draft = buildEmptyScenario({
      mintId,
      randomSource: () => 0.5,
      mode: 'logical',
      label: 'Steps',
      document,
    });
    const entry = {
      elementId: document.elements[1].id,
      portId: document.elements[1].ports[0].id,
    };
    const scenario = {
      ...draft,
      inputs: [
        {
          id: mintId(),
          entry,
          fixtureId: document.fixtures[0].id,
          journeyId: mintId(),
          atMs: null,
          payloadBindings: [],
          resource: null,
        },
        {
          id: mintId(),
          entry,
          fixtureId: document.fixtures[0].id,
          journeyId: mintId(),
          atMs: null,
          payloadBindings: [],
          resource: null,
        },
      ],
    };
    const html = renderToStaticMarkup(
      React.createElement(StepsSection, {
        document,
        scenario,
        onChange: vi.fn(),
        mintId,
        _defaultExpandedId: scenario.inputs[0].id,
      }),
    );
    expect(html).toContain('draggable="true"');
    expect(html).toContain('aria-label="Drag step 1; use arrow keys to reorder"');
    expect(html).toContain('aria-label="Move step up"');
    expect(html).toContain('aria-label="Move step down"');
    expect(reorderInputs(scenario.inputs, scenario.inputs[0].id, scenario.inputs[1].id).map((input) => input.id)).toEqual([
      scenario.inputs[1].id,
      scenario.inputs[0].id,
    ]);
  });
});
