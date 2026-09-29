/**
 * Tests for SVG Diagram Exporter (RV-10a).
 *
 * Implements specifications from:
 * - specs/revamp/contracts/parts-and-export.md ("JSON, images and files")
 * - specs/revamp/requirements.md (R10: Entry and transfer)
 *
 * Verification:
 * - SVG determinism
 * - Escaping of hostile labels (<script>, &, quotes)
 * - No external refs (no remote href, no <image>, no external fonts)
 * - Fonts as generic families
 * - Bounding box = content + 32px padding
 * - Node cards with label, caption, stripe
 */

import { describe, expect, it } from 'vitest';
import type { Document } from '../../domain/studio/model';
import { REFERENCE_EXAMPLES } from '../entry/fixtures';
import { parseSvgDimensions, renderDiagramSvg, xmlEscape } from './svg-export';

describe('SVG Diagram Export (renderDiagramSvg)', () => {
  it('escapes hostile characters (&, <, >, ", \') in xmlEscape', () => {
    const raw = '<script>alert("xss" & \'hack\')</script>';
    const escaped = xmlEscape(raw);
    expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot; &amp; &apos;hack&apos;)&lt;/script&gt;');
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
  });

  it('renders deterministically for all S01–S05 reference fixtures', () => {
    for (const example of REFERENCE_EXAMPLES) {
      const svg1 = renderDiagramSvg(example.fixture);
      const svg2 = renderDiagramSvg(example.fixture);
      expect(svg1).toBe(svg2);

      // Verify SVG starts with <svg and ends with </svg>
      expect(svg1.startsWith('<svg')).toBe(true);
      expect(svg1.endsWith('</svg>')).toBe(true);

      // Verify no external references (no http:, https:, //, <image)
      expect(svg1).not.toMatch(/href=["']https?:\/\//i);
      expect(svg1).not.toMatch(/<image\b/i);
      expect(svg1).not.toMatch(/@import/i);

      // Verify generic font families
      expect(svg1).toContain('font-family="system-ui, -apple-system, sans-serif"');

      // Verify dimensions can be parsed
      const { width, height } = parseSvgDimensions(svg1);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
    }
  });

  it('safely escapes hostile labels in placements, groups, and notes without executing or injecting markup', () => {
    const hostileDoc: Document = {
      id: 'hostile-doc',
      schema: 'studio-model/1',
      title: 'Hostile <script>alert("doc")</script>',
      elements: [
        {
          id: 'el-1',
          label: 'Service <script>alert("el1")</script> & "quotes"',
          description: 'Hostile test description',
          visualKind: 'service',
          behavior: { kind: 'unmodeled', version: 1, reason: 'test' },
          ports: [],
        },
      ],
      connections: [],
      relations: [],
      schemas: [],
      fixtures: [],
      refinements: [],
      scenarios: [],
      views: [
        {
          id: 'v-1',
          label: 'Main View <script>',
          placements: [
            {
              id: 'pl-1',
              elementId: 'el-1',
              x: 100,
              y: 100,
              width: 184,
              expanded: false,
            },
          ],
          groups: [
            {
              id: 'g-1',
              label: 'Group <img src=x onerror=alert(1)>',
              elementIds: ['el-1'],
              collapsed: false,
            },
          ],
          notes: [
            {
              id: 'n-1',
              text: 'Note with & and <script> tags',
              tone: 'paper',
              x: 400,
              y: 100,
              width: 200,
              attachedElementIds: [],
            },
          ],
          connectionIds: [],
          relationIds: [],
        },
      ],
    };

    const svg = renderDiagramSvg(hostileDoc, 'v-1');

    // Hostile tags must NOT appear unescaped
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('</script>');
    expect(svg).not.toContain('<img');

    // Escaped entities must be present
    expect(svg).toContain('&lt;script&gt;alert(&quot;el1&quot;)&lt;/script&gt;');
    expect(svg).toContain('&amp; &quot;quotes&quot;');
    expect(svg).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(svg).toContain('Note with &amp; and &lt;script&gt; tags');
  });

  it('computes content bounding box + 32px padding correctly', () => {
    const singleNodeDoc: Document = {
      id: 'doc-box',
      schema: 'studio-model/1',
      title: 'Box Test',
      elements: [
        {
          id: 'e1',
          label: 'Single Element',
          description: 'Single element description',
          visualKind: 'database',
          behavior: {
            kind: 'resource',
            version: 1,
            entryPortId: 'port-1',
            config: {
              type: 'storage',
              capacity: 500,
              writeCapacity: 200,
              queueLimit: 50,
              concurrency: 1,
              failureRate: 0,
              maxRetries: 0,
              retryDelayMs: 0,
            },
          },
          ports: [],
        },
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
            {
              id: 'p1',
              elementId: 'e1',
              x: 100,
              y: 200,
              width: 184,
              expanded: false,
            },
          ],
          groups: [],
          notes: [],
          connectionIds: [],
          relationIds: [],
        },
      ],
    };

    const svg = renderDiagramSvg(singleNodeDoc, 'v1');
    const { width, height } = parseSvgDimensions(svg);

    // Node is at x:100, y:200, width:184, height:76.
    // minX: 100 - 32 = 68. maxX: 100 + 184 + 32 = 316. Width: 316 - 68 = 248 (184 + 64 = 248)
    // minY: 200 - 32 = 168. maxY: 200 + 76 + 32 = 308. Height: 308 - 168 = 140 (76 + 64 = 140)
    expect(width).toBe(184 + 64);
    expect(height).toBe(76 + 64);
    expect(svg).toContain('viewBox="68 168 248 140"');

    // Contains stripe for database (data layer -> #8A4F6E)
    expect(svg).toContain('fill="#8A4F6E"');
    // Contains caption "storage · 500 /s cap"
    expect(svg).toContain('storage · 500 /s cap');
  });

  it('rejects an empty view with a clear message', () => {
    const emptyDoc: Document = {
      id: 'doc-empty',
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
          id: 'v-empty',
          label: 'Empty View',
          placements: [],
          groups: [],
          notes: [],
          connectionIds: [],
          relationIds: [],
        },
      ],
    };

    expect(() => renderDiagramSvg(emptyDoc, 'v-empty')).toThrow(
      'Add an element or note before exporting the diagram.',
    );
  });
});
