import { cn } from '@/lib/utils';
import type { PanelId } from '@/features/workspace/panels';

/**
 * Body wrapper classes shared by docked and floating panels. History, Library and the inspector manage
 * their own scroll region, header block and footer, so it gets the full
 * panel edge to edge; other panels keep the padded, scrolling body.
 */
export function panelContentClass(panelId: PanelId, extra?: string): string {
  return cn(
    'flex-1 min-h-0 text-ui bg-panel',
    panelId === 'history' || panelId === 'library' || panelId === 'inspector' ? 'overflow-hidden p-0' : 'overflow-y-auto p-4',
    extra,
  );
}
