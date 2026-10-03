import type { NoteTone } from '../../domain/studio/model';

/** Class names are written out in full so Tailwind can see them. */
export const NOTE_TONE_STYLES: Record<
  NoteTone,
  { readonly label: string; readonly card: string; readonly swatch: string; readonly svgFill: string }
> = {
  paper: { label: 'Yellow', card: 'bg-note border-note-edge', swatch: 'bg-note border-note-edge', svgFill: '#FBF6E8' },
  neutral: { label: 'Gray', card: 'bg-panel border-control-border', swatch: 'bg-panel border-control-border', svgFill: '#FFFFFF' },
  sky: { label: 'Blue', card: 'bg-note-sky border-note-sky-edge', swatch: 'bg-note-sky border-note-sky-edge', svgFill: '#EAF2F8' },
  mint: { label: 'Green', card: 'bg-note-mint border-note-mint-edge', swatch: 'bg-note-mint border-note-mint-edge', svgFill: '#E9F4EB' },
  rose: { label: 'Pink', card: 'bg-note-rose border-note-rose-edge', swatch: 'bg-note-rose border-note-rose-edge', svgFill: '#F9ECE9' },
  lilac: { label: 'Purple', card: 'bg-note-lilac border-note-lilac-edge', swatch: 'bg-note-lilac border-note-lilac-edge', svgFill: '#F1EBF8' },
};
