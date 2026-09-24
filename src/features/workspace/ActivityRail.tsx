import * as React from 'react';
import { BookOpen, History } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function ActivityRail() {
  return (
    <TooltipProvider delayDuration={250}>
      <aside
        data-testid="workspace-activity-rail"
        className={cn(
          'w-11 min-w-[44px] max-w-[44px] h-full flex flex-col items-center py-2 px-0 shrink-0',
          'border-r border-border bg-shell select-none z-chrome',
        )}
        role="toolbar"
        aria-label="Workspace tools"
      >
        <div className="flex flex-col items-center gap-1 w-full">
          {/* Library item (disabled with tooltip) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-testid="rail-library-btn"
                aria-label="Library"
                disabled
                className={cn(
                  'w-10 h-10 flex flex-col items-center justify-center rounded-control cursor-not-allowed select-none',
                  'bg-transparent text-secondary-text opacity-70',
                )}
              >
                <BookOpen size={16} className="stroke-current text-secondary-text" />
                <span className="font-mono text-[9px] uppercase tracking-wide mt-0.5 text-secondary-text">Lib</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Not available yet</TooltipContent>
          </Tooltip>

          {/* History item (disabled with tooltip) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-testid="rail-history-btn"
                aria-label="History"
                disabled
                className={cn(
                  'w-10 h-10 flex flex-col items-center justify-center rounded-control cursor-not-allowed select-none',
                  'bg-transparent text-secondary-text opacity-70',
                )}
              >
                <History size={16} className="stroke-current text-secondary-text" />
                <span className="font-mono text-[9px] uppercase tracking-wide mt-0.5 text-secondary-text">Hist</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Not available yet</TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}
