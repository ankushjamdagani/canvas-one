/**
 * CatalogEntryCard: one selectable, draggable catalog entry, shown as a list
 * row or a preview card. Shared by LibraryPanel and LibraryPicker.
 */

import * as React from 'react';
import { GROUP_STRIPE_COLORS, type CatalogEntry } from '../catalog/catalog';
import { libraryCaption } from '../catalog/caption';
import { getNodeIcon } from '../workspace/nodeVisuals';
import { cn } from '../../lib/utils';
import { isUnmodeledEntry } from './viewModel';

export interface CatalogEntryCardProps {
  readonly entry: CatalogEntry;
  readonly variant: 'row' | 'card';
  readonly selected: boolean;
  /** Smaller preview box for the dock picker. */
  readonly compact?: boolean;
  readonly onActivate: (entry: CatalogEntry) => void;
  readonly onPlace: (entryId: string) => void;
  readonly onDragStart: (e: React.DragEvent, entryId: string) => void;
  /** Extra handlers (hover/focus detail) forwarded to the root element. */
  readonly rootProps?: React.HTMLAttributes<HTMLDivElement>;
}

export function CatalogEntryCard({
  entry,
  variant,
  selected,
  compact = false,
  onActivate,
  onPlace,
  onDragStart,
  rootProps,
}: CatalogEntryCardProps) {
  const unmodeled = isUnmodeledEntry(entry);
  const Icon = getNodeIcon(entry.visualKind);
  const stripeColor = GROUP_STRIPE_COLORS[entry.group];
  const caption = entry.behaviorKind === 'unmodeled' ? entry.models : libraryCaption(entry);

  return (
    <div
      {...rootProps}
      role="option"
      aria-selected={selected}
      aria-label={`${entry.label}: ${libraryCaption(entry)}`}
      tabIndex={selected ? 0 : -1}
      draggable
      onDragStart={(e) => onDragStart(e, entry.entryId)}
      onClick={() => onActivate(entry)}
      onDoubleClick={() => onPlace(entry.entryId)}
      data-entry-id={entry.entryId}
      className={cn(
        'group relative flex p-2 rounded-lg border transition-all cursor-pointer select-none',
        variant === 'row' ? 'items-center gap-2.5' : 'flex-col min-w-0',
        selected
          ? 'border-primary bg-accent ring-1 ring-ring'
          : 'border-border bg-background hover:border-control-border-strong hover:bg-sunken/50',
      )}
    >
      {variant === 'row' ? (
        <div
          className="w-8 h-8 rounded-md bg-sunken border border-border flex items-center justify-center shrink-0 text-foreground relative overflow-hidden"
          style={stripeColor ? { borderLeftColor: stripeColor, borderLeftWidth: 3 } : undefined}
        >
          <Icon className="w-4 h-4" />
        </div>
      ) : (
        <div
          className={cn(
            'w-full rounded-md bg-sunken border border-border/60 flex items-center justify-center relative overflow-hidden mb-1.5',
            compact ? 'h-12' : 'h-14',
          )}
        >
          {stripeColor && (
            <div
              className="absolute top-0 left-0 right-0 h-[3px]"
              style={{ backgroundColor: stripeColor }}
            />
          )}
          <Icon className={cn('text-foreground/80', compact ? 'w-4 h-4' : 'w-5 h-5')} />
        </div>
      )}

      <div className={variant === 'row' ? 'flex-1 min-w-0' : undefined}>
        <div className={cn('text-xs font-semibold truncate leading-tight', selected ? 'text-accent-foreground' : 'text-foreground')}>{entry.label}</div>
        <div
          className={cn(
            'font-mono truncate mt-0.5', selected ? 'text-accent-foreground' : 'text-secondary-text',
            variant === 'row' ? 'text-[11px]' : 'text-[10px]',
          )}
        >
          {caption}
        </div>
        {variant === 'card' && unmodeled && (
          <span className="inline-block mt-1 text-[9px] font-mono px-1 py-px rounded bg-sunken text-secondary-text border border-border">
            Not simulated
          </span>
        )}
      </div>

      {variant === 'row' && (
        <div className="flex items-center gap-1.5 shrink-0">
          {unmodeled && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sunken text-secondary-text border border-border">
              Not simulated
            </span>
          )}
          <span className={cn('text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-opacity', selected ? 'text-accent-foreground' : 'text-secondary-text')}>
            drag
          </span>
        </div>
      )}
    </div>
  );
}
