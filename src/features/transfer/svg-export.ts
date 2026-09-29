/**
 * Standalone SVG Diagram Exporter (RV-10a).
 *
 * Implements specifications from:
 * - specs/revamp/contracts/parts-and-export.md ("JSON, images and files")
 * - specs/revamp/requirements.md (R10: Entry and transfer)
 * - specs/revamp/decisions.md (D35, D42: stripes, node captions)
 *
 * Rules:
 * - Standalone SVG string of the view
 * - Placements as node cards with label, caption and stripe
 * - Connections with kind line style and label
 * - Groups and notes
 * - Deterministic output (records sorted by stable ID)
 * - All user text XML-escaped
 * - No external references (no remote images, scripts, fonts)
 * - Fonts as generic families only
 * - Bounding box = content + 32 px padding
 */

import type { Connection, Document, Element, Group, Id, Note, Placement, View } from '../../domain/studio/model';
import { getNodeCaption } from '../workspace/nodeVisuals';
import { CATALOG_LAYER_COLORS, getCatalogLayer } from '../workspace/projection';

export function xmlEscape(text: string | null | undefined): string {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const CARD_HEIGHT = 76;
const PADDING = 32;
const GROUP_PADDING_X = 24;
const GROUP_PADDING_Y_TOP = 36;
const GROUP_PADDING_Y_BOTTOM = 24;

export type SvgDimensions = {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Extracts width and height from an SVG string (or its viewBox).
 */
export function parseSvgDimensions(svg: string): { width: number; height: number } {
  const widthMatch = svg.match(/\bwidth="([0-9.]+)"/);
  const heightMatch = svg.match(/\bheight="([0-9.]+)"/);
  if (widthMatch && heightMatch) {
    return {
      width: Math.round(parseFloat(widthMatch[1])),
      height: Math.round(parseFloat(heightMatch[1])),
    };
  }
  const viewBoxMatch = svg.match(/\bviewBox="[0-9.-]+\s+[0-9.-]+\s+([0-9.]+)\s+([0-9.]+)"/);
  if (viewBoxMatch) {
    return {
      width: Math.round(parseFloat(viewBoxMatch[1])),
      height: Math.round(parseFloat(viewBoxMatch[2])),
    };
  }
  throw new Error('Could not parse dimensions from SVG string');
}

/**
 * Renders a standalone, deterministic SVG string of the specified view in the document.
 */
export function renderDiagramSvg(document: Document, viewId?: string | null): string {
  if (!document || !document.views || document.views.length === 0) {
    throw new Error('Add an element or note before exporting the diagram.');
  }

  const view: View | undefined = viewId
    ? document.views.find((v) => v.id === viewId)
    : document.views[0];

  if (!view) {
    throw new Error(`View '${viewId}' was not found in document.`);
  }

  const placements = [...view.placements].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const notes = [...view.notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const groups = [...view.groups].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (placements.length === 0 && notes.length === 0) {
    throw new Error('Add an element or note before exporting the diagram.');
  }

  // Validate extents
  for (const p of placements) {
    if (Math.abs(p.x) > 1_000_000 || Math.abs(p.y) > 1_000_000) {
      throw new Error('Move components closer to the canvas origin before exporting.');
    }
  }
  for (const n of notes) {
    if (Math.abs(n.x) > 1_000_000 || Math.abs(n.y) > 1_000_000) {
      throw new Error('Move components closer to the canvas origin before exporting.');
    }
  }

  const elementById = new Map<Id, Element>(document.elements.map((el) => [el.id, el]));
  const placementByElementId = new Map<Id, Placement>();
  for (const p of placements) {
    placementByElementId.set(p.elementId, p);
  }

  // Bounds tracking
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  function expandBounds(x: number, y: number, w: number, h: number) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }

  // 1. Group shapes
  const groupSvgParts: string[] = [];
  for (const group of groups) {
    const memberPlacements = placements.filter((p) => group.elementIds.includes(p.elementId));
    if (memberPlacements.length === 0) continue;

    let gMinX = Infinity;
    let gMinY = Infinity;
    let gMaxX = -Infinity;
    let gMaxY = -Infinity;

    for (const p of memberPlacements) {
      gMinX = Math.min(gMinX, p.x);
      gMinY = Math.min(gMinY, p.y);
      gMaxX = Math.max(gMaxX, p.x + p.width);
      gMaxY = Math.max(gMaxY, p.y + CARD_HEIGHT);
    }

    const boxX = gMinX - GROUP_PADDING_X;
    const boxY = gMinY - GROUP_PADDING_Y_TOP;
    const boxWidth = gMaxX - gMinX + GROUP_PADDING_X * 2;
    const boxHeight = gMaxY - gMinY + GROUP_PADDING_Y_TOP + GROUP_PADDING_Y_BOTTOM;

    expandBounds(boxX, boxY, boxWidth, boxHeight);

    const escapedLabel = xmlEscape(group.label);
    const labelBadgeWidth = Math.max(48, Math.min(200, group.label.length * 7 + 16));

    groupSvgParts.push(
      `<g class="diagram-group" data-group-id="${xmlEscape(group.id)}">` +
        `<title>${escapedLabel}</title>` +
        `<rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" rx="8" ry="8" ` +
        `fill="#F7F5F1" fill-opacity="0.3" stroke="#DCD7CD" stroke-width="1.5" stroke-dasharray="5 5"/>` +
        `<rect x="${boxX + 8}" y="${boxY + 6}" width="${labelBadgeWidth}" height="20" rx="4" ` +
        `fill="#FFFFFF" stroke="#DCD7CD" stroke-width="1"/>` +
        `<text x="${boxX + 14}" y="${boxY + 20}" font-family="system-ui, -apple-system, sans-serif" ` +
        `font-size="11" font-weight="500" fill="#1B2421">${escapedLabel}</text>` +
        `</g>`,
    );
  }

  // 2. Element node card shapes
  const nodeSvgParts: string[] = [];
  for (const placement of placements) {
    const element = elementById.get(placement.elementId);
    if (!element) continue;

    const nodeX = placement.x;
    const nodeY = placement.y;
    const nodeWidth = placement.width;
    const nodeHeight = CARD_HEIGHT;

    expandBounds(nodeX, nodeY, nodeWidth, nodeHeight);

    const layer = getCatalogLayer(element.visualKind);
    const stripeColor = layer ? CATALOG_LAYER_COLORS[layer] : null;
    const caption = getNodeCaption(element);

    const escapedLabel = xmlEscape(element.label);
    const escapedCaption = xmlEscape(caption);

    let stripeSvg = '';
    if (stripeColor) {
      stripeSvg = `<rect x="${nodeX}" y="${nodeY}" width="${nodeWidth}" height="3" rx="1.5" fill="${stripeColor}"/>`;
    }

    nodeSvgParts.push(
      `<g class="diagram-node" data-placement-id="${xmlEscape(placement.id)}" data-element-id="${xmlEscape(element.id)}">` +
        `<title>${escapedLabel} — ${escapedCaption}</title>` +
        `<rect x="${nodeX}" y="${nodeY}" width="${nodeWidth}" height="${nodeHeight}" rx="6" ry="6" ` +
        `fill="#FFFFFF" stroke="#DCD7CD" stroke-width="1"/>` +
        stripeSvg +
        `<text x="${nodeX + 12}" y="${nodeY + 28}" font-family="system-ui, -apple-system, sans-serif" ` +
        `font-size="12" font-weight="600" fill="#1B2421">${escapedLabel}</text>` +
        `<text x="${nodeX + 12}" y="${nodeY + 50}" font-family="ui-monospace, monospace" ` +
        `font-size="11" fill="#4A544F">${escapedCaption}</text>` +
        `</g>`,
    );
  }

  // 3. Note shapes
  const noteSvgParts: string[] = [];
  for (const note of notes) {
    const noteX = note.x;
    const noteY = note.y;
    const noteWidth = note.width;
    const lines = note.text.split('\n');
    const noteHeight = Math.max(64, lines.length * 16 + 24);

    expandBounds(noteX, noteY, noteWidth, noteHeight);

    const fill = note.tone === 'paper' ? '#F5F2EB' : '#FFFFFF';
    const escapedText = xmlEscape(note.text);

    const textLinesSvg = lines
      .map((line, idx) => {
        return `<tspan x="${noteX + 12}" y="${noteY + 22 + idx * 16}">${xmlEscape(line)}</tspan>`;
      })
      .join('');

    noteSvgParts.push(
      `<g class="diagram-note" data-note-id="${xmlEscape(note.id)}">` +
        `<title>${escapedText}</title>` +
        `<rect x="${noteX}" y="${noteY}" width="${noteWidth}" height="${noteHeight}" rx="6" ry="6" ` +
        `fill="${fill}" stroke="#DCD7CD" stroke-width="1"/>` +
        `<text font-family="system-ui, -apple-system, sans-serif" font-size="12" fill="#1B2421">` +
        textLinesSvg +
        `</text>` +
        `</g>`,
    );
  }

  // 4. Edge shapes (connections)
  const connectionById = new Map<Id, Connection>(document.connections.map((c) => [c.id, c]));
  const activeConnectionIds = new Set(view.connectionIds);

  // Filter connections: in activeConnectionIds (or present between placed endpoints)
  const relevantConnections: Connection[] = [];
  for (const conn of document.connections) {
    const isExplicit = activeConnectionIds.has(conn.id);
    const bothPlaced =
      placementByElementId.has(conn.source.elementId) &&
      placementByElementId.has(conn.target.elementId);
    if ((isExplicit || activeConnectionIds.size === 0) && bothPlaced) {
      relevantConnections.push(conn);
    }
  }
  // Deterministic sorting by connection ID
  relevantConnections.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const edgeSvgParts: string[] = [];
  const edgeLabelParts: string[] = [];

  relevantConnections.forEach((conn, index) => {
    const sourceP = placementByElementId.get(conn.source.elementId)!;
    const targetP = placementByElementId.get(conn.target.elementId)!;

    const sx = sourceP.x + sourceP.width;
    const sy = sourceP.y + CARD_HEIGHT / 2;
    const tx = targetP.x;
    const ty = targetP.y + CARD_HEIGHT / 2;

    let pathD: string;
    let labelX: number;
    let labelY: number;

    if (tx - sx >= 40 && sourceP.id !== targetP.id) {
      const mid = (sx + tx) / 2;
      pathD = `M ${sx} ${sy} C ${mid} ${sy}, ${mid} ${ty}, ${tx} ${ty}`;
      labelX = mid;
      labelY = (sy + ty) / 2;
    } else {
      const lane = Math.min(sourceP.y, targetP.y) - 30 - (index % 6) * 16;
      pathD = `M ${sx} ${sy} L ${sx + 20} ${sy} L ${sx + 20} ${lane} L ${tx - 20} ${lane} L ${tx - 20} ${ty} L ${tx} ${ty}`;
      labelX = (sx + tx) / 2;
      labelY = lane;
    }

    expandBounds(Math.min(sx, tx), Math.min(sy, ty, labelY), Math.abs(tx - sx) || 20, Math.abs(ty - sy) || 20);

    let dashAttr = '';
    if (conn.kind === 'message') {
      dashAttr = ' stroke-dasharray="6 4"';
    } else if (conn.kind === 'data') {
      dashAttr = ' stroke-dasharray="2 3"';
    }

    edgeSvgParts.push(
      `<path d="${pathD}" fill="none" stroke="#4A544F" stroke-width="1.5" stroke-linejoin="round" ` +
        `marker-end="url(#diagram-arrow)"${dashAttr} data-connection-id="${xmlEscape(conn.id)}"/>`,
    );

    if (conn.label) {
      const escapedEdgeLabel = xmlEscape(conn.label);
      const labelWidth = Math.max(36, Math.min(180, conn.label.length * 6.5 + 12));
      const labelHeight = 18;
      const lx = labelX - labelWidth / 2;
      const ly = labelY - labelHeight / 2;

      expandBounds(lx, ly, labelWidth, labelHeight);

      edgeLabelParts.push(
        `<g class="diagram-edge-label">` +
          `<rect x="${lx}" y="${ly}" width="${labelWidth}" height="${labelHeight}" rx="4" ` +
          `fill="#F7F5F1" stroke="#DCD7CD" stroke-width="1"/>` +
          `<text x="${labelX}" y="${labelY + 4}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" ` +
          `font-size="10" font-weight="500" fill="#4A544F">${escapedEdgeLabel}</text>` +
          `</g>`,
      );
    }
  });

  // 5. Final bounding box calculation with 32px padding
  const svgMinX = Math.floor(minX - PADDING);
  const svgMinY = Math.floor(minY - PADDING);
  const svgWidth = Math.ceil(maxX - minX + PADDING * 2);
  const svgHeight = Math.ceil(maxY - minY + PADDING * 2);

  if (svgWidth > 100_000 || svgHeight > 100_000) {
    throw new Error('Diagram dimensions exceed limit; move elements closer together before exporting.');
  }

  const titleText = xmlEscape(`${document.title || 'System Studio'} — Diagram`);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" ` +
    `viewBox="${svgMinX} ${svgMinY} ${svgWidth} ${svgHeight}" role="img" aria-labelledby="diagram-title" ` +
    `font-family="system-ui, -apple-system, sans-serif">` +
    `<title id="diagram-title">${titleText}</title>` +
    `<defs>` +
    `<marker id="diagram-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">` +
    `<path d="M 0 1 L 7 4 L 0 7 Z" fill="#4A544F"/>` +
    `</marker>` +
    `</defs>` +
    `<rect x="${svgMinX}" y="${svgMinY}" width="${svgWidth}" height="${svgHeight}" fill="#FFFFFF"/>` +
    groupSvgParts.join('') +
    edgeSvgParts.join('') +
    edgeLabelParts.join('') +
    nodeSvgParts.join('') +
    noteSvgParts.join('') +
    `</svg>`;

  return svg;
}
