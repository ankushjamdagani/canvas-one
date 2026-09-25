/**
 * Mermaid v1 Flowchart Exporter (RV-10a).
 *
 * Implements specifications from:
 * - specs/revamp/contracts/parts-and-export.md ("Mermaid v1")
 * - specs/revamp/requirements.md (R10: Entry and transfer)
 *
 * Rules:
 * - Output plain text `flowchart LR` only
 * - Selected view elements sorted by stable ID map to generated n0, n1, ...
 * - Groups sorted by stable ID map to g0, g1, ...
 * - Wholly represented non-overlapping view groups emit subgraph g0["encoded label"]
 * - Each node emitted once using n0["encoded label"]
 * - All edges emitted after all node/subgraph declarations
 * - Connections emit n0 -->|"encoded kind: label"| n1 (omit colon suffix for empty label)
 * - Descriptive/contains/deployed-on relations emit dotted n0 -.->|"encoded kind: label"| n1
 * - Escaping by Unicode code point: preserve ASCII letters/digits/space and non-ASCII letters;
 *   normalize CR/LF/tab to spaces; encode all other punctuation/control chars as #NN;
 * - Empty view rejects with "Add an element before exporting."
 * - Output format: UTF-8 without BOM, LF newline, final LF, <= 2 MiB.
 */

import type { Connection, Document, Element, Group, Id, Relation, View } from '../../domain/studio/model';
import { mermaidFileName } from './filename';
import { MERMAID_EXPORT_LIMITATIONS } from './limitations';
import type { MermaidExportResult } from './types';

const MAX_MERMAID_BYTES = 2 * 1024 * 1024; // 2 MiB

/**
 * Encodes a label for Mermaid flowchart v1 syntax.
 * - Preserves ASCII letters (a-z, A-Z), digits (0-9), and space (0x20).
 * - Preserves non-ASCII letters (\p{L}).
 * - Normalizes CR, LF, and tab to spaces.
 * - Encodes all other punctuation, symbols, and control code points as `#NN;`
 */
export function encodeMermaidLabel(text: string | null | undefined): string {
  if (text == null) return '';
  // Normalize CR/LF/tab to space
  const normalized = String(text).replace(/[\r\n\t]/g, ' ');

  let out = '';
  for (const char of normalized) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;

    if (
      (cp >= 0x41 && cp <= 0x5a) || // A-Z
      (cp >= 0x61 && cp <= 0x7a) || // a-z
      (cp >= 0x30 && cp <= 0x39) || // 0-9
      cp === 0x20 // space
    ) {
      out += char;
    } else if (cp > 0x7f && /^\p{L}$/u.test(char)) {
      // Non-ASCII Unicode letter
      out += char;
    } else {
      // Decimal entity syntax #NN;
      out += `#${cp};`;
    }
  }

  return out;
}

/**
 * Renders the view as a Mermaid flowchart LR diagram string.
 */
export function renderDiagramMermaid(document: Document, viewId?: string | null): string {
  if (!document || !document.views || document.views.length === 0) {
    throw new Error('Add an element before exporting.');
  }

  const view: View | undefined = viewId
    ? document.views.find((v) => v.id === viewId)
    : document.views[0];

  if (!view) {
    throw new Error(`View '${viewId}' was not found in document.`);
  }

  const placedElementIds = new Set<Id>(view.placements.map((p) => p.elementId));
  if (placedElementIds.size === 0) {
    throw new Error('Add an element before exporting.');
  }

  // Find all elements placed in the view
  const elements = document.elements.filter((el) => placedElementIds.has(el.id));
  if (elements.length === 0) {
    throw new Error('Add an element before exporting.');
  }

  // Sort elements by stable ID ascending -> map to n0, n1, ...
  elements.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const elementToNodeId = new Map<Id, string>();
  elements.forEach((el, index) => {
    elementToNodeId.set(el.id, `n${index}`);
  });

  // Sort groups by stable ID ascending
  const viewGroups = [...view.groups].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Determine wholly represented, non-overlapping groups
  const claimedElementIds = new Set<Id>();
  const activeSubgraphs: { group: Group; groupId: string; members: Element[] }[] = [];

  for (const group of viewGroups) {
    // Wholly represented: all member element IDs must be placed in this view
    const isWhollyRepresented =
      group.elementIds.length > 0 &&
      group.elementIds.every((id) => elementToNodeId.has(id));

    if (!isWhollyRepresented) continue;

    // Non-overlapping: cannot share elements with an already claimed group
    const overlaps = group.elementIds.some((id) => claimedElementIds.has(id));
    if (overlaps) continue;

    // Claim member elements
    for (const id of group.elementIds) {
      claimedElementIds.add(id);
    }

    const members = group.elementIds
      .map((id) => elements.find((e) => e.id === id)!)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const groupId = `g${activeSubgraphs.length}`;
    activeSubgraphs.push({
      group,
      groupId,
      members,
    });
  }

  const lines: string[] = ['flowchart LR'];

  // 1. Emit subgraphs with member node declarations
  for (const sg of activeSubgraphs) {
    const encodedGroupLabel = encodeMermaidLabel(sg.group.label);
    lines.push(`  subgraph ${sg.groupId}["${encodedGroupLabel}"]`);
    for (const member of sg.members) {
      const nid = elementToNodeId.get(member.id)!;
      const encodedLabel = encodeMermaidLabel(member.label);
      lines.push(`    ${nid}["${encodedLabel}"]`);
    }
    lines.push('  end');
  }

  // 2. Emit ungrouped elements (each node emitted once)
  for (const el of elements) {
    if (!claimedElementIds.has(el.id)) {
      const nid = elementToNodeId.get(el.id)!;
      const encodedLabel = encodeMermaidLabel(el.label);
      lines.push(`  ${nid}["${encodedLabel}"]`);
    }
  }

  // 3. Emit connections (behavioral) whose endpoints are placed
  const relevantConnections = document.connections.filter(
    (conn) =>
      elementToNodeId.has(conn.source.elementId) &&
      elementToNodeId.has(conn.target.elementId),
  );
  relevantConnections.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const conn of relevantConnections) {
    const sourceNode = elementToNodeId.get(conn.source.elementId)!;
    const targetNode = elementToNodeId.get(conn.target.elementId)!;
    const labelText = conn.label ? `${conn.kind}: ${conn.label}` : conn.kind;
    const encodedEdgeLabel = encodeMermaidLabel(labelText);
    lines.push(`  ${sourceNode} -->|"${encodedEdgeLabel}"| ${targetNode}`);
  }

  // 4. Emit relations (descriptive / contains / deployed-on) whose endpoints are placed
  const relevantRelations: { relation: Relation; sourceId: Id; targetId: Id }[] = [];
  for (const rel of document.relations) {
    let sourceId: Id;
    let targetId: Id;
    if (rel.kind === 'contains') {
      sourceId = rel.parentId;
      targetId = rel.childId;
    } else if (rel.kind === 'deployed-on') {
      sourceId = rel.elementId;
      targetId = rel.hostId;
    } else {
      sourceId = rel.sourceId;
      targetId = rel.targetId;
    }

    if (elementToNodeId.has(sourceId) && elementToNodeId.has(targetId)) {
      relevantRelations.push({ relation: rel, sourceId, targetId });
    }
  }
  relevantRelations.sort((a, b) =>
    a.relation.id < b.relation.id ? -1 : a.relation.id > b.relation.id ? 1 : 0,
  );

  for (const item of relevantRelations) {
    const sourceNode = elementToNodeId.get(item.sourceId)!;
    const targetNode = elementToNodeId.get(item.targetId)!;
    const labelText = item.relation.label
      ? `${item.relation.kind}: ${item.relation.label}`
      : item.relation.kind;
    const encodedRelLabel = encodeMermaidLabel(labelText);
    lines.push(`  ${sourceNode} -.->|"${encodedRelLabel}"| ${targetNode}`);
  }

  // Output formatting: LF newline, final LF, UTF-8 without BOM
  const output = lines.join('\n') + '\n';

  const byteLength = new TextEncoder().encode(output).byteLength;
  if (byteLength > MAX_MERMAID_BYTES) {
    throw new Error(`Mermaid export (${byteLength} bytes) exceeds the 2 MiB limit`);
  }

  return output;
}

/**
 * Convenience helper to export Mermaid text and filename.
 */
export function exportDiagramMermaid(
  document: Document,
  viewId?: string | null,
): MermaidExportResult {
  const text = renderDiagramMermaid(document, viewId);
  return {
    text,
    fileName: mermaidFileName(document.title),
    limitations: MERMAID_EXPORT_LIMITATIONS,
  };
}
