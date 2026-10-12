import { renderDiagramSvg as renderSemanticSvg } from '@canvas-one/system-design/export/svg';
import type { Document } from '../../domain/studio/model';
import { markdownToPlainLines } from '../../lib/miniMarkdown';
import { NOTE_TONE_STYLES } from '../workspace/noteTones';
import { getNodeCaption } from '../workspace/nodeVisuals';
import { CATALOG_LAYER_COLORS, getCatalogLayer } from '../workspace/projection';
export { xmlEscape, parseSvgDimensions } from '@canvas-one/system-design/export/svg';
export type { SvgDimensions, SvgPresentation } from '@canvas-one/system-design/export/svg';
export function renderDiagramSvg(document: Document, viewId?: string | null): string {
 return renderSemanticSvg(document, viewId, { caption: getNodeCaption,
   stripe: (element) => { const layer = getCatalogLayer(element.visualKind); return layer ? CATALOG_LAYER_COLORS[layer] : null; },
   noteLines: markdownToPlainLines, noteFill: (tone) => NOTE_TONE_STYLES[tone].svgFill });
}
