import * as React from 'react';
import {
  History as HistoryIcon,
  LayoutGrid,
  ChevronsRight,
  ChevronsLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  PanelId,
  WorkspacePanelAction,
} from '@/features/workspace/panels';
import { usePanelCommands } from './panelCommands';

export interface PanelRailItemConfig {
  id: PanelId;
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  hasUnseenChanges?: boolean;
}

export interface PanelRailProps {
  side: 'left' | 'right';
  collapsedPanels: PanelRailItemConfig[];
  dispatch: (action: WorkspacePanelAction) => void;
  renderPanel: (panelId: PanelId) => React.ReactNode;
  activePeekPanel?: PanelId | null;
  onPeekChange?: (panelId: PanelId | null) => void;
  className?: string;
}

const defaultIcons: Record<PanelId, React.ComponentType<{ className?: string }>> = {
  history: HistoryIcon,
  library: LayoutGrid,
};

export const PanelRail: React.FC<PanelRailProps> = ({
  side,
  collapsedPanels,
  dispatch,
  renderPanel,
  activePeekPanel,
  onPeekChange,
  className,
}) => {
  const [hoveredPanel, setHoveredPanel] = React.useState<PanelId | null>(null);
  const [focusedPanel, setFocusedPanel] = React.useState<PanelId | null>(null);
  const routes = usePanelCommands();
  const expand = (panel: PanelId) => (routes ? routes.expand(panel) : dispatch({ type: 'EXPAND', panel }));

  if (collapsedPanels.length === 0) {
    return null;
  }

  const effectivePeek = activePeekPanel !== undefined ? activePeekPanel : (hoveredPanel || focusedPanel);

  return (
    <aside
      data-slot="panel-rail"
      data-side={side}
      aria-label={`${side} collapsed panel rail`}
      className={cn(
        'relative flex flex-col justify-between w-11 h-full bg-shell border-border select-none shrink-0 z-chrome',
        side === 'left' ? 'border-r' : 'border-l',
        className
      )}
    >
      {/* Top list of collapsed panel tabs */}
      <div className="flex flex-col items-center py-2 gap-2">
        {collapsedPanels.map((item, index) => {
          const Icon = item.icon || defaultIcons[item.id] || LayoutGrid;
          const isPeekOpen = effectivePeek === item.id;

          return (
            <React.Fragment key={item.id}>
              {index > 0 && <div className="h-px w-5 bg-border my-1" aria-hidden="true" />}
              <div
                className="relative flex flex-col items-center"
                onMouseEnter={() => {
                  setHoveredPanel(item.id);
                  onPeekChange?.(item.id);
                }}
                onMouseLeave={() => {
                  setHoveredPanel(null);
                  onPeekChange?.(null);
                }}
              >
                {/* Button for Icon and label */}
                <button
                  type="button"
                  data-slot="rail-item-button"
                  data-panel-id={item.id}
                  aria-label={`Expand ${item.title} panel`}
                  onClick={() => {
                    expand(item.id);
                    onPeekChange?.(null);
                  }}
                  onFocus={() => {
                    setFocusedPanel(item.id);
                    onPeekChange?.(item.id);
                  }}
                  onBlur={() => {
                    setFocusedPanel(null);
                    onPeekChange?.(null);
                  }}
                  className={cn(
                    'group relative flex flex-col items-center gap-2 p-1.5 rounded-md text-secondary-text hover:text-foreground hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors cursor-pointer',
                    isPeekOpen && 'bg-sunken text-foreground'
                  )}
                >
                  {/* Icon with notification dot */}
                  <div className="relative flex items-center justify-center size-7 rounded bg-sunken/60 group-hover:bg-sunken border border-control-border">
                    <Icon className="size-4" />
                    {item.hasUnseenChanges && (
                      <span
                        data-slot="unseen-changes-dot"
                        aria-label="Unseen changes"
                        className="absolute -top-1 -right-1 size-2 rounded-full bg-risk border border-shell"
                      />
                    )}
                  </div>

                  {/* Rotated label (vertical) */}
                  <span
                    data-slot="rail-item-label"
                    style={{ writingMode: 'vertical-rl' }}
                    className="font-mono text-[11px] tracking-widest uppercase text-secondary-text group-hover:text-foreground py-1 rotate-180"
                  >
                    {item.title}
                  </span>
                </button>

                {/* Peek Flyout Card */}
                {isPeekOpen && (
                  <div
                    data-slot="panel-peek-flyout"
                    data-panel-id={item.id}
                    onClick={() => expand(item.id)}
                    className={cn(
                      'absolute top-0 w-72 max-h-[calc(100vh-100px)] rounded-xl border border-border bg-panel shadow-floating z-floating p-3 flex flex-col gap-2 cursor-pointer animate-in fade-in-0 zoom-in-95',
                      side === 'left' ? 'left-12' : 'right-12'
                    )}
                  >
                    <div className="flex items-center justify-between pb-1.5 border-b border-border/80">
                      <span className="text-ui font-semibold text-foreground">
                        {item.title}
                      </span>
                      <span className="font-mono text-xs text-secondary-text">
                        peek · click to pin
                      </span>
                    </div>
                    <div className="overflow-hidden text-xs text-body pointer-events-none max-h-64">
                      {renderPanel(item.id)}
                    </div>
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Bottom expand toggle button (as in 23G) */}
      <div className="flex flex-col items-center pb-2">
        <button
          type="button"
          data-slot="rail-expand-all"
          aria-label={side === 'left' ? 'Expand left panels' : 'Expand right panels'}
          onClick={() => {
            if (collapsedPanels.length > 0) {
              expand(collapsedPanels[0].id);
            }
          }}
          className="p-1.5 rounded text-secondary-text hover:text-foreground hover:bg-sunken transition-colors cursor-pointer"
        >
          {side === 'left' ? (
            <ChevronsRight className="size-4" />
          ) : (
            <ChevronsLeft className="size-4" />
          )}
        </button>
      </div>
    </aside>
  );
};
