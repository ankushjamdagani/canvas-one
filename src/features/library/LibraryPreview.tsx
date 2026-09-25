/**
 * LibraryPreview Component (RV-06b / Screens 12A, 12B, 12C, 16E).
 *
 * Provides a composite preview component rendering fixed-prop states of:
 * - 12A: LibraryPanel (List view)
 * - 12B: LibraryPanel (Grid view)
 * - 12C: LibraryPanel with EntryDetailCard hover detail popover
 * - 16E: LibraryPicker (Compact 4-column picker from dock)
 *
 * For lead verification and screenshot mounting without touching files outside this folder.
 */

import * as React from 'react';
import { CATALOG_ENTRIES } from '../catalog/catalog';
import { LibraryPanel } from './LibraryPanel';
import { LibraryPicker } from './LibraryPicker';
import { EntryDetailCard } from './EntryDetailCard';
import type { LibraryView } from './types';

export function LibraryPreview() {
  const [listSelectedId, setListSelectedId] = React.useState('service');
  const [gridSelectedId, setGridSelectedId] = React.useState('queue');
  const [pickerSelectedId, setPickerSelectedId] = React.useState('service');
  const [panelView, setPanelView] = React.useState<LibraryView>('list');

  const queueEntry = CATALOG_ENTRIES.find((e) => e.entryId === 'queue') ?? CATALOG_ENTRIES[0];

  return (
    <div className="p-8 space-y-12 bg-[#F9FAF8] min-h-screen text-[#16201D] font-sans">
      <div className="max-w-6xl mx-auto space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">System Studio Library Preview (RV-06b)</h1>
        <p className="text-sm text-[#626D68]">
          Reference screenshots comparison: 12A (List view), 12B (Grid view), 12C (Hover detail), 16E (Dock picker).
        </p>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Screen 12A: List View */}
        <div className="space-y-3">
          <div className="text-xs font-mono font-medium text-[#626D68] uppercase tracking-wider">
            Screen 12A: LibraryPanel (List View)
          </div>
          <div className="w-[380px] h-[640px] border border-[#E7E3DB] rounded-lg overflow-hidden shadow-sm">
            <LibraryPanel
              view="list"
              onViewChange={() => {}}
              selectedEntryId={listSelectedId}
              onSelect={setListSelectedId}
              onPlace={(id) => console.log('Place 12A:', id)}
              onClose={() => console.log('Close 12A')}
            />
          </div>
        </div>

        {/* Screen 12B: Grid View */}
        <div className="space-y-3">
          <div className="text-xs font-mono font-medium text-[#626D68] uppercase tracking-wider">
            Screen 12B: LibraryPanel (Grid View)
          </div>
          <div className="w-[380px] h-[640px] border border-[#E7E3DB] rounded-lg overflow-hidden shadow-sm">
            <LibraryPanel
              view="grid"
              onViewChange={() => {}}
              selectedEntryId={gridSelectedId}
              onSelect={setGridSelectedId}
              onPlace={(id) => console.log('Place 12B:', id)}
              onClose={() => console.log('Close 12B')}
            />
          </div>
        </div>
      </div>

      {/* Screen 12C: Hover Detail Popover */}
      <div className="max-w-6xl mx-auto space-y-3">
        <div className="text-xs font-mono font-medium text-[#626D68] uppercase tracking-wider">
          Screen 12C: Hover Detail Card (Queue entry)
        </div>
        <div className="p-6 bg-white border border-[#E7E3DB] rounded-xl inline-block shadow-sm">
          <EntryDetailCard entry={queueEntry} />
        </div>
      </div>

      {/* Screen 16E: LibraryPicker from Dock */}
      <div className="max-w-6xl mx-auto space-y-3">
        <div className="text-xs font-mono font-medium text-[#626D68] uppercase tracking-wider">
          Screen 16E: LibraryPicker (Dock Compact Picker)
        </div>
        <div className="w-[620px] max-w-full">
          <LibraryPicker
            selectedEntryId={pickerSelectedId}
            onSelect={setPickerSelectedId}
            onPlace={(id) => console.log('Place 16E:', id)}
            onOpenFullLibrary={() => console.log('Open Full Library')}
            onClose={() => console.log('Close Picker')}
          />
        </div>
      </div>
    </div>
  );
}
