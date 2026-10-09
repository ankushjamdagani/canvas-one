/**
 * LibraryPanel: the standard component catalog library panel.
 * - List view with kind icon, label, libraryCaption, and "Not simulated" tags.
 * - 2-column Grid view with cards, previews, and group headers with counts.
 * - Hover/focus detail popover (see EntryDetailCard for the rows it omits).
 * - Footer bar with "<label> · DEFAULTS · ..." and "Place on canvas" primary action.
 * - Drag-and-drop: sets 'application/x-studio-catalog-entry' MIME type.
 * - Keyboard navigation (arrow keys, Enter, Escape) & touch (tap to select, second tap or footer button to place).
 * - Responsive: adapts between 320px and 440px widths, filling width at 390x844.
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import { usePortalRoot } from '@/components/ui/portal-root';
import {
  X,
  Search,
  List as ListIcon,
  LayoutGrid,
} from 'lucide-react';
import { CATALOG_ENTRIES } from '../catalog/catalog';
import { defaultsLine } from '../catalog/caption';
import { getNodeIcon } from '../workspace/nodeVisuals';
import type { LibraryPanelProps, LibraryTab } from './types';
import { filterEntries, groupCatalogEntries } from './viewModel';
import { EntryDetailCard } from './EntryDetailCard';
import { CatalogEntryCard } from './CatalogEntryCard';
import { useCatalogSelection } from './useCatalogSelection';
import { cn } from '../../lib/utils';

// The linked-project entry is instantiated from a project (Projects tab), not placed from the catalog.
const STANDARD_ENTRIES = CATALOG_ENTRIES.filter((entry) => entry.visualKind !== 'linked-project');

export function LibraryPanel({
  onPlace,
  onClose,
  view,
  onViewChange,
  selectedEntryId: controlledSelectedEntryId,
  onSelect,
  initialSearchQuery = '',
  className,
  renderSavedParts,
  renderLinkedProjects,
  captureRequested,
}: LibraryPanelProps) {
  const portalRoot = usePortalRoot();
  const [searchQuery, setSearchQuery] = React.useState(initialSearchQuery);
  const [tab, setTab] = React.useState<LibraryTab>('standard');
  const [oursCount, setOursCount] = React.useState(0);
  const [projectsCount, setProjectsCount] = React.useState(0);
  const lastCaptureRequest = React.useRef(captureRequested ?? 0);
  React.useEffect(() => {
    if (captureRequested && captureRequested !== lastCaptureRequest.current) setTab('ours');
    lastCaptureRequest.current = captureRequested ?? 0;
  }, [captureRequested]);
  const [hoveredEntryId, setHoveredEntryId] = React.useState<string | null>(null);
  // The detail card is portalled to the body and positioned from viewport
  // coordinates, so no scroll or overflow wrapper inside the panel can clip it.
  const [popoverPosition, setPopoverPosition] = React.useState<{
    top: number;
    left?: number;
    right?: number;
  } | null>(null);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const listContainerRef = React.useRef<HTMLDivElement>(null);

  const filteredEntries = React.useMemo(() => filterEntries(STANDARD_ENTRIES, searchQuery), [searchQuery]);
  const groupedSections = React.useMemo(() => groupCatalogEntries(filteredEntries), [filteredEntries]);

  const { selectedEntry, activate, onDragStart, onKeyDown } = useCatalogSelection({
    entries: filteredEntries,
    controlledSelectedId: controlledSelectedEntryId,
    onSelect,
    onPlace,
    onClose,
    columns: view === 'grid' ? 2 : 1,
    searchInputRef,
  });

  const activeDetailEntry = hoveredEntryId
    ? CATALOG_ENTRIES.find((e) => e.entryId === hoveredEntryId) ?? null
    : null;

  const showDetail = React.useCallback(
    (target: HTMLElement, entryId: string) => {
      setHoveredEntryId(entryId);
      if (containerRef.current) {
        const targetRect = target.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();
        const gap = 8;
        const top = Math.min(Math.max(8, targetRect.top), Math.max(8, window.innerHeight - 340));
        // Open toward the canvas: left of a right-docked panel, right of a left-docked one.
        const dockedLeft = containerRect.left + containerRect.width / 2 < window.innerWidth / 2;
        setPopoverPosition(
          dockedLeft
            ? { top, left: containerRect.right + gap }
            : { top, right: window.innerWidth - containerRect.left + gap },
        );
      }
    },
    [],
  );

  const hideDetail = React.useCallback(() => setHoveredEntryId(null), []);

  const detailHandlers = (entryId: string): React.HTMLAttributes<HTMLDivElement> => ({
    onMouseEnter: (e) => showDetail(e.currentTarget, entryId),
    onMouseLeave: hideDetail,
    onFocus: (e) => showDetail(e.currentTarget, entryId),
    onBlur: hideDetail,
  });

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Component Library"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        'relative flex flex-col h-full w-full bg-panel text-foreground font-sans select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'min-w-0 max-w-none border-0',
        className,
      )}
      data-testid="library-panel"
    >
      <div className="shrink-0 bg-background border-b border-border">
      {/* 2. Search Field */}
      <div className="px-4 pt-1 pb-3">
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 w-4 h-4 text-secondary-text pointer-events-none" />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (searchQuery) {
                  e.stopPropagation();
                  setSearchQuery('');
                }
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                // Move focus to list
                listContainerRef.current?.focus();
              }
            }}
            placeholder="Search parts, tags, models..."
            aria-label="Search components"
            className="w-full h-8 pointer-coarse:h-11 pl-8 pr-18 text-xs rounded-md bg-sunken border border-control-border text-foreground placeholder:text-secondary-text focus:border-control-border-strong focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring transition-all"
          />
          {searchQuery.trim().length > 0 && (
            <div className="absolute right-2.5 flex items-center gap-1.5 text-[11px] font-mono text-secondary-text">
              <span>
                {tab !== 'standard' ? 'Search active' : `${filteredEntries.length} ${filteredEntries.length === 1 ? 'match' : 'matches'}`}
              </span>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search query"
                className="p-0.5 rounded hover:bg-border text-secondary-text"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 3. Filter Bar & List/Grid Toggle */}
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1 px-4 pb-0 text-xs">
        <div role="tablist" aria-label="Library source" className="flex w-max max-w-full shrink-0 items-end gap-3 -mb-px overflow-x-auto">
          {(['standard', ...(renderSavedParts ? ['ours'] : []), ...(renderLinkedProjects ? ['projects'] : [])] as LibraryTab[]).map((id) => {
            const selectedTab = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selectedTab}
                data-testid={`library-tab-${id}`}
                onClick={() => setTab(id)}
                className={cn(
                  'flex items-center gap-1.5 py-2 text-[13px] border-b-2 transition-colors cursor-pointer',
                  selectedTab
                    ? 'font-semibold text-primary border-primary'
                    : 'font-medium text-secondary-text border-transparent hover:text-foreground',
                )}
              >
                <span>{id === 'standard' ? 'Standard' : id === 'ours' ? 'Ours' : 'Projects'}</span>
                <span
                  className={cn(
                    'font-mono text-[10px] rounded-full px-1.5 leading-4',
                    selectedTab
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-sunken text-secondary-text border border-border',
                  )}
                >
                  {id === 'standard' ? STANDARD_ENTRIES.length : id === 'ours' ? oursCount : projectsCount}
                </span>
              </button>
            );
          })}
        </div>

        {/* List / Grid segmented toggle (the Projects tab has a single list) */}
        <div
          hidden={tab === 'projects'}
          role="group"
          aria-label="View mode toggle"
          className="flex items-center p-0.5 mb-1.5 rounded-md bg-sunken border border-control-border"
        >
          <button
            type="button"
            onClick={() => onViewChange('list')}
            title="List view"
            aria-label="List view"
            aria-pressed={view === 'list'}
            className={`flex items-center gap-1 px-2 py-0.5 pointer-coarse:min-h-11 rounded text-[11px] font-medium transition-all ${
              view === 'list'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-secondary-text hover:text-foreground'
            }`}
          >
            <ListIcon className="w-3.5 h-3.5" />
            <span className="sr-only">List</span>
          </button>
          <button
            type="button"
            onClick={() => onViewChange('grid')}
            title="Grid view"
            aria-label="Grid view"
            aria-pressed={view === 'grid'}
            className={`flex items-center gap-1 px-2 py-0.5 pointer-coarse:min-h-11 rounded text-[11px] font-medium transition-all ${
              view === 'grid'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-secondary-text hover:text-foreground'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span className="sr-only">Grid</span>
          </button>
        </div>
      </div>

      </div>

      {/* 4. Entries Scroll Area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
      {renderSavedParts?.({ searchQuery, view, active: tab === 'ours', onCountChange: setOursCount })}
      {renderLinkedProjects?.({ searchQuery, active: tab === 'projects', onCountChange: setProjectsCount })}
      <div
        ref={listContainerRef}
        role="listbox"
        hidden={tab !== 'standard'}
        aria-label="Component catalog entries"
        tabIndex={0}
        className="p-4 space-y-4 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {filteredEntries.length === 0 ? (
          /* Empty state: clear search way out */
          <div className="py-12 px-4 text-center">
            <p className="text-xs text-secondary-text mb-3">
              No components match &ldquo;{searchQuery}&rdquo;
            </p>
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-control-border bg-background hover:bg-sunken text-primary shadow-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Clear search
            </button>
          </div>
        ) : (
          groupedSections.map((section) => (
            <div key={section.group} className="space-y-2">
              {/* Group header with line and count */}
              <div className="flex items-center gap-2 text-[10.5px] font-mono tracking-widest text-secondary-text">
                <span
                  className="font-medium"
                >
                  {section.group}
                </span>
                <div className="flex-1 h-px bg-border" />
                <span className="text-[10px] text-secondary-text">
                  {section.count}
                </span>
              </div>

              <div className={view === 'list' ? 'space-y-1.5' : 'grid grid-cols-2 gap-2 min-w-0'}>
                {section.entries.map((entry) => (
                  <CatalogEntryCard
                    key={entry.entryId}
                    entry={entry}
                    variant={view === 'list' ? 'row' : 'card'}
                    selected={selectedEntry?.entryId === entry.entryId}
                    onActivate={activate}
                    onPlace={onPlace}
                    onDragStart={onDragStart}
                    rootProps={detailHandlers(entry.entryId)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Floating Hover/Focus Detail Popover */}
      </div>
      {activeDetailEntry &&
        popoverPosition &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="hidden md:block fixed z-popover pointer-events-none"
            style={{ top: popoverPosition.top, left: popoverPosition.left, right: popoverPosition.right }}
          >
            <EntryDetailCard entry={activeDetailEntry} />
          </div>,
          portalRoot ?? document.body,
        )}

      {/* 5. Sticky Footer Bar */}
      <div className="px-4 py-3 border-t border-border bg-background flex items-center justify-between gap-3">
        {selectedEntry ? (
          <>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {(() => {
                const Icon = getNodeIcon(selectedEntry.visualKind);
                return (
                  <div className="w-7 h-7 rounded bg-background border border-border flex items-center justify-center flex-shrink-0 text-foreground">
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                );
              })()}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-foreground leading-tight truncate">
                  {selectedEntry.label}
                </div>
                <div className="text-[10.5px] font-mono text-secondary-text truncate mt-0.5">
                  {defaultsLine(selectedEntry)}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onPlace(selectedEntry.entryId)}
              aria-label={`Place ${selectedEntry.label} on canvas`}
              className="px-4 py-2 pointer-coarse:min-h-11 rounded-control bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-medium shadow-xs transition-colors flex-shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-none flex items-center gap-1.5"
            >
              <span>Place on canvas</span>
            </button>
          </>
        ) : (
          <div className="text-xs text-secondary-text">
            Select an entry to place
          </div>
        )}
      </div>
    </div>
  );
}
