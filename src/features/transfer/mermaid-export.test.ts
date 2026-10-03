/**
 * Tests for Mermaid v1 Flowchart Exporter (RV-10a).
 *
 * Implements specifications from:
 * - specs/revamp/contracts/parts-and-export.md ("Mermaid v1")
 * - specs/revamp/requirements.md (R10: Entry and transfer)
 *
 * Verification:
 * - Mermaid label escaping: letters, digits, spaces, non-ASCII letters, decimal entity encoding #NN;
 * - Collision-free generated IDs (n0, n1, ... and g0, g1, ...)
 * - Subgraphs: wholly represented groups emitted as subgraph g0 ... end; partly represented omitted
 * - Edges and relations: directed with labels and kinds (-->|"call: label"|, -.->|"contains: label"|)
 * - Empty view rejection: "Add an element before exporting."
 * - Hostile labels: 'end' as label, quotes, pipes, backticks, script tags, duplicate labels
 */

import { describe, expect, it } from 'vitest';
import type { Document } from '../../domain/studio/model';
import { REFERENCE_EXAMPLES } from '../entry/fixtures';
import { encodeMermaidLabel, exportDiagramMermaid, renderDiagramMermaid } from './mermaid-export';

describe('Mermaid v1 Diagram Export (renderDiagramMermaid)', () => {
  it('encodes labels according to Unicode code point rules in encodeMermaidLabel', () => {
    // Preserves ASCII letters, digits, and space
    expect(encodeMermaidLabel('User Service 123')).toBe('User Service 123');

    // Preserves non-ASCII letters (Unicode \p{L})
    expect(encodeMermaidLabel('Servicio Español 中文 Café')).toBe('Servicio Español 中文 Café');

    // Normalizes CR, LF, tab to space
    expect(encodeMermaidLabel('Line1\r\nLine2\tTab')).toBe('Line1  Line2 Tab');

    // Encodes punctuation/symbols using #NN;
    expect(encodeMermaidLabel('"quote"')).toBe('#34;quote#34;');
    expect(encodeMermaidLabel('a | b')).toBe('a #124; b');
    expect(encodeMermaidLabel('`code`')).toBe('#96;code#96;');
    expect(encodeMermaidLabel('<script>alert("x")</script>')).toBe(
      '#60;script#62;alert#40;#34;x#34;#41;#60;#47;script#62;',
    );
    expect(encodeMermaidLabel('item #1 & #2')).toBe('item #35;1 #38; #35;2');
    expect(encodeMermaidLabel('colon: semicolon;')).toBe('colon#58; semicolon#59;');
  });

  it('renders flowchart LR with collision-free node IDs sorted by element.id', () => {
    const doc: Document = {
      id: 'doc-m1',
      schema: 'studio-model/1',
      title: 'Mermaid Test',
      elements: [
        { id: 'el-zebra', label: 'Zebra Service', description: 'Zebra', visualKind: 'service', behavior: { kind: 'unmodeled', version: 1, reason: 'test' }, ports: [] },
        { id: 'el-alpha', label: 'Alpha Service', description: 'Alpha', visualKind: 'service', behavior: { kind: 'unmodeled', version: 1, reason: 'test' }, ports: [] },
      ],
      connections: [
        {
          id: 'c1',
          kind: 'call',
          config: {
            latencyMs: 10,
            returnLatencyMs: 10,
            weight: 1,
            condition: null,
            fallback: false,
            resource: null,
          },
          source: { elementId: 'el-alpha', portId: 'port-out' },
          target: { elementId: 'el-zebra', portId: 'port-in' },
        },
      ],
      relations: [],
      schemas: [],
      fixtures: [],
      refinements: [],
      scenarios: [],
      views: [
        {
          id: 'v1',
          label: 'V1',
          placements: [
            { id: 'p1', elementId: 'el-zebra', x: 200, y: 100, width: 184, expanded: false },
            { id: 'p2', elementId: 'el-alpha', x: 0, y: 100, width: 184, expanded: false },
          ],
          groups: [],
          notes: [],
          connectionIds: ['c1'],
          relationIds: [],
        },
      ],
    };

    const mermaid = renderDiagramMermaid(doc, 'v1');
    expect(mermaid.startsWith('flowchart LR\n')).toBe(true);

    // Sorted by element.id: el-alpha -> n0, el-zebra -> n1
    expect(mermaid).toContain('n0["Alpha Service"]');
    expect(mermaid).toContain('n1["Zebra Service"]');

    // Edge from n0 to n1 with kind and label
    expect(mermaid).toContain('n0 -->|"call"| n1');
  });

  it('emits wholly represented groups as subgraphs and omits partially represented groups', () => {
    const doc: Document = {
      id: 'doc-m2',
      schema: 'studio-model/1',
      title: 'Groups Test',
      elements: [
        { id: 'e1', label: 'Service A', description: 'A', visualKind: 'service', behavior: { kind: 'unmodeled', version: 1, reason: 'test' }, ports: [] },
        { id: 'e2', label: 'Service B', description: 'B', visualKind: 'service', behavior: { kind: 'unmodeled', version: 1, reason: 'test' }, ports: [] },
        { id: 'e3', label: 'Service C (unplaced)', description: 'C', visualKind: 'service', behavior: { kind: 'unmodeled', version: 1, reason: 'test' }, ports: [] },
      ],
      connections: [],
      relations: [],
      schemas: [],
      fixtures: [],
      refinements: [],
      scenarios: [],
      views: [
        {
          id: 'v1',
          label: 'V1',
          placements: [
            { id: 'p1', elementId: 'e1', x: 0, y: 0, width: 184, expanded: false },
            { id: 'p2', elementId: 'e2', x: 200, y: 0, width: 184, expanded: false },
          ],
          groups: [
            {
              id: 'g-whole',
              label: 'Wholly Represented Group',
              elementIds: ['e1', 'e2'],
              collapsed: false,
            },
            {
              id: 'g-partial',
              label: 'Partial Group',
              elementIds: ['e1', 'e3'], // e3 is NOT placed in this view!
              collapsed: false,
            },
          ],
          notes: [],
          connectionIds: [],
          relationIds: [],
        },
      ],
    };

    const mermaid = renderDiagramMermaid(doc, 'v1');

    // g-whole is wholly placed -> emitted as subgraph g0
    expect(mermaid).toContain('subgraph g0["Wholly Represented Group"]');
    expect(mermaid).toContain('end');

    // g-partial is partial -> omitted from subgraph emission
    expect(mermaid).not.toContain('Partial Group');
  });

  it('handles hostile labels, including "end" as label, duplicate labels, and special symbols', () => {
    const doc: Document = {
      id: 'doc-m3',
      schema: 'studio-model/1',
      title: 'Hostile Test',
      elements: [
        { id: 'e1', label: 'end', description: 'end1', visualKind: 'service', behavior: { kind: 'unmodeled', version: 1, reason: 'test' }, ports: [] },
        { id: 'e2', label: 'end', description: 'end2', visualKind: 'service', behavior: { kind: 'unmodeled', version: 1, reason: 'test' }, ports: [] },
        { id: 'e3', label: '<script>alert(1)</script>', description: 'script', visualKind: 'service', behavior: { kind: 'unmodeled', version: 1, reason: 'test' }, ports: [] },
      ],
      connections: [
        {
          id: 'c1',
          kind: 'message',
          config: {
            latencyMs: 10,
            ackDelayMs: 0,
            messageTtlMs: 10000,
            weight: 1,
            condition: null,
            fallback: false,
            resource: null,
          },
          source: { elementId: 'e1', portId: 'port-1' },
          target: { elementId: 'e2', portId: 'port-2' },
        },
      ],
      relations: [
        {
          id: 'r1',
          label: 'owns',
          kind: 'contains',
          parentId: 'e1',
          childId: 'e3',
        },
      ],
      schemas: [],
      fixtures: [],
      refinements: [],
      scenarios: [],
      views: [
        {
          id: 'v1',
          label: 'V1',
          placements: [
            { id: 'p1', elementId: 'e1', x: 0, y: 0, width: 184, expanded: false },
            { id: 'p2', elementId: 'e2', x: 200, y: 0, width: 184, expanded: false },
            { id: 'p3', elementId: 'e3', x: 400, y: 0, width: 184, expanded: false },
          ],
          groups: [],
          notes: [],
          connectionIds: ['c1'],
          relationIds: [],
        },
      ],
    };

    const mermaid = renderDiagramMermaid(doc, 'v1');

    // Duplicate labels have distinct collision-free IDs n0, n1
    expect(mermaid).toContain('n0["end"]');
    expect(mermaid).toContain('n1["end"]');
    expect(mermaid).toContain('n2["#60;script#62;alert#40;1#41;#60;#47;script#62;"]');

    // Empty connection label omits colon suffix
    expect(mermaid).toContain('n0 -->|"message"| n1');

    // Relation is dotted
    expect(mermaid).toContain('n0 -.->|"contains#58; owns"| n2');
  });

  it('rejects an empty view with "Add an element before exporting."', () => {
    const emptyDoc: Document = {
      id: 'doc-m-empty',
      schema: 'studio-model/1',
      title: 'Empty',
      elements: [],
      connections: [],
      relations: [],
      schemas: [],
      fixtures: [],
      refinements: [],
      scenarios: [],
      views: [
        {
          id: 'v1',
          label: 'Empty',
          placements: [],
          groups: [],
          notes: [],
          connectionIds: [],
          relationIds: [],
        },
      ],
    };

    expect(() => renderDiagramMermaid(emptyDoc, 'v1')).toThrow('Add an element before exporting.');
  });

  it('exports all S01–S05 reference fixtures cleanly via exportDiagramMermaid', () => {
    for (const example of REFERENCE_EXAMPLES) {
      const result = exportDiagramMermaid(example.fixture);
      expect(result.text.startsWith('flowchart LR\n')).toBe(true);
      expect(result.text.endsWith('\n')).toBe(true);
      expect(result.fileName).toMatch(/\.mmd$/);
      expect(result.limitations).toContain('Lossy diagram export');
    }
  });
});
