import * as React from 'react';
import type { PanelId, Placement } from '@/features/workspace/panels';

/**
 * Menu and button routes for panel header/rail actions (commands.md §5,
 * `panel.place|collapse|expand|reset-width`, `library|history.close`).
 * The workspace supplies these so every menu trigger runs through the command
 * registry; pointer gestures (drag, resize) keep dispatching reducer events
 * directly because they are high-frequency and only COMMIT persists.
 */
export interface PanelCommandRoutes {
  readonly place: (panelId: PanelId, placement: Placement) => void;
  readonly collapse: (panelId: PanelId) => void;
  readonly expand: (panelId: PanelId) => void;
  readonly resetWidth: (panelId: PanelId) => void;
  readonly close: (panelId: PanelId) => void;
}

export const PanelCommandsContext = React.createContext<PanelCommandRoutes | null>(null);

export function usePanelCommands(): PanelCommandRoutes | null {
  return React.useContext(PanelCommandsContext);
}
