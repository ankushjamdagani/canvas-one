/**
 * Shared selection, keyboard and drag behaviour for catalog entry lists
 * (LibraryPanel and LibraryPicker).
 */

import * as React from 'react';
import type { CatalogEntry } from '../catalog/catalog';
import { CATALOG_ENTRY_MIME_TYPE } from './types';
import { keyboardNavigationReducer, type NavigationAction } from './viewModel';

export interface UseCatalogSelectionOptions {
  readonly entries: readonly CatalogEntry[];
  readonly controlledSelectedId?: string | null;
  readonly onSelect?: (entryId: string) => void;
  readonly onPlace: (entryId: string) => void;
  readonly onClose?: () => void;
  /** Columns the entries are laid out in; 1 means a single list column. */
  readonly columns: number;
  /** Ref of the search input; Enter inside it must not place. */
  readonly searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export function useCatalogSelection({
  entries,
  controlledSelectedId,
  onSelect,
  onPlace,
  onClose,
  columns,
  searchInputRef,
}: UseCatalogSelectionOptions) {
  const [internalSelectedId, setInternalSelectedId] = React.useState<string | null>(
    () => controlledSelectedId ?? entries[0]?.entryId ?? null,
  );

  React.useEffect(() => {
    if (controlledSelectedId !== undefined) setInternalSelectedId(controlledSelectedId);
  }, [controlledSelectedId]);

  const selectedEntry = React.useMemo(() => {
    const found = internalSelectedId
      ? entries.find((e) => e.entryId === internalSelectedId)
      : undefined;
    return found ?? entries[0] ?? null;
  }, [entries, internalSelectedId]);

  const select = React.useCallback(
    (entryId: string) => {
      setInternalSelectedId(entryId);
      onSelect?.(entryId);
    },
    [onSelect],
  );

  /** First tap selects; a second tap on the selected entry places it. */
  const activate = React.useCallback(
    (entry: CatalogEntry) => {
      if (selectedEntry?.entryId === entry.entryId) onPlace(entry.entryId);
      else select(entry.entryId);
    },
    [selectedEntry, select, onPlace],
  );

  const onDragStart = React.useCallback((e: React.DragEvent, entryId: string) => {
    e.dataTransfer.setData(CATALOG_ENTRY_MIME_TYPE, entryId);
    e.dataTransfer.effectAllowed = 'copyMove';
  }, []);

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (entries.length === 0) return;

      let action: NavigationAction | null = null;
      if (e.key === 'ArrowDown') action = { type: 'ARROW_DOWN', columns };
      else if (e.key === 'ArrowUp') action = { type: 'ARROW_UP', columns };
      else if (columns > 1 && e.key === 'ArrowRight') action = { type: 'ARROW_RIGHT' };
      else if (columns > 1 && e.key === 'ArrowLeft') action = { type: 'ARROW_LEFT' };

      if (action) {
        e.preventDefault();
        const currentIndex = entries.findIndex((entry) => entry.entryId === selectedEntry?.entryId);
        const next = keyboardNavigationReducer({ selectedIndex: currentIndex }, action, entries.length);
        const nextEntry = entries[next.selectedIndex];
        if (nextEntry) select(nextEntry.entryId);
      } else if (
        e.key === 'Enter' &&
        selectedEntry &&
        document.activeElement !== searchInputRef.current
      ) {
        e.preventDefault();
        onPlace(selectedEntry.entryId);
      }
    },
    [entries, selectedEntry, columns, select, onPlace, onClose, searchInputRef],
  );

  return { selectedEntry, select, activate, onDragStart, onKeyDown };
}
