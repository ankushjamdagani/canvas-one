import { validateGraph, supportsFreeCanvas, type Project, type ModelNode } from "../domain/model";
import { componentDefinition } from "../domain/componentCatalog";
import { validateSubsystems, visibleSubsystems } from "../domain/subsystems";
import { noteAttachmentLabel, noteKinds, type CanvasNote } from "../domain/notes";

export interface DiagramSvg { svg: string; width: number; height: number }
interface Box { x: number; y: number; width: number; height: number }
const CARD_WIDTH = 215, CARD_HEIGHT = 112;
const NOTE_WIDTH = 240, NOTE_COLLAPSED_HEIGHT = 80, NOTE_EXPANDED_HEIGHT = 200;

/** XML 1.0 text: remove invalid control characters and escape every markup delimiter. */
function xml(value: string): string {
  return Array.from(value).filter((char) => !(char.length === 1 && char.charCodeAt(0) >= 0xd800 && char.charCodeAt(0) <= 0xdfff)).join("").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function glyphUnits(char: string): number {
  return /[MW@]/.test(char) ? 1.7 : /[A-Z]/.test(char) ? 1.3 : char.codePointAt(0)! > 255 ? 2 : 1;
}
function lines(value: string, columns: number, count: number): string[] {
  const chars = Array.from(value.replace(/\s+/g, " ").trim());
  const result: string[] = [];
  while (chars.length && result.length < count) {
    // Conservative glyph widths avoid long uppercase/CJK labels escaping compact cards.
    let take = 0, used = 0;
    while (take < chars.length) {
      const char = chars[take];
      const units = glyphUnits(char);
      if (used + units > columns && take > 0) break;
      used += units; take++;
    }
    if (take < chars.length) {
      const space = chars.slice(0, take).lastIndexOf(" ");
      if (space > 0) take = space;
    }
    result.push(chars.splice(0, take).join("").trim());
    while (chars[0] === " ") chars.shift();
  }
  if (chars.length) result[result.length - 1] = result.at(-1)!.slice(0, -1) + "…";
  return result;
}
function text(value: string, x: number, y: number, columns: number, count: number, size = 12, color = "#243b41", weight = 400): string {
  return lines(value, columns, count).map((line, index) =>
    `<text x="${x}" y="${y + index * (size + 3)}" font-size="${size}" font-weight="${weight}" fill="${color}">${xml(line)}</text>`).join("");
}
function rect(box: Box, fill: string, stroke: string, radius = 9, extra = ""): string {
  return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${radius}" fill="${fill}" stroke="${stroke}" ${extra}/>`;
}
function noteShape(note: CanvasNote, project: Project): { shape: string; box: Box } {
  const box = { x: note.position.x, y: note.position.y, width: NOTE_WIDTH, height: note.collapsed ? NOTE_COLLAPSED_HEIGHT : NOTE_EXPANDED_HEIGHT };
  const type = noteKinds[note.kind];
  const attachment = note.attachment ? (noteAttachmentLabel(note, project) ?? "Linked item unavailable") : undefined;
  const full = [type, note.title, note.body, attachment].filter(Boolean).join(" — ");
  const body = note.collapsed ? "" : text(note.body, box.x + 14, box.y + 78, 31, 6, 10, "#5e5142");
  const linked = attachment && !note.collapsed ? text(attachment, box.x + 14, box.y + 181, 31, 1, 10, "#80500d") : "";
  const shape = `<g><title>${xml(full)}</title>` +
    rect(box, "#fff3df", "#e0b76c", 9) +
    text(type, box.x + 14, box.y + 20, 31, 1, 10, "#80500d", 600) +
    text(note.title, box.x + 14, box.y + 43, 29, 2, 13, "#243b41", 600) +
    body + linked + "</g>";
  return { shape, box };
}

/** A standalone vector rendition, independent of DOM, zoom, selection and worker state. */
export function renderDiagramSvg(project: Project): DiagramSvg {
  if (!supportsFreeCanvas(project.graph)) {
    throw new Error("Choose Architecture diagram to export an image.");
  }
  const errors = [...validateGraph(project.graph, false), ...validateSubsystems(project.subsystems)];
  if (errors.length) throw new Error(errors[0]);
  const notes = project.graph.notes ?? [];
  if (!project.graph.nodes.length && !notes.length) throw new Error("Add a component or note before exporting the diagram.");
  // Bound absolute coordinates as well as extent to avoid precision loss in SVG geometry.
  if (project.graph.nodes.some((node) => Math.abs(node.position.x) > 1_000_000 || Math.abs(node.position.y) > 1_000_000))
    throw new Error("Move components closer to the canvas origin before exporting.");
  const boxes = new Map<string, Box>(project.graph.nodes.map((node) => [node.id, {
    x: node.position.x, y: node.position.y, width: CARD_WIDTH, height: CARD_HEIGHT,
  }]));
  const groups = visibleSubsystems(project);
  if (groups.some((group) => boxes.has(group.id))) throw new Error("Subsystem IDs must differ from component IDs.");
  const endpoints = new Map<string, string>();
  const hidden = new Set<string>();
  const groupShapes: string[] = [], collapsedShapes: string[] = [];
  const bounds: Box[] = [];
  for (const group of groups) {
    const members = group.nodeIds.map((id) => boxes.get(id)!);
    const left = Math.min(...members.map((box) => box.x)) - 24;
    const top = Math.min(...members.map((box) => box.y)) - 64;
    const right = Math.max(...members.map((box) => box.x + box.width)) + 24;
    const bottom = Math.max(...members.map((box) => box.y + box.height)) + 24;
    const box: Box = group.collapsed
      ? { x: left + 48, y: top + 71, width: 240, height: 112 }
      : { x: left, y: top, width: right - left, height: bottom - top };
    bounds.push(box);
    const shape = `<g><title>${xml(group.name)} · ${group.nodeIds.length} components</title>` +
      rect(box, group.collapsed ? "#eef7f5" : "#f7faf8", "#8db7ac", 10, group.collapsed ? "" : 'stroke-dasharray="5 4"') +
      text(group.name, box.x + 14, box.y + 23, 29, 2, 13, "#243b41", 600) +
      text(`${group.nodeIds.length} components${group.collapsed ? " · collapsed" : ""}`, box.x + 14, box.y + (group.collapsed ? 66 : 55), 32, 1, 10, "#5e7267") +
      (group.collapsed ? text("Architecture boundary", box.x + 14, box.y + 89, 30, 1, 11, "#087f84") : "") + "</g>";
    if (group.collapsed) {
      boxes.set(group.id, box);
      for (const id of group.nodeIds) { endpoints.set(id, group.id); hidden.add(id); }
      collapsedShapes.push(shape);
    } else groupShapes.push(shape);
  }
  const nodeShapes = project.graph.nodes.filter((node) => !hidden.has(node.id)).map((node: ModelNode) => {
    const box = boxes.get(node.id)!;
    bounds.push(box);
    const type = node.kind === "custom" ? node.customType! : componentDefinition(node.kind).label;
    return `<g><title>${xml([node.name, type, node.description].filter(Boolean).join(" — "))}</title>` +
      rect(box, "#ffffff", "#d6e2dc") +
      text(node.name, box.x + 14, box.y + 23, 23, 2, 13, "#243b41", 600) +
      text(type, box.x + 14, box.y + 61, 29, 1, 10, "#087f84", 600) +
      text(node.description || "Architecture component", box.x + 14, box.y + 80, 30, 2, 10, "#5e7267") + "</g>";
  });
  const noteShapes: string[] = [];
  for (const note of notes) {
    const rendered = noteShape(note, project);
    bounds.push(rendered.box);
    noteShapes.push(rendered.shape);
  }
  const edgeShapes: string[] = [], labelShapes: string[] = [];
  project.graph.edges.forEach((edge, index) => {
    const sourceId = endpoints.get(edge.source) ?? edge.source;
    const targetId = endpoints.get(edge.target) ?? edge.target;
    // Keep real self-loops; hide only relationships internal to a collapsed boundary.
    if (sourceId === targetId && (hidden.has(edge.source) || hidden.has(edge.target))) return;
    const source = boxes.get(sourceId)!, target = boxes.get(targetId)!;
    const sx = source.x + source.width, sy = source.y + source.height / 2;
    const tx = target.x, ty = target.y + target.height / 2;
    let points: number[][], labelX: number, labelY: number;
    if (tx - sx >= 40 && sourceId !== targetId) {
      const mid = (sx + tx) / 2;
      points = [[sx, sy], [mid, sy], [mid, ty], [tx, ty]];
      labelX = mid; labelY = (sy + ty) / 2;
    } else {
      const lane = Math.min(source.y, target.y) - 36 - (index % 8) * 18;
      points = [[sx, sy], [sx + 24, sy], [sx + 24, lane], [tx - 24, lane], [tx - 24, ty], [tx, ty]];
      labelX = (sx + tx) / 2; labelY = lane;
    }
    points.forEach(([x, y]) => bounds.push({ x, y, width: 0, height: 0 }));
    let dash = "";
    if (edge.transport === "message") {
      dash = ' stroke-dasharray="7 5"';
    } else if (edge.transport === "call") {
      dash = "";
    } else if (edge.communication === "async") {
      dash = ' stroke-dasharray="7 5"';
    } else if (edge.communication === "data") {
      dash = ' stroke-dasharray="2 4"';
    }
    edgeShapes.push(`<path d="${points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ")}" fill="none" stroke="#72b4b2" stroke-width="1.5" stroke-linejoin="round" marker-end="url(#diagram-arrow)"${dash}/>`);
    const label = [edge.label, edge.protocol].filter(Boolean).join(" · ");
    if (label) {
      const columns = tx - sx >= 40 && sourceId !== targetId ? Math.max(4, Math.min(32, Math.floor((tx - sx - 10) / 6.2))) : 32;
      const wrapped = [edge.label, edge.protocol].filter((value): value is string => !!value).flatMap((value) => lines(value, columns, 24));
      const width = Math.max(40, Math.max(...wrapped.map((line) => Array.from(line).reduce((sum, char) => sum + glyphUnits(char), 0))) * 6.2 + 10);
      const box = { x: labelX - width / 2, y: labelY - (wrapped.length * 14 + 10) / 2, width, height: wrapped.length * 14 + 10 };
      bounds.push(box);
      labelShapes.push(`<g><title>${xml(label)}</title>${rect(box, "#ffffff", "#dce7e1", 4)}` +
        wrapped.map((line, lineIndex) => text(line, box.x + 5, box.y + 15 + lineIndex * 14, 100, 1, 11, "#243b41")).join("") + "</g>");
    }
  });
  const minX = Math.min(...bounds.map((box) => box.x)) - 32;
  const minY = Math.min(...bounds.map((box) => box.y)) - 32;
  const width = Math.ceil(Math.max(...bounds.map((box) => box.x + box.width)) - minX + 32);
  const height = Math.ceil(Math.max(...bounds.map((box) => box.y + box.height)) - minY + 32);
  if (width > 100_000 || height > 100_000) throw new Error("Move components closer together before exporting this diagram.");
  const isVisualOnly = project.graph.scenario === "diagram";
  const titleDesc = isVisualOnly
    ? `<title id="diagram-title">${xml(project.name)} — Architecture diagram</title><desc>Entire diagram with current subsystem collapse state. Visual architecture only. Full component notes are available in element titles.</desc>`
    : `<title id="diagram-title">${xml(project.name)} — System design</title><desc>Entire canvas with current subsystem collapse state. Configured system snapshot. Full component notes are available in element titles.</desc>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" role="img" aria-labelledby="diagram-title" font-family="Arial, Helvetica, sans-serif">${titleDesc}<defs><marker id="diagram-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L8 4 L0 8 Z" fill="#087f84"/></marker></defs><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#ffffff"/>${groupShapes.join("")}${edgeShapes.join("")}${nodeShapes.join("")}${collapsedShapes.join("")}${labelShapes.join("")}${noteShapes.join("")}</svg>`;
  return { svg, width, height };
}

/** Prefer 2× output, bounded to 8192 per side and 16 million total pixels. */
export function pngDimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error("The diagram has invalid image dimensions.");
  const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(16_000_000 / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
