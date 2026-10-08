import * as React from 'react';
import {
  MoreHorizontal,
  X,
  PanelLeft,
  PanelRight,
  AppWindow,
  ArrowRightToLine,
  ArrowLeftRight,
  Check,
  GripHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuHeader,
  DropdownMenuFooter,
} from '@/components/ui/dropdown-menu';
import type {
  PanelId,
  Placement,
  PanelMode,
  WorkspacePanelAction,
} from '@/features/workspace/panels';
import { usePanelCommands, type PanelCommandRoutes } from './panelCommands';

export type PanelMenuActionType =
  | 'dock-right'
  | 'dock-left'
  | 'float'
  | 'collapse'
  | 'reset-width'
  | 'close';

/**
 * Pure dispatcher for panel header menu actions. With `routes` (supplied by
 * the workspace) each action runs as its registry command; without them it
 * falls back to the raw reducer event (standalone previews and tests).
 */
export function dispatchPanelMenuAction(
  actionType: PanelMenuActionType,
  panelId: PanelId,
  placement: Placement,
  dispatch: (action: WorkspacePanelAction) => void,
  routes?: PanelCommandRoutes | null
): void {
  if (routes) {
    switch (actionType) {
      case 'dock-right':
        routes.place(panelId, 'right');
        break;
      case 'dock-left':
        routes.place(panelId, 'left');
        break;
      case 'float':
        routes.place(panelId, 'floating');
        break;
      case 'collapse':
        routes.collapse(panelId);
        break;
      case 'reset-width':
        routes.resetWidth(panelId);
        break;
      case 'close':
        routes.close(panelId);
        break;
    }
    return;
  }
  switch (actionType) {
    case 'dock-right':
      dispatch({ type: 'PLACE', panel: panelId, placement: 'right', index: 0 });
      break;
    case 'dock-left':
      dispatch({ type: 'PLACE', panel: panelId, placement: 'left', index: 0 });
      break;
    case 'float':
      dispatch({ type: 'PLACE', panel: panelId, placement: 'floating', index: 0 });
      break;
    case 'collapse':
      dispatch({ type: 'COLLAPSE', panel: panelId });
      break;
    case 'reset-width':
      if (placement === 'left') {
        dispatch({ type: 'RESET_SIDE', side: 'left' });
      } else {
        dispatch({ type: 'RESET_SIDE', side: 'right' });
      }
      break;
    case 'close':
      dispatch({ type: 'CLOSE', panel: panelId });
      break;
  }
}

export interface PanelHeaderProps {
  panelId: PanelId;
  title: string;
  badge?: React.ReactNode;
  placement: Placement;
  mode: PanelMode;
  currentWidth: number;
  dispatch: (action: WorkspacePanelAction) => void;
  onDragStart?: (e: React.PointerEvent) => void;
  showGrip?: boolean;
  isFloating?: boolean;
  className?: string;
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  renderMenuInline?: boolean;
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({
  panelId,
  title,
  badge,
  placement,
  mode,
  currentWidth,
  dispatch,
  onDragStart,
  showGrip = false,
  isFloating = false,
  className,
  menuOpen,
  onMenuOpenChange,
  renderMenuInline = false,
}) => {
  const routes = usePanelCommands();
  const isDockedRight = mode === 'docked-right' || (placement === 'right' && mode !== 'floating' && mode !== 'collapsed');
  const isDockedLeft = mode === 'docked-left' || (placement === 'left' && mode !== 'floating' && mode !== 'collapsed');
  const isFloat = mode === 'floating' || placement === 'floating';

  const handleDockRight = () => {
    dispatchPanelMenuAction('dock-right', panelId, placement, dispatch, routes);
  };

  const handleDockLeft = () => {
    dispatchPanelMenuAction('dock-left', panelId, placement, dispatch, routes);
  };

  const handleFloat = () => {
    dispatchPanelMenuAction('float', panelId, placement, dispatch, routes);
  };

  const handleCollapse = () => {
    dispatchPanelMenuAction('collapse', panelId, placement, dispatch, routes);
  };

  const handleResetWidth = () => {
    dispatchPanelMenuAction('reset-width', panelId, placement, dispatch, routes);
  };

  const handleClose = () => {
    dispatchPanelMenuAction('close', panelId, placement, dispatch, routes);
  };

  return (
    <div
      data-slot="panel-header"
      data-panel-id={panelId}
      tabIndex={-1}
      aria-label={`${title} panel`}
      className={cn(
        'group/header relative flex items-center justify-between px-3 py-2 border-b border-border bg-background text-foreground select-none shrink-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        onDragStart && 'cursor-grab active:cursor-grabbing',
        className
      )}
      onPointerDown={(e) => {
        // Only trigger drag if not clicking a button or menu
        if ((e.target as HTMLElement).closest('button, [role="menuitem"], [data-slot="dropdown-menu-content"]')) {
          return;
        }
        onDragStart?.(e);
      }}
    >
      {/* Top grip indicator for floating panel */}
      {showGrip && (
        <div
          data-slot="panel-grip-bar"
          aria-hidden="true"
          className="absolute -top-1.5 left-1/2 -translate-x-1/2 flex items-center justify-center text-secondary-text/60"
        >
          <GripHorizontal className="size-4" />
        </div>
      )}

      {/* Left: Title + optional badge */}
      <div className="flex items-center gap-2 min-w-0">
        <h2 className="text-ui font-semibold text-foreground truncate">
          {title}
        </h2>
        {badge && (
          <span
            data-slot="panel-header-badge"
            className="font-mono text-xs text-secondary-text rounded bg-sunken px-1.5 py-0.5 border border-control-border"
          >
            {badge}
          </span>
        )}
      </div>

      {/* Right: Actions menu ("…") and Close ("×") */}
      <div
        className="flex items-center gap-1 shrink-0"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-sm text-secondary-text hover:text-foreground hover:bg-sunken focus-visible:ring-1"
              aria-label={`${title} options`}
              data-slot="panel-menu-trigger"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={4}
            className="w-56 p-0 overflow-hidden"
            data-slot="panel-dropdown-menu"
          >
            <DropdownMenuHeader className="px-3 py-2 text-secondary-text">
              {title} {isFloating ? 'panel' : 'tab'}
            </DropdownMenuHeader>

            <div className="p-1.5 bg-background space-y-0.5">
              {/* Dock right */}
              <DropdownMenuItem
                onClick={handleDockRight}
                className={cn('text-[13px] gap-2.5 px-2.5 py-1.5 rounded-control', isDockedRight && 'bg-accent hover:bg-accent font-medium text-accent-foreground [&_svg]:text-accent-foreground')}
                data-slot="menu-item-dock-right"
              >
                <PanelRight className="size-3.5 text-secondary-text shrink-0" />
                <span>Dock right</span>
                {isDockedRight && <Check className="ml-auto size-3.5 text-primary" data-slot="check-icon" />}
              </DropdownMenuItem>

              {/* Dock left */}
              <DropdownMenuItem
                onClick={handleDockLeft}
                className={cn('text-[13px] gap-2.5 px-2.5 py-1.5 rounded-control', isDockedLeft && 'bg-accent hover:bg-accent font-medium text-accent-foreground [&_svg]:text-accent-foreground')}
                data-slot="menu-item-dock-left"
              >
                <PanelLeft className="size-3.5 text-secondary-text shrink-0" />
                <span>Dock left</span>
                {isDockedLeft && <Check className="ml-auto size-3.5 text-primary" data-slot="check-icon" />}
              </DropdownMenuItem>

              {/* Float */}
              <DropdownMenuItem
                onClick={handleFloat}
                className={cn('text-[13px] gap-2.5 px-2.5 py-1.5 rounded-control', isFloat && 'bg-accent hover:bg-accent font-medium text-accent-foreground [&_svg]:text-accent-foreground')}
                data-slot="menu-item-float"
              >
                <AppWindow className="size-3.5 text-secondary-text shrink-0" />
                <span>Float</span>
                {isFloat && <Check className="ml-auto size-3.5 text-primary" data-slot="check-icon" />}
              </DropdownMenuItem>

              <DropdownMenuSeparator className="my-1" />

              {/* Collapse to rail */}
              <DropdownMenuItem
                onClick={handleCollapse}
                className="text-[13px] gap-2.5 px-2.5 py-1.5 rounded-control"
                data-slot="menu-item-collapse"
              >
                <ArrowRightToLine className="size-3.5 text-secondary-text shrink-0" />
                <span>Collapse to rail</span>
              </DropdownMenuItem>

              {/* Reset width */}
              <DropdownMenuItem
                onClick={handleResetWidth}
                className="text-[13px] gap-2.5 px-2.5 py-1.5 rounded-control"
                data-slot="menu-item-reset-width"
              >
                <ArrowLeftRight className="size-3.5 text-secondary-text shrink-0" />
                <span>Reset width</span>
                <span className="ml-auto font-mono text-xs text-secondary-text">
                  {currentWidth}
                </span>
              </DropdownMenuItem>
            </div>

            <DropdownMenuFooter className="p-1 bg-panel border-t border-hairline">
              {/* Close */}
              <DropdownMenuItem
                onClick={handleClose}
                data-slot="menu-item-close"
                variant="default"
                className="text-[13px] gap-2.5 px-2.5 py-1.5 rounded-control"
              >
                <X className="size-3.5 text-secondary-text shrink-0" />
                <span>Close tab</span>
              </DropdownMenuItem>
            </DropdownMenuFooter>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          className="size-7 rounded-sm text-secondary-text hover:text-foreground hover:bg-sunken focus-visible:ring-1"
          onClick={handleClose}
          aria-label={`Close ${title}`}
          data-testid={panelId === 'inspector' ? 'inspector-close' : undefined}
          data-slot="panel-close-button"
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Static / SSR Inline Menu for Preview and Testing without Portal */}
      {menuOpen && renderMenuInline && (
        <div
          data-slot="panel-dropdown-menu"
          className="absolute right-3 top-10 z-popover min-w-[12rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0"
        >
          <div className="px-2 py-1.5 font-mono text-xs tracking-wide font-semibold text-secondary-text">
            {title} {isFloating ? 'panel' : 'tab'}
          </div>
          <div className="-mx-1 my-1 h-px bg-border" />
          <button
            type="button"
            onClick={handleDockRight}
            data-slot="menu-item-dock-right"
            className={cn(
              'relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] outline-none transition-colors hover:bg-sunken text-foreground',
              isDockedRight && 'bg-accent hover:bg-accent font-medium text-accent-foreground [&_svg]:text-accent-foreground'
            )}
          >
            <PanelRight className="size-4 mr-2 text-secondary-text" />
            <span>Dock right</span>
            {isDockedRight && <Check className="ml-auto size-4 text-primary" data-slot="check-icon" />}
          </button>
          <button
            type="button"
            onClick={handleDockLeft}
            data-slot="menu-item-dock-left"
            className={cn(
              'relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] outline-none transition-colors hover:bg-sunken text-foreground',
              isDockedLeft && 'bg-accent hover:bg-accent font-medium text-accent-foreground [&_svg]:text-accent-foreground'
            )}
          >
            <PanelLeft className="size-4 mr-2 text-secondary-text" />
            <span>Dock left</span>
            {isDockedLeft && <Check className="ml-auto size-4 text-primary" data-slot="check-icon" />}
          </button>
          <button
            type="button"
            onClick={handleFloat}
            data-slot="menu-item-float"
            className={cn(
              'relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] outline-none transition-colors hover:bg-sunken text-foreground',
              isFloat && 'bg-accent hover:bg-accent font-medium text-accent-foreground [&_svg]:text-accent-foreground'
            )}
          >
            <AppWindow className="size-4 mr-2 text-secondary-text" />
            <span>Float</span>
            {isFloat && <Check className="ml-auto size-4 text-primary" data-slot="check-icon" />}
          </button>
          <div className="-mx-1 my-1 h-px bg-border" />
          <button
            type="button"
            onClick={handleCollapse}
            data-slot="menu-item-collapse"
            className="relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] outline-none transition-colors hover:bg-sunken text-foreground"
          >
            <ArrowRightToLine className="size-4 mr-2 text-secondary-text" />
            <span>Collapse to rail</span>
          </button>
          <button
            type="button"
            onClick={handleResetWidth}
            data-slot="menu-item-reset-width"
            className="relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] outline-none transition-colors hover:bg-sunken text-foreground"
          >
            <ArrowLeftRight className="size-4 mr-2 text-secondary-text" />
            <span>Reset width</span>
            <span className="ml-auto font-mono text-xs text-secondary-text">{currentWidth}</span>
          </button>
          <button
            type="button"
            onClick={handleClose}
            data-slot="menu-item-close"
            className="relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] outline-none transition-colors hover:bg-sunken text-foreground"
          >
            <X className="size-4 mr-2 text-secondary-text" />
            <span>Close tab</span>
          </button>
        </div>
      )}
    </div>
  );
};
