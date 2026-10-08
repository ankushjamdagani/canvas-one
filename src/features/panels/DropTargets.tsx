import * as React from 'react';
import { cn } from '@/lib/utils';
import type { SideWidths } from '@/features/workspace/panels';
import { clampSideWidth } from './geometry';

export interface DropTargetsProps {
  activeTarget: 'left' | 'right' | null;
  sideWidths: SideWidths;
  className?: string;
}

export const DropTargets: React.FC<DropTargetsProps> = ({
  activeTarget,
  sideWidths,
  className,
}) => {
  const leftWidth = clampSideWidth(sideWidths.left);
  const rightWidth = clampSideWidth(sideWidths.right);

  return (
    <div
      data-slot="drop-targets-overlay"
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 z-dock overflow-hidden',
        className
      )}
    >
      {/* Left Dock Drop Target */}
      <div
        data-slot="drop-target-left"
        data-active={activeTarget === 'left'}
        style={{ width: `${leftWidth}px` }}
        className={cn(
          'absolute top-0 bottom-0 left-0 transition-colors flex flex-col justify-center items-center',
          activeTarget === 'left'
            ? 'bg-primary/10 border-r-2 border-primary'
            : 'border-r border-dashed border-control-border-strong/50'
        )}
      >
        <div
          data-slot="drop-target-left-preview"
          className={cn(
            'w-48 h-36 rounded-xl border-2 border-dashed flex flex-col items-center justify-center transition-all',
            activeTarget === 'left'
              ? 'border-primary bg-accent/40 shadow-sm'
              : 'border-control-border bg-transparent opacity-60'
          )}
        />
        <div
          data-slot="drop-badge-left"
          className={cn(
            'mt-4 px-3 py-1 rounded-full font-mono text-xs tracking-wider transition-all shadow-sm',
            activeTarget === 'left'
              ? 'bg-primary text-primary-foreground font-semibold ring-2 ring-primary/20 scale-105'
              : 'bg-card text-secondary-text border border-border'
          )}
        >
          Dock left
        </div>
      </div>

      {/* Right Dock Drop Target */}
      <div
        data-slot="drop-target-right"
        data-active={activeTarget === 'right'}
        style={{ width: `${rightWidth}px` }}
        className={cn(
          'absolute top-0 bottom-0 right-0 transition-colors flex flex-col justify-center items-center',
          activeTarget === 'right'
            ? 'bg-primary/10 border-l-2 border-primary'
            : 'border-l border-dashed border-control-border-strong/50'
        )}
      >
        <div
          data-slot="drop-target-right-preview"
          className={cn(
            'w-48 h-36 rounded-xl border-2 border-dashed flex flex-col items-center justify-center transition-all',
            activeTarget === 'right'
              ? 'border-primary bg-accent/40 shadow-sm'
              : 'border-control-border bg-transparent opacity-60'
          )}
        />
        <div
          data-slot="drop-badge-right"
          className={cn(
            'mt-4 px-3 py-1 rounded-full font-mono text-xs tracking-wider transition-all shadow-sm',
            activeTarget === 'right'
              ? 'bg-primary text-primary-foreground font-semibold ring-2 ring-primary/20 scale-105'
              : 'bg-card text-secondary-text border border-border'
          )}
        >
          Dock right
        </div>
      </div>
    </div>
  );
};
